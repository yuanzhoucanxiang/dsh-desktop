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

### 0.1 现状一览（2026-10-11 收口）

**已交付**（都在工作树里，未发版；每一步都有可跑的验收）：

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | 工具台骨架：注册表 + 统一入口 + 切换器 + 设置段 + host 状态（`$DSH_HOME/workbench.json`） | `test:workbench` 27+20 · `verify:workbench-ui` 8 组 |
| **P1** | 写作模式接入：注册模式、两个自持入口让位、关闭守卫接 `canDeactivate` | `test:writing-bridge` 12 · `verify:workbench-writing` |
| **P2** | GIR 接入：注册模式、侧栏入口让位（源码线 `0.57.4-alpha` + 冻结快照 r4） | `verify:workbench-gir` |
| **P3** | 共享库 `packages/mode-kit`：会话承载/投影/身份/协调客户端抽出来；写作侧改为消费（四个再导出 shim） | `test:mode-kit` 8 · 全链零回归 |
| **L1** | 同时在场 + 上下文连续 + 一键交接（载荷不透明；工具台加上下文行与通知出口） | 写作探针 L1 段 + `test:workbench` 上下文/交接断言 |
| **L1.5** | 守卫按 `reason` 分流（交接不再喊"未退出写作台"）；钉住"脏稿先落盘、文稿不关" | 写作探针 L1.5 段 |
| **L2（第一刀）** | 辅助坞：工具台右缘 + `dock` 契约 + rail/收展 + `--dsh-wb-dock-width` 让位；写作提供坞视图 | 写作探针 L2 段 · `test:workbench` 坞断言 |
| **L2（第二刀·主屏）** | 入口目的地改为全屏主屏（参考多窗口预览）：左列「对话」瓷砖（v1：会话标题 + 回到完整会话，会话服务缺失如实降级）+ 右侧模式瓷砖格（契约新增 `tile` 字段；提供的内容窗口直接渲染，没提供的退化为大按钮卡）；主屏本身不改 `activeModeId`；入口不再单模式直进 | `test:workbench` 28+20 · `verify:workbench-ui` 9 组 |

**没做**：最近打开 / 健康总览（契约留了字段）· 真分屏（两个完整模式并排）· GIR 的坞视图（"写作时看着图"，
要动另一个仓库）· 写作 / GIR 的主屏 tile 内容窗口（暂为大按钮卡，由各插件后续提供）· 主屏真聊天瓷砖
（v1 只有会话标题 + 跳回；转录 + 输入框走 mode-kit 会话栈）· `panel` 面板式挂载（与 `openSession` 抢中心列的冲突未定）· P4 壳侧联动（热键/退出守卫/
通知统一出口）· 模式启用探测（内核 `pluginManager`）。

**原型轮（2026-10-12，非正式交付）**：用户定的工作方式 = **先 HTML 互动原型、手感定了再落正式**。
`prototypes/workbench-home/`：`index.html` = v1 全屏主屏（对应上面 L2 第二刀，已落正式）；`strip.html` =
v2.2 长条对话窗设想（窗口收成「手机微信式」长条 + 模式从接缝拼接，**待拍板**，见 §12-8）。
原型不与构建/门禁挂钩，落差表与踩坑见其 README。

**拍板后的状态（2026-10-12 晚更新）**：**长条门面已定为目的地、v1 全屏主屏退为"壳能力缺席时的降级形态"**。
**壳侧形态能力刀 1 已落地**（档位枚举 IPC / 动态最小尺寸 / 置顶 / 记忆隔离 / 发送方闸，
验收 `npm run verify:shell-shape` 14 PASS + 1 显式 SKIP、hardening S9、全链 `verify:writing-quick`
**QUICK_EXIT=0**）——但**插件门面一行未接**：现在没有任何东西去请求变形，用户可见行为不变，
上表 L2 第二刀仍是当前唯一可用的门面（入口 → 全屏主屏）。逐条代价见 §6.4.1、交付与明确未做项见 §6.4.2、
排期见 §12-8。

**2026-10-12 刀 2 更新**：门面**接线第一口已落地并用户可见**——主屏打开时申请 `strip`（窗口收成 420 宽竖条、
主屏走既有 <900px 竖排），关闭时还原 `normal`；桥缺席（官方壳/老包）自动退回全屏主屏。详见 §6.4.3。

**2026-10-12 深夜复核（刀 4–7 之后，把上面那句"仍未做"改准）**：`mini` 已是真档位（`verify:shell-shape`
F 段按主进程 `getContentBounds()` 判）、真聊天瓷砖与输入框已接（只读转录 + 发送，见 §6.4.4）、
状态条三个指标已在**真内核**上读出过真值（走会话句柄 `retain → binding(id).session.projections`）。
**仍未做**：无边框与自绘顶栏（要重建窗口）、扇形呼出 UI、模式界面拼接。
置顶这一关的实测与修法见 §12-9 末段（踩坑 #29）；三钮见 §6.4.5。

