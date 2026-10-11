# 创作工具台层（workbench）架构 v1

> 状态：**设计待评审**（2026-10-11）。本文件只立架构与契约，不含实现。
> 上游定位：自研桌面版 = **创作一体 agent**（`logs/2026-09-26.md:256-263`）；
> GIR 生图模式「插件优先」决议（`E:\GIR\GIR_定位决议_插件优先_2026-09-30.md:36-44`）。
> 本层要解决的问题是：写作模式与 GIR 生图模式各自都已经是"一个模式"，但**还没有"工具台"**。

---

## 0. 一句话结论

把"模式"变成一等公民：新增一个**纯插件形态**的工具台层（`@dsh-local/workbench`），
由它统一**入口、切换、互斥、上下文与共享服务**；写作模式与 GIR 保持各自领域实现不变，
只把"门面"交给工具台。工具台不碰内核代码，缺席时两个模式仍各自可用（官方壳兼容）。

---

## 1. 现状：两条线已经同构，缺的是它们之间的那一层

### 1.1 已核实的插件契约（事实）

一个"模式"目前由四件东西构成，两模式完全同构：

| 面 | 写作模式 | GIR 生图模式 |
|---|---|---|
| host 半 | `plugin/writing-mode/index.js`：`inject=['webServer','llm','agentDefaultModel']`，注册 `/api/writing-mode` 分发 | `dsh-plugins/gir-ui/index.js`：`inject=['webServer']`，注册 `/gir-api` 代理 + `/gir-ui/*` |
| client 半 | `src/client/entry.js`：`inject=['slots','sessions','connection','workspaces']` | `client.js:45`：`inject=['slots','sessions']` |
| 入口 | `shell.overlay`（order 20）+ `sidebar.footer.action`（order 30）+ `conversation.session.header.utilities`（order 40） | `shell.overlay`（order 30，id `gir-workbench`）+ `sidebar.footer.action`（order 40）+ `settings.section` |
| 设置 | `settings.section` id `writing-mode` | `settings.section` id `gir` |
| 工具卡 | 无（走自带右栏会话视图） | `tool.call.toolview`：每个 MCP 工具一张卡（工作树 31 个注册键，发布快照 41） |
| agent 人设 | `writing-companion` preset **向内核 registry 编程注册**（`index.js:54-80`） | `dsh-plugins/gir` MCP server + preset **文件安装**到 `~/.dsh/.agent-presets/gir/` |
| 会话 | 自建 adapter（唯一 native 接触面）+ 创建协调状态机 + send 三态 | 只读当前 dsh 会话（`ctx.sessions`），**不创建会话/工作区、无协调协议** |
| 数据根 | `~/.dsh/writing-mode.json` 的 roots（作品库，文件即数据） | GIR 后端 8787（SQLite + assets + exports，插件只做代理） |

证据：`plugin/writing-mode/package.json:15-24`、`src/client/entry.js:36-41,53-128`、
`E:\GIR\gir-dsh\dsh-plugins\gir-ui\package.json:17-28`、`gir-ui/client.js:45,3910-3926`、
`E:\GIR\gir-dsh\dsh-plugins\gir\preset\agent.cordis.yml:90-101`。

> **取证纪律（GIR 侧）**：GIR 有两条代际不同的线——开发树 `E:\GIR\gir-dsh`（gir-ui `0.37.0`、
> MCP 38 工具、教程 13 步）与发布快照 `E:\GIR\gir-runtime\releases\<ver>`（`0.57.1-alpha`、
> 104 工具、教程 15 步）。**引用任何数字必须标明来源树**，否则"32 个工具"这类旧值会在文档里
> 继续漂移（本文件此前就写过 32，已按上表改正）。

> **别混淆两个 `inject`（0.2.0-rc.2 实测）**：`package.json` 里的 `dsh.client.inject` 是**包 id 数组**
> （boot 图的到达顺序/预载边，不是服务名）；上面表格里的 `inject` 是 client 模块体导出的**服务名**数组。
> 附带发现：三处插件（writing-mode / shell-settings / gir-ui）的 `dsh.client.inject` 都写了
> `@deepseek-ai/dsh-client-runtime`，而该包在 0.2.0-rc.2 **已不存在**——被内核静默跳过，
> 无害但属该清理的陈旧声明（见 R8）。

### 1.2 缺口（这是本层存在的唯一理由）

