import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dataDirectory } from "./store.ts";

// A single Markdown note, stored beside the board database. No task schema.
export function readTodo(directory = dataDirectory()): string {
  try { return readFileSync(join(directory, "todo.md"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
export function saveTodo(markdown: string, expected: string, directory = dataDirectory()): void {
  if (readTodo(directory) !== expected) throw new Error("Todo 已在别处修改，请保留当前草稿，重新打开面板后再保存。");
  const temporary = join(directory, `.todo-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, markdown, { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(directory, "todo.md"));
  } finally { rmSync(temporary, { force: true }); }
}
