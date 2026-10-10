import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("Todo uses a Markdown file, persists across MCP restarts, and preserves external edits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-todo-test-"));
  const start = async () => {
    const client = new Client({ name: "todo-test", version: "1" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../plugins/task-board/dist/server.js", import.meta.url).pathname], env: { PATH: process.env.PATH!, TASK_BOARD_DATA_DIR: directory } }));
    return client;
  };
  let client = await start();
  const markdown = "## 今天\n\n- [ ] 写下要做的事\n- [x] 做完的事\n\n**备注**\n";
  try {
    expect((await client.callTool({ name: "todo_read", arguments: {} })).structuredContent).toEqual({ markdown: "" });
    const tools = await client.listTools();
    const save = tools.tools.find(tool => tool.name === "todo_save")!;
    expect(save._meta?.ui).toEqual({ visibility: ["app"] });
    expect(save.annotations?.readOnlyHint).toBe(false);
    expect((await client.callTool({ name: "todo_save", arguments: { markdown, expected: "" } })).isError).not.toBe(true);
    expect(readFileSync(join(directory, "todo.md"), "utf8")).toBe(markdown);
    await client.close(); client = await start();
    expect((await client.callTool({ name: "todo_read", arguments: {} })).structuredContent).toEqual({ markdown });
    const external = "- [ ] 在外部编辑器补充的待办\n";
    writeFileSync(join(directory, "todo.md"), external);
    const conflict = await client.callTool({ name: "todo_save", arguments: { markdown: "old draft", expected: markdown } });
    expect(conflict.isError).toBe(true);
    expect(readFileSync(join(directory, "todo.md"), "utf8")).toBe(external);
    const invalid = await client.callTool({ name: "todo_save", arguments: { markdown: "x".repeat(100001), expected: external } });
    expect(invalid.isError).toBe(true);
    expect(readFileSync(join(directory, "todo.md"), "utf8")).toBe(external);
    expect((await client.callTool({ name: "todo_save", arguments: { markdown: "", expected: external } })).isError).not.toBe(true);
    expect(readFileSync(join(directory, "todo.md"), "utf8")).toBe("");
  } finally { await client.close(); rmSync(directory, { recursive: true, force: true }); }
});