1. **入口碎片化**：每个模式各自往 `sidebar.footer.action` 塞一个按钮。两个模式 = 两个按钮，
   用户看不出"这是一个工具台"；再加第三个模式就是第三颗按钮。
2. **没有互斥**：`shell.overlay` 是**加法列表槽**（"a fresh `id` is added beside the shipped
   entries"），两个全屏浮层可以同时挂载，谁先谁后没有仲裁者
   （`dsh-cordis-client-runner/lib/client.js:4816-4840`）。
   今天两模式各自持有开关（`state/mode-store.js` / gir-ui 自己的 state），互相不知道对方存在。
3. **没有共享上下文**：写作的"当前作品"与 GIR 的"当前项目/画布"互不可见；切模式后上下文丢失；
   文稿与参考图/成品之间不能互相引用。
4. **重复建设**：项目选择器、设置段、会话承载、版本/独占创建、导出、通知、空状态、教程骨架，
   两边各写一遍（写作侧最完整：`adapters/harness/*` 是它自己说的"唯一 native 接触面"）。
5. **没有"东西在哪"的统一答案**：用户要记两套库根概念。

### 1.3 已有的伏笔（说明这层不是凭空发明）

- 写作模式 `state/mode-store.js:30-31` 的注释原文：
  **"外部（工作台）注册关闭守卫：正在编辑时切走要先过它"** —— 它已经在等一个工具台。
- 内核已有"注册表服务"惯用法：`ctx.reflect.provide('sidebarRightTabs', tabs)`（`dsh-client-ui-sidebar-right/lib/client.js:9073`），
  业务包 `inject:['sidebarRightTabs']` 后 `register(...)`（`dsh-client-ui-deliverables/lib/client.js:2238,2297`）。
  **工具台模式注册表照这个写**，不发明新机制。
- 内核已有"中央页面 + 侧栏入口"原生形态：`dsh-client-ui-schedule` "registers the `schedules`
  main panel and matching sidebar entry"（其 `README.zh.md:64`），`main` 是 keyed 槽
  （`client-runner/lib/client.js:3884-3917`）。

### 1.4 同构到什么程度（契约 v1 是"描述"而非"发明"）

一轮逐文件对比（2026-10-11）显示两模式的骨架**逐字同形**，因此 §3 的契约只是把它们已经在做的事写下来：

- client 挂载三件套完全同形：`shell.overlay` 全屏浮层 + `sidebar.footer.action` 入口 + `settings.section` 设置段
  （gir-ui 的 `client.js:31-32` 自己就写着"注册契约与 palis-theme-panel / writing-mode 一致"）。
- host 面同形：`export const name` + `export const inject` + `apply(ctx)`，`ctx.webServer.register({kind,path,handler})`
  包在 `ctx.effect` 里；回环判定 / 跨站拒绝 / 方法白名单 / body 字节上限 / `{ok:false,error}` 封套同款。
- 配置面同形：一个 JSON 或 settings 命名空间 + 一条 config 路由。
- 安装即幂等 + 漂移可检：写作 `runtime-manifest.json` 逐文件 sha256；GIR `delivery-manifest.json` + `setup.mjs doctor`。
- 版本不可覆盖语义同构：写作 `-vN` 独占创建 + SHA256 revision；GIR 版本不可静默覆盖、回退建新版本。

**推论**：工具台不需要发明新机制，只需要①把三件套里的"入口"从各模式手里收上来，②给它们一个共同的
激活仲裁与上下文。这也是 P0/P1 能做到"零回归"的信心来源。

---

## 2. 分层模型

```
L3 模式（模式各自拥有）   写作模式(writing)        GIR 生图(gir)        未来模式…
                         领域数据/领域UI/后端/preset/工具
───────────────────────── 模式契约 v1（本文 §3）─────────────────────────
L2 工具台 @dsh-local/workbench（本层）
   入口与切换 · 激活仲裁 · 上下文 · 通知 · 健康 · 共享服务(mode-kit)
───────────────────────── 插件契约（内核已有）──────────────────────────
L1 壳 dsh-desktop（Electron）  窗口/托盘/热键/通知/多窗口/更新/审阅/插件管理/skin
L0 内核 dsh（不改）            agent 运行时 · 会话/工作区/preset/工具 · slots · settings · web server
```

**边界原则**（延续 `AGENTS.md` 的"内核零修改"与 GIR 的"插件优先"）：

