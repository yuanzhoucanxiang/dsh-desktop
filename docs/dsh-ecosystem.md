# DeepSeek Harness (DSH) 生态调研报告（用于第三方 Electron 桌面外壳）

## 0. 这份文件是什么 / 什么时候该重读

这是一份面向 **`dsh-desktop`（Electron 桌面外壳）** 协作者与后续 agent 的长期参考资料，回答四个问题：

1. DeepSeek Harness 本身是什么（npm 包、CLI、插件架构、patch 层、profile、web UI）；
2. 生态里已有哪些桌面外壳（哪些是能借鉴的，哪些只是 CLI fork 的排雷清单）；
3. 有哪些成熟插件 / 插件市场，各用了什么扩展点；
4. 插件 UI 面板的官方契约是什么，以及我们自己的外壳应该怎么与合作插件共存。

**什么时候该重读**：在决定「某个能力放内核插件还是放外壳」、要接一个新插件市场/面板、或要升级内置 `@deepseek-ai/dsh` 版本之前。

> ⚠️ **数据基线 ≈ 2026-08**。本文件里所有 star/fork/版本/发布时间都是当时直查 GitHub API 与 npm registry 得到的**快照**，官方仓库 star 以「万」计、第三方包以「天」为单位发版，**数字会很快过期，重读时请复查**（尤其是第 2、3 节的 star 与版本）。文中「已验证 / 推断 / 未验证」标注不可省略：它区分了「有 URL 或本地文件佐证的事实」与「合理推测」。

采集方式：GitHub API / npm registry 直查、本机已安装的 DSH 发行包（`@deepseek-ai/dsh@0.1.0-rc.6` 的随包 README/SKILL 文档）与已安装的桌面实例 `yuanzhoucanxiang/dsh-desktop`（含其 `resources/plugin/` 下的真实插件源码）。

---

## 1. DeepSeek Harness 本身（全部已验证）

| 项 | 事实 | 来源 |
|---|---|---|
| 官方仓库 | `deepseek-ai/deepseek-harness`，**172,889 ⭐ / 18,701 fork**，最近 push 2026-08-19，描述「Everything is a Plugin」 | https://github.com/deepseek-ai/deepseek-harness |
| npm 包 | `@deepseek-ai/dsh`：`latest=0.1.0-rc.7`，`next=0.1.0-rc.8`，共 8 个版本；本机桌面内置的是 **rc.6**。仍是 pre-1.0 RC | https://www.npmjs.com/package/@deepseek-ai/dsh |
| CLI 命令 | `dsh --profile <name>`（启动 profile）、`dsh --profile headless "任务"`（一次性）、**`dsh web`（=`--profile web` 别名）**、`dsh plugin --profile <name> <pnpm args>`（插件管理，转发给 pnpm）；launcher 旗标 `--patch`、`--dump-config`、`--dump-default-config` | 随包 `README.zh.md`（`node_modules/@deepseek-ai/dsh/`） |
| 插件模型 | Cordis v4（`@deepseek-ai/cordis@^4.0.1`）+ loader（`cordis-plugin-loader` 的 EntryTree：`id/name/config/group/disabled/inject`）。插件是一个 `{ name, inject, apply(ctx) }` 对象；`ctx.effect(() => sub)` 拥有一个返回 disposer 的外部订阅、`ctx.on()` 监听事件 | 随包 `config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md`、`cordis-plugin-loader/README.md` |
| patch 层 | 空根上按序叠加：各 bundle 的 `cordis.patch.yml` → profile 的 `cordis.patch.yml` → home 级 `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。按 `id` 定位、**整段替换 config**、`insert` 追加、`!!js` 挂载时插值 | `dsh-app-boot/README.md`、`dsh-base/README.md` |
| profile | 目录在 `$DSH_HOME/profiles/<name>`（`$DSH_HOME` 缺省 `~/.dsh`）；含 `package.json`（`dsh.profile.bundles` 有序列表）+ `cordis.patch.yml`。bundle 用 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 声明 | `dsh-home-paths/README.md`、`dsh-app-boot/README.md` |
| Web 面 | `@deepseek-ai/dsh-web-app` bundle：webserver 默认 `127.0.0.1:3080`（**拒绝 0.0.0.0**），打印 `dsh web:` URL 行，注入 `DSH_WEB_URL`/`DSH_WEB_MODE` 环境变量；API 网关（`ctx.apiProxy`）无路由、由 HTTP 载体包裹 | `dsh-web-app/README.md`、`dsh-web-app/cordis.patch.yml` |
| 官方文档 | `docs/cordis-primer.zh.md`、`docs/user/develop/framework/index.md`（develop→framework 扩展框架）、官方站点 deepseek.com/harness/en/ | 见下 URL |

官方扩展/嵌入相关链接（已验证存在）：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md
- https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/user/develop/framework/index.md
- https://deepseek.com/harness/en/
- 社区 Cordis 分层指南（质量高，中文）：https://www.cnblogs.com/indieseek/p/22583131/deepseek-harness-everything-plugin-cordis-architecture-guide
- 社区插件开发教程：https://dev.to/henry_lin_3ac6363747f45b4/deepseek-harness-dsh-cha-jian-kai-fa-jiao-cheng-4h6j

**嵌入关键结论（推断，但依据充分）**：Web UI **不是独立应用**——`apps/web` 的 Vite 入口只构建外壳，只有 `dsh web` 注入 `window.__DSH_BOOT__` 才能跑起来（本会话运行时上下文明确说明；`dsh-client-modules/README.md` 描述其 Node 半边扫描 `dsh.client` 行、哈希 bundle 进 `window.__DSH_BOOT__` 并在 `/plugins/<id>/client.js` 下服务）。**因此桌面外壳的正确姿势是「启动 `dsh web`，把 BrowserWindow 指向 `http://127.0.0.1:3080`」，而不是直接加载前端 dist**——本机已装桌面实例正是这么做的。

