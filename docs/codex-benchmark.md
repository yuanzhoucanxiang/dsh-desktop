# OpenAI Codex 全表面 UX/功能基准调研

> **这份文件是什么 / 什么时候该重读**：本文件是对 OpenAI **Codex** 编码 agent 产品家族（CLI / IDE 扩展 / cloud+GitHub 评审 / 桌面 App）四类表面所做的一次 UX/功能基准盘点。目标是给「Electron 外壳 + 本地 Web 版 agent 内核」的桌面应用（dsh-desktop，外壳启动 `dsh web` 并托管其 Web UI）提供一份**可落地的抄作业清单**：每一行都说明 Codex 怎么做、为什么好用、以及对应到我们的外壳层能否实现、是否要改内核。
>
> **重读时机**：① 规划外壳层新功能、排优先级时（先看 P0/P1/P2 分级）；② 想确认某项能力是否「外壳可做 vs 必须改内核」时（看最后一列与 ⛔内核 标记）；③ Codex 发布大版本后重新对齐能力集时。文中能力点均来自官方文档，来源见文末「主要来源」。

---

## 一、四个表面速览

- **Codex CLI**（开源 `openai/codex`，终端 TUI）：`/` 斜杠命令 + `@` 文件提及 + `!` 行首跑本地命令；`/model` `/reasoning` `/fast` 切模型与推理强度；`/plan` 计划模式；`/permissions` 切审批/沙箱档位（`read-only` / `workspace-write` / `danger-full-access`，审批策略 `untrusted` / `on-request` / `never` + `auto_review` 自动审查）；`codex resume` 恢复会话、`codex exec` 非交互（`--json` JSONL 流、`--output-schema`、stdin 管道）；`-i/--image` 图片输入；MCP（`codex mcp add`）；`AGENTS.md` 分层约定；`~/.codex/config.toml` 单文件配置；`tui.keymap` 全键位可改；`/diff` `/raw` 看 diff/抄录；`notify` 外部命令 + `tui.notifications`（osc9/bel）通知。
- **Codex IDE 扩展**（VS Code/Cursor/Windsurf，Xcode/JetBrains 自有集成）：composer 下方**权限控件**与**模型/推理强度控件**；`/cloud` `/local` `/worktree` 切换运行位置；`/review` 审查（对 base 分支或未提交改动）；review 面板**逐文件/逐 hunk** stage/unstage/revert + 整份 diff 级操作；`@` 提及打开的文件/选区；内联行评论反馈；命令面板命令（`Codex: Open Codex Sidebar`、`chatgpt.addFileToThread` 等）。
- **Codex cloud / web + GitHub 评审**：网页/CLI/IDE/GitHub/Linear/Slack 五入口发起**并行云任务**；每仓库配置**可复现环境**（依赖/变量/secret/设置步骤）；完成后审 diff、开 PR；GitHub 上 `@codex review` / `@codex fix the P1 issue` / `@codex security review` 触发评审与修复、可自动评审。
- **Codex 桌面 App**（= ChatGPT 桌面 App，macOS/Windows/Linux，Windows 有原生沙箱）：多项目并行 + git worktree + **Handoff** 在 Local↔Worktree 间搬会话；review 面板；计划任务（scheduled tasks）；集成终端；插件/Skills；Activity 视图；`codex://` 深链接；全键盘快捷键；通知。

---

## 二、优先级基准表

> 图例：**【P0】立即做** · **【P1】值得做** · **【P2】锦上添花** · **【⛔内核】不改内核做不到**。末列「外壳层实现」指仅用：Electron 窗口/菜单/托盘、全局+本地快捷键、OS 通知、文件对话框、剪贴板、协议处理器、多窗口、preload 注入 overlay（已含右侧 changes review 侧栏）、读 git 状态、spawn 进程、持久化设置、自动更新。