- L2 **是插件**，不是壳代码：官方壳装上同样能用（降级，见 §6.3）；壳的能力（热键/多窗口/通知）
  经 `window.dshShell` 使用并**必须能力探测**（写作模式已有先例：`WritingModeApp.js:402` 的 `wikiBridge`）。
- L2 **不改内核、不改模式内部**：只接管门面。
- L2 **不统一领域数据模型**：写作的目录结构、GIR 的项目记录各归各的；共享的是**句柄与上下文**，不是存储。

---

## 3. 模式契约 v1（本层最重要的交付物）

### 3.1 工具台向模式提供（client 侧服务）

```js
// 模式侧：**不**把 workbench 写进顶层 inject（那会让整条 fiber 等一个可能不存在的服务），
// 而是在 apply 里用可选注入——与 gir-ui 现在拿 settings 的写法完全一致
// （gir-ui/index.js:274 的 c.inject(['settings'], …)）。
export const inject = ['slots', 'sessions', /* …原有，一字不改… */]
export function apply(ctx) {
  ctx.inject(['workbench'], (scope) => {
    scope.workbench.registerMode({
      id: 'writing',                       // 稳定 id：持久化键、路由键、互斥键
      label: () => '写作',                  // thunk：跟随后续本地化，不需重注册
      order: 20,
      mount: 'overlay',                    // 'overlay' | 'panel'（§4）
      // 生命周期（全部可选，缺省即"无状态模式"）
      canDeactivate: () => boolean | Promise<boolean>,  // 关闭守卫（写作侧接 setCloseGuard）
      onActivate: (reason) => void,
      onDeactivate: (reason) => void,
      // 上下文（可选）：工具台用它做"当前在做什么"的统一展示与恢复
      context: {
        get: () => ({ kind: 'novel', id, path, title }),
        subscribe: (fn) => dispose,
        open: (ref) => void,               // 从最近列表/引用跳回
      },
      // 健康（可选）：入口上显示就绪/降级/错误
      health: { get: () => ({ state: 'ok' | 'degraded' | 'error', detail }), subscribe },
      // 跨模式引用（可选，§5.2）
      refs: { list: () => [...], resolve: (ref) => ({ /* … */ }) },
    })
  })
}
```

### 3.2 模式向工具台暴露的最小面

- **注册描述**（上面的对象）；`registerMode` 返回 disposer，随 effect 拆除。
- **不做**：不注册入口按钮、不注册工具台自己的浮层、不写工具台状态文件。

### 3.3 降级（硬约束，验收项 W5）

- 模式**必须**在 `workbench` 服务缺席时保留今天的自持入口（`sidebar.footer.action` + 自己的开关），
  否则官方壳 / 未装工具台时模式不可达。
- 工具台**必须**在模式缺席/加载失败时把入口隐藏或置灰，不产生死按钮。
- 判定方式沿用写作模式的双栈判定思路（`CONTRACT.md:190` 的 capabilities 硬/软缺口）。

---

## 4. 挂载形态：两种，工具台负责选一个

| 形态 | 机制 | 适用 | 现状 |
|---|---|---|---|
| `overlay` 覆盖式 | `shell.overlay` 注册全屏浮层（列表槽，加法、默认 click-through） | 沉浸式工作台：写作台、GIR 暗房 | 两模式**当前都在用** |
| `panel` 面板式 | keyed `main` 槽（`{name:'main', key:'<你的key>'}`）+ `sidebar.panellist` 用**同一个 id** 注册图标 + `ctx.layout.selectPanel(key)` 切过去 | 轻量模式：保留内核侧栏/会话列表 | **官方设计路径**，0.1.7 与 0.2.0 都在；内核自家 plugin-manager / schedule 就这么做 |

`panel` 的机制已由内核侧调研证实（`dsh-client-ui-layout/lib/client.js:609-612` 的 `main: keyed/root`、
`:445-465` 的 `LayoutController.selectPanel`（跨插件面板动作面，未注册的 key 直接抛错）、
`dsh-client-ui-sidebar/lib/client.js:173-190` 的 `selectPanel(id)` + `sidebar.panellist` 同 id 渲染）。
**但它有一条必须知道的冲突**：`uiWorkspace.openSession(target)` = `replaceMain(target, signal, 'reveal')`，
而 `'reveal'` 会执行 `ctx.layout.selectPanel(null)`（清掉全局面板选择、回到会话）
（`dsh-client-ui-workspace/lib/client.js:821-823,971-994`）——**即"模式面板"与"打开某个会话"会抢占中心列**：
用户点侧栏任一会话，模式面板就被顶掉。