**怎么跑**（在 `dsh-desktop/` 下；跑 electron 探针前先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`）：

```bash
npm run test:workbench && npm run test:mode-kit && npm run test:writing-bridge
npm run verify:workbench-build && npm run verify:workbench-ui
npm run verify:workbench-writing          # 写作接入（P1/L1/L1.5/L2）
npm run verify:workbench-gir              # GIR 接入（跨仓；找不到就 SKIP）
npm run verify:writing-quick              # 全链零回归（含上面三条里的两条）
```

契约与用法见 [`plugin/workbench/README.md`](../../plugin/workbench/README.md)；
写作侧的接入细节见 [`plugin/writing-mode/CONTRACT.md`](../../plugin/writing-mode/CONTRACT.md) 的
「接入工具台（P1）/ L1 / L2」三节；
**继续开发的纪律、UI 规则、验收清单与给下一个 agent 的启动指令**见
[`docs/workbench-mode-guide.md`](../workbench-mode-guide.md)。

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
| **统一上下文条** | **L1 已实现（2026-10-11）**：模式报 `context.get/subscribe`，工具台汇总后显示在入口与切换器上（"正在做：写作 · 归乡记 · 第2章"）。工具台**只汇总与展示**，不解释内容 |
| **一键交接** | **L1 已实现（2026-10-11）**：`registry.handoff(to, payload)` —— 先切到目标模式（走同一套关闭守卫），再调目标的 `onHandoff`；载荷**不透明**（见 §5.5） |
| **通知出口** | **L1 已实现（2026-10-11）**：工具台帧级 toast（6 秒自动消失、点一下即关）；交接结果与将来的模式上报都走它，模式不再各自弹 toast |
| 最近打开 | 统一"最近 N 项"（模式通过 `context` 上报），跨模式可跳回 —— **未实现** |
| 健康总览 | 各模式 `health` 汇总；入口角标显示降级/错误 —— **未实现**（契约字段已收下） |
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

### 5.5 多模式在场与一键交接（L1，2026-10-11 项目所有者选定）

项目所有者的设想：**工具台开启时写作 / 生图（以及将来的导演模式）同时在场，直接开始全流程创作**。
本轮把"同时在场"落成两件事——**上下文连续**与**一键交接**（用户选择 A；"同屏共存"留待 L2）：

- **同时在场是既有的**：模式被切走后 overlay 只渲染 `null`，**不卸载**——状态、会话绑定、草稿都在，
  所以"都活着、随时切"不需要新机制。
- **上下文连续**：模式在注册时提供 `context: { get, subscribe }`（只报**稳定**的东西：作品、当前稿、
  当前项目/画布——不要每次敲键都推），工具台把它显示在入口与切换器上；`context.get` 抛错 → 显示为空
  （工具台不编造）。
- **一键交接**：`registry.handoff(to, payload)` → 先 `setActive(to)`（**会过当前模式的关闭守卫**）→
  再调目标的 `onHandoff(envelope)`。载荷**刻意不透明**：

  ```js
  { from, kind, title, text, path, refs: [...], at }   // kind 由模式自己定义（默认 'text'）
  ```

  工具台只保证结构、不解释含义——**因为"产物链"还没定**（用户 2026-10-11：暂不确定），
  这样将来链路怎么变都不用改通道。
- **如实语义**：目标没实现 `onHandoff` → `delivered:false`（工具台在 toast 里说"还没有接收端"）；
  被守卫拦下 → 不切也不交付；没有工具台 → 写作侧的按钮禁用并说明原因。
- **交接与退出走同一套守卫，但语义不同（L1.5，2026-10-11 修正）**：守卫现在收到 `reason`
  （`switch` / `exit` / `handoff`）。**先前以为"交接会保存并关闭当前稿"是错的**——核实 `editor.close()`
  只是 `flush()`（脏了就保存，**不清空会话**），所以交接不会关掉作者正在写的那一篇；L1.5 实际做的是：
  ① 把 reason 透传到守卫，交接失败时由调用方说"交接已取消"、**不再喊"未退出写作台"**；
  ② 用探针把"脏稿先落盘"钉成断言（改脏 → 交接 → 磁盘文件已更新）。

**同屏共存（L2，2026-10-11 第一刀已落地）**：`shell.overlay` 是加法槽，多个全屏条目能并存，但两个模式现在都是
`position:fixed; inset:0` 的完整应用——并排必须由工具台在**一个浮层里**做布局、模式交出"可嵌入视图"。
内核没有多面板原语（`main` 是 keyed 单面板、`rightbar` 单一占用），所以布局要工具台自己写。

L2 第一刀选了**"主视图 + 辅助坞"**（真分屏留给下一刀）：

- **坞是工具台自己的浮层条目**（`shell.overlay` id `workbench-dock`，order 11），不是模式的浮层；
  模式通过 `registerMode({ dock: { label, view, order } })` 提供一份**轻视图组件**——
  这是**运行时传进来的组件引用**（不是跨插件 import），所以不违反内核的 bundle 纯净门禁。
- **只显示"不是当前主视图"的模式**：主视图已经有了，再显示一遍没意义（写作当主视图时坞里不显示写作）。
- **收起时留右缘 rail**，点一下展开；展开时把宽度写进 CSS 变量 `--dsh-wb-dock-width`，
  模式可以选择给内容让位（写作台的 `.dshWmRoot` 已经 `padding-right: var(--dsh-wb-dock-width,0px)`——
  没装工具台时这个变量不存在，等于没这行）。
- **互斥不变量不变**：同一时刻仍然只有一个**主视图**；坞是主视图的附属面，不改 `activeModeId`、不参与 `canDeactivate`。
- 落地顺序：工具台（坞基础设施）+ 写作模式（坞视图：当前作品/章节/路径 + 「回到写作台」）。
  **"写作时看着图"**（GIR 的坞视图）要动 GIR 仓库（源码线 + 冻结 revision），留作下一刀。

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
| **窗口形态**（长条/小条/还原） | **零先例**：全仓无边框、无 setSize/setPosition 类调用（详见 §6.4.1 逐项代价表） | 档位枚举 IPC + 无边框顶栏 + 变形期不落盘 windowBounds | 壳（**2026-10-12 用户获准**，未实施） |

约定：插件对壳能力**一律能力探测**（`window.dshShell` 可能不存在；官方壳是另一套
`globalThis.dshDesktop`，`protocolVersion===1`），缺席时降级而不是报错——写作模式的 `wikiBridge`
（`WritingModeApp.js:402`）是现成先例。

#### 6.4.1 「窗口形态」这条能力（2026-10-12 项目所有者获准改外壳，**未实施**）

用户原话：「可以改外壳支持，因为这个我们自己做的桌面版就是为了自定义」。指 v2.2 长条窗设想里
"整个窗口收成手机微信式长条 / 最小化成一小条 / 退出模式还原"那一口。§2 非目标「不做壳的事」
在此**有限破例**：门面（模式注册、当前模式、上下文、交接、坞）**仍全部留在插件里**，
壳只多一条"按档位改主窗形状"的能力——与下面「重议条件」第③类同构。

按 2026-10-12 只读调查 `main.js` 的现状，这一口的真实代价（不是估计，是代码里能指出来的）：

| 事项 | 现状与证据 | 要做的事 |
|---|---|---|
| 窄长条被最小尺寸挡死 | 主窗 `minWidth:980 / minHeight:640`（`main.js:2195-2196`） | 进形态时 `setMinimumSize` 放开、还原时收回（全仓**无先例**） |
| 无边框 + 自绘顶栏 | 整个仓库**没有任何** `frame:false` / `titleBarStyle` / `setSize` / `setPosition` / `setFrame` / 全屏调用；启动画面不是独立窗口，是主窗先 `loadFile(SPLASH_PATH)` 再交接（`main.js:3581`、`:1678-1700`） | 新增无边框形态 + 顶栏 ←⚙—⎋✕ 的 IPC（最小化/关闭）+ 拖拽区；这是**一整块新活**，不是改参数 |
| 变形会被当成"用户改了窗口" | resize/move 防抖 500ms 落盘 `settings.windowBounds`（`main.js:2213-2226`），启动经 `validBounds` 恢复（`:2170-2178`）、还有 maximized 标志（`:2210`） | 形态期间的尺寸**不能**写进 windowBounds（否则重启停在长条态）；长条几何另存字段 + 还原时用原 bounds 回填 |
| "最小化成一小条"和托盘打架 | `closeToTray` 默认 true，关窗即 `hide()` 进托盘（`main.js:143`、`:2229-2235`）；托盘与 `shell:quit`（`:2782`、`:3171`） | 定义清楚 ⎋/—/✕ 三个钮各走哪条既有语义，别再造一套退出路径 |
| 置顶 | 全仓**没有** `alwaysOnTop` 代码 | 长条若要贴桌面浮着，是新增能力（并要考虑打断用户其它工作） |
| 新开 IPC 的安全 | 审计威胁模型第一条就是"内核页面能调 IPC 是要紧的"（`docs/audits/shell-hardening/2026-09-21/report.md:17`）；现有高危通道按窗授权 `isSettingsSender`（`main.js:1105-1112`）；`shell-hardening-test` **对 main.js 源码做正则断言**（`lib/shell-hardening.test.js:50-82`） | **不开通用的 `x/y/w/h` 接口**：只收档位枚举（如 `strip`/`mini`/`normal`），几何由外壳按屏幕自己算；按现有范式过闸 + 补 hardening 断言 |
| **窄视口实测（2026-10-12 已量）** | 用 `scripts/measure-strip-layout.mjs` 真起隔离实例、连 CDP 把内核页面压到 1360/980/760/640/480/**420** 宽逐档取样：**横向溢出 0**（`documentElement.scrollWidth == clientWidth` 每档都成立）、模型名与占位文案**优雅截断**（`MiMo-V2.6-Pro Default` → `MiMo-V2.6-P… D…`）、左图标栏 + hero + composer + 底部「工具」入口在 420px 下**依然成块不破版**（截图 `%TEMP%\dsh-strip-measure\shots\w420.png`）。溢出元素数在 1360 与 420 下几乎不变（18 → 19），说明那批是常驻的绝对定位元素、不是被窄出来的 | **结论：长条取 ~420px 宽不会把内核首页压垮**，宽度下限的顾虑可以放下；真正没量的是**模式浮层**（写作台/GIR 不是移动布局，420px 下必挤）——那正是"模式界面拼在右侧、总宽随拼接增长"要解决的，下一刀量它 |
| 外壳注入在窄窗下的表现（**部分未测**） | `preload.js` 现在注入的是**皮肤 CSS**（`dsh-skin`，41 处）+ **断连浮层** `#dsh-shell-kernel-overlay` + 审阅 UI `#dsh-review-*`（`preload.js:115` 起）；实测取样时 `[id^="dsh-review"]` **一个都不在**——审阅 UI 是条件挂载（要有 git 工作区/审阅态），所以"窄窗下审阅侧栏会不会破版"**这条仍未测** | 实施第一天补测：先在实例里造出审阅态再量；别把"没报错"当成"没问题" |
| 真 OS 窗口 resize 怎么验（**新发现的工具缺口**） | CDP 在 Electron 上**不支持** `Browser.getWindowForTarget`（实测回 `-32601 'Browser.getWindowForTarget' wasn't found`），所以**没法用 CDP 改真实窗口尺寸**；本轮全部数值是 `Emulation.setDeviceMetricsOverride` 的**视口仿真**（布局层等价，但不含 OS 层 resize 路径与 `minWidth` 钳制） | 真 resize 只能等 §6.4.1 的形态能力落地后**用自家 IPC 验**（届时探针直接断言 `win.getBounds()`）；`minWidth:980` 到底会不会钳制外部改窗，也到那时才有答案 |

