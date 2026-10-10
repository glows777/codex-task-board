# 项目约定

本项目是 Codex 侧边栏看板插件，用于直观查看任务运行、完成和阻塞状态。

## 参考实现

- Better Codex 是本项目的主要参考实现，UI 和功能均以它为参考，包括页面布局、组件样式、交互方式和任务管理行为。
- 上游仓库：https://github.com/Ericwong5021/better-codex
- 本地参考源码：`references/better-codex/`。
- 设计或实现相关功能前，先查看 Better Codex 的对应页面和实现，避免凭印象另做一套。
- 具体实现范围以用户当前需求为准；以 Better Codex 为参考不代表自动实现它的全部功能。
- `references/better-codex/` 用作参考，不直接修改或在其中开发本项目。

## 开发与接入

- 使用 Bun + TypeScript 开发。
- 侧边栏使用官方 MCP Apps SDK 与 OpenAI Extensions；任务观察使用官方生命周期 hooks。
- Better Codex 的私有桌面桥接、CDP 注入和私有数据库读取不作为本项目的接入方式。
- 四列状态为“运行中、等待批准、异常、本轮结束”；状态以观察到的官方事件为依据，不因长时间无活动推断异常。
- 测试限定在本项目的 `tests/`，不运行或修改参考仓库的测试。
- 插件安装包使用官方支持的 `.codex-plugin/plugin.json` 兼容布局；变更打包格式时必须用真实 Codex 加载验证 MCP 和 hooks，不能只依赖 schema 校验。
- hooks、MCP 和预览必须使用相同的数据目录；不能假设宿主向它们注入相同的 `PLUGIN_DATA`。
