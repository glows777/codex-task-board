import { dataDirectory, Store } from "./store.ts";
import { readTodo } from "./todo.ts";
// Preview uses the same read path as MCP; it never adds demo tasks to a live store.
const store = new Store();
const html = (await Bun.file(new URL("../plugins/task-board/dist/dashboard.html", import.meta.url)).text()).replace('content="app"', 'content="preview"');
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.TASK_BOARD_PORT || 4173),
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/") return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname === "/api/snapshot") return Response.json(store.snapshot());
    if (url.pathname === "/api/todo") return Response.json({ markdown: readTodo() });
    if (url.pathname.startsWith("/api/task/")) {
      const id = decodeURIComponent(url.pathname.slice(10));
      return Response.json({ task: store.task(id), activities: store.activities(id) });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Task board preview: ${server.url} (data: ${dataDirectory()})`);