**仍开放**（要用户定的细节，不是技术问题）：长条默认宽/高与停靠边、是否置顶、
`—` 与 `⎋` 分别对应什么（原型里 `—` 收成小条、`⎋` 退出模式、`✕` 关界面）、
以及 v1 全屏主屏是保留成"← 返回工作区选择"那一层还是被长条取代（plan §12-8）。
**本轮没写任何壳层代码**：形态细节没定，先动 `main.js` 会白做。

#### 6.4.2 形态能力**刀 1 已落地**（2026-10-12 晚，用户「可以做」之后）

细节已由项目所有者拍板（§12-8），于是先把**能力**做出来、门面留给下一刀。已交付：

| 交付 | 内容 |
|---|---|
| 档位与几何 | `WORKBENCH_SHAPES = normal / strip / mini`；strip 420×(工作区高×0.86) 右上角、mini 300×168 右下角；**几何一律主进程算**，页面只能发档位字符串 |
| 动态最小尺寸 | `SHAPE_MIN_SIZE`：normal 980×640 → strip 320×320 → mini 240×120（实测生效，长条不再被 980 挡死） |
| 记忆隔离 | 形态期只记 `workbenchShapeBounds[shape] = {x,y}`；`scheduleSaveBounds` 在形态期直接绕开 `windowBounds`，**防抖到点还再判一次形态** |
| 置顶 | `workbenchStripOnTop`（默认开，可关）；normal 形态一律不置顶 |
| 授权 | `isKernelPageSender`：必须是主窗 `webContents` **且**发帧 URL 过 `isKernelPageUrl`；三条通道（set/get/on-top）同一道闸 |
| 桥 | `preload.js`：`getWorkbenchShape` / `setWorkbenchShape` / `setWorkbenchStripOnTop` / `onWorkbenchShape`（推送） |
| 验收 | 新增 `npm run verify:shell-shape`（真起隔离实例 + CDP，**14 PASS + 1 显式 SKIP**）；`shell-hardening-test` 加 **S9 八条**源码断言（枚举纪律 / 发送方闸 / 不收几何 / 不污染 windowBounds / normal 不置顶 / 最小尺寸真的放开） |

