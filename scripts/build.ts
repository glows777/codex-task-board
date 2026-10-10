import { mkdirSync } from "node:fs";
const root = new URL("../", import.meta.url);
const output = new URL("plugins/task-board/dist/", root);
mkdirSync(output, { recursive: true });
async function build(entry: string, target: "bun" | "browser") {
  const result = await Bun.build({ entrypoints: [new URL(entry, root).pathname], target, minify: target === "browser" });
  if (!result.success) throw new AggregateError(result.logs, `Failed to build ${entry}`);
  return await result.outputs[0].text();
}
const [server, hook, script, style, template] = await Promise.all([
  build("src/server.ts", "bun"), build("src/hook.ts", "bun"), build("src/ui/app.tsx", "browser"),
  build("src/ui/styles.css", "browser"), Bun.file(new URL("src/ui/index.html", root)).text(),
]);
const html = template.replace("__STYLES__", () => style).replace("__SCRIPT__", () => script.replace(/<\/script/gi, "<\\/script")).replace("__MODE__", "app");
await Bun.write(new URL("server.js", output), server);
await Bun.write(new URL("hook.js", output), hook);
await Bun.write(new URL("dashboard.html", output), html);
console.log("Built sidebar MCP app and observation hook → plugins/task-board/dist/");
