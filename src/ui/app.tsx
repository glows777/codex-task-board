import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { BlockNoteEditor } from "@blocknote/core";
import { AllSelection } from "prosemirror-state";
import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { createRoot } from "react-dom/client";
import { statusLabels, statuses, type Snapshot, type Task } from "../model.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = element("board"), notice = element("notice"), connection = element("connection");
const search = element<HTMLInputElement>("search"), project = element<HTMLSelectElement>("project"), auto = element<HTMLInputElement>("auto"), refresh = element<HTMLButtonElement>("refresh");
const preview = document.querySelector<HTMLMetaElement>('meta[name="board-mode"]')?.content === "preview";
let snapshot: Snapshot = { tasks: [], lastEventAt: null, collectedSince: null, revision: -1 };
let busy = false, connected = false, lastError = "", chatError = "";
let app: App;
type Scope = "all" | "attention" | "ended" | "error";
let scope: Scope = "all", listMode = false;
const taskOrder = new Map<string, number>();
const needsAnswer = (task: Task) => task.status === "running" && task.reason === "等待你回答问题";
const needsAction = (task: Task) => task.status === "approval" || needsAnswer(task);
const todo = element("todo"), todoEditorRoot = element("todo-editor"), todoStatus = element("todo-status");
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
  notice.textContent = lastError || chatError || (snapshot.tasks.length ? "" : "还没有任务记录。安装并允许插件 hooks 后，在 Codex 对话中发送一条消息，任务会出现在这里。已有对话会从下一次活动开始接入。");
  notice.hidden = !notice.textContent;
  notice.dataset.error = String(!!lastError || !!chatError);
}
function clock(): void {
  board.querySelectorAll<HTMLTimeElement>("time[data-at]").forEach(time => time.textContent = relative(Number(time.dataset.at)));
  connection.textContent = lastError ? "同步中断" : !connected ? "正在连接" : auto.checked ? "自动同步" : "更新已暂停";
  connection.dataset.connected = String(connected && !lastError);
}
function render(): void {
  const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.task : undefined;
  const scrolls = new Map([...board.querySelectorAll<HTMLElement>(".column")].map(node => [node.dataset.status, node.querySelector<HTMLElement>(".cards")?.scrollTop || 0]));
  const query = search.value.trim().toLocaleLowerCase();
  const matching = snapshot.tasks.filter(task => (!project.value || task.cwd === project.value) && (!query || [task.title, task.project, task.reason, task.activity].join(" ").toLocaleLowerCase().includes(query)));
  const counts = { all: matching.length, attention: matching.filter(needsAction).length, ended: matching.filter(task => task.status === "ended").length, error: matching.filter(task => task.status === "error").length };
  Object.entries(counts).forEach(([key, count]) => { element(`${key}-count`).textContent = String(count); });
  const visible = matching.filter(task => scope === "all" || (scope === "attention" ? needsAction(task) : task.status === scope)).sort((a, b) => taskOrder.get(a.id)! - taskOrder.get(b.id)!);
  element("board-summary").textContent = snapshot.revision < 0 ? "正在读取任务…" : `${counts.attention ? `${counts.attention} 个对话等你行动` : "暂无对话等你行动"} · 本轮结束不代表任务完成`;
  board.dataset.layout = listMode ? "list" : "board";
  board.dataset.scope = scope;
  board.innerHTML = statuses.map((status, index) => {
    const tasks = visible.filter(task => task.status === status);
    if (scope !== "all" && !tasks.length) return "";
    return `<section class="column" data-status="${status}" data-empty="${!tasks.length}" aria-labelledby="column-${status}"><div class="column-head"><span class="status-dot" aria-hidden="true"></span><h2 id="column-${status}">${statusLabels[status]}</h2><span class="count">${tasks.length}</span></div><div class="cards">${tasks.map(task => {
      const waiting = needsAction(task);
      const state = task.status === "approval" ? "等你批准" : needsAnswer(task) ? "等你回答" : task.status === "error" ? task.closed ? "已中断 / 退出" : "工具返回失败" : "";
      const action = task.status === "approval" ? "查看批准" : needsAnswer(task) ? "回答问题" : task.status === "ended" ? "查看回复" : task.status === "error" ? "查看异常" : "继续对话";
      const context = task.status === "ended" && task.activity ? task.activity : task.reason;
      return `<button type="button" class="card" data-task="${escape(task.id)}" data-needs-action="${waiting}" title="${escape(task.title)}" aria-label="${action}：${escape(task.title)}"><span class="card-top"><span class="project-chip" title="${escape(task.cwd)}">${escape(task.project)}</span>${state ? `<span class="card-state">${state}</span>` : ""}</span><span class="card-title">${escape(task.title)}</span><span class="card-reason" title="${escape(context)}">${escape(context)}</span><span class="card-meta"><time data-at="${task.updatedAt}" datetime="${new Date(task.updatedAt).toISOString()}" title="${escape(date(task.updatedAt))}">${relative(task.updatedAt)}</time><span class="open-chat" aria-hidden="true">${action} ↗</span></span></button>`;
    }).join("") || `<div class="empty">${query || project.value ? "没有匹配的任务" : ["交给 Agent，进展会出现在这里", "暂无批准请求", "暂无异常记录", "暂无结束记录"][index]}</div>`}</div></section>`;
  }).join("") || `<div class="board-empty"><strong>${scope === "attention" && !query && !project.value ? "暂时没有对话等你行动" : "没有匹配的对话"}</strong><span>${scope === "attention" ? "批准或回答请求出现时，会汇集在这里。" : "可以切换筛选，或等待下一次对话活动。"}</span></div>`;
  board.querySelectorAll<HTMLElement>(".column").forEach(node => { node.querySelector<HTMLElement>(".cards")!.scrollTop = scrolls.get(node.dataset.status) || 0; });
  if (focusId) [...board.querySelectorAll<HTMLButtonElement>("[data-task]")].find(button => button.dataset.task === focusId)?.focus({ preventScroll: true });
  clock(); showNotice();
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
      renderTodoChecklist();
      scheduleTodoSave();
    }}
  />);
  renderTodoChecklist();
}
function renderTodoChecklist(): void {
  if (!todoEditor) return;
  const checklist = element("todo-checklist");
  const focusId = (document.activeElement as HTMLInputElement)?.dataset?.block;
  const items: { id: string; text: string; checked: boolean }[] = [];
  const documentBlocks = todoEditor.document;
  const collect = (blocks: typeof documentBlocks): void => {
    for (const block of blocks) {
      if (block.type === "checkListItem") items.push({ id: block.id, checked: block.props.checked, text: todoEditor!.blocksToMarkdownLossy([{ ...block, children: [] }]).replace(/^[*+-] \[[ xX]\]\s*/, "").trim() || "未命名待办" });
      if (block.children.length) collect(block.children);
    }
  };
  collect(documentBlocks);
  const pending = items.filter(item => !item.checked);
  checklist.innerHTML = pending.slice(0, 3).map(item => `<label class="todo-item"><input type="checkbox" data-block="${escape(item.id)}" aria-label="完成待办：${escape(item.text)}" ${preview ? "disabled" : ""}/><span>${escape(item.text)}</span></label>`).join("") + `<p class="todo-count">${pending.length > 3 ? `还有 ${pending.length - 3} 项未完成，展开查看` : pending.length ? `${pending.length} 项未完成` : items.length ? "清单已全部勾选" : "暂无待办，记下你的下一步"}${items.some(item => item.checked) ? ` · 已勾选 ${items.filter(item => item.checked).length} 项` : ""}</p>`;
  if (focusId) (checklist.querySelector<HTMLInputElement>(`[data-block="${CSS.escape(focusId)}"]`) || checklist.querySelector<HTMLInputElement>("input") || element<HTMLInputElement>("todo-input")).focus({ preventScroll: true });
}
element("todo-checklist").addEventListener("change", event => {
  const input = event.target as HTMLInputElement;
  if (!todoEditor || preview || !input.dataset.block) return;
  todoEditor.updateBlock(input.dataset.block, { props: { checked: input.checked } });
  currentMarkdown = todoEditor.blocksToMarkdownLossy(todoEditor.document);
  renderTodoChecklist(); scheduleTodoSave();
});
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
      domAttributes: { editor: { class: "todo-document", role: "textbox", "aria-label": "Todo 正文", "aria-multiline": "true", "aria-readonly": String(preview) } },
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
  renderTodoChecklist();
  scheduleTodoSave();
  input.value = "";
  input.focus();
  todoEditorRoot.scrollTop = todoEditorRoot.scrollHeight;
});
element("todo-input").addEventListener("compositionstart", () => { quickComposing = true; });
element("todo-input").addEventListener("compositionend", () => { quickComposing = false; });
element("todo-expand").addEventListener("click", () => {
  const expanded = todo.dataset.expanded !== "true";
  todo.dataset.expanded = String(expanded);
  element("todo-expand").setAttribute("aria-expanded", String(expanded));
  element("todo-expand").textContent = expanded ? "收起" : "展开";
  if (!expanded) void saveTodo();
});
element("todo-retry").addEventListener("click", () => {
  element("todo-retry").hidden = true;
  if (!todoLoaded) void loadTodo(); else void saveTodo();
});
document.querySelectorAll<HTMLButtonElement>(".scopes [data-scope]").forEach(button => button.addEventListener("click", () => {
  scope = button.dataset.scope as Scope;
  document.querySelectorAll<HTMLButtonElement>(".scopes [data-scope]").forEach(control => control.setAttribute("aria-pressed", String(control.dataset.scope === scope)));
  render();
}));
function setLayout(value: boolean): void {
  listMode = value;
  element("mode-board").setAttribute("aria-pressed", String(!value));
  element("mode-list").setAttribute("aria-pressed", String(value));
  render();
}
element("mode-board").addEventListener("click", () => setLayout(false));
element("mode-list").addEventListener("click", () => setLayout(true));
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
board.addEventListener("click", event => { const button = (event.target as Element).closest<HTMLButtonElement>("[data-task]"); if (button?.dataset.task) void openChat(button.dataset.task); });
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
