import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiStyles } from "@modelcontextprotocol/ext-apps";
const iframe = document.querySelector<HTMLIFrameElement>("iframe")!;
// The protocol permits partial styles; the SDK's generated Record type requires every key.
const lightStyles = { "--color-background-primary": "#f5f3ed", "--color-text-primary": "#242424", "--color-text-secondary": "#686868" } as McpUiStyles;
const darkStyles = { "--color-background-primary": "#212121", "--color-text-primary": "#ececec", "--color-text-secondary": "#b4b4b4" } as McpUiStyles;
const bridge = new AppBridge(null, { name: "Official SDK test host", version: "1" }, { serverTools: {}, openLinks: {} }, { hostContext: { theme: "light", styles: { variables: lightStyles }, displayMode: "inline", containerDimensions: { height: 900, maxWidth: 1440 } } });
bridge.onopenlink = async ({ url }) => {
  document.documentElement.dataset.openedUrl = url;
  return { isError: document.documentElement.dataset.denyOpen === "true" };
};
bridge.oncalltool = async params => {
  const response = await fetch("/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
  if (!response.ok) throw new Error(`Host forwarding failed: ${response.status}`);
  return await response.json();
};
bridge.oninitialized = async () => {
  document.documentElement.dataset.initialized = "true";
  await bridge.sendToolInput({ arguments: {} });
};
let dark = false;
document.querySelector("#dark")!.addEventListener("click", () => {
  dark = !dark;
  bridge.setHostContext({ theme: dark ? "dark" : "light", styles: { variables: dark ? darkStyles : lightStyles } });
});
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
iframe.src = "/app";