| 能力 | Codex 怎么做 | 为什么好用 | 对「Electron 外壳 + 本地 web agent 内核」意味着什么 |
|---|---|---|---|
| **【P0】全局/本地快捷键 + 可自定义** | 命令面板 `Cmd/Ctrl+K`、新会话 `Cmd+N`、切审查面板 `Cmd+Alt+B`、全局 Quick chat `Cmd+Opt+N`、Settings>Keyboard Shortcuts 可搜/可重置；CLI 侧 `tui.keymap.<context>.<action>` 逐键重映射 | 键盘优先、打断成本趋零、跨应用唤起，是「常驻工具」的体验底座 | ✅ **纯外壳层**：menu accelerator + `globalShortcut` + preload 注入本地快捷键，完全不动内核。P0 第一优先级 |
| **【P0】OS 通知（回合完成/需审批/后台运行）** | 桌面通知三档（never/background/always）、权限/提问通知分开关；CLI `notify` 触发外部程序 + `tui.notifications`（osc9/bel，仅失焦时提醒） | 长任务不用盯着，失焦也能知道「该你处理了」 | ✅ **纯外壳层**：Electron `Notification` + 经 preload 观察 web 状态（或轮询 git 状态变化）判定回合完成。前提是能读到内核状态——外壳已注入 overlay，具备观察通道 |
| **【P0】diff 审查面板 + 逐文件/逐 hunk stage·revert·commit·push** | review 面板按 Unstaged/Staged/Commit/Branch/Last turn 分档，整份 diff / 单文件 / 单 hunk 三级 stage·unstage·revert；面板头一键 Stage all/Revert all | 把「agent 改了什么」变成可逐块接受/丢弃的信任闭环，是 agent 工具最核心的安全感来源 | ✅ **外壳层最强对标点**：读 git 状态 + spawn `git diff/add/restore/checkout/commit/push` 都是外壳能力；已注入的右侧 changes review 侧栏正好升级成完整信任闭环。P0 |
| **【P0】深链接 / 协议处理器** | `codex://threads/new?prompt=…&path=…`、`codex://settings`、`codex://plugins/…` 等一整套 URL scheme，可从浏览器/外部工具直接打开指定会话并预填 prompt | 把 app 变成可被外部世界驱动的入口：分享、书签、别的工具一键投喂上下文 | ✅ **纯外壳层**：`app.setAsDefaultProtocolClient` 明确在授权能力内。注册 `dsh://`/自定义 scheme 即可，不改内核 |
| **【P0】多窗口 / 多会话并行** | 并行云任务 + 多 project + worktree 多 checkout，桌面 App 强调「projects in parallel」 | 长任务互相阻塞是 agent 工具最大痛点，并行=生产力翻倍 | ✅ **纯外壳层**：多 `BrowserWindow`/多 tab 各自承载会话。唯一前提是内核会话可用独立 URL 路由寻址（多数 web agent 支持） |
| **【P1】托盘 + 全局快速唤起（Quick chat 悬浮小窗）** | Quick chat 热键开轻量提问窗；Activity 视图铃铛 `Cmd+Opt+U`；floating pet 显示 Running/Needs input/Ready/Blocked | 不打断主线、随时插一句；后台状态一眼可见 | ✅ 外壳层可做：tray + `globalShortcut` 弹出一个小 BrowserWindow 指向新会话 URL。※需内核支持「开一个独立轻会话」的路由；若内核只有单一会话则降级为「唤起主窗」 |
| **【P1】任务列表 / 进度 / 活动视图** | Activity 视图（unread/running/waiting）、状态栏字段、窗口标题显示 task progress、scheduled tasks | 多任务时能回答「谁在跑、谁卡住、谁等我」 | ◐ 外壳层可做**外壳侧**表现：托盘菜单/Dock badge/窗口标题显示运行中任务数（经 preload 观察状态）。任务列表的**内容与生命周期在内核**，外壳只能反映、不能编排 |
| **【P1】状态可视化（标题栏/状态栏：模型·分支·上下文余量·进度）** | `tui.status_line` / `tui.terminal_title` / `/statusline` `/title` `/status` 自选并排序字段 | 复杂任务里随时确认「当前在哪个模型/分支/还剩多少上下文」 | ◐ 外壳层可设窗口标题与 badge，但**具体字段值需内核暴露**（通过页面状态或事件）。没有内核配合只能显示 git 分支/任务耗时等外壳可自算的项 |
| **【P1】一键「审查这个 PR」（gh 上下文 + 对 base 的 diff）** | 桌面 App 经 `gh auth login` 拉 PR 上下文/评论/changed files，review 面板并排展示；IDE 用 `/review` 对 base 分支 | 不用切去 GitHub 就能带着 PR 上下文审查、并要求 agent 逐个处理评论 | ◐ 外壳层可 spawn `gh pr view/diff` + `git diff <base>...HEAD` 读取上下文并在 overlay 展示 diff 与评论。**「让 agent 修」这一下需内核**（或先复制指令到剪贴板让用户粘贴） |
| **【P1】git worktree 并行后台环境** | 桌面 App 一键在 worktree 开后台会话（detached HEAD、默认保留最近 15 个、`.worktreeinclude` 拷贝被忽略文件） | 后台任务不污染前台 checkout，分支互不干扰 | ✅ 外壳层可 spawn `git worktree add` + 新窗口指向该 worktree（读 git 状态 + spawn 进程都在授权内）。会话与 worktree 的绑定/清理策略需内核协作 |
| **【P1】本地 ↔ 后台/云端任务切换** | IDE `/cloud` `/local` `/worktree`；桌面 Handoff 在 Local↔Worktree 间搬移会话**和代码**（处理同一分支只能一处 checkout 的 Git 约束） | 小任务前台快改，大任务扔后台/云端，回来接着审 | ◐ 外壳层能做「新开/切换窗口指向不同 checkout」；**Handoff（把会话+代码安全搬移）需内核**，是 Codex 最深的一层，外壳抄不了核心 |
| **【P1】会话历史搜索 / 恢复** | `codex resume`、`Cmd+G` 搜索历史（可匹配聊天内容与分支名）、`Cmd+Shift+[ ]` 前后翻会话 | 长项目里找回「上次改到哪」是高频动作 | ◐ 外壳层可加「最近会话」菜单 + 快捷键（读内核暴露的会话列表/deep link）；**会话数据与恢复逻辑在内核** |
| **【P1】持久化设置 UI + 外部通知命令钩子** | `~/.codex/config.toml` 单文件（schema 校验 + Even Better TOML 补全，分层 profile）；`[notify]` 回合完成时跑外部程序 | 设置一处改、可版本化、可脚本化；通知可接 webhook/桌面 toast | ✅ 外壳层可做**自身**设置窗（persisted settings 在授权内）并在事件时 spawn 外部程序。**统一进内核的 config.toml 语义需内核**——外壳不要越权改内核配置 |
| **【P2】图片输入（粘贴/拖入/文件选择）** | 粘贴进 composer，或 `codex -i/--image` 传截图/设计稿/架构图 | 视觉上下文（报错截图、UI 稿）能少写很多字 | ◐ 剪贴板 + 文件对话框是外壳能力；但**让模型「看见」图需内核接受粘贴/附件**。外壳只能做「选图→插入路径/进剪贴板」的搬运 |
| **【P2】内联 diff 行评论回注** | hover 行出 `+`，按行留言，agent 按行级意见精修（比泛泛指令更准） | 行级反馈是「agent 修对没有」的最高效修正方式 | ◐ overlay 可捕获评论，但**回注 agent 需内核 hook**；否则退化为「评论复制进剪贴板，用户自己贴回聊天」 |
| **【P2】自动更新** | 安装脚本/brew/winget 更新 + App 内自动更新 | 高频迭代的 agent 工具必须无痛升级 | ✅ **纯外壳层**（`electron-updater`），属于基建而非差异化，故 P2 |
| **【⛔内核】沙箱/审批模式强制** | `read-only`/`workspace-write`/`danger-full-access` + `Ask for approval`/`Approve for me`(auto_review)/`Full access`，逐 OS 平台原生强制（macOS Seatbelt / Linux bubblewrap / Windows 原生沙箱） | 这是「敢让 agent 自己跑」的信任底座，降低审批疲劳 | ❌ **外壳不可能实现**。外壳只能加一个「切换档位」的快捷键，但真正的文件/网络强制在内核沙箱 |
| **【⛔内核】plan 模式** | `/plan` 先出执行计划再动手 | 高风险改动先对齐方案，避免返工 | ❌ 内核（agent 执行范式）。外壳只能做个「计划中」的视觉提示 |
| **【⛔内核】模型 / 推理强度切换** | composer 下方模型+推理控件，CLI `/model` `/reasoning` `/fast`，`--model/-m` | 简单任务省钱、难任务加深推理 | ❌ 内核（模型路由）。外壳最多加个菜单项映射到内核已有命令/深链 |
| **【⛔内核】`@` 文件提及补全** | composer 内 `@` 搜文件并把路径加入 prompt | 免去手打路径、把上下文「点到即送」 | ❌ 内核（web app composer 的交互）。preload 强改 DOM 太脆，不建议 |
| **【⛔内核】斜杠命令面板** | `/` 弹出可过滤命令列表（40+ 条） | 键盘发现式控制台，不记命令名也能用 | ❌ 内核（composer 语法与命令注册） |
| **【⛔内核】AGENTS.md 约定消费** | 全局 `~/.codex/AGENTS.md` + 项目 `AGENTS.md` + 嵌套 `AGENTS.override.md` 分层合并，`/init` 生成 | 仓库规范一次写好、处处生效 | ❌ 内核（读取并注入 prompt）。外壳只能帮用户脚手架/编辑该文件 |
| **【⛔内核】MCP server 执行** | `codex mcp add`、config.toml `[mcp_servers]`、三表面共享配置、STDIO/HTTP+OAuth | 把第三方文档/浏览器/Figma 接进 agent | ❌ 内核（工具协议与执行）。外壳只能做一个「管理面板」写配置文件——若内核没有配置文件/API 就别硬来 |
| **【⛔内核】会话 resume 的内容恢复** | `codex resume` / `codex exec resume --last` 精确续接上下文 | 二段式流水线、隔天续活 | ❌ 内核（会话状态与上下文）。外壳只能做入口快捷键 |

