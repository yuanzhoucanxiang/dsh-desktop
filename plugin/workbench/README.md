# `@dsh-local/workbench` —— 创作工具台

把 dsh 的若干**创作模式**（写作、GIR 生图，将来还有导演等）收进一个统一门面：**一个入口、一个当前模式、
一套上下文与交接、一块辅助坞、一块主屏**。设计依据 [`docs/plans/workbench-layer-v1.md`](../../docs/plans/workbench-layer-v1.md)；
2026-10-11 从 P0 骨架一路做到 L2 第二刀（主屏）。

> 本文件是**契约**（怎么注册、字段什么语义、路由与状态怎么管）。
> **开发纪律**（流程 / UI 规则 / 验收清单 / 启动指令）见
> [`docs/workbench-mode-guide.md`](../../docs/workbench-mode-guide.md)；
> **现状与路线**见设计文档 §0.1。

定位三条（决定了很多"为什么不那样做"）：

1. **纯插件、零内核改动**：工具台是内核页面里的插件，跑在官方壳上也能用。
2. **门面归插件，能力归壳**：开窗/热键/通知/退出守卫是**壳能力**（清单见设计文档 §6.4），
   插件按需申请并能力探测，不往 `preload.js` 塞常驻 UI。
3. **不统一领域数据**：写作的目录结构、GIR 的服务端版本各归各的；工具台只共享**门面与句柄**。

---

## 一、一个"模式"要提供什么（模式契约 v1）

模式在 client 侧用**可选注入**接入（服务缺席时整段不执行 → 自动降级）：

```js
ctx.inject(['workbench'], (scope) => {
  scope.workbench.registerMode({
    id: 'writing',            // 必填。稳定 id：持久化键 / 互斥键 / 坞键
    label: () => '写作',       // 显示名（thunk 可跟随后续本地化）
    order: 20,                // 列表与坞的排序（默认 100）
    mount: 'overlay',         // 'overlay' | 'panel'（v1 只启用 overlay；panel 仅登记）

    // —— 以下全部可选 ——
    canDeactivate: ({ to, reason }) => true | Promise<boolean>,  // 关闭守卫（纯判定）
    onActivate: ({ from, reason, fromLabel }) => {},
    onDeactivate: ({ to, reason }) => {},
    context: { get: () => ({ kind, title, project, doc }), subscribe: (fn) => dispose },
    onHandoff: (envelope) => {},                                  // 接收别的模式的交接
    dock: { label: () => '写作', view: Component, order: 50 },    // 辅助坞轻视图
    tile: { label: '写作', view: Component, order: 100 },         // 主屏瓷砖的「主要内容窗口」
  })
})
```

要点：

- **`registerMode` 返回 disposer**，随调用方的 effect 拆除（工具台会清掉 `activeModeId`、解绑 context 订阅）。
- **重复 id 直接抛错**（配置事故要响）；**没有 `context.get` / `dock.view` / `tile.view` 就如实算"没有"**，
  不会给一个点开是空白的坞或瓷砖。
- `canDeactivate` 是**纯判定**：只回答能不能走、不改状态（落状态由 `onDeactivate` 做），
  抛错按**拒绝**处理。一次切换只问一次。`reason` 取 `'switch' | 'exit' | 'handoff' | 'restore' | …`。
- **`context` 只报稳定的东西**（作品、当前稿、当前项目/画布）：工具台据此重渲染入口与切换器，
  不要每次敲键都推。
- **`dock.view` / `tile.view` 都是运行时交过来的 React 组件引用**（不是 import 别的插件）——内核客户端 bundle 的
  **纯净门禁禁止跨插件值导入**，而组件引用走服务传递不违反它。dock 是"别人当主视图时右缘的轻视图"，
  tile 是"主屏右侧瓷砖格里的内容窗口"；两者并立，模式给哪个都行。

## 二、工具台对用户可见的部分

