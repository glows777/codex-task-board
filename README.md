# Codex 任务看板

Bun + TypeScript 开发的本地 Codex 侧边栏工作台，用于跟进关注的对话、查看新回复和记录个人笔记。UI 和功能参考 Better Codex，接入使用官方 MCP Apps SDK、OpenAI Extensions 和生命周期 hooks。

## 本地安装

需要 Bun 和 Codex CLI，运行机器应能从 PATH 找到 `bun` 和 `codex`。已验证的版本为 Bun 1.4.0、Codex CLI 0.162.1。

从项目根目录安装依赖、构建并安装插件：

```sh
bun install --frozen-lockfile
bun run build
codex plugin marketplace add . --json
codex plugin add task-board@codex-task-board-local --json
bun run test:installed
```

安装后重新打开 Codex CLI，在交互输入中执行 `/hooks`。本插件应在 8 类事件中各显示一个已安装 hook。选择事件并按 Enter 查看定义，再使用界面提供的信任选项审阅并信任。未信任时 Active 可以为 0，但 Installed 不应全部为 0；安装、启用和测试均不会替你信任 hooks。

通过桌面的“Open plugin”或侧边栏入口打开看板。接入并信任 hooks 后，发送一条消息检查实际采集；当前对话若尚未重新加载插件，可在新对话中验证。

更新本地插件时，重新构建并安装，再重新打开对话加载新包：

```sh
bun run build
codex plugin add task-board@codex-task-board-local --json
bun run test:installed
```

修改 hook 定义后需重新审阅其信任。不要直接修改缓存中的安装包。

## 我的关注

仅提供看板，按个人关注状态组织对话：

| 状态 | 使用方式 |
| --- | --- |
| 跟进中 | 新观察到的对话默认进入这里，继续跟进时保持在此列 |
| 稍后 | 暂时放下的对话，可随时恢复跟进 |
| 已完成 | 点击圆形完成按钮后移入，默认隐藏，可通过“显示已完成”查看和恢复 |

首次加入后，只有人工操作改变关注和完成状态。回复结束、工具失败或再次运行均不会自动完成事项或恢复关注。移动、完成与移出看板可撤销。

移出看板不会归档或删除 Codex 聊天，可从“添加对话”入口按名称或项目搜索并重新加入。此入口仅包含已接入且未加入看板的对话，不导入尚未观察到的历史。已有对话的分类保留，原“新发现”记录也在此入口展示，不因新对话的默认行为调整而重新加入关注。

### 新回复与运行标记

卡片用“新回复”提示变化。点击名称或聚焦后按 Enter，通过官方 MCP Apps SDK `openLink` 请求打开聊天；成功打开后清除点击时那条回复的提示。打开失败、打开期间收到新回复或其他面板修改状态时，保留提示并告知。提示按回复事件序号保存，并通过版本检查避免覆盖更新。

打开聊天只表示已进入对应对话，不作为阅读或验收证明，也不会完成事项或改变所在列。没有单独的“标记已查看”操作。已完成对话收到新回复时，在“显示已完成”旁提示，不自动恢复跟进。

运行信息作为辅助标记，不决定看板列：

| 标记 | 依据 |
| --- | --- |
| 运行中 | 观察到新请求或工具调用，等待回答时另有提示 |
| 等待批准 | 观察到官方 `PermissionRequest`，相同调用返回或本轮结束后清除 |
| 异常 | 明确工具失败、用户中断，或会话未观察到本轮结束就退出 |
| 本轮结束 | 观察到有效的 `Stop`，表示本次回复结束，不代表事项完成 |

“本轮结束”以次要文字显示，人工完成以“已完成”列表示。摘要中的“已完成”等措辞保留原文，不用于判断事项是否完成。

### 名称、筛选与排序

对话名称读取官方 `codex app-server` 的 `thread/list.name`，每 30 秒同步一次。只请求交互来源和元数据，不读取完整 turns、不 resume、不触发模型。请求与回复摘要不覆盖名称；名称不可用时显示稳定 ID 占位和“名称待同步”，读取失败保留已知名称。

支持搜索、项目筛选和每 3 秒自动刷新。首次加载按最近活动排序，普通更新保持相对位置，新对话追加。窄侧边栏纵向显示各组，无需横向滚动。`⌘ K`（其他系统为 `Ctrl K`）聚焦搜索，在搜索框中按 `Escape` 清空搜索。

历史对话从接入后的下一次活动开始出现，不导入整份历史。已观察到的应用生成建议请求封套被排除，普通英文请求不被过滤。

## 笔记

笔记区始终展开，宽屏位于右侧，窄屏位于上方，不随关注筛选、完成状态或看板滚动而移动。对话刷新只更新看板区域，不重建笔记编辑器。

使用 BlockNote 完整编辑器，支持中文格式菜单、Markdown 快捷语法、表格与代码块。快捷输入可按 Enter 或加号添加待办，提交后保留焦点。勾选项留在笔记文档中，不拆成任务卡片或移入看板的已完成列。

停顿 500 毫秒后自动保存，离开正文时也保存。保存期间可继续输入，后续内容依次写入。显示“已保存”后重新打开仍可读取；保存失败时保留正文草稿，继续输入或离开正文时重试。若读入后文件被外部编辑，不覆盖外部修改。