**这一刀抓到并修掉的两个真缺陷**（都是同一个根因链，由 `verify:shell-shape` 的 D/E 两条先红后绿）：
`applyWorkbenchShape` 原先**先 `setBounds` 后记形态**，于是切换过程中投递的 resize 事件仍按"用户手动改了
普通窗口"把 **421×655 写进了 `windowBounds`**（D 红），而还原 normal 时又是这条脏记忆把窗口带回
421 宽（E 红）。现在改成**先记形态再动窗**，并在防抖回调里二次判定形态。

**这一刀明确没做**（别当已有）：**无边框与自绘顶栏**——Electron 43 的 `frame` 只能在构造时设定
（`electron.d.ts:3848` 只有构造参数，运行时没有 `setFrame`），要无边框就得**重建窗口**（内核页面会重载）；
**工具台门面一行都没接**（现在只有壳会变形，页面上没有任何东西去请求它），所以**用户可见行为零变化**、
`CHANGELOG` 本轮不记；`—`/`⎋`/`✕` 三钮与托盘语义的对齐、拼接面板宽度策略，全部留给下一刀。

**验收时踩到的两条判据坑**（已进 `WORKLOG.md` 踩坑速查 #20/#21）：
① 程序化改窗后 `window.outerWidth` 可能是**滞后读数**（实测主进程 `getBounds` 已回 1363，页面仍报 421）；
② 窗口被别的窗口遮挡时 `document.hidden=true`，**Chromium 会推迟布局**（实测 `clientWidth` 5 秒不动）——
所以"渲染侧真的窄了"只在文档可见时判，不可见时显式 SKIP 并改以 `getContentBounds()` 为权威。

#### 6.4.3 门面接线**第一口**（2026-10-12 刀 2，用户可见）

`plugin/workbench/src/client/shell-shape.js`（新）做能力探测，`Chrome.js` 接线：
**主屏打开 → 申请 `strip`；主屏关闭（含点「进入」进模式）→ 还原 `normal`**；
"从没收成条过就绝不发还原"（否则会把用户的窗口尺寸/最大化状态乱改回去）；
桥缺席（官方壳 / 老安装包 / 探针环境）→ 一个字都不做，主屏照旧全屏 —— §3.3 降级硬约束守住。
主屏在窄窗下走**既有的 <900px 竖排**（对话列在上、瓷砖格在下），不是新写一套长条 UI。

验收：`verify:workbench-ui` 三条新断言——开主屏申请过 `strip`；把探针窗口**真**收到 420 宽后
`[data-wb-chat]` 在 `[data-wb-tiles]` 之上（竖排）且 `scrollWidth - clientWidth <= 1`（零横向溢出）；
关闭后申请序列是 `['strip','normal']`。`verify:workbench-writing` 零回归（那边的假宿主没有 `dshShell`，
正好覆盖降级路径）。全链 `verify:writing-quick` QUICK_EXIT=0。

**这一口明确没做**：`mini`（`—` 收小条）、无边框与自绘顶栏、扇形呼出、模式界面拼接、
真聊天瓷砖、状态条三指标接真数据源。所以现在的"长条" = **窄下来的全屏主屏**，
是通往 v2.2 的第一级台阶，不是终点形态。

**刀 3 补（2026-10-12 晚）**：状态条三指标已接内核真投影（`sessionStats` / `tokenUsage` / `contextPressure`，
读 `sessions.list` 行上的 `projectionValues` + 按会话 `refreshProjections`；算不出就如实写"还没数据"，
不拿 0 冒充）。同一轮**第一次端到端验成真实窗口变形**：真起实例点入口 → `data-wb-shape="strip"` 且
`window.outerWidth = 421×655`。**未证实项**：取证那条会话的列表行没带投影值，所以"能出真数"要在
**有生成记录的会话**上复验；若仍空，真路径应是会话句柄上的 `session.projections`
（retain/打开会话 = mode-kit 会话栈那一层），届时改挂并更新本节。详见 `logs/2026-10-12.md` 刀 3。

