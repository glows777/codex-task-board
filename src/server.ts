import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions } from "@openai/mcp-extensions/server";
import { z } from "zod";
import { Store } from "./store.ts";
import { readTodo, saveTodo } from "./todo.ts";
import { nameSync } from "./thread-names.ts";
import { focusStates } from "./model.ts";

const store = new Store();
const syncNames = nameSync(store);
const icon = { src: `data:image/png;base64,${Buffer.from(await Bun.file(new URL("../assets/icon.png", import.meta.url)).arrayBuffer()).toString("base64")}`, mimeType: "image/png" };
const server = new McpServer({ name: "codex-task-board", version: "0.1.0", icons: [icon] });
new OpenAIExtensions(server);
const uri = "ui://task-board/dashboard.html";
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const result = (value: object) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { ...value } });

registerAppTool(server, "board", {
  title: "我的关注", description: "打开工作台，管理关注的 Codex 对话、新回复和个人待办。",
  inputSchema: z.object({}).strict(), annotations: readOnly,
  _meta: { ui: { resourceUri: uri }, "openai/ui": { entrypoints: [{ type: "global" }] } },
}, async () => { const namesError = await syncNames(); return result({ ...store.snapshot(), namesError }); });
registerAppTool(server, "board_snapshot", {
  title: "刷新任务状态", description: "读取任务看板的最新状态。", inputSchema: z.object({}).strict(), annotations: readOnly,
  _meta: { ui: { visibility: ["app"] } },
}, async () => { const namesError = await syncNames(); return result({ ...store.snapshot(), namesError }); });
registerAppTool(server, "focus_update", {
  title: "管理我的关注", description: "保存用户手动设置的跟进状态或新回复提示的清除标记，不改变 Codex 对话。",
  inputSchema: z.object({ sessionId: z.string().min(1).max(180), expectedVersion: z.number().int().nonnegative(), state: z.enum(focusStates).optional(), viewedReplySequence: z.number().int().nonnegative().optional() }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ["app"] } },
}, async ({ sessionId, expectedVersion, state, viewedReplySequence }) => {
  try { store.updateFocus(sessionId, { state, viewedReplySequence }, expectedVersion); return result(store.snapshot()); }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "关注状态保存失败" }] }; }
});
registerAppTool(server, "task_detail", {
  title: "读取最近活动", description: "读取指定对话的最近 30 条看板事件。", inputSchema: z.object({ sessionId: z.string().min(1).max(180) }).strict(), annotations: readOnly,
  _meta: { ui: { visibility: ["app"] } },
}, async ({ sessionId }) => result({ task: store.task(sessionId), activities: store.activities(sessionId) }));
registerAppTool(server, "todo_read", {
  title: "读取 Todo", description: "读取本地 todo.md 的 Markdown 内容。", inputSchema: z.object({}).strict(), annotations: readOnly,
  _meta: { ui: { visibility: ["app"] } },
}, async () => result({ markdown: readTodo() }));
registerAppTool(server, "todo_save", {
  title: "保存 Todo", description: "保存用户在面板中编辑的 Markdown 到本地 todo.md。",
  inputSchema: z.object({ markdown: z.string().max(100000), expected: z.string().max(100000) }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ["app"] } },
}, async ({ markdown, expected }) => {
  try { saveTodo(markdown, expected); return result({ markdown }); }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "保存失败" }] }; }
});
const resourceMeta = { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } } };
registerAppResource(server, "任务看板", uri, { _meta: resourceMeta }, async address => ({ contents: [{ uri: address.href, mimeType: RESOURCE_MIME_TYPE, text: await Bun.file(new URL("./dashboard.html", import.meta.url)).text(), _meta: resourceMeta }] }));
await server.connect(new StdioServerTransport());
process.on("SIGTERM", () => { store.close(); process.exit(0); });
