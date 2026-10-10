import { strict as assert } from "node:assert";
import { hookEvents } from "../src/model.ts";
import { CodexClient } from "./codex-client.ts";

const client = new CodexClient();
try {
  await client.connect();
  const result = await client.call("hooks/list", { cwds: [new URL("../", import.meta.url).pathname] });
  const entry = result.data[0];
  assert.equal(entry.errors.length, 0);
  const hooks = entry.hooks.filter((hook: any) => hook.pluginId === "task-board@codex-task-board-local");
  assert.deepEqual(hooks.map((hook: any) => hook.eventName).sort(), hookEvents.map(name => name[0].toLowerCase() + name.slice(1)).sort());
  assert(hooks.every((hook: any) => hook.enabled));
  console.log(`Installed hooks: ${hooks.length}; trust: ${[...new Set(hooks.map((hook: any) => hook.trustStatus))].join(", ")}`);
  const status = await client.call("mcpServerStatus/list", { serverName: "task-board", limit: 10 });
  const server = status.data.find((entry: any) => entry.pluginId === "task-board@codex-task-board-local");
  assert(server, "Installed task-board MCP server is missing");
  assert.equal(server.toolsError, null, server.toolsError || "");
  assert(server.serverInfo, "MCP initialize did not complete");
  const tools = Object.values(server.tools) as { name: string; _meta?: Record<string, any> }[];
  assert.equal(tools.length, 5);
  assert(tools.some(tool => tool.name.endsWith("todo_read")));
  assert(tools.some(tool => tool.name.endsWith("todo_save")));
  assert(tools.some(tool => tool._meta?.["openai/ui"]?.entrypoints?.some((entry: any) => entry.type === "global")), "Sidebar entrypoint missing");
  assert(server.resources.some((resource: any) => resource.uri === "ui://task-board/dashboard.html"));
  console.log("Installed MCP: initialize, 5 tools including Todo, global sidebar entrypoint and UI resource passed");
} finally { await client.close(); }