- 因此 v1 **只启用 `overlay`**：写作台与 GIR 是"沉浸式全屏"，浮层在会话之上，不存在被 `selectPanel(null)` 顶掉的问题；
  工具台只做互斥与门面，两模式实现一字不改。
- `panel` 降级为 v2 候选，且**前置条件是先解决上面这条冲突**（要么模式面板声明"我占着中心列时不允许被动切走"，
  要么接受"打开会话即退出模式"的语义并写进 UI）。不在本轮实现，避免把"立架构"变成"改两个模式 + 改内核交互"。

**互斥语义（v1 核心）**：工具台持有唯一 `activeModeId`；切换时
① 先问当前模式的 `canDeactivate`（被拒 → 不切，提示来自该模式）；
② 上一个模式失活 → 其 overlay 渲染 `null`（**保持挂载，不卸载**：草稿、滚动位置、会话绑定都留住，
   与现状一致，`WritingModeApp.js:820-824` 已是这个行为）；
③ 新模式的 overlay 恢复渲染，`onActivate` 收到 `{ reason: 'switch' | 'restore' | 'hotkey' }`。

---

## 5. 共享层分级（明确"什么共享、什么不共享"）

### 5.1 工具台直接提供（模式必须用）

| 能力 | 说明 |
|---|---|
| 模式注册表 + 切换器 | §3；入口是**一个**工具台按钮（侧栏底部），展开模式列表 |
| 激活仲裁 | §4；跨窗口一致（状态权威在 host，见 §7.2） |
| 统一上下文条 | 当前模式 / 当前项目 / 当前条目（写作：作品+章节；GIR：项目+画布），切模式后可恢复 |
| 最近打开 | 统一"最近 N 项"（模式通过 `context` 上报），跨模式可跳回 |
| 通知出口 | 一个 `shell.overlay` 通知条目，模式不再各自弹自己的 toast |
| 健康总览 | 各模式 `health` 汇总；入口角标显示降级/错误（沿用 `sidebar.toggle.badge` 或工具台自己的标记） |
| 设置入口 | `settings.section` id `workbench`：模式列表 + 各模式设置段的导航（各模式保留自己的段） |

### 5.2 共享库 `@dsh-local/mode-kit`（模式按需接入）

> **P3 已落地（2026-10-11）**：`dsh-desktop/packages/mode-kit/` 已建，写作模式改为消费它。
> **形态是"构建期共享"，不是运行期模块**——内核客户端 bundle 的纯净门禁禁止跨插件值导入
> （见 §6.3），所以各模式在构建时把库内联进自己的 `client.js`；运行期不存在这个包。
> 写作模式保留四个**再导出 shim**（老路径不动：审计探针/单测/src 内部都按老路径 import），
> 由 `test:mode-kit` 守导出面漂移 + "库不得反向依赖任何宿主插件"的结构边界。

1. **会话承载（P3 已抽）**：`src/harness/adapter.js`（唯一 native 接触面：双栈创建、四级聚焦退路、
   输入双通道、send 三态、创建协调、迟到结果身份核对）+ `projection.js`（会话图投影 +
   `stripInjectedBlocks`）+ `identity.js`（项目身份归一）+ `coordination-client.js`（协调协议客户端，
   `api` 改成**必填**——抽库时正是这条把原来对 `services/writing-api.js` 的默认 import 逼掉了）。
   **这是重复建设最贵的一块**：GIR 侧目前只能只读当前会话，"让 Agent 帮忙出图"本该共享同一条路。
   **GIR 接入的两条路**（属 GIR 仓库自己的决定）：① 给它的 client.js 加构建，把库当依赖打包；
   ② vendor 一份源码 + 漂移门禁。本库不替它选，也不为它引入构建。
2. **项目根与路径安全**：`resolveUnderRoots` 类的 realpath 边界校验（写作侧已验证的写法），
   GIR 若要读写本地素材同样需要。（P3 未抽：它现在与写作的库根语义绑得较紧，等 GIR 真要用时再抽。）
