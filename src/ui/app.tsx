import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { BlockNoteEditor } from "@blocknote/core";
import { AllSelection } from "prosemirror-state";
import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { createRoot } from "react-dom/client";
import { focusLabels, hasUnreadReply, type FocusState, type FocusTask, type Snapshot } from "../model.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = element("board"), notice = element("notice"), connection = element("connection");
const search = element<HTMLInputElement>("search"), project = element<HTMLSelectElement>("project"), auto = element<HTMLInputElement>("auto"), refresh = element<HTMLButtonElement>("refresh");
const preview = document.querySelector<HTMLMetaElement>('meta[name="board-mode"]')?.content === "preview";
let snapshot: Snapshot = { tasks: [], lastEventAt: null, collectedSince: null, revision: -1 };
let busy = false, connected = false, lastError = "", chatError = "";
let app: App;
type Scope = "all" | "discovered";
let scope: Scope = "all";
let showCompleted = false, actionBusy = false;
const taskOrder = new Map<string, number>();
const needsAnswer = (task: FocusTask) => task.status === "running" && task.reason === "等待你回答问题";
const todoEditorRoot = element("todo-editor"), todoStatus = element("todo-status");
let undoAction: {id:string;state:FocusState} | undefined;
let todoEditor: BlockNoteEditor | undefined;
const todoReactRoot = createRoot(todoEditorRoot);
let todoLoaded = false, todoLoading = false, savedMarkdown = "", currentMarkdown = "";
let todoSaving = false, todoComposing = false;
let quickComposing = false;
let todoSaveTimer: ReturnType<typeof setTimeout> | undefined;
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const relative = (at: number) => { const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000)); return seconds < 60 ? "刚刚" : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : seconds < 86400 ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 86400)} 天前`; };
const date = (at: number) => new Date(at).toLocaleString("zh-CN", { hour12: false });
function showNotice(): void {
  notice.textContent = lastError || chatError || snapshot.namesError || (snapshot.tasks.length ? "" : "还没有对话记录。接入 hooks 后，新对话会自动进入跟进中，你可以移到稍后或取消关注。");
  notice.hidden = !notice.textContent;
  notice.dataset.error = String(!!lastError || !!chatError);
}
function clock(): void {
  board.querySelectorAll<HTMLTimeElement>("time[data-at]").forEach(time => time.textContent = relative(Number(time.dataset.at)));
  connection.textContent = lastError ? "同步中断" : !connected ? "正在连接" : auto.checked ? "自动同步" : "更新已暂停";
  connection.dataset.connected = String(connected && !lastError);
  auto.parentElement!.title = connection.textContent;
}
function render(): void {
  const focusKey = (document.activeElement as HTMLElement)?.dataset?.control;
  const scrolls = new Map([...board.querySelectorAll<HTMLElement>(".column")].map(node => [node.dataset.focus, node.querySelector<HTMLElement>(".cards")?.scrollTop || 0]));
  const query = search.value.trim().toLocaleLowerCase();
  const matching = snapshot.tasks.filter(task => (!project.value || task.cwd === project.value) && (!query || [task.title, task.request, task.reply, task.project, task.reason].join(" ").toLocaleLowerCase().includes(query)));
  const followed = matching.filter(task => task.focus === "following" || task.focus === "later");
  const counts = { all: followed.length, discovered: matching.filter(task => task.focus === "discovered").length, done: matching.filter(task => task.focus === "done").length };
  Object.entries(counts).forEach(([key, count]) => { element(`${key}-count`).textContent = String(count); });
  const doneUnread = matching.filter(task => task.focus === "done" && hasUnreadReply(task)).length;
  element("completed-label").textContent = `显示已确认完成${counts.done ? ` (${counts.done})` : ""}${doneUnread ? ` · ${doneUnread} 个有新回复` : ""}`;
  matching.sort((a, b) => taskOrder.get(a.id)! - taskOrder.get(b.id)!);
  element("board-summary").textContent = snapshot.revision < 0 ? "正在读取…" : counts.all ? `${counts.all} 个关注的对话` : "新接入的对话会自动进入跟进中";
  board.dataset.layout = "board";
  board.dataset.scope = scope;
  const groups: FocusState[] = scope === "discovered" ? ["discovered"] : ["following", "later", ...(showCompleted ? ["done" as const] : [])];
  const sections = groups.map(group => {
    const tasks = matching.filter(task => task.focus === group);
    return `<section class="column" data-focus="${group}" data-empty="${!tasks.length}" aria-labelledby="column-${group}"><div class="column-head"><h2 id="column-${group}">${focusLabels[group]}</h2><span class="count">${tasks.length}</span></div><div class="cards"><div class="thread-cards">${tasks.map(task => {
      const unread = hasUnreadReply(task);
      const state = task.status === "approval" ? "等你批准" : needsAnswer(task) ? "等你回答" : task.status === "running" ? "运行中" : task.status === "error" ? task.closed ? "已中断" : "工具失败" : "本轮结束";
      const context = task.reply && (unread || task.status === "ended") ? task.reply : task.request || task.reason;
      const disabled = preview || actionBusy ? "disabled" : "";
      const control = (action: string, text: string) => `<button type="button" data-action="${action}" data-control="${escape(task.id)}-${action}" ${disabled}>${text}</button>`;
      return `<article class="card" data-task="${escape(task.id)}" data-status="${task.status}" data-unread="${unread}"><div class="card-content"><div class="card-top"><span class="project-chip" title="${escape(task.cwd)}">${escape(task.project)}</span><span class="card-state" title="${escape(task.status === "ended" ? "Codex 本轮回复结束，不代表事项已确认完成" : task.reason)}">${state}</span>${unread ? '<span class="unread-label">待查看</span>' : ""}${group === "done" ? '<span class="completion-label" title="你已确认这件事完成">已确认完成</span>' : ""}</div><button type="button" class="card-title" data-open="${escape(task.id)}" data-control="${escape(task.id)}-open" title="${escape(task.title)}">${escape(task.title)}</button>${!task.titleKnown ? '<span class="name-pending">名称待同步</span>' : ""}<p class="card-reason" title="${escape(context)}">${escape(context)}</p><div class="card-meta"><time data-at="${task.updatedAt}" datetime="${new Date(task.updatedAt).toISOString()}" title="${escape(date(task.updatedAt))}">${relative(task.updatedAt)}</time><span class="card-actions">${group === "discovered" ? control("follow", "加入关注") : group === "done" ? control("restore", "恢复关注") : `${unread ? control("view", "标记已查看") : ""}${control(group === "later" ? "follow" : "later", group === "later" ? "继续跟进" : "稍后")}${control("unfollow", "取消关注")}`}</span></div></div>${group !== "discovered" && group !== "done" ? `<button type="button" class="complete-task" data-action="complete" data-control="${escape(task.id)}-complete" aria-label="确认完成：${escape(task.title)}" title="确认完成" ${disabled}><span class="completion-circle" aria-hidden="true"></span></button>` : ""}</article>`;
    }).join("")}${!tasks.length && group !== "following" ? `<p class="empty">${group === "discovered" ? "没有新发现的对话" : group === "done" ? "已确认完成的事项会留在这里" : "稍后再处理的对话放在这里"}</p>` : ""}</div></div></section>`;
  }).join("");
  const parsed = document.createElement("template"); parsed.innerHTML = sections;
  const groupKey = [...parsed.content.querySelectorAll<HTMLElement>(".column")].map(node => node.dataset.focus).join(",");
  if (board.dataset.groups !== groupKey) {
    board.innerHTML = sections; board.dataset.groups = groupKey;
  } else {
    parsed.content.querySelectorAll<HTMLElement>(".column").forEach(next => {
      const current = board.querySelector<HTMLElement>(`[data-focus="${next.dataset.focus}"]`)!;
      current.dataset.empty = next.dataset.empty;
      current.querySelector(".thread-cards")!.innerHTML = next.querySelector(".thread-cards")!.innerHTML;
      current.querySelector(".count")!.textContent = next.querySelector(".count")!.textContent;
    });
  }
  const following = board.querySelector<HTMLElement>('[data-focus="following"] .cards');
  if (following) {
    if (!followed.length) following.querySelector(".thread-cards")!.insertAdjacentHTML("beforeend", `<div class="board-empty"><strong>还没有关注的对话</strong><span>${counts.discovered ? "从新发现中选择你想继续跟进的对话。" : "新接入的对话会自动进入跟进中，可移到稍后或取消关注。"}</span></div>`);
  }
  board.querySelectorAll<HTMLElement>(".column").forEach(node => { node.querySelector<HTMLElement>(".cards")!.scrollTop = scrolls.get(node.dataset.focus) || 0; });
  if (focusKey) [...board.querySelectorAll<HTMLElement>("[data-control]")].find(node => node.dataset.control === focusKey)?.focus({ preventScroll: true });
  clock(); showNotice();
}
function showUndo(message: string): void {
  element("undo-message").textContent = message;
  element("undo").hidden = false;
}
async function changeFocus(task: FocusTask, state?: FocusState, viewedReplySequence?: number, allowUndo = true): Promise<void> {
  if (preview || actionBusy) return;
  actionBusy = true; chatError = ""; render();
  try {
    const value = await call("focus_update", { sessionId: task.id, expectedVersion: task.version, ...(state ? { state } : {}), ...(viewedReplySequence !== undefined ? { viewedReplySequence } : {}) });
    accept(value);
    if (state && allowUndo) { undoAction = { id: task.id, state: task.focus }; showUndo(state === "done" ? "已确认完成" : state === "discovered" ? "已取消关注" : state === "later" ? "已移到稍后" : "已加入关注"); }
  } catch (error) {
    await update();
    chatError = `未保存。${error instanceof Error ? error.message : "请重试"}`;
  } finally { actionBusy = false; render(); }
}
async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (preview) {
    const response = await fetch(name === "todo_read" ? "/api/todo" : "/api/snapshot", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
  const result = await app.callServerTool({ name, arguments: args }, { timeout: 10000 });
  if (result.isError) throw new Error(result.content?.filter(item => item.type === "text").map(item => item.text).join(" ") || "操作失败");
  if (!result.structuredContent) throw new Error("工具未返回可用数据");
  return result.structuredContent;
}
function accept(value: Record<string, unknown>): void {
  if (!Array.isArray(value.tasks) || typeof value.revision !== "number") throw new Error("看板响应格式不正确");
  const next = value as unknown as Snapshot;
  const changed = next.revision !== snapshot.revision;
  for (const task of [...next.tasks].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!taskOrder.has(task.id)) taskOrder.set(task.id, taskOrder.size);
  }
  snapshot = next;
  if (changed) {
    const chosen = project.value;
    const projects = [...new Map(snapshot.tasks.map(task => [task.cwd, task.project])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    project.innerHTML = '<option value="">所有项目</option>' + projects.map(([cwd, label]) => `<option value="${escape(cwd)}">${escape(label)}</option>`).join("");
    project.value = projects.some(([cwd]) => cwd === chosen) ? chosen : "";
    render();
  }
}
async function update(): Promise<void> {
  if (busy || !connected) return;
  busy = true; refresh.disabled = true;
  try { accept(await call("board_snapshot")); lastError = ""; }
  catch (error) { lastError = `状态同步中断，保留最近记录。${error instanceof Error ? error.message : "请稍后刷新"}`; }
  finally { busy = false; refresh.disabled = false; clock(); showNotice(); }
}
async function openChat(id: string): Promise<void> {
  chatError = "";
  try {
    if (preview) { chatError = "开发预览不打开真实聊天，请在 Codex 中点击卡片。"; return; }
    if (!connected) throw new Error("Not connected");
    const result = await app.openLink({ url: `codex://threads/${encodeURIComponent(id)}` }, { timeout: 10000 });
    if (result.isError) throw new Error("Host denied navigation");
  } catch {
    chatError = "无法打开聊天，请重试或从 Codex 侧边栏打开对应对话。";
  } finally { showNotice(); }
}
function todoMessage(message: string, error = false): void {
  todoStatus.textContent = message; todoStatus.dataset.error = String(error);
  element("todo-retry").hidden = !error;
}
function renderTodoEditor(): void {
  if (!todoEditor) return;
  todoReactRoot.render(<BlockNoteView
    editor={todoEditor} editable={!preview}
    theme={document.documentElement.dataset.theme === "dark" ? "dark" : "light"}
    onChange={() => {
      currentMarkdown = todoEditor!.blocksToMarkdownLossy(todoEditor!.document);
      scheduleTodoSave();
    }}
  />);
}
function followHostTheme(context: McpUiHostContext): void {
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.theme) applyDocumentTheme(context.theme);
  renderTodoEditor();
}
async function loadTodo(): Promise<void> {
  if (todoLoaded || todoLoading || !connected) return;
  todoLoading = true; todoMessage("正在读取…");
  try {
    const value = await call("todo_read");
    if (typeof value.markdown !== "string") throw new Error("Todo 内容格式不正确");
    savedMarkdown = currentMarkdown = value.markdown;
    todoEditor = BlockNoteEditor.create({
      dictionary: zh,
      domAttributes: { editor: { class: "todo-document", role: "textbox", "aria-label": "笔记正文", "aria-multiline": "true", "aria-readonly": String(preview) } },
    });
    const blocks = todoEditor.tryParseMarkdownToBlocks(savedMarkdown);
    if (blocks.length) todoEditor.replaceBlocks(todoEditor.document, blocks);
    renderTodoEditor();
    todoLoaded = true;
    element<HTMLButtonElement>("todo-add").disabled = preview;
    element<HTMLInputElement>("todo-input").disabled = preview;
    todoMessage(preview ? "开发预览只读" : "自动保存");
  } catch { todoMessage("读取失败，请重试。", true); element("todo-retry").hidden = false; }
  finally { todoLoading = false; }
}
element("todo-quick").addEventListener("submit", event => {
  event.preventDefault();
  const input = element<HTMLInputElement>("todo-input");
  const text = input.value.trim();
  if (!todoEditor || preview || !text || quickComposing) return;
  const last = todoEditor.document.at(-1)!;
  const block = { type: "checkListItem" as const, content: text };
  if (todoEditor.document.length === 1 && last.type === "paragraph" && Array.isArray(last.content) && !last.content.length) todoEditor.replaceBlocks([last], [block]);
  else todoEditor.insertBlocks([block], last, "after");
  currentMarkdown = todoEditor.blocksToMarkdownLossy(todoEditor.document);
  scheduleTodoSave();
  input.value = "";
  input.focus();
  todoEditorRoot.scrollTop = todoEditorRoot.scrollHeight;
});
element("todo-input").addEventListener("compositionstart", () => { quickComposing = true; });
element("todo-input").addEventListener("compositionend", () => { quickComposing = false; });
element("todo-retry").addEventListener("click", () => {
  element("todo-retry").hidden = true;
  if (!todoLoaded) void loadTodo(); else void saveTodo();
});
document.querySelectorAll<HTMLButtonElement>(".scopes [data-scope]").forEach(button => button.addEventListener("click", () => {
  scope = button.dataset.scope as Scope;
  document.querySelectorAll<HTMLButtonElement>(".scopes [data-scope]").forEach(control => control.setAttribute("aria-pressed", String(control.dataset.scope === scope)));
  render();
}));
element("search-shortcut").textContent = /Mac/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && !event.isComposing && todoEditor && (event.target as Element).closest?.(".todo-document")) {
    event.preventDefault();
    const view = todoEditor.prosemirrorView;
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    if (todoEditorRoot.contains(event.target as Node)) return;
    event.preventDefault(); search.focus(); search.select();
  }
  if (event.key === "Escape" && document.activeElement === search) { search.value = ""; render(); }
});
function scheduleTodoSave(): void {
  clearTimeout(todoSaveTimer);
  if (preview || !todoLoaded || todoComposing) return;
  todoMessage(todoSaving ? "正在保存…" : currentMarkdown === savedMarkdown ? "已保存" : "待保存…");
  todoSaveTimer = setTimeout(() => void saveTodo(), 500);
}
async function saveTodo(): Promise<void> {
  clearTimeout(todoSaveTimer);
  if (preview || !todoLoaded || todoSaving || todoComposing) return;
  const markdown = currentMarkdown;
  if (markdown === savedMarkdown) { todoMessage("已保存"); return; }
  todoSaving = true; todoMessage("正在保存…");
  let succeeded = false;
  try {
    await call("todo_save", { markdown, expected: savedMarkdown });
    savedMarkdown = markdown; succeeded = true;
    todoMessage(currentMarkdown === savedMarkdown ? "已保存" : "待保存…");
  } catch (error) { todoMessage(error instanceof Error && error.message.includes("Todo 已在别处修改") ? "Todo 已在别处修改。当前草稿保留，请先复制草稿，再重新打开面板。" : "保存失败，草稿保留。请重试。", true); }
  finally {
    todoSaving = false;
    if (succeeded && currentMarkdown !== savedMarkdown) scheduleTodoSave();
  }
}
todoEditorRoot.addEventListener("focusout", () => void saveTodo());
todoEditorRoot.addEventListener("compositionstart", () => { todoComposing = true; clearTimeout(todoSaveTimer); });
todoEditorRoot.addEventListener("compositionend", () => { todoComposing = false; scheduleTodoSave(); });
todoEditorRoot.addEventListener("click", async event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
  if (!link) return;
  event.preventDefault();
  if (preview || (!event.metaKey && !event.ctrlKey)) return;
  try { if ((await app.openLink({ url: link.href }, { timeout: 10000 })).isError) throw new Error("Denied"); }
  catch { todoMessage("无法打开链接，请稍后重试。", true); }
});
search.addEventListener("input", render); project.addEventListener("change", render);
auto.addEventListener("change", () => { clock(); if (auto.checked) void update(); });
refresh.addEventListener("click", () => void update());
element<HTMLInputElement>("show-completed").addEventListener("change", event => { showCompleted = (event.target as HTMLInputElement).checked; render(); });
board.addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.open) { void openChat(button.dataset.open); return; }
  const id = button.closest<HTMLElement>("[data-task]")?.dataset.task;
  const task = snapshot.tasks.find(task => task.id === id);
  if (!task) return;
  switch (button.dataset.action) {
    case "view": void changeFocus(task, undefined, task.replySequence); break;
    case "complete": void changeFocus(task, "done", task.replySequence); break;
    case "follow": case "restore": void changeFocus(task, "following"); break;
    case "later": void changeFocus(task, "later"); break;
    case "unfollow": void changeFocus(task, "discovered"); break;
  }
});
element("undo-button").addEventListener("click", async () => {
  if (!undoAction || actionBusy) return;
  const action = undoAction;
  const task = snapshot.tasks.find(task => task.id === action.id);
  if (task) await changeFocus(task, action.state, undefined, false);
  if (chatError) return;
  undoAction = undefined; element("undo").hidden = true;
});
document.addEventListener("visibilitychange", () => { if (document.hidden) void saveTodo(); else if (auto.checked) void update(); });
render();
try {
  if (preview) { element("preview").hidden = false; document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  else {
    app = new App({ name: "Codex 任务看板", version: "0.1.0" }, {}, { autoResize: false });
    app.ontoolresult = result => { if (Array.isArray(result.structuredContent?.tasks)) accept(result.structuredContent!); };
    app.onhostcontextchanged = followHostTheme;
    await app.connect(undefined, { timeout: 10000 });
    followHostTheme(app.getHostContext() || { theme: "light" });
  }
  connected = true;
  await Promise.all([loadTodo(), update()]);
} catch (error) { lastError = `无法连接看板。${error instanceof Error ? error.message : "请重新打开插件"}`; clock(); showNotice(); }
setInterval(() => { clock(); if (auto.checked && !document.hidden) void update(); }, 3000);