---

## 三、3 个最该抄的点

1. **审查面板 = 外壳的「主场」**。Codex 的 review 面板（按 Unstaged/Staged/Commit/Branch/Last turn 分档 + 逐文件/逐 hunk stage·revert + 一键 commit/push）几乎**全部落在你已授权的外壳能力里**（读 git 状态 + spawn git + 已注入的右侧 changes review 侧栏）。这是把现有 overlay 升级成完整「信任闭环」的最短路径，且是纯桌面壳相对 web 版最不可替代的优势。→ **P0 首做**。
2. **后台感知三件套：全局快捷键 + OS 通知 + 托盘快速唤起**。web 版 agent 最缺的就是「任务在后台跑时，桌面能提醒我、我能随时唤起」。这三样是**纯外壳层、成本最低、感知最强的差异化**，Codex 用 `notify` + Activity 视图 + Quick chat 热键整套证明了它的价值。→ **P0/P1**。
3. **深链接 / 协议处理器**（`codex://threads/new?prompt=…`）。它把桌面 app 从「一个窗口」变成「可被外部工具、浏览器、分享链接驱动的入口」，是形成生态闭环和分发心智的关键。`setAsDefaultProtocolClient` 就在你的授权清单里，成本极低。→ **P0**。

**一句话结论**：能在外壳层抄、且收益最大的，是「审查面板 + 后台感知三件套 + 深链接」这五件事——它们恰好都落在你列出的外壳授权能力内，**无需改内核**；而沙箱强制、plan mode、模型切换、`@`/斜杠命令、MCP、AGENTS.md、session resume 是内核能力，外壳只能做入口/快捷键，不能实现。