---

## 2. 桌面外壳 / 包装器（star 数均已通过 GitHub API 复核）

| 项目/包名 | 是什么 | 成熟度证据（已验证） | 我们能借鉴什么具体做法 | 链接 |
|---|---|---|---|---|
| `anywhere-labs/deepseek-harness-desktop` | 面向 DSH 插件生态的桌面端；标语「万物皆插件，桌面本身也是插件」 | **16,387 ⭐ / 778 fork**，2026-08-20 仍活跃 | 这是当前最强标杆：把「桌面」也做成插件/带插件市场；配套 docs/user-guide.md、docs/faq.md | https://github.com/anywhere-labs/deepseek-harness-desktop |
| `dataelement/dsh-desktop` | 「DeepSeek Harness Desktop」 | **1,322 ⭐ / 102 fork**，2026-08-20 活跃 | 第二个重量级外壳；规模足以作为「成熟 Electron 壳」参照 | https://github.com/dataelement/dsh-desktop |
| `yuanzhoucanxiang/dsh-desktop`（**本机正在运行的实例**） | 自研 Electron 壳，内置 `@deepseek-ai/dsh@rc.6`+Node v26.1.0；electron-updater 指向该 repo；`resources/plugin/` 内置 `dialog-optimize`（双面插件）+ `review-bridge`（host 插件 + `--patch` 注入） | 本机已安装、可读源码；stars 未公开（未验证） | **最可借鉴的现成分工**：外壳经 `--patch` 注入 host 插件，插件把会话文件改动写 NDJSON 流供外壳「修改审阅」侧边栏消费 + 提供 `/api/review-bridge/revert` 端点做单条逆回退 | 本机 `resources/app-update.yml`（owner=yuanzhoucanxiang, repo=dsh-desktop） |
| `ahikl/dsh-desktop`（npm `@ahikl/dsh-desktop@0.3.2`，5 版本） | 基于 Electron 的 dsh Web UI 外壳：系统托盘 + dsh 风格自定义标题栏 | 1 ⭐；npm 0.3.2（2026-08-16） | 最小可行外壳样板：托盘 + 自绘标题栏 + 包成 npm bundle | https://github.com/ahikl/dsh-desktop |
| `lai-133/dsh-integration` | Electron 壳 + 自托管 `dsh web`，集成 dsh-better-sidebar / dsh-web-ui / ModLens / awesome-dsh-plugin / dshmarket | 4 ⭐（2026-08-19） | 「外壳 = 壳 + 内置一批易用性插件」的组合打法 | https://github.com/lai-133/dsh-integration |
| `sdkwork-ai/deepseek-harness-desktop` | 描述与官方仓库完全相同，**疑似官方 CLI 的 fork/镜像，非桌面壳** | 15 ⭐ / 2 fork | 反面提醒：很多同名仓库只是 CLI fork，评估前先看描述/README | https://github.com/sdkwork-ai/deepseek-harness-desktop |
| `aYang998122/dsh-desktop` | 自包含运行时、双击即用、内置插件市场/技能/记忆管理 | stars 未验证 | 自包含 Node 运行时 + 免命令行 + 内置市场，是外壳产品化的另一个取向 | https://github.com/aYang998122/dsh-desktop |