3. **preset 交付口径**（v1 只统一约定、不统一实现）：写作走"向内核 registry 注册 + yml→js 生成器 + 漂移门禁"，
   GIR 走"文件安装到 `~/.dsh/.agent-presets/` + MCP 行"。两者都要在 0.2.0 上自证可用，
   mode-kit 先提供**判据与自检**（"我的 preset 在当前内核上注册成功了吗"），不强行合并交付路径。
4. （v2 候选）版本/独占创建、导出、引用句柄、教程骨架。

### 5.3 明确**不共享**（各自保留）

领域数据模型与存储（写作的目录/版本命名 vs GIR 的项目记录/SQLite）、领域 UI 与流程
（写作五阶段 vs GIR 五阶段成像）、后端服务（GIR FastAPI 不进 dsh 进程）、preset 人设与工具集。

### 5.4 跨模式引用（产品决策，先定接口不实现）

统一引用句柄 `{ mode, kind, id, path?, title }`；v1 只要求"能列出 + 能跳回"，
不做"把 GIR 的图塞进写作台正文"这类深耦合。理由：引用一旦深耦合，两个模式的版本与删除语义都要联动。

---

## 6. 实现机制（全部基于已核实的插件契约）

### 6.1 client 半

```js
// dsh-desktop/plugin/workbench/src/client/entry.js（形态与 writing-mode 一致）
export const name = 'workbench'
export const inject = ['slots', 'sessions', 'connection', 'workspaces']
export function apply(ctx) {
  ctx.effect(() => ctx.reflect.provide('workbench', registry), 'workbench: service')
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'workbench', order: 10, label: () => '工具台' },
      WorkbenchEntry)), 'workbench: entry')
  ctx.effect(() => ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'workbench', order: 10, label: () => '工具台' },
      WorkbenchChrome)), 'workbench: chrome')
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'workbench', order: 45, label: () => '工具台' },
      WorkbenchSettings)), 'workbench: settings')
}
```

- **服务注册表**照 `sidebarRightTabs` 的写法（`ctx.reflect.provide` + effect 拆除）。
- 工具台自己的浮层**不常驻全屏**：只有切换器/通知/上下文条按需出现，其余时间渲染 `null`。
- 模式侧接入是一行 `ctx.inject(['workbench'], …)`（`gir-ui/index.js:274` 已有 `c.inject(['settings'], …)` 同款用法）。

### 6.2 host 半

- `inject: ['webServer']`，注册 `exact` 路由 `/api/workbench`（沿用写作模式的路由×方法白名单 + 环回/可信判定，
  实现可直接复用 `plugin/writing-mode/lib/http.js` 的口径，但**不互相 import**，抽到 mode-kit 后再共用）。
- 职责：① 状态权威（`activeModeId`、最近打开、模式启用集合）；② 模式探测——**用内核的权威清单，不要扫目录**：
  内核 host 服务 `pluginManager` 经 remote 暴露（`ctx.remote.pluginManager`：`listPlugins()` / `listBundles()` /
  `setPluginEnabled(id,enabled)` / `setBundleEnabled(name,enabled)` / `installBundle` / `removeBundle` /
  `reload(requiredIds)` 等，`dsh-plugin-manager/lib/index.js:1379-2031`），UI 侧先例是
  `dsh-client-ui-plugin-manager`（`main` key `plugins` + `sidebar.panellist` 同 id）；③ 为将来壳侧热键/通知提供读接口。
  于是"工具台里开关某个模式"不需要新造机制：**内核有启用/禁用 API，壳侧另有一条 `cordis.patch.yml` 写
  `- id: <entryId>` + `disabled: true` 的通道**（`dsh-desktop/main.js:926-930`、`:2923-2954`）。
  ⚠ 第三方插件能否默认可注入 `remote.pluginManager` 未验证（见 R9），P0 先按"只读探测"实现。
- 配置：`~/.dsh/workbench.json`（工具台状态，**不碰** `writing-mode.json` 与 GIR 的 settings 命名空间）。
- 损坏语义照写作模式的既定纪律：只有 ENOENT 才当空配置；解析失败保留原件字节并拒绝回写
  （`CONTRACT.md:143-145`）——这条已经是本项目的硬规矩，新层必须同款。
- 设置面走内核公开契约：工具台的设置段注册进 `settings.section`；若要用内核统一表单，
  用 `ctx.configForms.get(entryId)`（`entryId` = host 插件 loader 条目 id，即命名空间）。
  `shell-settings` 是这条路的现成先例（它用 `settings.plugins.tab`，`plugin/shell-settings/client.js:1-13`）。

