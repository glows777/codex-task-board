export const statuses = ["running", "approval", "error", "ended"] as const;
export type Status = typeof statuses[number];
export const statusLabels: Record<Status, string> = { running: "运行中", approval: "等待批准", error: "异常", ended: "本轮结束" };
export const hookEvents = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "Interrupt"] as const;
export type EventName = typeof hookEvents[number];
export interface Event {
  sessionId: string; turnId: string; name: EventName; cwd: string;
  tool: string; toolId: string; signature: string; summary: string;
  failed: boolean; at: number;
}
export interface Task {
  id: string; turnId: string; title: string; cwd: string; project: string;
  status: Status; reason: string; activity: string; updatedAt: number;
  approvals: { signature: string; reason: string }[];
  closed: boolean;
}
export interface Activity extends Event { sequence: number }
export interface Snapshot { tasks: Task[]; lastEventAt: number | null; collectedSince: number | null; revision: number }

export function reduceTask(previous: Task | null, event: Event): Task | null {
  if (event.name === "SessionStart") return previous;
  if (!previous && ["SessionEnd", "Stop", "Interrupt"].includes(event.name)) return null;
  // A new prompt establishes the active turn; late outputs from an old turn cannot overwrite it.
  if (previous && event.name !== "UserPromptSubmit" && event.turnId && event.turnId !== previous.turnId) return previous;
  const task: Task = previous ? structuredClone(previous) : {
    id: event.sessionId, turnId: event.turnId, title: "已接入的 Codex 对话",
    cwd: event.cwd, project: event.cwd.split(/[\\/]/).filter(Boolean).at(-1) || "未命名项目",
    status: "running", reason: "正在执行", activity: "", updatedAt: event.at, approvals: [], closed: false,
  };
  // Finishing tools can arrive after an interrupt. Only a prompt or a new tool invocation resumes a turn.
  if (task.closed && !["UserPromptSubmit", "PreToolUse"].includes(event.name)) return previous;
  task.updatedAt = event.at;
  task.activity = event.summary;
  if (event.cwd) {
    task.cwd = event.cwd;
    task.project = event.cwd.split(/[\\/]/).filter(Boolean).at(-1) || "未命名项目";
  }
  switch (event.name) {
    case "UserPromptSubmit":
      task.turnId = event.turnId;
      task.title = event.summary || "新的 Codex 请求";
      task.approvals = [];
      task.closed = false;
      task.status = "running";
      task.reason = "正在处理本轮请求";
      break;
    case "PermissionRequest":
      if (!task.approvals.some(item => item.signature === event.signature)) task.approvals.push({ signature: event.signature, reason: event.summary });
      task.status = "approval";
      task.reason = task.approvals[0].reason;
      break;
    case "PreToolUse":
      task.closed = false;
      task.status = task.approvals.length ? "approval" : "running";
      task.reason = task.approvals[0]?.reason || (/request_user_input/.test(event.tool) ? "等待你回答问题" : `正在调用 ${event.tool}`);
      break;
    case "PostToolUse":
      task.approvals = task.approvals.filter(item => item.signature !== event.signature);
      task.status = task.approvals.length ? "approval" : event.failed ? "error" : "running";
      task.reason = task.approvals[0]?.reason || (event.failed ? `${event.tool} 返回失败；等待后续处理` : `${event.tool} 已返回，继续处理`);
      break;
    case "Interrupt":
      task.status = "error"; task.reason = "本轮已中断"; task.approvals = []; task.closed = true;
      break;
    case "SessionEnd":
      if (!task.closed) { task.status = "error"; task.reason = "会话已退出，未观察到本轮结束"; task.approvals = []; task.closed = true; }
      break;
    case "Stop":
      task.reason = task.status === "error" ? "本轮结束；此前工具返回失败，请查看对话结果" : "本轮回复结束";
      task.status = "ended"; task.approvals = []; task.closed = true;
      break;
  }
  return task;
}
