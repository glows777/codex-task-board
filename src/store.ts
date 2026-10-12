import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { reduceTask, type Activity, type Event, type FocusState, type FocusTask, type Snapshot, type Task } from "./model.ts";
import { isGeneratedPrompt } from "./events.ts";

// Compatibility MCP processes don't receive the hooks' PLUGIN_DATA. Use one shared local path.
export function dataDirectory(): string { return process.env.TASK_BOARD_DATA_DIR || join(homedir(), ".local", "share", "codex-task-board"); }
export class Store {
  readonly db: Database;
  constructor(directory = dataDirectory()) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new Database(join(directory, "board.sqlite"), { create: true, strict: true });
    this.db.exec(`PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session ON events(session, sequence);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS focus (id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'following', name TEXT NOT NULL DEFAULT '',
        viewed_reply INTEGER NOT NULL DEFAULT 0, last_reply INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0);`);
    // Add personal state without rewriting hook history or treating old replies as completed.
    if (this.db.query<{user_version:number},[]>("PRAGMA user_version").get()!.user_version < 1) this.db.transaction(() => {
      this.db.exec(`INSERT OR IGNORE INTO focus(id,state,last_reply,excluded)
      SELECT tasks.id, 'discovered', COALESCE((SELECT MAX(sequence) FROM events WHERE session=tasks.id AND json_extract(payload,'$.name')='Stop'),0),
      CASE WHEN (SELECT json_extract(payload,'$.summary') FROM events WHERE session=tasks.id AND json_extract(payload,'$.name')='UserPromptSubmit' ORDER BY sequence DESC LIMIT 1)
        LIKE 'This is an app-generated request for a suggested next user message.%The user did not write this message.%' THEN 1 ELSE 0 END
      FROM tasks;
      PRAGMA user_version=1;`);
    }).immediate();
  }
  record(event: Event): void {
    this.db.transaction(() => {
      // Explicit state also applies to existing databases whose column default is still discovered.
      this.db.query("INSERT OR IGNORE INTO focus(id,state) VALUES(?,'following')").run(event.sessionId);
      if (event.name === "UserPromptSubmit") {
        const excluded = Number(isGeneratedPrompt(event.summary));
        this.db.query("UPDATE focus SET excluded=?,version=version+1 WHERE id=? AND excluded<>?").run(excluded,event.sessionId,excluded);
      }
      if (this.db.query<{excluded:number},[string]>("SELECT excluded FROM focus WHERE id=?").get(event.sessionId)?.excluded) return;
      const previous = this.task(event.sessionId);
      const recorded = this.db.query("INSERT INTO events(session,payload,at) VALUES(?,?,?)").run(event.sessionId, JSON.stringify(event), event.at);
      const next = reduceTask(previous, event);
      if (next && next !== previous) this.db.query("INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").run(next.id, JSON.stringify(next), next.updatedAt);
      if (next && next !== previous && event.name === "Stop") this.db.query("UPDATE focus SET last_reply=?,version=version+1 WHERE id=?").run(recorded.lastInsertRowid,event.sessionId);
    }).immediate();
  }
  task(id: string): Task | null {
    const row = this.db.query<{payload: string}, [string]>("SELECT payload FROM tasks WHERE id=?").get(id);
    return row ? JSON.parse(row.payload) : null;
  }
  snapshot(): Snapshot {
    return this.db.transaction(() => {
      const info = this.db.query<{last: number | null; first: number | null; revision: number}, []>("SELECT MAX(at) AS last, MIN(at) AS first, COALESCE(MAX(sequence),0) AS revision FROM events").get()!;
      const tasks = this.db.query<{payload:string;state:FocusState;name:string;viewed_reply:number;last_reply:number;version:number}, []>(
        "SELECT tasks.payload,focus.* FROM tasks JOIN focus ON focus.id=tasks.id WHERE focus.excluded=0 ORDER BY tasks.updated_at DESC"
      ).all().map(row => {
        const task: Task = JSON.parse(row.payload);
        return { ...task, request: task.request ?? task.title, reply: task.reply ?? (task.status === "ended" ? task.activity : ""),
          title: row.name || `对话 · ${task.id.slice(-8)}`, titleKnown: !!row.name,
          focus: row.state, version: row.version, replySequence: row.last_reply, viewedReplySequence: row.viewed_reply };
      });
      const versions = this.db.query<{total:number},[]>("SELECT COALESCE(SUM(version),0) AS total FROM focus").get()!.total;
      return { tasks, lastEventAt: info.last, collectedSince: info.first, revision: info.revision + versions };
    })();
  }
  setNames(names: {id:string;name:string}[]): void {
    this.db.transaction(() => {
      for (const item of names) this.db.query("UPDATE focus SET name=?,version=version+1 WHERE id=? AND name<>?").run(item.name,item.id,item.name);
    }).immediate();
  }
  updateFocus(id: string, patch: { state?: FocusState; viewedReplySequence?: number }, expectedVersion: number): FocusTask {
    return this.db.transaction(() => {
      if (!this.task(id)) throw new Error("对话记录不存在，请刷新。");
      const row = this.db.query<{state:FocusState;viewed_reply:number;last_reply:number;version:number;excluded:number},[string]>("SELECT * FROM focus WHERE id=?").get(id)!;
      if (row.excluded) throw new Error("这条记录是应用生成的请求，不能加入关注。");
      if (row.version !== expectedVersion) throw new Error("这条对话刚有更新，请刷新后再操作。");
      if (patch.viewedReplySequence !== undefined && (patch.viewedReplySequence < 0 || patch.viewedReplySequence > row.last_reply)) throw new Error("查看标记无效，请刷新。");
      this.db.query("UPDATE focus SET state=?,viewed_reply=?,version=version+1 WHERE id=?").run(patch.state ?? row.state,Math.max(row.viewed_reply,patch.viewedReplySequence ?? row.viewed_reply),id);
      return this.snapshot().tasks.find(task => task.id === id)!;
    }).immediate();
  }
  activities(id: string): Activity[] {
    return this.db.query<{sequence: number; payload: string}, [string]>("SELECT sequence,payload FROM events WHERE session=? ORDER BY sequence DESC LIMIT 30").all(id).map(row => ({ ...JSON.parse(row.payload), sequence: row.sequence }));
  }
  close(): void { this.db.close(); }
}