### 6.3 壳侧与官方壳

- 壳侧**本轮零改动**；`main.js:443` 的 `BUILTIN_PLUGINS` 加入 `workbench` 即随壳分发
  （`main.js:445-462` 会同步到 `$DSH_HOME/profiles/node_modules/@dsh-local/workbench`）。
- `window.dshShell` 一律能力探测后使用。**开窗口是壳的能力，不是插件的**：自研壳目前只有**一个**白名单口子
  `shell:open-wiki`，且调用方**只能传作品路径**、URL 由壳自己拼（`main.js:1799-1816,2985`）——
  所以"GIR 画布独立窗口"这类需求必须先加壳侧 IPC + 内核路由，**不能**由工具台或模式自己开窗（见 R10）。
- 官方壳：工具台可作为普通插件安装；壳能力缺席时降级为"只有入口与切换"（官方壳另有
  `globalThis.dshDesktop`（`protocolVersion===1`）载具，与本层 v1 无关）。
- **client 半的两条硬约束**（0.2.0-rc.2 实测，写工具台代码前必须知道）：
  ① `require()` 白名单只有 9 个 seed 词（`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
  `@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、
  `dsh-client-ui-dockkit`）**加 boot 图里已有的包行**，其余一律抛错 → 工具台 client 必须像写作模式那样
  自带 esbuild 打包（`plugin/writing-mode/client.js:5` 的构建注释）；
  ② **跨插件值导入被内核明令禁止**（"client bundle purity gate forbids cross-plugin value imports and
  directs cross-plugin collaboration through cordis services"，`dsh-client-ui-settings/lib/client.js:1260-1264`）
  → 模式与工具台之间只能走 §3 的服务注册表，不能互相 require。

### 6.4 壳能力清单（插件申请、壳实现；P4 再谈）

**决策（2026-10-11，项目所有者批准）**：工具台的**门面留在内核页面插件里，壳前端不参与**；
壳只提供**能力**，由插件按需申请。三条理由：

1. **官方壳兼容是硬约束**：GIR「插件优先」决议要求同一插件也能跑在官方壳上；壳注入的 UI 在官方壳**不存在**，
   门面一旦长在壳里，写作模式与 GIR 换到官方壳就失去统一入口，等于把"模式"绑死在自研壳上。
2. **`preload.js` 是"零侵入"设计**：它只注入两样东西（内核断连浮层、修改审阅侧栏），且外壳加固审计的
   威胁模型第一条就是"**内核页面能调 IPC** 是要紧的"（`docs/audits/shell-hardening/2026-09-21/report.md:17`）。
   往这一层加常驻 UI 会扩大该攻击面，收益只是"少一次插件加载"。
3. **能力不需要靠壳画 UI 才能用**：内核页面插件已经能拿到 `window.dshShell`（写作模式用它开档案窗口，
   并且做了能力探测），所以"热键呼出工具台"这类事，正确形态是**插件申请壳能力**。

| 能力 | 现状 | 缺什么 | 归属 |
|---|---|---|---|
| 开独立窗口 | 只有 `shell:open-wiki`（调用方只传作品路径，URL 由壳拼，`main.js:1799-1816,2985`） | 通用窗口类型 + 内核路由 | 壳（R10） |
| 全局热键 | 壳有热键通道（`shell:set-global-hotkey`），但只服务壳自己的动作 | "呼出工具台 / 切换模式"的语义 + 到页面的通道 | 壳 + 插件 |
| 通知 | 壳有 `notifyCommand`；页面侧目前各插件自弹 | 统一出口（工具台已预留 `ui-store` 的 notice，§5.1） | 插件优先，壳按需 |
| 退出守卫 | 壳不知道"模式"存在 | before-quit → 询问页面（模式的 `canDeactivate`） | 壳 + 插件 |
| 模式记忆 | 工具台自己读写 `$DSH_HOME/workbench.json` | 无（壳将来要读就读同一文件） | 已具备 |

约定：插件对壳能力**一律能力探测**（`window.dshShell` 可能不存在；官方壳是另一套
`globalThis.dshDesktop`，`protocolVersion===1`），缺席时降级而不是报错——写作模式的 `wikiBridge`
（`WritingModeApp.js:402`）是现成先例。

