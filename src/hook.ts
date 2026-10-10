import { isBoardTool, normalizeEvent } from "./events.ts";
import { Store } from "./store.ts";

// Observation only: never emit a permission decision, continuation, or injected context.
try {
  const input = JSON.parse(await Bun.stdin.text());
  if (!isBoardTool(input.tool_name)) {
    const store = new Store();
    try { store.record(normalizeEvent(input)); }
    finally { store.close(); }
  }
} catch (error) {
  console.error(`Task board could not record the hook: ${error instanceof Error ? error.message : "unknown error"}`);
}
// Valid neutral output for every subscribed event, including Stop and Interrupt.
console.log("{}");
