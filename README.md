# Codex 任务看板

Bun + TypeScript 开发的本地 Codex 侧边栏插件。UI 和功能以 `references/better-codex/` 为参考，插件接入使用官方 MCP Apps SDK、OpenAI Extensions 和生命周期 hooks。

## 我的关注

仅使用看板，不提供列表模式。新观察到的对话默认进入“跟进中”，由用户决定是否移到“稍后”或移出看板。首次加入后，只有明确的用户操作改变关注和完成状态。回复结束、工具失败、再次运行均不会自动完成或恢复关注。点击圆形完成按钮后移入“已完成”，默认隐藏，可通过“显示已完成”查看和恢复；移动、完成与移出看板可撤销。移出后不再显示在看板，可从“添加对话”入口搜索名称或项目并重新加入；不归档或删除 Codex 聊天。添加入口仅包含已接入且未加入看板的对话，不导入尚未观察到的历史。原“新发现”记录沿用已有存储值，在添加入口展示，无需迁移数据。已有对话的分类保留，不因默认行为调整而重新加入关注。

卡片显示运行信息和“新回复”提示，不再提供独立的“标记已查看”操作。成功打开聊天后清除点击时那条回复的提示，表示已进入对应聊天，不作为阅读或验收证明；打开失败时保留提示。提示按回复事件序号保存，跨面板使用版本检查，打开期间有新回复或其他面板改动时保留提示并告知，避免清除更新或覆盖人工决定。清除提示不会完成事项或改变其所在列。新回复会再次提示；已完成对话的新回复在“显示已完成”旁提示，不自动恢复跟进。有效的 `Stop` 显示次要文字“本轮结束”，人工完成以“已完成”列表示，不重复堆叠完成标签。摘要中的“已完成”等措辞保留原文，不用于判断完成状态。

主标题读取官方 `codex app-server` 的 `thread/list.name`，每 30 秒同步一次，只请求交互来源和元数据，不读取完整 turns、不 resume、不触发模型。请求与回复摘要不覆盖名称。名称尚未获取时显示稳定 ID 占位和“名称待同步”，读取失败保留已有名称。运行机器需能从 PATH 找到 `codex` 和 `bun`。历史对话仍从接入后的下一次活动开始出现，不导入整份历史。已观察到的应用生成建议请求封套被排除，普通英文请求不被过滤。

## 运行标记

- **运行中**：新请求或工具调用正在处理，等待回答另有提示。
- **等待批准**：官方 `PermissionRequest` 事件，相同调用返回或本轮结束后清除。
- **异常**：明确工具失败、用户中断或会话未观察到本轮结束就退出。
- **本轮结束**：观察到 `Stop`，表示本次回复结束，不代表业务完成。

运行标记不决定人工状态列。首次加载按最近活动排序，普通更新保持相对位置，新对话追加。支持搜索、项目筛选和每 3 秒刷新。点击名称或聚焦后按 Enter，通过官方 MCP Apps SDK `openLink` 请求打开对应聊天；宿主拒绝时提示。窄侧边栏纵向显示各组，无需横向滚动。`⌘ K`（其他系统为 `Ctrl K`）聚焦搜索，`Escape` 清空搜索。不重命名或归档原对话，不扫描 Codex 私有数据库或 transcript。

## 笔记

固定笔记区与看板并列，宽屏保持在右侧，窄屏固定在上方；编辑器始终展开，不随关注筛选、完成状态或看板滚动而移动。保留 BlockNote 完整笔记编辑器、中文格式菜单、Markdown 快捷语法、表格与代码块。勾选项留在笔记文档中，不拆成任务卡片或移入看板的已完成列。快捷输入仍可按 Enter 或加号添加待办，焦点保留。停顿 500 毫秒后自动保存，离开正文时也保存。对话刷新只更新看板区域，不重建笔记编辑器。

内容保存为 `~/.local/share/codex-task-board/todo.md`（设置 `TASK_BOARD_DATA_DIR` 时跟随该目录），与 Codex 聊天状态分开。使用 BlockNote 公共 API `tryParseMarkdownToBlocks` 读入、`blocksToMarkdownLossy` 导出；语法和空白可能规范化，Markdown 无法保留颜色等特殊样式，不保证任意 Markdown 方言的无损往返。没有单独的 JSON 文档或云端上传服务；外部图片能否加载取决于宿主的资源访问策略。保存时可以继续输入，后续内容会依次写入。状态显示“已保存”后重新打开仍可读取。保存失败时保留正文中的草稿，继续输入或离开正文时重试；若读入后文件已被外部编辑，不覆盖新内容。开发预览只读，正式插件通过 app-only MCP 工具读取和保存。

## 开发与验证

需要 Bun（当前验证版本 1.4.0）和 Codex CLI（当前验证版本 0.162.1）。`bun run test:browser` 使用本机 Google Chrome。

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run test
bun run test:browser
bun run preview
```

预览地址为 `http://127.0.0.1:4173`。开发预览只读，不打开真实聊天。浏览器验证使用临时数据，截图目录由命令输出。`bun scripts/browser-check.ts --serve` 可启动同一套临时 SDK 测试宿主供手动验证，不修改真实数据。

插件包位于 `plugins/task-board/`；构建生成其中的 `dist/server.js`、`dist/hook.js` 和自包含 UI 资源。安装时只需要该插件目录，无需携带项目的 `node_modules/` 和参考仓库。运行机器需能从 PATH 找到 `bun`。

目录分为开发源码、可安装包和只读参考：