**重议条件**（只有这两类需求会牵动壳，且都只加**能力**、不搬门面）：① "每个模式一个独立 OS 窗口"；
② "关窗/退出时先问模式的守卫"。

---

## 7. 数据与状态

### 7.1 归属

| 数据 | 位置 | 权威 |
|---|---|---|
| 工具台状态（激活模式、最近、启用集合） | `~/.dsh/workbench.json` | host |
| 模式配置 | 各自（`writing-mode.json` / GIR settings 命名空间 `gir`） | 各自 host |
| 领域数据 | 各自库根（写作作品库 / GIR 项目库） | 各自 |
| 临时 UI 状态（面板开合、滚动） | localStorage（现状保留） | client |

### 7.2 为什么状态权威在 host

理由有三，且都不依赖"多窗口现在就存在"：
① 壳侧热键（P4）要在没有页面上下文的情况下知道"当前该呼出哪个模式"；
② 档案 wiki 窗口是壳开的独立窗口（`shell:open-wiki`），它看到的状态应与主窗口一致；
③ host 是唯一能同时被壳、被多个页面读到的地方（client 侧状态只活在一个页面里）。
client 侧只做乐观更新 + 订阅；跨窗口同步 v1 用轮询/聚焦刷新即可（**不引入新的实时通道**）。
注：GIR 画布独立窗口需要**先加壳侧能力**（R10），在它落地前 ② 只覆盖 wiki 窗口。

---

## 8. 迁移路径（每阶段可独立验收，不改变既有行为为准入条件）

| 阶段 | 内容 | 准入门槛 |
|---|---|---|
| **P0 骨架** | 新建 `plugin/workbench`（host+client），只做注册表 + 入口 + 切换器；两模式**暂不接入** | 现有 `verify:writing-quick` 与 GIR UI 冒烟**全绿**（零回归）；工具台单测 |
| **P1 写作接入** | 写作模式 `ctx.inject(['workbench'])` 注册；有工具台时不再自己塞侧栏按钮；`setCloseGuard` 接上 `canDeactivate` | W1/W2/W3/W5；写作全链回归 |
| **P2 GIR 接入** | gir-ui 同款接入（它已有 `inject` 双服务写法） | GIR UI 冒烟 + 双模式同屏实测 |
| **P3 共享库** | ~~抽 `mode-kit`：会话承载 + 路径安全~~ **已完成（2026-10-11）**：`packages/mode-kit` 建库、写作模式消费（四个再导出 shim + `test:mode-kit` 漂移门禁）；路径安全未抽（等 GIR 真要用再抽）；GIR 接入留给它自己选构建/vendor | 写作侧逐字节行为不变（现有单测即回归网）→ `verify:writing-quick` **QUICK_EXIT=0** |
| **P4 壳侧联动** | 热键呼出工具台、模式记忆、通知统一出口（**能力清单与边界见 §6.4**：只加壳能力，门面仍在插件里） | 打包版实测（`app.isPackaged` 分支必须实测，见 `AGENTS.md` §1） |

**顺序理由**：P0/P1 先证明"门面统一"不伤现有模式；P3 的抽取只有在两模式都接入后才看得清共性。

---

## 9. 验收口径（v1，可执行）

- **W1 入口唯一**：同时装 writing-mode + gir-ui + workbench，侧栏底部**只有一个**工具台入口；
  切换器列出两个模式；模式自己的按钮在有工具台时不出现。
- **W2 互斥**：写作台激活时切到 GIR —— 写作 overlay 不再渲染（`html` 上 `data-writing-mode` 移除）、
  GIR 全屏可见；切回写作 —— 文稿、滚动位置、未发送草稿仍在（overlay 未卸载）。
- **W3 关闭守卫**：写作台有未保存内容时切换被拦下，提示来自写作模式的守卫，不是工具台自造文案。
- **W4 持久化**：重启应用后回到上次激活的模式。
- **W5 降级**：禁用/卸载 workbench 后，两模式各自的入口与开关**照旧工作**（官方壳兼容路径）。
- **W6 零内核改动**：`git status` 不含 `runtime/`、`node_modules/@deepseek-ai/*` 与任何内核包。
- **W7 零回归**：写作侧 `npm run verify:writing-quick` 全链 exit 0；GIR 侧 `node test-smoke.cjs`
  （SSR 冒烟，当前 69 OK / 0 FAIL）、`test-upload.mjs`（16）、MCP `smoke_test.py`、后端 `pytest -q`（319 passed）
  维持不变；新增 workbench 单测覆盖注册/切换/守卫/降级四条。