| 面 | 位置 | 行为 |
|---|---|---|
| 统一入口 | `sidebar.footer.action`（order 10） | 侧栏底部**一个**「工具台」按钮；**没有任何模式注册时渲染 `null`**（不留死按钮） |
| 主屏 | `shell.overlay`（id `workbench`，order 10） | 点入口打开主屏（参考多窗口预览）：**自研壳上先申请把窗口收成 `strip` 长条再打开**（壳能力缺席时就直接开全屏主屏，行为一字不变），关闭时还原。左列「对话」瓷砖（会话标题 + **最近 6 条真实转录（只读）** + 状态条三指标 + 「回到完整会话」；读不到会话服务就如实说明）+ 右侧**模式瓷砖格**——提供了 `tile` 的模式渲染自己的内容窗口，没提供的退化为大按钮卡（保证可达）；顶部「正在做」上下文行、激活时有退出钮；↑↓ 选择、回车进入、Esc 关闭。**主屏本身不改当前模式**，点瓷砖上的「进入」/按钮卡才切换（同一套守卫）；平时渲染 `null`，不占屏 |
| 通知出口 | 同上（帧级 toast） | 交接结果等统一走这里；6 秒自动消失、点一下即关 |
| 辅助坞 | `shell.overlay`（id `workbench-dock`，order 11） | 右缘显示**非当前主视图**的模式的轻视图；收起留竖排 rail；展开写 `--dsh-wb-dock-width`；左缘可拖拽调宽（240–720px，localStorage 记忆） |
| 设置段 | `settings.section`（id `workbench`，order 45） | 已注册模式、当前模式、host 状态 revision；读不到就明说 |

**互斥**：同一时刻只有一个**主视图**（`activeModeId`）。切走时上一个模式的浮层只渲染 `null`、**不卸载**
（草稿、滚动位置、会话绑定都留住）。坞是主视图的**附属面**，不改 `activeModeId`、不参与 `canDeactivate`。

**降级**：没装工具台（或跑在官方壳上）时，模式必须保留自己的入口与开关——工具台缺席不能导致模式不可达。
反过来，模式缺席时工具台也不显示它的入口。

## 三、上下文与一键交接

- **上下文**：工具台只做**汇总与展示**（入口 + 切换器上的「正在做：写作 · 归乡记 · 第2章」），
  不解释内容；`context.get` 抛错 → 显示为空，不编造。
- **交接**：`workbench.handoff(to, payload)` → **先切到目标模式**（走同一套关闭守卫）→ 再调目标的 `onHandoff`。
  载荷**刻意不透明**（"产物链"还没定，将来怎么变都不用改通道）：

  ```js
  { from, kind, title, text, path, refs: [...], at }   // kind 由模式自己定义，默认 'text'
  ```

  如实语义：目标没有 `onHandoff` → `delivered:false`（toast 说"还没有接收端"）；
  被守卫拦下 → 不切也不交付；没有工具台 → 调用方自己说明（写作台就是禁用按钮 + title 说明）。

## 四、host 半

- `inject: ['webServer']`，注册**一条** exact 路由 `/api/workbench`，按 `?route=` 分发：

  | route | 方法 | body / 返回 |
  |---|---|---|
  | `state` | GET | `{ok, state:{version, revision, activeModeId, recent}}`；状态文件损坏 → 409 `corrupt-config` + `backup` |
  | `state` | POST | `{activeModeId?, recent?, baseRevision?}` → 新 state；revision 不匹配 → 409 `revision-conflict` |

- **状态文件** `$DSH_HOME/workbench.json`（`DSH_DESKTOP_HOME` 优先，其次 `DSH_HOME`，最后 `~/.dsh`）。
  只存**跨模式共享**的东西；模式自己的配置一律不在这里。
- **损坏纪律**（照写作模式既定规矩）：只有 ENOENT 算"空状态"；解析失败保留 `.damaged-<ts>` 原件、
  如实报错并**拒绝回写**（否则一次"切个模式"就把 activeModeId/最近项静默清零）。
- 安全面：环回对端 + 可信 Host/Origin + 路由×方法白名单 + 按字节收 body（口径同 writing-mode 的 `lib/http.js`，
  但**不 import 对方**——各自独立发布到 profile，跨插件相对 import 会让单独安装解析失败）。

## 五、门禁与命令

```bash
npm run test:workbench           # 注册表 28 + host 状态/路由 20（纯 node）
npm run verify:workbench-build   # 重建 client.js 与仓库产物逐字节一致
npm run verify:workbench-ui      # P0+L2 主屏：真实 Electron 隔离窗口 9 组（入口/主屏/对话列/瓷砖/切换/守卫/host/设置段）
npm run verify:workbench-writing # P1+L1+L1.5+L2：写作接入（双 client 同页）
npm run verify:workbench-gir     # P2+L1：GIR 接入（三 client 同页 + 假 GIR 后端）；跨仓依赖，找不到时 SKIP
npm run test:mode-kit            # 共享库 mode-kit 的导出面/边界
```

