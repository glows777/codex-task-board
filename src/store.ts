import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { reduceTask, type Activity, type Event, type Snapshot, type Task } from "./model.ts";

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
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  }
  record(event: Event): void {
    this.db.transaction(() => {
      const previous = this.task(event.sessionId);
      this.db.query("INSERT INTO events(session,payload,at) VALUES(?,?,?)").run(event.sessionId, JSON.stringify(event), event.at);
      const next = reduceTask(previous, event);
      if (next && next !== previous) this.db.query("INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").run(next.id, JSON.stringify(next), next.updatedAt);
    }).immediate();
  }
  task(id: string): Task | null {
    const row = this.db.query<{payload: string}, [string]>("SELECT payload FROM tasks WHERE id=?").get(id);
    return row ? JSON.parse(row.payload) : null;
  }
  snapshot(): Snapshot {
    return this.db.transaction(() => {
      const info = this.db.query<{last: number | null; first: number | null; revision: number}, []>("SELECT MAX(at) AS last, MIN(at) AS first, COALESCE(MAX(sequence),0) AS revision FROM events").get()!;
      return { tasks: this.db.query<{payload: string}, []>("SELECT payload FROM tasks ORDER BY updated_at DESC").all().map(row => JSON.parse(row.payload)), lastEventAt: info.last, collectedSince: info.first, revision: info.revision };
    })();
  }
  activities(id: string): Activity[] {
    return this.db.query<{sequence: number; payload: string}, [string]>("SELECT sequence,payload FROM events WHERE session=? ORDER BY sequence DESC LIMIT 30").all(id).map(row => ({ ...JSON.parse(row.payload), sequence: row.sequence }));
  }
  close(): void { this.db.close(); }
}