其他见到的外壳（未逐一核星，多为小项目）：`Meditationacm/dsh-desktop`(1⭐)、`kyorakuyk/dsh-desktop`、`zcx960/deepseek-desktop`、`wess09/DeepSeekHarnessDesktop`、`Sakana-yuyu/deepseek-harness-desktop`（有 Releases）、`omdsh-dev/deepseek-harness-desktop`、`Lotus-c/DSH-Desktop`，以及 Obsidian 插件 `obsidian-deepseek-harness-native`（在 Obsidian 侧边栏驱动 DSH Web GUI + vault 双向桥接 + DSH 服务自动管理）。

---

## 3. 成熟插件 / 生态目录（npm 版本与发布时间均已直查 registry；stars 已核）

| 项目/包名 | 是什么 | 成熟度证据 | 借鉴点 | 链接 |
|---|---|---|---|---|
| `dshmarket` | 插件市场（DSH 内可视浏览/搜索/一键装） | npm **1.16.2、55 版本**（极活跃） | 外壳可直接复用/内嵌市场，免自建分发 | https://www.npmjs.com/package/dshmarket |
| `dsh-workbench` | Web 右侧文件工作区（UI 面板） | npm 0.9.0、14 版本 | UI 面板类插件的成熟样本 | https://www.npmjs.com/package/dsh-workbench |
| `dsh-knowledge` | Cherry Studio 式知识库（分块/嵌入/检索 + 模型工具 + 浏览器管理面板） | npm 0.3.3、8 版本 | 「工具包 + 浏览器管理面板」双面插件样本 | https://www.npmjs.com/package/dsh-knowledge |
| `dsh-web-shell` | 右侧停靠 xterm.js 终端（WebSocket PTY 桥） | npm 0.1.1 | 把「终端」做成 Web 面板而非外壳原生，减少外壳负担 | https://www.npmjs.com/package/dsh-web-shell |
| `dsh-smart-approval` | fail-closed LLM 辅助审批审阅器 | npm 0.1.0-rc.6（next rc.7） | 审批/权限策略应走内核插件 | https://www.npmjs.com/package/dsh-smart-approval |
| `@dexthemes/deepseek-harness-plugin` | 主题发现/预览/应用/回退 | npm 0.6.4 | 主题系统是客户端 Slot/主题 token 的典型用途 | https://www.npmjs.com/package/@dexthemes/deepseek-harness-plugin |
| `@deepseek-harness-tui/dsh-tui` / `@dopejs/dsh-tui` / `@lk251066/dsh-tui` / `@vascent/dsh-tui` | 多个类 Claude Code 的 TUI 前端（多会话/流式/工具卡/审批） | 分别 0.8.6(17版)/0.10.0(27版)/1.8.2(16版)/0.1.19(18版) | 证明「同一内核、多前端面」是常态；外壳只是又一个面 | 见 npm |
| `@openma/deepseek-harness-acp` / `deepseek-harness-acp` | ACP（Agent Client Protocol）适配/独立 server | 0.4.15(22版)/0.1.14(13版) | 子代理/外部 agent 桥接走协议适配插件 | https://github.com/openma-ai/deepseek-harness-acp |
| `deepseek-harness-wallet` | 本地优先的用量记账/充值 | npm 0.2.2 | 计费/用量是 host 数据，放插件 | https://www.npmjs.com/package/deepseek-harness-wallet |
| `dsh-codex-connect` | ChatGPT OAuth + Codex 模型接入 | npm 0.1.0-alpha.4.14 | 模型/路由切换走内核 provider 插件 | https://www.npmjs.com/package/dsh-codex-connect |
| `@dingtalk-real-ai/dsh-dingtalk` | 钉钉连接器 | npm 0.5.0 | IM 桥接形态 | https://www.npmjs.com/package/@dingtalk-real-ai/dsh-dingtalk |
| `dsh-win32` | Windows 一键装极简模式持久 shell（含沙箱） | npm **0.15.0、30 版本**（很成熟） | Windows 平台化/沙箱适配的现成做法 | https://www.npmjs.com/package/dsh-win32 |
| `dsh-plugin-subagents` | 统一 subagent provider（原生/ACP/Codex/Claude Code 桥 + 角色库 + 权限上限） | npm 0.1.2 | 子代理供给层扩展点 | https://www.npmjs.com/package/dsh-plugin-subagents |
| `dsh-exec-extension` | 按调用 CLI 旗标替换 headless-startup | npm 0.1.3 | 启动参数注入扩展点 | https://www.npmjs.com/package/dsh-exec-extension |

