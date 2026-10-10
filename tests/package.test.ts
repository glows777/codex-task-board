import { expect, test } from "bun:test";
test("compatibility package has one manifest and points to bundled files", async () => {
  const root = new URL("../plugins/task-board/", import.meta.url);
  expect(await Bun.file(new URL("plugin.json", root)).exists()).toBe(false);
  const manifest = await Bun.file(new URL(".codex-plugin/plugin.json", root)).json();
  expect(manifest.mcpServers).toBe("./.mcp.json");
  expect(manifest.hooks).toBe("./hooks/hooks.json");
  const mcp = await Bun.file(new URL(".mcp.json", root)).json();
  expect(mcp.mcpServers["task-board"]).toEqual({ command: "bun", args: ["dist/server.js"], cwd: "." });
  for (const path of [".mcp.json", "hooks/hooks.json", "dist/server.js", "dist/hook.js", "dist/dashboard.html"]) {
    expect(await Bun.file(new URL(path, root)).exists()).toBe(true);
  }
});
test("hooks package is passive, complete and launches Bun through the official plugin root", async () => {
  const config = await Bun.file(new URL("../plugins/task-board/hooks/hooks.json", import.meta.url)).json();
  expect(Object.keys(config.hooks).sort()).toEqual(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "Interrupt"].sort());
  for (const values of Object.values(config.hooks) as {hooks:{type:string;command:string;timeout:number}[]}[][]) {
    expect(values[0].hooks[0].type).toBe("command");
    expect(values[0].hooks[0].command).toBe('bun "${PLUGIN_ROOT}/dist/hook.js"');
    expect(values[0].hooks[0].timeout).toBeLessThanOrEqual(3);
  }
});