**刀 3b 收口（同日）**：上面那个"若仍空"已查清并改掉——**列表行这条路根本拿不到这三个键**
（`session.projections` RPC 的响应 schema 里没有 `tokenUsage`/`sessionStats`/`contextPressure`，实证），
真路径确认是**会话句柄**：`sessions.retain` → `binding(id).session.projections`，已改挂上去
（实机 `data-wb-telemetry="retained"` + 18 个投影键到位）。顺带抓到第二个真 bug：客户端 `tokenUsage`
是**扁平**的、host 侧 durable state 才套 `{totals,last}`，只按嵌套写会让命中率永远算不出；现在两种都认，
探针 fixture 换成实测扁平形状（旧读法在这条 fixture 上会红）。
**已证实（2026-10-12 晚，项目所有者实机截图）**：换到一条有生成记录的会话「能接手这个项目吗」，
读出 `⚡ 47 tok/s｜缓存 38%｜上下文 1%`，转录同时给出作者/活动/出错各行——
状态条与真聊天瓷砖在真内核上都成立。（早前那条「剧本创作」是空会话，显示"还没数据"也是对的。）

#### 6.4.4 下一刀（真聊天瓷砖）的实现路径**已摸清**（2026-10-12 调研，未实施）

不再需要试探——本仓库里已有一条跑通的路，写作伙伴面板天天在用：

| 环节 | 现成的东西 | 位置 |
|---|---|---|
| 会话服务 | `ctx.inject(['uiConversation'])` → `uiConversation.binding(id).target('chat')`（0.2.0 的消息图通道；0.1.7 有回退） | `plugin/writing-mode/src/client/adapters/harness/runtime.js:52-55,73` |
| 消息投影 | mode-kit 的 `projectChat(chat)` + `textOf(parts)` + `stripInjectedBlocks(text)`（剥掉注入块，别把 prompt 喂给作者看） | `packages/mode-kit/src/harness/projection.js:14,36,51` |
| 会话句柄 | `sessions.retain(id,{source:'mainView'})` → `sessions.binding(id).session`（本轮刀 3b 已在工具台跑通同一写法） | `packages/mode-kit/src/harness/adapter.js:140,157` |
| 发送 | 0.2.0 走 `conversation.input.shell`（前提是先有 retained binding），0.1.7 走 `uiWorkspace.openSession` | 见 `logs/2026-09-26.md`、`WORKLOG.md` 09-26 条 |

**边界两条**：① 工具台随壳内置，构建期相对 import `packages/mode-kit` 可以（不违反 bundle 纯净门禁——
不是跨插件值导入）；② **读转录免费、发消息花额度**，所以"只读转录"那一半可以自行验收，
"输入框发送"那一半要项目所有者点头才做真机验。设计成两段交付，别混一刀。
**状态（2026-10-12 刀 4）**：**第一段（只读转录）已落地**——`chat-transcript.js` 按上表接通 0.2.0
会话图 / 0.1.7 快照两条通道，投影走 mode-kit `projectChat`；真内核实机
`data-wb-chat-source="uiConversation"`（通道接通；当时 0 行是因为顶部那条是空会话，与 `turns:0` 一致）。
**第二段（输入框 + 发送）也已落地**（刀 5）：`chat-send.js` 用会话句柄的
`prompt([{type:'text',text}], 'queue')`（签名照 mode-kit `adapter.js:765` 生产代码），
`accepted / rejected / uncertain` 三种结果分开处理，**非 accepted 一律保留作者正文**并给出路。
路上被探针抓到三个真缺陷（订阅回环挂死、闭包块级引用、fixture 形状猜错），
见 `logs/2026-10-12.md` 刀 4/刀 5 与踩坑 #22/#24。

#### 6.4.5 长条自绘顶栏三钮（2026-10-12 刀 8，语义按 §12-8 拍板）

`—` 收成小条（小条下再点它展开回来）· `⎋` 退出工具台并还原窗口 · `✕` **复用既有关窗语义**。
三条实现纪律：

- **只在条状形态渲染**（`shape === 'strip' || 'mini'`）：normal 下还有系统标题栏，两套按钮并排只会碍事。
  样式上 `.dshWbHome` 因此改成纵向 flex（bar 在上、面板在下）；`toast` 本来就是 `position:fixed`，不受影响。
- **`✕` 不给插件 quit/hide**：新增 `shell:close-window`（过 `isKernelPageSender`）里只做 `win.close()`，
  是"进托盘"还是"真退出"由既有 `closeToTray` 那份逻辑定——页面能表达的意图只有"用户按了关闭"。
  回读新增 `visible` 字段专给实机门禁判这条（S9 钉住：关窗通道过同一道发送方闸、且没有 quit/hide 旁路）。
- **小条只留一行**：`mini` 下不渲染对话列与瓷砖格（`300×168` 塞不下就是破版），
  Esc 等价 `⎋`。桥缺席（官方壳/老包）时 `—` 与 `✕` 什么都不做、`⎋` 退化成"关主屏"，不自造错误文案。

验收：`verify:workbench-ui` ③e 一组（三钮齐备且都是原生 button + title、`—` 的档位申请尾巴、
小条下瓷砖确实不在、`✕` 只调关窗**不改形态**、`⎋` 还原 normal、焦点能落在钮上）；
`verify:shell-shape` 新增 I 段在**真实例**上验 `✕`：窗口 `isVisible()=false`、页面转 `hidden`、
进程还在、`shape` 仍是 `strip` 且 `alwaysOnTop` 未被顺手改掉。

**顺带补的一处自己引入的回退**：`—` 会整块卸载对话列，输入框里**没发出去的字**跟着一起没了。
`ui-store.js` 因此加了一段内存级 `chatDraft`（**不落盘**——那只是作者的一段在打草稿，没必要留在磁盘上），
输入框走 `defaultValue` + `onChange` 记账，accepted 时清零；探针里加了"`—` ⇄ 展开不吞字"这条断言，
它先红后绿，红的原因是**合成输入没走通**：React 在无控组件上装了 value tracker，直接
`el.value = x` 会把 tracker 一起改掉，随后派发的 `input` 被判定"值没变"，`onChange` 根本不触发——
要绕就得用原型上的原生 setter（踩坑 **#32**）。

