import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Store } from "./store.ts";

// Official read-only metadata protocol. Never resume a thread or start a model turn.
export async function readThreadNames(cwds: string[]): Promise<{id:string;name:string}[]> {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  let nextId = 0;
  const pending = new Map<number, {resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  const fail = (error: Error) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on("error", fail);
  child.on("exit", () => fail(new Error("Codex 名称读取进程已退出")));
  lines.on("line", line => {
    try {
      const message = JSON.parse(line), request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || "Codex 名称读取失败"));
      else request.resolve(message.result);
    } catch { fail(new Error("Codex 名称响应格式不正确")); }
  });
  async function call(method: string, params: object): Promise<any> {
    const id = ++nextId;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(() => { pending.delete(id); reject(new Error("Codex 名称读取超时")); }, 5000);
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    } finally { clearTimeout(timer!); }
  }
  try {
    await call("initialize", { clientInfo: { name: "task-board-names", version: "1" } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const names: {id:string;name:string}[] = [];
    let cursor: string | null = null;
    do {
      const page = await call("thread/list", { cursor, limit: 100, cwd: cwds, sourceKinds: ["cli", "vscode", "appServer"], useStateDbOnly: true });
      if (!Array.isArray(page.data)) throw new Error("Codex 对话列表格式不正确");
      for (const thread of page.data) if (typeof thread.id === "string" && typeof thread.name === "string" && thread.name.trim()) names.push({ id: thread.id, name: thread.name.trim().slice(0, 300) });
      cursor = page.nextCursor;
    } while (cursor);
    return names;
  } finally { lines.close(); child.kill(); }
}

export function nameSync(store: Store, read = readThreadNames): () => Promise<string> {
  let checkedAt = 0, pending: Promise<string> | undefined, error = "";
  return async () => {
    if (pending) return pending;
    if (Date.now() - checkedAt < 30000) return error;
    checkedAt = Date.now();
    const tasks = store.snapshot().tasks;
    if (!tasks.length) return error;
    pending = (async () => {
      try { store.setNames(await read([...new Set(tasks.map(task => task.cwd).filter(Boolean))])); error = ""; }
      catch { error = "对话名称暂未同步，保留已知名称。请确认 Codex CLI 可用后刷新。"; }
      finally { pending = undefined; }
      return error;
    })();
    return pending;
  };
}