---

## 四、可信度声明

1. **网站防护（403）与文档镜像**：`developers.openai.com/codex` 与 `learn.chatgpt.com` 对非浏览器请求返回 `403 Forbidden`（Cloudflare 防护），无法直接抓取原文。本文所有能力点改从官方文档的**逐页 Markdown 镜像**获取——`github.com/mehmetbaykar/codex-docs-skill` 仓库（路径 `skills/codex-docs/references/*.md`），其中每一页都标注了官方 `source:` 原 URL（即「主要来源」一节所列的 `learn.chatgpt.com/docs/...` 链接）。
2. **未实机验证项（诚实声明）**：
   - IDE 扩展（VS Code/Cursor）的 diff 逐 hunk 交互细节，来自共享 review-panel 文档的推断，**未实机运行**扩展。
   - 桌面 App 的「活动视图 / 宠物（pets）/ 计划任务（scheduled tasks）」UI 为文档描述，**非实测**。
   - 因原站被拦截、依赖镜像，个别字段可能与最新线上版本有细微出入。
3. **两处事实澄清**：① 当前官方文档中「ChatGPT 桌面 App」已承载 Codex（`codex://` 协议、review 面板、worktree 皆在其中），早期宣传的「Codex App」已被合并进 ChatGPT 桌面 App，本文当作同一桌面表面处理；② 沙箱/审批、模型切换、plan mode 等属于 agent 内核能力，外壳层不可能实现，已用 ⛔内核 标出。