**仍未做**：无边框与自绘顶栏（要重建窗口，Electron 43 无运行时 `setFrame`）、**拖动长条**
（现在仍走系统标题栏；无边框那一刀要同时补 `-webkit-app-region` 与钮的 `no-drag`）、扇形呼出 UI、
模式界面拼接。

**重议条件**（只有这几类需求会牵动壳，且都只加**能力**、不搬门面）：① "每个模式一个独立 OS 窗口"；
② "关窗/退出时先问模式的守卫"；③ **窗口形态本身**（把主窗收成长条/小条再还原）——
2026-10-12 项目所有者已获准（"可以改外壳支持，因为这个我们自己做的桌面版就是为了自定义"），
代价与未实测项见 §6.4.1，**门面仍在插件里**这条不变。

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
| **L1 上下文 + 一键交接** | **已完成（2026-10-11，用户选定 A）**：注册表加 `context`/`onHandoff`/`handoff`；工具台加上下文行与通知 toast；写作侧上报上下文 + 顶栏「去生图」；载荷不透明（§5.5） | `test:workbench` 26 断言 + 写作探针扩到 L1（上下文上报 / 上下文行 / 交接端到端 / 通知）；全链 `QUICK_EXIT=0` |
| **L1.5 交接不喊退出** | **已完成（2026-10-11）**：守卫收到 `reason`（switch/exit/handoff），交接失败只说"交接已取消"；探针钉住"脏稿先落盘、文稿不关"。**修正**：原先以为交接会关稿——核实 `editor.close()` 只是 flush，不会清空会话 | `test:writing-bridge` 12 断言（含 reason 透传）+ 探针 L1.5 断言；全链 `QUICK_EXIT=0` |
| **L2 同屏共存（第一刀）** | **已完成（2026-10-11）**：工具台加辅助坞（自己的 `shell.overlay` 条目 + `dock` 注册字段 + rail/收展 + `--dsh-wb-dock-width` 让位变量）；写作模式提供坞视图（作品/章节/路径 + 回到写作台）。真分屏与"GIR 的坞视图"留待下一刀 | 写作探针扩到 L2（收起留 rail / 展开显示写作视图 / 变量 340px↔0px / 写作当主视图时无坞）；`test:workbench` 27 断言（新增坞字段与 `dockViewOf`）；全链 `QUICK_EXIT=0` |
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
6. **多模式在场 / 全流程创作**：**已定方向（2026-10-11）= A「同时在场 + 上下文连续」**（L1 已实现，§5.5）；
   **B「同屏共存」留待 L2**（要模式交出可嵌入视图 + 工具台自己写布局）。
7. **产物链**：项目所有者 2026-10-11 明确**暂不确定** → 交接载荷保持**不透明**（§5.5），
   等链路定了再决定要不要给载荷加语义（或加"最近产物"这类工具台级视图）。
8. **主屏形态**：v1 全屏主屏（已落，L2 第二刀）**还是** v2.2 长条对话窗（2026-10-12 用户设想，
   原型 `prototypes/workbench-home/strip.html` 验证中）——长条窗涉及**壳层窗口变形**（主进程管
   窗口尺寸/位置/chrome，§6.4 壳能力清单要加）与**多 agent 编排**（主 agent 统筹各模式子 agent），
   代价与官方壳兼容性都要重估；等原型手感拍板，也可能是两套并存（长条 = 默认界面，主屏 = 工作区选择）。
   **2026-10-12 复核补**：这一设想的两条技术待查已有结论（遥测三指标内核都有真数据源 · 多 agent 是
   "内核给原语 + 实验 team 包默认关闭"，统筹语义仍要工具台自己写），详见 guide §9-5 与 `logs/2026-10-12.md`；
   **壳层窗口变形**：2026-10-12 项目所有者**获准改外壳**（"可以改外壳支持，因为这个我们自己做的桌面版
   就是为了自定义"），逐条代价与两个**未实测**项已落 §6.4.1；仍待定的细节是 v1 全屏主屏
   保留为"← 返回工作区选择"那一层还是被长条取代、长条的尺寸/停靠边/是否置顶、`—`/`⎋`/`✕` 各走哪条
   既有关窗-托盘-退出语义。官方壳兼容性仍需单独评估（壳能力缺席时长条不成立，只能退回 v1 主屏）。

   **拍板（2026-10-12，项目所有者三问三答）**：
   - **形态**：**长条取代主屏、v1 全屏主屏退役**——进工具台不再先弹一块全屏主屏，而是直接把窗口收成
     微信式长条。
   - **顶栏三钮**：`—` 收成小长条 · `⎋` 退出工作台模式（窗口还原）· `✕` **走现有关窗语义 = 收进托盘**
     （不新造第二条退出路径）。
   - **位置与置顶**：**记住用户拖到的位置、下次还在那 + 置顶做成单独开关**（不硬编码"永远贴右缘"）。

   **落地状态（2026-10-12 刀 8 / 刀 9）**：三钮语义已按上面三条实现，并各有实机判据——
   `verify:workbench-ui` ③e（三钮齐备、都是原生 button 带 title、`—` 只申请档位、`✕` 只调关窗
   **不改形态**、`⎋` 还原 normal）+ `verify:shell-shape` I 段（真实例上 `✕` 后窗口
   `isVisible()=false`、页面转 hidden、进程还活着、形态与置顶都没被顺手改）。
   位置记忆 `workbenchShapeBounds` 已生效；置顶这一轮补到 **Win32 真值**（判据与补刀见 §12-9 末段）。
   刀 9 另外把"形态跨过重启说谎"这条不一致补掉：启动即把持久化的 `workbenchShape` 落回 normal
   （位置记忆不动），否则 `scheduleSaveBounds` 会永远跳过写 `windowBounds`，用户窗口记忆冻住。
   **仍待**：直接拖动长条（现在归系统标题栏，与无边框那一刀一起补 app-region + 钮的 `no-drag`）、
   `✕` 之后从托盘还原的手感确认。

   **连带后果（设计约束，不是新问题）**：长条成立的前提是"壳能改窗口形状"，而**官方壳 / 老安装包 /
   探针 harness 都没有这条能力**。§3.3 与验收 W5 的降级硬约束要求"壳能力缺席时模式仍可达"，所以主屏
   **不能删**，它的角色从"目的地"降为**壳能力缺席时的降级形态**（能力探测走 `window.dshShell`，
   照写作模式 `wikiBridge` 的先例）。即：自研壳 = 入口即长条；官方壳 = 入口开主屏（现状那套）。
   契约 §二「主屏」那一行、`tile` 字段语义与门禁断言都按这个改写，属实施阶段的事。

   **排期顺序（先壳后面门）**：
   1. **壳侧能力**：档位枚举 IPC（`strip`/`mini`/`normal`，几何由外壳按屏幕算）+ 无边框形态与自绘顶栏 +
      长条几何单独持久化（**绝不写进 `settings.windowBounds`**，否则重启停在长条态）+ 置顶开关 +
      `minWidth/minHeight` 动态放开 + 与 `closeToTray`/托盘/`shell:quit` 语义对齐；
      补 `shell-hardening-test` 断言，并**手动**跑 `verify-ipc-authz`（它不在 npm scripts 里）。
      涉及打包分支的话按 `AGENTS.md` §1 实测打包版。
   2. **插件侧门面**：长条的对话列（真聊天）· 扇形呼出（模式清单仍来自注册表）· 拼接区（要模式交
      "可嵌入视图"，即 §9「真分屏」那一口）· 统筹卡（先只读 `sessions.list` 的 `running`/`updatedAt`
      起一个真状态；多 agent 编排按上面的结论另立评估）。
   3. **窄视口已量（2026-10-12）**：内核首页压到 420px 宽**不破版**（横向溢出 0、文案优雅截断，
      实测行见 §6.4.1）→ 长条的宽度下限不是拦路虎。**第 1 步里仍要补量的三条**：
      ① 模式浮层（写作台 / GIR）在窄窗下的真实表现（决定拼接面板的最小宽）；② 审阅 UI
      `#dsh-review-*` 是条件挂载，要造出审阅态再量；③ 真 OS 窗口 resize 路径——CDP 在 Electron 上
      **不支持** `Browser.getWindowForTarget`（实测回 `-32601`），本轮数值全部来自视口仿真，
      真 resize 只能等自家形态 IPC 落地后用 `win.getBounds()` 断言。

