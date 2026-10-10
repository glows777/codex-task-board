import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { once } from "node:events";

// Read-only app-server probe: never starts a model turn or changes hook trust.
export class CodexClient {
  private child = spawn("codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "ignore"] });
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private lines = createInterface({ input: this.child.stdout });
  constructor() {
    this.lines.on("line", line => {
      const message = JSON.parse(line);
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
  }
  async connect() {
    await this.call("initialize", { clientInfo: { name: "task-board-package-check", version: "1" }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }
  async call(method: string, params: object): Promise<any> {
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Codex ${method} timed out`)), 10000); })]);
    } finally { clearTimeout(timer!); this.pending.delete(id); }
  }
  async close() {
    this.lines.close();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const exited = once(this.child, "exit"); this.child.kill(); await exited;
    }
  }
}