`test:mode-kit` / `test:writing-bridge` / `verify:workbench-writing` 都在 `verify:writing-quick` 链里；
`verify:workbench-gir` **故意不进链**（它依赖 `E:\GIR` 那个仓库，找不到就 SKIP 退出 0）。

跑 electron 探针前注意两个环境变量（从 Electron 宿主终端——Kimi Work 等——跑门禁会继承到它们）：
① `ELECTRON_RUN_AS_NODE=1` **必须先清掉**（`Remove-Item Env:ELECTRON_RUN_AS_NODE`），否则 electron 会以
node 模式启动、`app` 为 undefined；② `ELECTRON_ENABLE_LOGGING=1` 要带上，否则 GUI 子系统的 electron.exe
主进程日志进不了管道，输出像被吞。冷启动验收（`verify-writing-coldstart`）已对这两个变量**自我隔离**
（摘掉前者、补上后者、直调 electron.exe），不经 npm shim。

## 六、已知边界（别当成已有）

- **壳的"窗口形态"能力已接上第一口**（2026-10-12 刀 2）：外壳提供 `shell:set-workbench-shape`
  （`normal` / `strip` 长条 / `mini` 小条，**只收档位枚举**，几何由主进程按显示器算）、
  `shell:get-workbench-shape`、`shell:set-workbench-strip-on-top`、推送 `shell:workbench-shape`，
  桥在 `window.dshShell` 上。工具台侧 `src/client/shell-shape.js` 做**能力探测**，`Chrome.js` 的接线规则：
  **主屏打开 → 申请 `strip`；主屏关闭（含进入模式）→ 还原 `normal`**，且"从没收成条过就绝不发还原"
  （否则会把用户的窗口尺寸/最大化状态乱改回去）。桥缺席（官方壳 / 老安装包 / 探针环境）→
  一个字都不做，主屏照旧全屏（§3.3 降级）。主屏在窄窗下走**既有 <900px 竖排**（对话列在上、瓷砖格在下），
  探针按 420 宽断言竖排 + 零横向溢出。**仍未接**：`mini`（`—` 收小条）、无边框与自绘顶栏、
  扇形呼出、模式拼接、状态条三指标真数据源。纪律不变：形态只发档位枚举，**绝不把任意几何传给壳**。
- **对话列下的状态条已接内核真投影**（2026-10-12 刀 3 + 3b 修正）：三条指标 = `sessionStats`
  （tok/s = `decodeTokens/(decodeMs/1000)`）、`tokenUsage`（缓存命中 = `cacheRead ÷ (uncached+cacheRead+cacheWrite)`）、
  `contextPressure`（上下文 = `pressureTokens/contextWindow`）。
  **读的是会话句柄上的投影 Store**：`sessions.retain(id,{source:'mainView'})` →
  `sessions.binding(id).session.projections`（照 mode-kit 写法）。**列表行拿不到这三个键**——
  `session.projections` 那条 RPC 的响应 schema 只带 title / inbox / sessionListMetadata / subagentCatalog
  这类（2026-10-12 实证），早先"读列表行 + refreshProjections"的写法在真机上永远算不出。
  环境没有 retain/binding（老内核、探针假宿主）→ 退回读列表行；条上挂
  `data-wb-telemetry="retained|list-row|no-store|no-session"` 与 `data-wb-telemetry-keys`
  （看到的投影键），实机一眼能看出走到哪一步。
  **形状坑（真内核抓到的真 bug）**：客户端 `tokenUsage` 是**扁平**的 `{uncachedInputTokens, outputTokens,
  cacheReadTokens, cacheWriteTokens}`，host 侧 durable state 才套 `{totals,last}`；只按嵌套写读法命中率永远算不出。
  现在两种都认，探针 fixture 也换成实测扁平形状（旧读法在这条 fixture 上会红）。
  投影字段全是可选：算不出就写"还没数据/未上报"+原因，**绝不拿 0 冒充"没有"**；没有会话时整条不摆。
  **实机状态**：`retained` 路径 + 18 个投影键都到位；顶部那条会话「剧本创作」是**空会话**
  （`turns:0 / decodeMs:0 / contextPressure:{}`），它显示"还没数据"是正确行为。
  算术已在两种形状上验算出 `⚡ 38 tok/s | 缓存 92% | 上下文 23%`；
  **已证实（2026-10-12 晚，项目所有者实机截图）**：换到一条有生成记录的会话读出
  `⚡ 47 tok/s｜缓存 38%｜上下文 1%`，转录同时给出作者/活动/出错各行——状态条与真聊天瓷砖在真内核上都是活的。
