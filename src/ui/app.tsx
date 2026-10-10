import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { BlockNoteEditor } from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { createRoot } from "react-dom/client";
import { statusLabels, statuses, type Snapshot } from "../model.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = element("board"), notice = element("notice"), connection = element("connection");
const search = element<HTMLInputElement>("search"), project = element<HTMLSelectElement>("project"), auto = element<HTMLInputElement>("auto"), refresh = element<HTMLButtonElement>("refresh");
const preview = document.querySelector<HTMLMetaElement>('meta[name="board-mode"]')?.content === "preview";
let snapshot: Snapshot = { tasks: [], lastEventAt: null, collectedSince: null, revision: -1 };
let busy = false, connected = false, lastError = "", chatError = "";
let app: App;
const todo = element("todo"), todoEditorRoot = element("todo-editor"), todoStatus = element("todo-status");
let todoEditor: BlockNoteEditor | undefined;
const todoReactRoot = createRoot(todoEditorRoot);
let todoLoaded = false, todoLoading = false, savedMarkdown = "", currentMarkdown = "";
let todoSaving = false, todoComposing = false;
let todoSaveTimer: ReturnType<typeof setTimeout> | undefined;
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const relative = (at: number) => { const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000)); return seconds < 60 ? "刚刚" : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : seconds < 86400 ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 86400)} 天前`; };
const date = (at: number) => new Date(at).toLocaleString("zh-CN", { hour12: false });
function showNotice(): void {
  notice.textContent = lastError || chatError || (snapshot.tasks.length ? "" : "还没有任务记录。安装并允许插件 hooks 后，在 Codex 对话中发送一条消息，任务会出现在这里。已有对话会从下一次活动开始接入。");
  notice.hidden = !notice.textContent || !todo.hidden;
  notice.dataset.error = String(!!lastError || !!chatError);
}
function clock(): void {
  board.querySelectorAll<HTMLTimeElement>("time[data-at]").forEach(time => time.textContent = relative(Number(time.dataset.at)));
  connection.textContent = lastError ? "同步中断" : !connected ? "正在连接" : auto.checked ? "每 3 秒更新" : "更新已暂停";
  connection.dataset.connected = String(connected && !lastError);
}
function render(): void {
  const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.task : undefined;
  const scrolls = [...board.querySelectorAll<HTMLElement>(".cards")].map(node => node.scrollTop);
  const query = search.value.trim().toLocaleLowerCase();
  const visible = snapshot.tasks.filter(task => (!project.value || task.cwd === project.value) && (!query || [task.title, task.project, task.reason, task.activity].join(" ").toLocaleLowerCase().includes(query)));
  board.innerHTML = statuses.map((status, index) => {
    const tasks = visible.filter(task => task.status === status);
    return `<section class="column" data-status="${status}" aria-labelledby="column-${status}"><div class="column-head"><span class="status-dot" aria-hidden="true"></span><h2 id="column-${status}">${statusLabels[status]}</h2><span class="count">${tasks.length}</span></div><div class="cards">${tasks.map(task => `<button type="button" class="card" data-task="${escape(task.id)}" aria-label="打开聊天：${escape(task.title)}"><span class="card-top"><span class="card-id">${escape(task.id.slice(0, 8))}</span><span class="card-state">${task.status === "error" && task.closed ? "已中断 / 退出" : statusLabels[task.status]}</span></span><span class="card-title">${escape(task.title)}</span><p class="card-reason" title="${escape(task.reason)}">${escape(task.reason)}</p><span class="card-meta"><span class="project-chip" title="${escape(task.cwd)}">${escape(task.project)}</span><time data-at="${task.updatedAt}" datetime="${new Date(task.updatedAt).toISOString()}" title="${escape(date(task.updatedAt))}">${relative(task.updatedAt)}</time></span></button>`).join("") || `<div class="empty">${query || project.value ? "没有匹配的任务" : ["暂无运行中的任务", "暂无批准请求", "暂无异常记录", "暂无结束记录"][index]}</div>`}</div></section>`;
  }).join("");
  board.querySelectorAll<HTMLElement>(".cards").forEach((node, index) => { node.scrollTop = scrolls[index] || 0; });
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
      domAttributes: { editor: { class: "todo-document", role: "textbox", "aria-label": "Todo 正文", "aria-multiline": "true", "aria-readonly": String(preview) } },
    });
    const blocks = todoEditor.tryParseMarkdownToBlocks(savedMarkdown);
    if (blocks.length) todoEditor.replaceBlocks(todoEditor.document, blocks);
    renderTodoEditor();
    todoLoaded = true;
    todoMessage(preview ? "开发预览只读" : "自动保存");
  } catch { todoMessage("读取失败，再次点击 Todo 重试。", true); }
  finally { todoLoading = false; }
}
function switchView(showTodo: boolean): void {
  if (!showTodo) void saveTodo();
  todo.hidden = !showTodo; board.hidden = showTodo;
  element("board-toolbar").hidden = showTodo; notice.hidden = showTodo || !notice.textContent;
  element<HTMLButtonElement>("view-board").setAttribute("aria-pressed", String(!showTodo));
  element<HTMLButtonElement>("view-todo").setAttribute("aria-pressed", String(showTodo));
  if (showTodo) void loadTodo();
}
element("view-board").addEventListener("click", () => switchView(false));
element("view-todo").addEventListener("click", () => switchView(true));
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
  } catch (error) { todoMessage(`保存失败，草稿保留。继续输入或离开正文时重试。${error instanceof Error ? error.message : ""}`, true); }
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
  if (!todo.hidden) await loadTodo();
  await update();
} catch (error) { lastError = `无法连接看板。${error instanceof Error ? error.message : "请重新打开插件"}`; clock(); showNotice(); }
setInterval(() => { clock(); if (auto.checked && !document.hidden) void update(); }, 3000);