生态目录（已核 star）：`0xsline/awesome-deepseek-harness` **769 ⭐/287 fork**（https://github.com/0xsline/awesome-deepseek-harness）；`AdamPlatin123/awesome-dsh-plugins` **1,281 ⭐/123 fork**（每日扫描 `dsh-external` org、9000+ 候选、Top50 策展，https://github.com/AdamPlatin123/awesome-dsh-plugins）；`Ephemeral-AI-Lab/dsh-plugins` 44 ⭐；`2BingLing/dsh-market`（1500+ 插件、中文搜索、五维评分、一键装，Web+侧边栏双形态）；另有 `dsh-market/dsh-market`、`uluckystar/dsh-plugin-market`、`DshMarketPlace/dsh-plugins-store`、`web-casa/Awesome-DeepSeek-Harness-Plugins`（自称 cordis.run 自动生成）。社区还有多篇「值得装的 10/15 款插件」榜单（zzbaike、juejin、jishuzhan）。

**推断**：生态进入高速扩张期（上千候选、多个市场与雷达），但绝大多数第三方插件是 pre-1.0/alpha，成熟度集中在少数头部包（dshmarket、dsh-workbench、dsh-win32、TUI 系、ACP 系）。

---

## 4. 插件 UI 面板约定（从随包源码 + 真实插件逆向，已验证）

官方/规范路线（三件事合起来构成「一个客户端面板插件」）：

1. **package.json 声明 client 半边**：`"dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-conversation", ...] } }`，并用 `"exports": { "./client": "./client.js" }` 指向客户端 bundle（见随包 `dsh-client-ui-sidebar/package.json` 与本机 `dialog-optimize/package.json`）。
2. **host 半边**是一个普通 Cordis 插件（`export const name / inject / apply(ctx)`），可 `ctx.webServer.register({ kind:'exact', path:'/api/xxx', handler })` 注册私有 HTTP 端点；用 `ctx.on('session/event', ...)` 订阅会话事件（见本机 `dialog-optimize/index.js`、`review-bridge.js`）。
3. **client 半边**：Node 半边扫描 `dsh.client` 行 → 组成 `window.__DSH_BOOT__` 并在 `/plugins/<id>/client.js` 服务；浏览器半边要么走 **Slots 系统**（`ctx.get('slots')` → `slots.inject('target.slot', () => slots.register({name, key/id}, React.createElement(...)))`，协议 single/list/keyed/chain；已知槽位 `settings.section`、`shell.overlay`、`sidebar.footer.action`、`conversation.chat.turnTail`、`tool.view.cordis`、`tool.call.toolview`），要么是预构建 bundle 调 `window.__ModuleLoader__.load({ id, factory })` 返回 `{ name, inject, apply }`。