- **最近打开**、**健康总览**：契约里留了 `recent` / `health`，**未实现**。
- **主屏对话列（2026-10-12 刀 4 起）**：显示顶部那条会话的标题 + **最近 6 条真实转录**（只读）+
  状态条三指标 + 「回到完整会话」。转录走 `chat-transcript.js`：0.2.0 用
  `uiConversation.binding(id).target('chat')`、老内核退回会话快照，投影一律经 mode-kit
  `projectChat`（含 `stripInjectedBlocks`——不剥就会把注入给模型的 prompt 端给作者看）。
  卡片常驻 `data-wb-chat-source`（`uiConversation`/`session`/`pending`/`none`/`no-service`/`no-session`）
  供实机自查。**输入框与发送仍未做**（要发真实消息花额度，单独一段等点头）；
  空会话就显示 0 行，不编内容也不编"读不到"。
  **更正（2026-10-12 复核内核代码）**：早前写的"内核会话快照没有时间字段，所以不显示最近"**不成立**——
  内核 `sessions.list` 快照每条记录都带 `updatedAt`（列表本身按它倒序），另有 `running` / `blank` /
  `agentAvailable`；恒有值的标题字段是 `displayTitle`（`title` 只在会话确有持久标题时存在）。
  所以「最近打开」与"某会话是否正在跑"都有现成数据源，只是**都还没实现**。
  证据与调查过程见 `logs/2026-10-12.md`。
- **写作 / GIR 的主屏 tile 内容窗口未做**：两者目前在主屏右侧都是大按钮卡（可达、可进），
  各自的「主要内容窗口」由对应插件/仓库后续提供 `tile` 接入。
- **真分屏**（两个完整模式并排）：未做；当前只有"主视图 + 辅助坞"。坞视图目前只有写作模式提供。
- **模式启用/禁用探测**（内核 `pluginManager`）：未做（第三方可注入性未验证，设计文档 R9）。
- **`mount: 'panel'`**：只是登记信息；`panel` 与 `openSession` 抢中心列的冲突未定（设计文档 §4）。
- 工具台暂**未被壳的插件管理器列为可禁用项**（内置插件都不声明 `dsh.bundle.patch`，与 writing-mode 现状一致）。

## 七、目录

```
plugin/workbench/
  index.js              host 半：/api/workbench 分发（路由×方法白名单、错误码 → 状态码）
  lib/http.js           环回/可信判定、body 收集、JSON 响应
  lib/state.js          $DSH_HOME/workbench.json 的读改写 + 损坏纪律 + 原子替换
  src/client/entry.js   client 入口：provide 服务 + 注册 4 个槽位条目 + 从 host 恢复
  src/client/registry.js 模式注册表（纯逻辑，可在 node 单测）：注册/互斥/守卫/上下文/交接/坞
  src/client/Chrome.js  主屏（左列对话 + 右侧模式瓷砖格）+ 上下文行 + 通知出口
  src/client/ConversationTile.js  主屏左列「对话」瓷砖（读内核会话服务，缺失如实降级）
  src/client/Dock.js    辅助坞（rail / 面板 / CSS 变量）
  src/client/shell-shape.js  壳「窗口形态」能力探测 + 申请（缺席返回 null，门面自动退回全屏主屏）
  src/client/FooterEntry.js / Settings.js / ui-store.js / use-workbench.js / host-api.js / styles.js / copy.js
  test/registry.mjs · test/host-state.mjs
  client.js             构建产物（esbuild，勿手改；npm run build:workbench）
  runtime-manifest.json 发布集合（profile 同步逐文件比对用）
```

— 记录：deepseek-v4.1-flash（2026-10-11）；L2 主屏轮：Kimi（2026-10-11）；壳"窗口形态"能力已具备、门面未接：Qoder（2026-10-12）；形态接线第一口（主屏开=strip、关=normal，能力缺席降级）：Qoder（2026-10-12）
