import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeEvent } from "../src/events.ts";
import { hasUnreadReply } from "../src/model.ts";
import { Store } from "../src/store.ts";
import { nameSync } from "../src/thread-names.ts";

const directories: string[] = [];
function setup() { const directory = mkdtempSync(join(tmpdir(), "focus-test-")); directories.push(directory); return { directory, store: new Store(directory) }; }
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const event = (name: string, extra = {}) => normalizeEvent({ hook_event_name: name, session_id: "thread-1", turn_id: "turn-1", cwd: "/project", prompt: "第一轮需求", last_assistant_message: "第一轮回复", ...extra });

test("new replies need review; only a human mutation completes a followed conversation", () => {
  const { store, directory } = setup();
  store.record(event("UserPromptSubmit")); store.setNames([{ id: "thread-1", name: "稳定的对话名称" }]);
  let task = store.snapshot().tasks[0]; expect(task.focus).toBe("following");
  store.record(event("Stop")); task = store.snapshot().tasks[0];
  expect(task.focus).toBe("following"); expect(hasUnreadReply(task)).toBe(true);
  task = store.updateFocus(task.id, { viewedReplySequence: task.replySequence }, task.version);
  expect(task.focus).toBe("following"); expect(hasUnreadReply(task)).toBe(false);
  store.record(event("UserPromptSubmit", { turn_id: "turn-2", prompt: "继续" }));
  expect(store.snapshot().tasks[0].title).toBe("稳定的对话名称");
  store.record(event("Stop", { turn_id: "turn-2", last_assistant_message: "第二轮回复" }));
  task = store.snapshot().tasks[0]; expect(hasUnreadReply(task)).toBe(true);
  task = store.updateFocus(task.id, { state: "done" }, task.version);
  store.record(event("UserPromptSubmit", { turn_id: "turn-3", prompt: "又一个需求" }));
  store.record(event("Stop", { turn_id: "turn-3" }));
  expect(store.snapshot().tasks[0].focus).toBe("done");
  store.close();
  const reloaded = new Store(directory);
  expect(reloaded.snapshot().tasks[0].focus).toBe("done");
  expect(hasUnreadReply(reloaded.snapshot().tasks[0])).toBe(true);
  reloaded.close();
});

test("new conversations follow by default in an existing database without overriding personal choices", () => {
  const directory = mkdtempSync(join(tmpdir(), "focus-existing-")); directories.push(directory);
  const db = new Database(join(directory, "board.sqlite"));
  db.exec(`CREATE TABLE focus (id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'discovered', name TEXT NOT NULL DEFAULT '',
    viewed_reply INTEGER NOT NULL DEFAULT 0, last_reply INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0);
    PRAGMA user_version=1;`);
  db.close();
  let store = new Store(directory);
  for (const state of ["discovered", "later", "done"] as const) {
    store.record(event("UserPromptSubmit", { session_id: state }));
    const task = store.snapshot().tasks.find(task => task.id === state)!;
    store.updateFocus(task.id, { state }, task.version);
  }
  store.close(); store = new Store(directory);
  store.record(event("SessionStart"));
  store.record(event("UserPromptSubmit"));
  expect(store.snapshot().tasks.find(task => task.id === "thread-1")!.focus).toBe("following");
  for (const state of ["discovered", "later", "done"] as const) {
    store.record(event("UserPromptSubmit", { session_id: state, turn_id: "turn-2" }));
    store.record(event("Stop", { session_id: state, turn_id: "turn-2" }));
    expect(store.snapshot().tasks.find(task => task.id === state)!.focus).toBe(state);
  }
  store.close();
});

test("stale panels cannot clear a reply that arrived after the viewed card or override another panel", () => {
  const { store, directory } = setup(); store.record(event("UserPromptSubmit")); store.record(event("Stop"));
  const stale = store.snapshot().tasks[0];
  const second = new Store(directory);
  second.updateFocus(stale.id, { state: "later" }, stale.version);
  expect(() => store.updateFocus(stale.id, { state: "done" }, stale.version)).toThrow("刚有更新");
  const beforeReply = store.snapshot().tasks[0];
  store.record(event("UserPromptSubmit", { turn_id: "turn-2" })); store.record(event("Stop", { turn_id: "turn-2" }));
  expect(() => store.updateFocus(beforeReply.id, { viewedReplySequence: beforeReply.replySequence }, beforeReply.version)).toThrow("刚有更新");
  expect(hasUnreadReply(store.snapshot().tasks[0])).toBe(true);
  second.close(); store.close();
});

test("late and duplicate Stop events do not manufacture new unread replies", () => {
  const { store } = setup(); store.record(event("UserPromptSubmit")); store.record(event("Stop"));
  const task = store.snapshot().tasks[0]; store.updateFocus(task.id, { viewedReplySequence: task.replySequence }, task.version);
  store.record(event("Stop"));
  expect(hasUnreadReply(store.snapshot().tasks[0])).toBe(false);
  store.record(event("UserPromptSubmit", { turn_id: "turn-2" })); store.record(event("Stop"));
  expect(hasUnreadReply(store.snapshot().tasks[0])).toBe(false);
  store.close();
});

test("observed app-generated request envelopes are excluded, ordinary English remains available", () => {
  const { store } = setup();
  store.record(event("UserPromptSubmit", { prompt: "This is an app-generated request for a suggested next user message. The user did not write this message." }));
  store.record(event("PreToolUse")); store.record(event("Stop"));
  expect(store.snapshot().tasks).toHaveLength(0);
  store.record(event("UserPromptSubmit", { prompt: "This is my task. Please help." }));
  expect(store.snapshot().tasks).toHaveLength(1); store.close();
});

test("migration preserves old hook history and Todo, no old Stop becomes personal completion", () => {
  const directory = mkdtempSync(join(tmpdir(), "focus-migration-")); directories.push(directory);
  writeFileSync(join(directory, "todo.md"), "- [ ] 原有个人待办\n");
  const db = new Database(join(directory, "board.sqlite"));
  db.exec("CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL); CREATE TABLE tasks(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)");
  const stop = event("Stop");
  db.query("INSERT INTO events(session,payload,at) VALUES(?,?,?)").run("old", JSON.stringify(stop), stop.at);
  db.query("INSERT INTO tasks VALUES(?,?,?)").run("old", JSON.stringify({ id: "old", title: "旧请求", status: "ended", activity: "旧回复", updatedAt: stop.at }), stop.at);
  db.close(); const store = new Store(directory);
  expect(store.snapshot().tasks[0].focus).toBe("discovered");
  expect(hasUnreadReply(store.snapshot().tasks[0])).toBe(true);
  expect(store.activities("old")).toHaveLength(1);
  expect(store.snapshot().tasks[0].reply).toBe("旧回复"); store.close();
  expect(readFileSync(join(directory, "todo.md"), "utf8")).toBe("- [ ] 原有个人待办\n");
});

test("official name synchronization preserves personal decisions and reports unavailable metadata", async () => {
  const { store } = setup(); store.record(event("UserPromptSubmit"));
  const initial = store.snapshot().tasks[0]; store.updateFocus(initial.id, { state: "later" }, initial.version);
  expect(await nameSync(store, async () => [{ id: initial.id, name: "官方名称" }])()).toBe("");
  expect(store.snapshot().tasks[0].title).toBe("官方名称"); expect(store.snapshot().tasks[0].focus).toBe("later");
  const failure = nameSync(store, async () => { throw new Error("offline"); });
  expect(await failure()).toContain("暂未同步"); expect(store.snapshot().tasks[0].title).toBe("官方名称"); store.close();
});
