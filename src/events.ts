import { createHash } from "node:crypto";
import { hookEvents, type Event, type EventName } from "./model.ts";

const brief = (value: unknown, limit = 160): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
// Only explicit result fields count as failure. Ordinary text containing "error" doesn't.
export function toolFailed(response: unknown): boolean {
  const result = object(response);
  return result.isError === true || (typeof result.exit_code === "number" && result.exit_code !== 0);
}
export function isBoardTool(value: unknown): boolean {
  return typeof value === "string" && /^mcp__task[-_]board__(?:board|board_snapshot|task_detail|todo_read|todo_save)$/.test(value);
}
export function normalizeEvent(value: unknown, at = Date.now()): Event {
  const input = object(value);
  if (typeof input.session_id !== "string" || !input.session_id || !hookEvents.includes(input.hook_event_name as EventName)) throw new Error("Unsupported hook event or missing session_id");
  const name = input.hook_event_name as EventName;
  if (!["SessionStart", "SessionEnd"].includes(name) && (typeof input.turn_id !== "string" || !input.turn_id)) throw new Error("Turn event is missing turn_id");
  const tool = brief(input.tool_name, 120);
  const args = object(input.tool_input);
  const failed = name === "PostToolUse" && toolFailed(input.tool_response);
  let summary = "";
  switch (name) {
    case "UserPromptSubmit": summary = brief(input.prompt); break;
    case "PermissionRequest": summary = brief(args.description) || `等待批准 ${tool}`; break;
    case "PreToolUse": summary = `调用 ${tool}`; break;
    case "PostToolUse": summary = `${tool} ${failed ? "返回失败" : "已返回"}`; break;
    case "Stop": summary = brief(input.last_assistant_message) || "本轮回复结束"; break;
    case "Interrupt": summary = "用户中断本轮"; break;
    case "SessionStart": summary = "采集已接入"; break;
    case "SessionEnd": summary = "会话退出"; break;
  }
  return {
    sessionId: input.session_id, turnId: brief(input.turn_id, 180), name,
    cwd: typeof input.cwd === "string" ? input.cwd.slice(0, 2000) : "",
    tool, toolId: brief(input.tool_use_id, 180),
    // Codex Bash post hooks retain only `command`; approval descriptions aren't part of call identity.
    signature: createHash("sha256").update(tool + canonical(tool === "Bash" && typeof args.command === "string" ? { command: args.command } : input.tool_input)).digest("hex"),
    summary, failed, at,
  };
}
