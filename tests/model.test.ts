import { describe, expect, test } from "bun:test";
import { normalizeEvent, toolFailed } from "../src/events.ts";
import { reduceTask, type Task } from "../src/model.ts";

function event(name: string, extra: Record<string, unknown> = {}) {
  return normalizeEvent({ session_id: "session-1", turn_id: "turn-1", cwd: "/projects/dashboard", hook_event_name: name, tool_name: "Bash", tool_input: { command: "bun test" }, ...extra });
}
const start = () => reduceTask(null, event("UserPromptSubmit", { prompt: "实现看板" }))!;
describe("hook state transitions", () => {
  test("idle SessionStart does not create a running task", () => {
    expect(reduceTask(null, event("SessionStart"))).toBeNull();
  });
  test("approval survives unrelated parallel tool activity, then clears on matching output", () => {
    let task: Task = start();
    task = reduceTask(task, event("PermissionRequest", { tool_input: { command: "publish", description: "需要发布许可" } }))!;
    expect(task.status).toBe("approval");
    task = reduceTask(task, event("PreToolUse"))!;
    task = reduceTask(task, event("PostToolUse", { tool_response: { exit_code: 0 } }))!;
    expect(task.status).toBe("approval");
    task = reduceTask(task, event("PostToolUse", { tool_input: { command: "publish" }, tool_response: { exit_code: 0 } }))!;
    expect(task.status).toBe("running");
  });
  test("old turn completion cannot finish a new turn", () => {
    const next = reduceTask(start(), event("UserPromptSubmit", { turn_id: "turn-2", prompt: "继续" }))!;
    expect(reduceTask(next, event("Stop"))).toEqual(next);
    expect(reduceTask(next, event("PostToolUse", { tool_response: { isError: true } }))).toEqual(next);
  });
  test("explicit tool failure recovers on further activity; Stop means turn end", () => {
    let task = reduceTask(start(), event("PostToolUse", { tool_response: { isError: true } }))!;
    expect(task.status).toBe("error");
    task = reduceTask(task, event("PreToolUse"))!;
    expect(task.status).toBe("running");
    task = reduceTask(task, event("Stop", { last_assistant_message: "已经回复" }))!;
    expect(task.status).toBe("ended");
    expect(task.reason).toBe("本轮回复结束");
  });
  test("interrupt remains abnormal despite late output and Stop", () => {
    const task = reduceTask(start(), event("Interrupt"))!;
    expect(task.status).toBe("error");
    expect(reduceTask(task, event("PostToolUse"))).toEqual(task);
    expect(reduceTask(task, event("Stop"))).toEqual(task);
    expect(reduceTask(task, event("UserPromptSubmit", { turn_id: "turn-2" }))!.status).toBe("running");
  });
  test("session exit is not task completion; no inactivity timer invents failure", () => {
    expect(reduceTask(start(), event("SessionEnd"))!.status).toBe("error");
    const task = start(); task.updatedAt = Date.now() - 24 * 3600000;
    expect(reduceTask(task, event("SessionStart", { source: "compact" }))).toEqual(task);
  });
  test("question waiting is not an approval request", () => {
    const task = reduceTask(start(), event("PreToolUse", { tool_name: "request_user_input" }))!;
    expect(task.status).toBe("running");
    expect(task.reason).toBe("等待你回答问题");
  });
  test("failure detection does not classify arbitrary error text as failure", () => {
    expect(toolFailed("0 errors")).toBe(false);
    expect(toolFailed({ output: "error examples", exit_code: 0 })).toBe(false);
    expect(toolFailed({ exit_code: 1 })).toBe(true);
    expect(toolFailed({ isError: true })).toBe(true);
  });
  test("normalize stores summaries and hashes, never command/output bodies", () => {
    const value = event("PostToolUse", { tool_input: { command: "secret-command" }, tool_response: { output: "secret-output", exit_code: 0 } });
    expect(JSON.stringify(value)).not.toContain("secret-command");
    expect(JSON.stringify(value)).not.toContain("secret-output");
    expect(() => event("PostToolUse", { turn_id: undefined })).toThrow();
  });
});