```text
src/                              Bun / TypeScript 源码和 MCP App UI
scripts/                          构建与浏览器验证
tests/                            本项目测试（包括真实 Codex 加载检查）
.agents/plugins/marketplace.json  本地 marketplace
plugins/task-board/
  .codex-plugin/plugin.json        官方兼容格式 manifest
  .mcp.json                       MCP stdio 启动配置
  hooks/hooks.json                官方生命周期事件订阅
  dist/                           自包含安装产物
references/better-codex/           参考源码，不参与构建或测试
```

官方推荐的新格式是根目录 `plugin.json` / `mcp.json`，但当前 Codex 0.162.1 的加载器会跳过该格式的 hooks。此包使用官方文档与 plugin-creator 仍支持的兼容布局，确保 MCP 与 hooks 都可被发现。不要同时保留根目录 `plugin.json`，否则宿主会优先选择它。升级格式前须通过真实 Codex 加载检查，不能只检查 JSON schema。

## 本地安装

先构建，再从本项目根目录执行官方 CLI：

```sh
codex plugin marketplace add . --json
codex plugin add task-board@codex-task-board-local --json
bun run test:installed
```

安装后重新打开 Codex CLI，在交互输入中执行 `/hooks`。本插件应在 8 类事件中各显示一个已安装 hook；选择事件并按 Enter 查看定义，再使用界面提供的信任选项审阅并信任。没有信任前 Active 可以是 0，但 Installed 不应全部为 0。安装和启用本身不会信任 hooks，测试也不会替你修改信任。

桌面中的“Open plugin”或侧边栏入口用于打开看板。接入并信任 hooks 后发送一条消息验证实际采集；当前对话若没有重新加载插件，可在新对话中验证。

开发改动后重新 `bun run build` 和 `codex plugin add task-board@codex-task-board-local --json`，再重新打开对话加载新包；修改 hook 定义后需要重新审阅其信任。不要直接修改缓存中的安装包。

## 数据和能力边界

hook、MCP 和开发预览统一使用 `~/.local/share/codex-task-board/board.sqlite`，采用 WAL 和事务支持多个 hook 进程写入。这是本插件自己的数据，不是 Codex 私有数据库。兼容格式 MCP 不自动获得 hooks 的 `PLUGIN_DATA`，因此默认路径不依赖该变量。测试可统一设置 `TASK_BOARD_DATA_DIR`；覆盖时须让 hook、MCP 和预览获得同一值。数据只在本机保存：包括对话 ID、目录、160 字以内的提示/回复/批准原因摘要、工具名称和事件时间，不保存命令正文、工具输出或完整 transcript。

hooks 不是完整的运行监控接口：不覆盖全部托管工具，也不保证报告崩溃、断网、批准被拒绝或执行卡死。看板展示**最后观察到的状态**，时间只表示最近事件，不按超时猜测异常。批准请求在没有后续事件时会保留，详情可查看时间。

目前 Codex 的 Bash `PostToolUse` 可能只返回输出文本，没有退出码，空输出成功与失败无法区分。第一版只识别结果明确包含 `isError: true` 或非零 `exit_code` 的错误，不从普通输出中猜测失败；因此“异常”并不覆盖所有命令失败。后续执行会让暂时的工具错误恢复为运行中。当前 MCP 调用的失败也可能由宿主跳过 PostToolUse，无法保证全面捕获。

采集 hook 始终返回空 JSON，不批准或拒绝操作，不改变模型上下文、停止和继续行为。采集写入失败时输出诊断并保持中立。停止插件可在 Codex 中禁用或卸载；本地历史数据单独保留。

## 官方与参考资料

- [侧边栏扩展](https://developers.openai.com/plugins/build/extensions)
- [官方聊天链接](https://learn.chatgpt.com/docs/reference/commands#deep-links)
- [插件打包、marketplace 和 hooks 信任](https://developers.openai.com/plugins/build/plugins)
- [官方 app-server 元数据协议](https://learn.chatgpt.com/docs/app-server)
- [hooks 事件协议](https://learn.chatgpt.com/docs/hooks)
- [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)
- [BlockNote 完整组件](https://www.blocknotejs.org/docs/getting-started)与 [Markdown 导出边界](https://www.blocknotejs.org/docs/features/export/markdown)
- [Codex Bash hook 输出实现](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/context.rs)
- [Better Codex](https://github.com/Ericwong5021/better-codex)：样式借鉴说明和 Apache-2.0 许可证在插件包内 `NOTICE` / `BETTER-CODEX-LICENSE`。

`tests/codex-runtime.test.ts` 通过当前 Codex 的官方 app-server `plugin/read` 验证包内 8 个 hooks 和 MCP 被发现。安装后运行 `bun run test:installed`，检查实际启用的 hooks、MCP initialize、6 个工具（包括关注修改和 Todo 读写）、全局侧边栏入口和 UI 资源。两项检查都不修改配置、不信任 hooks、不启动模型请求。浏览器测试使用官方 `AppBridge` 驱动真实 UI，并通过 SDK 调用独立的 stdio MCP 进程；它验证协议与渲染、Todo 编辑保存重载和失败时的草稿保留，但不能代替 Codex 桌面里安装、信任 hooks 后的最终验收。

关注状态迁移只增加插件数据库的 `focus` 表和 schema 标记，保留原有 tasks/events 与 todo.md。回退到旧构建可继续读取原事件，但旧 UI 不呈现人工关注状态；需要恢复原始数据库时，先停用插件再从备份还原。