9. **扇形呼出的图标画在"窗外"——这条原型里的效果在真实产品里做不到那么直白**（2026-10-12 查实）。
   原型 `strip.html` 里模式图标朝窗外的桌面扇形展开，是因为整个"桌面"只是页面背景；
   真实产品里长条就是一个 `BrowserWindow`，**窗口不能往自己的边界外画东西**。三条路各有代价：
   - **A. 收在窗口内**（贴着右缘内侧展开一列图标）：零新能力、纯插件改动，但"朝窗外张开"的手感没了；
   - **B. 辅助透明置顶窗**（壳再开一个覆盖在长条外侧、鼠标穿透的窗）：最接近原型手感，
     **要新增壳能力**（开/关/定位/命中测试/与主窗联动），并要处理多窗焦点与"托盘堆积"老问题；
   - **C. 原生菜单**（`Menu.popup` 在光标处弹）：能画在窗外且实现最省，但只能是一列文字菜单项，
     不是图标扇形，也拿不到我们想要的动效。
   **要项目所有者定**：为这个手感付不付 B 的代价；不付就走 A（我倾向先 A，手感不满意再升 B）。

   **B 方案可行性评估（2026-10-12 晚，项目所有者选 B 之后做的实测，不是纸面推演）**：

   | 风险 | 怎么测的 | 结果 |
   |---|---|---|
   | ① 非激活辅助窗会不会抢走长条的键盘焦点 / 能不能收到点击 | 真起 Electron：主窗 + `focusable:false` 无边框辅助窗，向辅助窗里的红块发 `sendInputEvent` 点击，前后比对 `isFocused()` | **通过**：`{mainFocusedBefore:true, overlayFocused:false, overlayClicked:'clicked', mainStillFocused:true}` —— 辅助窗收得到 DOM 点击，主窗焦点一点没丢。`setParentWindow` 也在（可让辅助窗随主窗生死） |
   | ② `transparent:true` 到底画不画得透明 | 截 `capturePage()` 看角落与色块的 alpha | **这台机器上测不了**：连**对照组**（`transparent:false` 的实心窗）截回来也是整片 alpha=0 → 截图路径本身不可信，不能拿它判透明与否。顺带一次合并实验里还见过 `Network service crashed` / GPU 进程退出，透明 + 本机 GPU 的组合需要人眼确认一次 |
   | ③ 会不会破坏"一个应用一个窗口"的基本预期 | API 面核对（`electron.d.ts`：`transparent` / `skipTaskbar` / `focusable` / `setIgnoreMouseEvents(…, {forward})` 标注 `@platform darwin,win32` / `setParentWindow`） | **不破坏**（设计上可保证）：`skipTaskbar` ⇒ 任务栏与 Alt-Tab 里仍只有一个窗口；非激活 ⇒ 不抢键盘；不注册托盘 ⇒ 不喂"托盘堆积"那个老毛病；随主窗 move/close/hide 联动 ⇒ 主窗一关它必须一起没 |

   **结论**：B **可以做**，但**必须先做一次人眼确认**再往上盖扇形 UI——透明与本机 GPU 合成这一条
   （②）在无人值守下测不出来，硬盖就是拿用户的机器赌。落地顺序定死：
   1. **最小浮标切片**：壳加一个"能开/能关/跟着主窗走"的辅助窗（先只画一个明显的色块 + 一个可点区域），
      拉预览实例请项目所有者看一眼：**看不看得见、点它会不会让长条输入框失焦、关掉长条它有没有跟着没**。
   2. 三条都过了才做扇形 UI（模式图标、错峰滑入、点外收起吞点击——展开期间**不穿透**，
      避免误点到别的应用）。
   3. 任一条不过就退回 A（窗内贴右缘一列），代价是"朝窗外张开"的手感变淡，写进 CHANGELOG 与契约。
   **新增壳能力的形态**（第 1 步就要定）：`shell:open-workbench-overlay` / `shell:close-workbench-overlay`
   + 状态回读，同样**只收枚举与语义参数、不收任意几何**（辅助窗的位置由主窗 bounds 推出来），
   发送方仍过 `isKernelPageSender`；`shell-hardening-test` 补断言，实机探针验"关掉后不残留窗口"。

   **最小浮标切片已落地（2026-10-12 晚，上面第 1 步做完了）** —— **⛔ 已于 2026-10-13 整体移除**
   （项目所有者目检后："这个浮标没有用就去掉"）。下面这段保留为历史记录；实现与通道、门面调用、
   相关断言都已删掉，反向守卫见 `verify:shell-shape` 的 G 段与 `verify:workbench-ui` 的假桥。
   扇形呼出若要做，**回到 §12-9 重新拍板**（不要拿这份历史当"已完成"）。
   壳侧 `showWorkbenchOverlay()` /
   `hideWorkbenchOverlay()`（`transparent` + `frame:false` + `focusable:false` + `skipTaskbar` +
   置顶走 `enforceTopmost`（见下一段）+ `setParentWindow(主窗)`），位置由主窗 bounds 推、放不下自动翻另一侧；
   主窗 move/resize 跟随，hide/minimize/close 一律 `destroy()`（不留孤儿浮标）。
   **辅助窗刻意不带 preload** ⇒ 它拿不到 `dshShell`，没有新增 IPC 攻击面。
   门面接线：主屏收成 strip 后自动开浮标、还原 normal 时关掉（桥没这个方法就什么都不做）。
   `verify:shell-shape` 新增 G 段 4 条全过：开得了 / 状态回读 `overlay:true` /
   **开着时主窗 `isFocused()` 仍为 true** / 关得掉且 `overlay:false` 不残留。
   **仍差项目所有者目检两件事**：透明画得对不对（这台机器 `capturePage` 判不了，见踩坑 #28）、
   物理点击是否真的不抢键盘焦点（探针里是主进程 `isFocused` + 独立实验的合成点击，不是手指）。
   目检过了才做扇形 UI（图标、错峰滑入、点外收起并吞点击）；不过就退 A。

   **置顶这一关的实测与修法（2026-10-12 深夜，项目所有者目检报告"置顶从没生效过"之后）**：
   应用自报 `alwaysOnTop=true`、`isAlwaysOnTop()` 也说 true，但 Win32 `GWL_EXSTYLE` 恒是
   `0x00200100`（没 `WS_EX_TOPMOST`）——门禁读自报值，所以一路绿；用户实机上长条与浮标被别的应用
   整个盖住。六轮实验（probe2–probe7，判据一律读 OS）定死三条：

   | 实测 | 结论 |
   |---|---|
   | 七个 `alwaysOnTopLevel` 各置位一次 ×2 轮 | **只有 `screen-saver` 与 `pop-up-menu` 会置 `0x8`**；`floating`（省略 level 时的默认值）、torn-off-menu、modal-panel、main-menu、status 一律不置位 |
   | 窗形消融（frame / 透明 / focusable / skipTaskbar / resizable 单独与全套） | **与窗形无关**——任何形状的窗都能置上；先前"浮标能、主窗不能"的差别在调用时机，不在窗形 |
   | 置位成功后经历 别的应用抢前台（真起 notepad）/ focus / blur / minimize+restore / setBounds | **全部扛住** ⇒ 只有"落地"这一关需要重试，不需要常驻看门狗 |
   | 单次调用后 50ms 一次连采 3.3 秒 | 抓到一次**整个窗口生命周期都没落地**（三次独立复现） ⇒ 一次调用不可信 |

   `isAlwaysOnTop()` 在 Windows 上就是这个 OS 位的读数（每次采样与 `GetWindowLong(-20)` 一致）
   ⇒ 主进程有**免费的自校验探针**。据此壳侧新增 `enforceTopmost(target, want, label)`：
   申请 → 读 OS 真值 → 没落地按 `0/120/300/700/1500ms` 补刀，仍不成**记日志不静默**；
   全文件只留这一处 `setAlwaysOnTop`（S9 用反例守卫钉住），`shapeState()` 把**申请值**
   （`alwaysOnTop`）与**系统真值**（`topmostOs`）分开报。验收侧 H 段改判 OS 位并轮询等落定，
   G 段焦点判据只在"开浮标前主窗本来有焦点"时成立、否则显式 SKIP；
   探针新增 `--selftest`（掩码判据 + 真枚举桌面窗口）——**读 OS 的判据自己也要被验一次**
   （这轮差点把探针的假阴性当成"置顶修不好"，见踩坑 #30）。
   对 B 方案的账：评估表里 ③（不破坏"一个应用一个窗口"）这轮第一次拿到 **OS 级证据**
   （浮标在 OS 里确实置顶、关掉后查不到该窗口、主窗焦点没被抢）；② 透明**仍未测**，仍等人眼确认。

---

署名：deepseek-v4.1-flash（依据 2026-10-11 项目所有者"先立工具台这一层架构"的决定整理）；§0.1 原型轮与决策点 8 补充：Kimi（2026-10-12）；决策点 8 于 2026-10-12 由项目所有者拍板（内容见上），壳层代价调查与 ⑤ 修复：Qoder（2026-10-12）。
