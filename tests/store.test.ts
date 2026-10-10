import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDirectory } from "../src/store.ts";

test("hook-only PLUGIN_DATA does not split hook and MCP stores", () => {
  const override = process.env.TASK_BOARD_DATA_DIR;
  const supplied = process.env.PLUGIN_DATA;
  try {
    delete process.env.TASK_BOARD_DATA_DIR;
    delete process.env.PLUGIN_DATA;
    const mcpDirectory = dataDirectory();
    process.env.PLUGIN_DATA = "/test/hook-only-data";
    expect(dataDirectory()).toBe(mcpDirectory);
    expect(mcpDirectory).toBe(join(homedir(), ".local", "share", "codex-task-board"));
    process.env.TASK_BOARD_DATA_DIR = "/test/explicit-shared-data";
    expect(dataDirectory()).toBe("/test/explicit-shared-data");
  } finally {
    if (override === undefined) delete process.env.TASK_BOARD_DATA_DIR; else process.env.TASK_BOARD_DATA_DIR = override;
    if (supplied === undefined) delete process.env.PLUGIN_DATA; else process.env.PLUGIN_DATA = supplied;
  }
});