内容保存为本地 `todo.md`，正式插件通过 app-only MCP 工具读取和保存，开发预览只读。BlockNote 使用公共 API `tryParseMarkdownToBlocks` 读入、`blocksToMarkdownLossy` 导出，语法和空白可能规范化，颜色等特殊样式无法保留，不保证任意 Markdown 方言的无损往返。没有单独的 JSON 文档或云端上传服务，外部图片能否加载取决于宿主的资源访问策略。

## 开发与验证

安装依赖并构建后，运行项目检查：

```sh
bun run typecheck
bun run test
bun run test:browser
```

测试限定在本项目的 `tests/`，不运行参考仓库的测试。浏览器测试需要本机 Google Chrome，使用临时数据，截图目录由命令输出。

| 检查 | 覆盖范围 |
| --- | --- |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run test` | 状态、存储、笔记、打包和集成测试；其中 `tests/codex-runtime.test.ts` 通过真实 Codex 的 `plugin/read` 检查 8 类 hooks 与 MCP 被发现 |
| `bun run test:browser` | 官方 AppBridge 驱动真实 UI，经 SDK 调用独立 stdio MCP 进程，检查渲染、关注操作、聊天打开、新回复提示、笔记保存与失败恢复 |
| `bun run test:installed` | 检查已安装且启用的 hooks、MCP initialize、6 个工具（含关注修改和笔记读写）、全局侧边栏入口和 UI 资源，并报告 hook 信任状态 |

Codex 加载检查和安装检查均不修改配置、不信任 hooks、不启动模型请求。浏览器测试不能替代在 Codex 桌面中安装、信任 hooks 后的最终验收。

### 开发预览

```sh
bun run preview
```

预览地址为 `http://127.0.0.1:4173`，读取本地数据，不保存笔记或打开真实聊天。手动检查临时数据和 SDK 交互时，可使用测试宿主：

```sh
bun scripts/browser-check.ts --serve
```

该宿主不修改真实数据，地址由命令输出。

### 目录与打包

插件包位于 `plugins/task-board/`，构建生成 `dist/server.js`、`dist/hook.js` 和自包含 UI 资源。安装时只需要该插件目录，无需携带项目的 `node_modules/` 和参考仓库。

```text
src/                              Bun / TypeScript 源码和 MCP App UI
scripts/                          构建与浏览器验证
tests/                            本项目测试（包括真实 Codex 加载检查）
.agents/plugins/marketplace.json   本地 marketplace
plugins/task-board/
  .codex-plugin/plugin.json        官方兼容格式 manifest
  .mcp.json                        MCP stdio 启动配置
  hooks/hooks.json                 官方生命周期事件订阅
  dist/                            自包含安装产物
references/better-codex/           参考源码，不参与构建或测试
```

本项目使用官方支持的 `.codex-plugin/plugin.json` 兼容布局。Codex CLI 0.162.1 的加载器会跳过根目录 `plugin.json` / `mcp.json` 布局的 hooks；不要同时保留根目录 `plugin.json`，否则宿主会优先选择它。升级打包格式前须通过真实 Codex 加载检查，不能只依赖 JSON schema 校验。`references/better-codex/` 仅供参考，不在其中开发或修改。

## 数据和能力边界

### 本地数据

默认数据目录为 `~/.local/share/codex-task-board/`：

| 文件 | 内容 |
| --- | --- |
| `board.sqlite` | 插件采集的事件、对话元数据与人工关注状态，采用 WAL 和事务支持多个 hook 进程写入 |
| `todo.md` | 个人笔记，与聊天状态分开保存 |

hook、MCP 和预览必须使用同一数据目录。可通过 `TASK_BOARD_DATA_DIR` 覆盖，但须向三者传入相同值。兼容格式 MCP 不自动获得 hooks 的 `PLUGIN_DATA`，默认路径因此不依赖该变量。

数据仅在本机保存，包括对话 ID、目录、160 字以内的提示、回复和批准原因摘要、工具名称及事件时间。不保存命令正文、工具输出或完整 transcript，不扫描 Codex 私有数据库，不重命名或归档原对话。

### 观察范围

hooks 不是完整的运行监控接口：不覆盖全部托管工具，也不保证报告崩溃、断网、批准被拒绝或执行卡死。看板展示**最后观察到的状态**，时间只表示最近事件，不按超时猜测异常。批准请求在没有后续事件时会保留，详情可查看时间。

Codex 的 Bash `PostToolUse` 可能只返回输出文本，没有退出码，空输出成功与失败无法区分。插件只识别结果明确包含 `isError: true` 或非零 `exit_code` 的错误，不从普通输出中猜测失败，因此“异常”不覆盖所有命令失败。后续执行会让暂时的工具错误恢复为运行中。MCP 调用失败时，宿主也可能跳过 `PostToolUse`，无法保证全面捕获。

采集 hook 始终返回空 JSON，不批准或拒绝操作，不改变模型上下文、停止和继续行为。采集写入失败时输出诊断并保持中立。停止插件可在 Codex 中禁用或卸载；本地历史数据单独保留。

### 数据迁移与回退

关注状态迁移只增加插件数据库的 `focus` 表和 schema 标记，保留原有 tasks/events 与 `todo.md`。原“新发现”状态沿用已有存储值，无需迁移。回退到旧构建可继续读取原事件，但旧 UI 不呈现人工关注状态；需要恢复原始数据库时，先停用插件再从备份还原。

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