- **W8 真实预览**：按工作区约定拉起隔离实例（`DSH_DESKTOP_USER_DATA=%TEMP%\dsh-preview`）由用户实机点验，
  截图/GIF 只作辅助。

---

## 10. 风险与待核实（不冒充已解决）

| # | 事项 | 现状 | 处理 |
|---|---|---|---|
| R1 | `main` keyed 面板式挂载（§4 `panel`） | **机制已证实**（官方设计、0.1.7/0.2.0 都在），但 `openSession` → `selectPanel(null)` 会抢占中心列 | v2 候选；先定"模式面板 vs 打开会话"的语义（§4），再谈实现 |
| R2 | 客户端 `ctx.provide` 的卸载/重建语义 | 有先例（sidebarRightTabs 在同一 effect 内 provide 并随 effect 拆除），但**工具台自身未验证** | P0 单测覆盖"卸载后服务消失、模式回退自有入口" |
| R3 | 跨窗口状态同步 | 目前无实时通道，只有聚焦刷新 | v1 用聚焦刷新；多窗口需求明确后再谈 |
| R4 | 模式加载顺序 | 工具台可能晚于模式加载 | 用 `ctx.inject(['workbench'], …)` 等待服务，不做"先加载后注册"假设 |
| R5 | GIR 后端不在 dsh 进程内 | 工具台无法代管其生命周期 | 工具台只做健康展示（读 GIR `/health` 指纹，沿用 gir-ui 既有判定），不代管启动 |
| R6 | 深耦合引用（图进文稿） | 产品决策未定 | v1 只做"可列出 + 可跳回"，见 §5.4 |
| R7 | 工具台成为第二个"必须装的插件" | 与"插件优先/官方壳兼容"有张力 | 强制 §3.3 降级路径 + W5 验收 |
| R8 | 三处插件的 `dsh.client.inject` 仍写着已不存在的 `@deepseek-ai/dsh-client-runtime` | 0.2.0-rc.2 静默跳过，**当前无害** | 顺手清理（属模式侧小改，不阻塞本层）；不要照抄进工具台 |
| R9 | 第三方插件能否注入 `remote.pluginManager`（模式探测/启停的权威面） | **未验证**，只确认了官方包的 inject 名单 | P0 先做"只读探测"；要启停则回退壳侧 `cordis.patch.yml` 通道 |
| R10 | GIR 画布独立窗口 | **壳能力缺口**：自研壳只有 `shell:open-wiki`（只收作品路径） | 记为 P4 之后的壳侧任务（加 IPC + 内核路由），工具台不越权开窗 |

---

## 11. 非目标（本轮明确不做）

- 不改内核代码，不给内核提 patch。
- 不做统一数据模型 / 迁移既有作品库与 GIR 项目。
- 不做插件市场、远程安装、版本分发（GIR 的自更新已有一套，不合并）。
- 不把 GIR 后端（FastAPI/8787）搬进 dsh 进程。
- 不重写两个模式的内部实现（P1/P2 只加注册与守卫）。
- 不做多窗口与热键（P4 再说）。

---

## 12. 决策点（需要项目所有者拍板）

1. **工具台放哪**：`dsh-desktop/plugin/workbench`（随壳内置，`BUILTIN_PLUGINS`）**还是**独立仓库外部插件？
   本文按"随壳内置 + 契约可抽取"设计。
2. **入口位置**：侧栏底部一个按钮（现状延续）**还是**顶栏/`shell.leading` 的模式标签页？
3. **`mode-kit` 抽取时机**：P3（两模式接入后）**还是**提前（先抽会话承载，GIR 直接复用）？
4. **共享到哪一层**：只共享门面（本文方案），还是把"作品/项目"抽象成统一实体（更统一，但会动两个模式的数据层）？
5. **工具台门面归属**：内核页面插件（**已定**，2026-10-11）vs 壳注入层 —— 结论 = 插件；
   理由与重议条件见 §6.4。重议时也只加**壳能力**（开窗/热键/退出守卫），不把门面搬进壳前端。

---

署名：deepseek-v4.1-flash（依据 2026-10-11 项目所有者"先立工具台这一层架构"的决定整理）