---

## 五、主要来源

官方文档逐页镜像（实抓自 `github.com/mehmetbaykar/codex-docs-skill`，每页原始 `source:` 如下）：

- [Keyboard shortcuts & deep links（`codex://`）](https://learn.chatgpt.com/docs/reference/commands)
- [Developer commands（CLI 全命令 + 内置斜杠命令 + 交互快捷键 + IDE 扩展命令）](https://learn.chatgpt.com/docs/developer-commands)
- [Sandbox（沙箱模式/审批策略）](https://learn.chatgpt.com/docs/sandboxing) · [Permission modes](https://learn.chatgpt.com/docs/permission-modes)
- [Codex CLI overview](https://learn.chatgpt.com/docs/codex/cli) · [Codex IDE extension](https://learn.chatgpt.com/docs/codex/ide)
- [Non-interactive mode（`codex exec`/`--json`/`--output-schema`/resume）](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Notifications（桌面/CLI/IDE）](https://learn.chatgpt.com/docs/notifications) · [Image inputs](https://learn.chatgpt.com/docs/image-inputs)
- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · [Code review（review 面板/逐 hunk/内联评论/PR 评审）](https://learn.chatgpt.com/docs/code-review)
- [Review GitHub pull requests（`@codex review`/`@codex fix`/自动评审/Security Review）](https://learn.chatgpt.com/docs/third-party/github)
- [Codex cloud（并行任务/环境/PR）](https://learn.chatgpt.com/docs/cloud) · [Worktrees & Handoff](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [ChatGPT desktop app](https://learn.chatgpt.com/docs/app) · [Windows app（原生沙箱/集成终端）](https://learn.chatgpt.com/docs/windows/windows-app)
- [MCP](https://learn.chatgpt.com/docs/extend/mcp) · [Models（/model、推理强度、Sol/Terra/Luna、Ultra 子代理）](https://learn.chatgpt.com/docs/models) · [Config reference（`config.toml` schema）](https://learn.chatgpt.com/docs/config-file/config-reference)

其他：[openai/codex 仓库](https://github.com/openai/codex) · [VS Code 扩展市场页](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt) · [官方 Codex 文档入口](https://developers.openai.com/codex) · [镜像仓库](https://github.com/mehmetbaykar/codex-docs-skill)。

— 调研：deepseek-v4-pro 子代理（2026-08-21）
