import { expect, test } from "bun:test";
import { hookEvents } from "../src/model.ts";
import { CodexClient } from "./codex-client.ts";

test("current Codex discovers all bundled hooks and the MCP server", async () => {
  const client = new CodexClient();
  try {
    await client.connect();
    const { plugin } = await client.call("plugin/read", { pluginName: "task-board", marketplacePath: new URL("../.agents/plugins/marketplace.json", import.meta.url).pathname });
    // App-server serializes event names in camelCase; hooks.json uses PascalCase.
    expect(plugin.hooks.map((hook: {eventName:string}) => hook.eventName).sort()).toEqual(hookEvents.map(name => name[0].toLowerCase() + name.slice(1)).sort());
    expect(plugin.mcpServers).toEqual(["task-board"]);
  } finally { await client.close(); }
}, 15000);
