import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Store } from "../src/store.ts";

const directory = mkdtempSync(join(tmpdir(), "codex-board-test-"));
const env = { ...process.env, TASK_BOARD_DATA_DIR: directory };
const root = new URL("../", import.meta.url).pathname;
const hookFile = join(root, "plugins/task-board/dist/hook.js");
afterAll(() => rmSync(directory, { recursive: true, force: true }));
async function hook(name: string, session = "runtime-session", extra: Record<string, unknown> = {}) {
  const child = Bun.spawn([process.execPath, hookFile], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(JSON.stringify({ hook_event_name: name, session_id: session, turn_id: "runtime-turn", cwd: root, tool_name: "Bash", tool_input: {}, prompt: "验证真实 hook 进程到看板", ...extra }));
  child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(0); expect(JSON.parse(stdout)).toEqual({});
  return stderr;
}
test("built hook process → SQLite → built MCP server → sidebar resource", async () => {
  expect(await hook("UserPromptSubmit")).toBe("");
  expect(await hook("PermissionRequest", "runtime-session", { tool_input: { description: "批准运行测试" } })).toBe("");
  const client = new Client({ name: "task-board-integration", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "plugins/task-board/dist/server.js")], env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string,string] => typeof entry[1] === "string")) });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.find(tool => tool.name === "board")?._meta?.["openai/ui"]).toEqual({ entrypoints: [{ type: "global" }] });
    const snapshot = await client.callTool({ name: "board", arguments: {} });
    expect(((snapshot.structuredContent as Record<string, unknown>)?.tasks as {status:string}[])[0].status).toBe("approval");
    const resource = await client.readResource({ uri: "ui://task-board/dashboard.html" });
    expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect("text" in resource.contents[0] && resource.contents[0].text).toContain('content="app"');
    expect(await hook("Stop")).toBe("");
    const ended = await client.callTool({ name: "board_snapshot", arguments: {} });
    expect(((ended.structuredContent as Record<string, unknown>)?.tasks as {status:string}[])[0].status).toBe("ended");
    const task = (ended.structuredContent as any).tasks[0];
    const complete = await client.callTool({ name: "focus_update", arguments: { sessionId: task.id, state: "done", expectedVersion: task.version } });
    expect((complete.structuredContent as any).tasks[0].focus).toBe("done");
    expect(tools.tools.find(tool => tool.name === "focus_update")?._meta?.ui).toEqual({ visibility: ["app"] });
    const detail = await client.callTool({ name: "task_detail", arguments: { sessionId: "runtime-session" } });
    expect(((detail.structuredContent as Record<string, unknown>)?.activities as unknown[]).length).toBe(3);
  } finally { await client.close(); }
});
test("multiple hook processes write without losing sessions", async () => {
  await Promise.all(Array.from({length:12}, (_,index) => hook("UserPromptSubmit", `parallel-${index}`)));
  const store = new Store(directory);
  try { expect(store.snapshot().tasks.filter(task => task.id.startsWith("parallel-")).length).toBe(12); }
  finally { store.close(); }
});
test("own board tools don't create phantom running tasks", async () => {
  expect(await hook("PreToolUse", "self-poll", { tool_name: "mcp__task_board__board_snapshot" })).toBe("");
  expect(await hook("PreToolUse", "self-poll", { tool_name: "mcp__task_board__todo_read" })).toBe("");
  expect(await hook("PostToolUse", "self-poll", { tool_name: "mcp__task_board__todo_save" })).toBe("");
  const store = new Store(directory);
  try { expect(store.task("self-poll")).toBeNull(); }
  finally { store.close(); }
});
test("invalid payload never emits an approval/continuation decision", async () => {
  expect(await hook("UnknownEvent")).toContain("Unsupported hook event");
});
test("storage failure still returns a neutral hook response", async () => {
  const path = join(directory, "blocked-data-path"); writeFileSync(path, "not a directory");
  const child = Bun.spawn([process.execPath, hookFile], { env: { ...env, TASK_BOARD_DATA_DIR: path }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(JSON.stringify({ hook_event_name: "Stop", session_id: "broken-store", turn_id: "turn" })); child.stdin.end();
  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({});
  expect(await new Response(child.stderr).text()).toContain("could not record the hook");
  expect(await child.exited).toBe(0);
});