**没有「route」注册**——官方 UI 扩展点是 **Slots，不是路由**；「panel」= 往某个 Slot 注册组件。官方开发技能书（SKILL.md）明确「先 `Slots.listSubTree` 查槽位协议再注册，禁止猜 id/key、禁止操纵 document.body 硬编码选择器」。

### 4.1 ⚠️ 给我们自己的排雷警告：不要学 `dialog-optimize/client.js` 的 DOM 注入

本机内置插件 `dialog-optimize/client.js` 走的是**另一种流行但脆弱的做法**——**直接 DOM 注入**：用 `MutationObserver` + `requestAnimationFrame` 帧循环，`querySelector` 命中这些**编译后 hash 类名 / 私有 data 属性**：

- `.gdEzaW_bubble`、`.p-xYUq_timeStart`、`.p-xYUq_actions`、`.Md3f7G_older`（React/CSS-in-JS 编译产出的不可读类名）；
- `[data-chat-flow-key]`、`[data-conversation-scroll]`、`[data-disclosure-row]`、`[data-open]`、`[data-state]`（产品私有 DOM 标注）；
- `[data-composer-seat] textarea`（直接拿 textarea 并 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set` 写入，触发 React 受控输入）。

这些选择器是**内核未承诺的私有实现细节**：DSH 一升级、一换构建工具或换渲染器，类名/属性一变，插件就静默失效或把 UI 打乱。SKILL.md 对此有明令：*「Do not manipulate `document.body`, `window`, or hard-coded product DOM selectors」*。它工作，但把外壳/插件绑死在内核的私有 DOM 上。

**应该怎么改（可执行建议，按优先级）**：

1. **首选：迁移到官方 Slots 契约。** 用 `ctx.get('slots')` + `slots.inject('目标槽位', () => slots.register({ name, key/id }, React.createElement(...)))` 挂 UI；`conversation.chat.turnTail` 挂「回复折叠/导航」这类会话尾追加项、`tool.view.cordis` 挂 run 卡交互、`shell.overlay` 挂全局浮层、`settings.section` 挂设置页。先从 `Slots.listSubTree` 查目标槽位的协议（single/list/keyed/chain）与 props 再注册，**不要**猜 id/key。这样内核升级只影响槽位契约，而契约是被官方 SKILL.md 维护的。
2. **退而求其次：改成「插件吐数据/端点 + 外壳原生渲染」。** 这正是本机 `review-bridge` 的范式：内核插件只做 `ctx.on('session/event')` 采集 + `ctx.webServer.register({kind:'exact', path})` 暴露端点（数据回退/撤销逻辑在 host），**UI 完全由 Electron 外壳原生侧边栏渲染**（读 NDJSON / `fetch` 端点）。这样 web 侧的 DOM 一行都不碰，内核升级不影响外壳渲染层。
3. **能不改就至少隔离脆弱面。** 若短期仍需 DOM 注入，把所有选择器集中到一个常量表、每次升级 `@deepseek-ai/dsh` 后在 `dialog-optimize` 上做一次「选择器存活自检」（启动时探测关键 selector 是否存在、不存在就降级为功能停用而非报错打乱布局），并给每个选择器写清它对应的语义（`data-chat-flow-key` = 会话流节点身份、`.gdEzaW_bubble` = 用户气泡文本容器），便于升级时快速重映射。

一句话：**能走 Slots 走 Slots；走不了 Slots 就退回「内核吐数据 + 外壳原生渲染」；DOM 刮取只作为临时兜底并隔离管理。**

---

## 5. 哪些能力放插件（内核侧）vs 外壳（Electron 侧）

**应做成 DSH 插件（内核侧）——因为只有它够得着 `ctx.*` 与事件流：**
- 会话事件/文件改动的**采集与精确回退**（diff review 的「数据源 + Undo」）：`review-bridge` 已证明这是插件职责（`ctx.on('session/event')` + 逆序回退 + `/api/.../revert`）。外壳只读它吐的 NDJSON / 调它的端点。
- 模型路由/切换、Codex/Claude/ACP/IM 桥接、subagent 供给层、权限/审批策略（`dsh-smart-approval` 方向）、计费用量、知识库检索与 `describe_image` 这类工具能力——都是 provider/tool/service 扩展点。
- 自定义 HTTP API 端点（`ctx.webServer.register`），供外壳以 `fetch` 调用——这是外壳与内核最干净的桥。
- 会话管理/侧边栏业务数据（session 列表、workspace、projection）——数据在 host，UI 可用官方 Slot 或外壳原生。

**应留在 Electron 外壳侧——因为那是 OS 能力，插件不该碰：**
- 窗口、系统托盘、自绘标题栏、全局快捷键、Dock/任务栏、多显示器、原生通知（`ahikl/dsh-desktop`、`anywhere-labs` 的做法）。
- **启动/托管 `dsh web`**、端口/`--trusted-host` 管理、进程生命周期、崩溃重启、日志。
- 安全面：把 web UI 关进受限 webview/BrowserView，管理 `webRuntime.trustedHosts`，限制导航（DSH 有意不支持 0.0.0.0 绑定）。
- 自动更新（electron-updater，本机 `app-update.yml` 即此模式）、原生文件对话框、系统剪贴板、安装/升级 `@deepseek-ai/dsh` 与 Node 运行时。
- 「修改审阅/文件 diff」这类**外壳级 UI**：数据与回退在插件，渲染在外壳原生面板（本机 review-bridge 模式）——不要用 DOM 注入去跟 web UI 抢布局。

**判断标准一句话**：需要 `ctx.*` 服务/会话事件/文件系统的 → 插件；需要 OS/窗口/进程/安全边界的 → 外壳。外壳通过「`--patch` 注入插件行 + 读插件吐的流/调插件开的端点」协作，而不是去改 web DOM。

---

## 6. 明确查不到 / 可能不存在的东西（如实说明）

- **官方没有「嵌入 Web UI 的 API/iframe 文档」**：查不到官方 embed/iframe 指南。Web UI 依赖 `dsh web` 注入 `window.__DSH_BOOT__`，不是可独立 iframe 的产物；官方文档只有 cordis-primer 与 develop/framework（如何写插件），没有「如何把 web UI 嵌进桌面」的官方说明。
- **官方没有插件市场/registry**：官方只发布 `@deepseek-ai/*` npm scope（本机可见 100+ 包）。「dshmarket / dsh-market / 各 awesome 列表」全是社区项目；不存在官方插件商店。
- **`@dsh-external` 作为 npm scope 基本查无实包**：`scope:dsh-external` 检索返回的全是关键词误命中（use-sync-external-store 之类），没有真正的 `@dsh-external/*` 插件包。`dsh-external` 更可能是 **GitHub org 名**（被 awesome 列表描述引用为 `dsh-external/hub`），但其内容我未能直接核实（GitHub API 匿名限流）——**这点标记为「未完全验证」**，不要假设它是个可安装的 npm scope。
- **大量同名 `deepseek-harness-desktop` 仓库只是官方 CLI 的 fork/镜像**（如 `sdkwork-ai/...` 描述与官方一字不差），不是桌面壳——评估前必须看 README 而非名字。
- **整体成熟度**：官方本体是 17 万 star 的成熟项目，但**版本仍是 0.1.0-rc**；第三方插件绝大多数是 pre-1.0/alpha，更新以「天」为单位（全部时间戳集中在 2026-08 一周内）。含义：**生态处于「高速度、低稳定性」的爆发期**——先发优势大，但任何「稳定 API」假设都要谨慎；外壳应把对内核的依赖收敛到 patch 行 + 自有 HTTP 端点 + 官方 Slots，避免绑定私有 DOM。

（注：本报告所有 star/fork/版本/时间均为 GitHub API 与 npm registry 直查结果；「未验证」处已显式标注，未杜撰任何仓库、数字或链接。）

---

— 调研：deepseek-v4-pro 子代理（2026-08-21）
