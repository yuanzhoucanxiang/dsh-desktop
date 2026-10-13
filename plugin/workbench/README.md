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
| 主屏 | `shell.overlay`（id `workbench`，order 10） | 点入口打开主屏（参考多窗口预览）：**自研壳上先申请把窗口收成 `strip` 长条再打开**（壳能力缺席时就直接开全屏主屏，行为一字不变），关闭时还原。左列「对话」瓷砖（会话标题 + **最近 6 条真实转录（只读）** + 状态条三指标 + 「回到完整会话」；读不到会话服务就如实说明）+ 右侧**模式瓷砖格**——提供了 `tile` 的模式渲染自己的内容窗口，没提供的退化为大按钮卡（保证可达）；顶部「正在做」上下文行、激活时有退出钮；↑↓ 选择、回车进入、Esc 关闭。**主屏本身不改当前模式**，点瓷砖上的「进入」/按钮卡才切换（同一套守卫）；平时渲染 `null`，不占屏。**条状形态下顶部另有一行自绘三钮 `—`/`⎋`/`✕`**（见 §六） |
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
  `shell:get-workbench-shape`、`shell:set-workbench-strip-on-top`、**`shell:set-workbench-splice`**、
  推送 `shell:workbench-shape`，桥在 `window.dshShell` 上。工具台侧 `src/client/shell-shape.js` 做**能力探测**，
  `Chrome.js` 的接线规则：
  **主屏打开 → 申请 `strip`；主屏关闭（含进入模式）→ 还原 `normal`**，且"从没收成条过就绝不发还原"
  （否则会把用户的窗口尺寸/最大化状态乱改回去）。桥缺席（官方壳 / 老安装包 / 探针环境）→
  一个字都不做，主屏照旧全屏（§3.3 降级）。**形态分工（2026-10-13 起，对齐原型 v2.2）**：
  壳在位 → 主屏收成长条 → **对话优先**（不摆瓷砖格）+ 右缘**接缝**是模式入口；
  桥缺席（官方壳/老包/探针假宿主）→ 主屏保持宽窗，瓷砖格与按钮卡才是这一版的布局。
  探针按 420 宽断言"只有对话列 + 接缝在位 + 零横向溢出"。**仍未接**：无边框与自绘顶栏（要重建窗口）、
  接缝的**模式拼接**（原型 v2.2 的右界面/左子对话，需要模式交出可嵌入视图 + 壳层拼接几何）。
  纪律不变：形态只发档位枚举，**绝不把任意几何传给壳**。
- **长条版式按原型重排（2026-10-13 前端深入优化）**：改前是"两层标题（顶栏 + 面板里又一行标题）、
  对话只占上半、输入区悬在中间、状态条在输入框**上方**、次要出口是整行大按钮"——对着 Kimi 原型的
  同尺寸截图逐条改：**只有一层顶栏**（strip 下不渲染 `.dshWbHead`/"对话"小标题）；
  **对话主体 `flex:1` 撑满**（`.dshWbChatBody`，没消息时说明**居中**，不再贴底像页脚）；
  **输入区钉底**且 `+` / 输入框 / 发送**同框**（`.dshWbInputWrap` + 框内右下 `.dshWbSendIn`）；
  **状态条移到输入框下方**（原型顺序）；消息改成**左右气泡**（`.dshWbMsg.is-user` 贴右、作者名只在非自己那侧）；
  「回到完整会话」从整行按钮收成 `.dshWbLinkBtn` 小链接；strip 下内边距收到 10/12px。
  量过几何：`composer[12,496,388,49]`、`meter[12,564,388,23]`、`foot[12,602,388,20]`、右缘把手 16×45、`overflowX=0`。
- **流式态与工具活动行（2026-10-13 前端深入优化第二刀）**：
  - **流式态**：会话**正在生成**时（列表快照记录上的 `running`）在转录末尾挂一行
    `data-wb-chat-streaming`（呼吸点 + "正在生成…" + 该会话当前 tok/s；速度还没数据就不显示那一段）。
    **与"还没有消息"互斥**：正在生成时摆的是流式态，不是空态说明。呼吸动画尊重 `prefers-reduced-motion`。
  - **工具活动行**：转录投影给的是**结构化** `tool: {name, phase, isError}`（mode-kit 的 `projectChat`），
    所以工具调用**不套气泡**，压成一行 `data-wb-chat-act`（⚙ + 工具名 + 阶段：进行中/完成/失败；
    失败用错误色**且**带"失败"文字，不只靠颜色）。
  - 探针按 fixture 验：`running=true` → 流式态在；改 `false` → 收起；再回 `true` → 回来；
    工具调用渲染成活动行且带工具名与阶段。
- **气泡细节：长文折叠（2026-10-13 前端深入优化第三刀）**：旧实现把正文**硬截断到 160 字**
  （一个字都不该丢）→ 现在超 180 字的正文默认折三行（`-webkit-line-clamp`）+「展开全文（N 字）」开关
  （`data-wb-msg-toggle` / `data-wb-msg-open`），**折叠态也完整渲染正文**。
  **时间戳没做**：内核 chat 节点只有 `seq`（序列）与 `data.step`，**没有墙钟时间**——不编造，
  真需要就等内核给字段（或由壳侧在收到消息时自己记，但那是另一条路）。
  探针：长文默认折叠且正文长度 ≥ 200（锁住"不再截断"）、点开后 `is-clamped` 消失。
- **小条显示同一份状态数据（2026-10-13 前端深入优化第四刀）**：原型 `.mini` 不是"少画点东西"，
  而是**同一条状态数据换个尺寸**。所以把会话快照 / 遥测订阅 / 状态条抽成 `src/client/use-session.js`
  （`useSessionSnapshot` / `useSessionTelemetry` / `TelemetryMeter`），长条与小条共用一份；
  小条用 `compact`（去掉进度条，字号 10px，贴底加分隔线），指标文案一个字不改。
  探针：`[data-wb-mini] [data-wb-meter]` 在位且是 `compact`、指标文案非空。
- **对话三态说清（空 / 正在读 / 读不到，2026-10-13）**：`data-wb-chat-log-empty` 区分
  `pending`（通道在、图还没送到 → "正在读取这条会话的内容…"）/ `no-messages`（"还没有消息…"）/
  `none`·`no-service`（"暂时读不到…"）。**加载态与空态不能混**：`pending` 错报成"还没有消息"
  会让作者以为会话是空的（2026-10-13 修）。**流式态与空态互斥**：正在生成时摆流式态。
  探针按 fixture 逐个验（先 `null` 图验加载态、再空图 + `running:false` 验空态）。
- **拼接几何（壳侧，2026-10-13）**：`shell:set-workbench-splice`——模式界面要拼在长条旁边时，
  窗口得跟着变宽。**页面只说"要拼多宽"**（有界标量：`0` = 收起，或 280–760，越界夹住），
  x / y / 高度全由主进程算；几何规则是**长条右缘不动**（它贴着工作区右缘）、向左加宽
  （`x -= splice`、`width += splice`；用户拖过的位置记忆存的是长条自己的 x，同样左移）。
  只对 `strip` 生效，`mini` 下不动窗口但**值留着**，切回长条即恢复。
  `shapeState()` 回读 `spliceWidth` / `spliceRange`；设置项 `settings.workbenchSplice`。
  实机门禁 `verify:shell-shape` **J 段**判五件事：+400 且右缘不动 / 越界夹住 / 收起还原 / 非数被拒 / 形态不变。
  **仍未做**：插件侧的拼接面板与左侧子 agent 对话（见下条，第一版已落地）。
- **拼接面板·插件侧（2026-10-13，用户拍板 A；同日第二版支持多块 + 拖拽）**：
  **接缝里点一下模式 = 把它拼到长条右侧**（不是进入模式）；要进它的全屏界面就点 `←` 回宽窗主屏、
  再点瓷砖「进入」。拼接区是长条右侧的若干列（`data-wb-splice` / `data-wb-splice-width`，
  外层 `data-wb-splice-wrap` 报块数），内容是模式的**可嵌入视图**——第一版直接用它的 `dock` 视图
  （写作模式已有），窗口由壳按总宽加宽。
  - **可以同时拼多个**：新拼的**贴主长条插入**（`index 0`，旧的整体外顶——原型 v2.2 的规则），
    总宽 = 各块之和（壳侧上限按显示器工作区算，`spliceRange` 回读）；
  - **每块左缘可拖拽调宽**（`.dshWbSpliceGrip`，pointer capture，移动中节流申请、松手落定）；
    宽度**记忆在壳的 `settings.workbenchSplice`**，所以重启/重进长条还在；
  - 三条纪律：① **没有可嵌入视图的模式不拼**（如实说明"还没提供可嵌入视图"，窗口一动不动）；
    ② 壳不支持拼接（老壳）→ `no-splice-bridge`，界面保持原样；③ **进入模式 / 回宽窗 / 退出工具台 /
    关主屏时先收起拼接**，挂载时还会对账壳里残留的 `spliceWidth`（页面重载后自动收回）。
  - 两个只有实测才会发现的坑（都进了踩坑速查）：**拼接期间窗口位置会被写进"长条位置记忆"**
    （收起后长条跑偏，右缘 1392→1113）→ 写回时把 splice 加回去；**拖拽回调里的 `spliced` 是旧闭包值**
    （松手把宽度改回去）→ 用 ref 且**在同一 tick 里立刻同步**。
  - 探针 **⑪ 组**：拼接后当前模式不变、申请 420、模式视图渲染、接缝标「已拼接」；**两块同拼** →
    新块贴长条（DOM 序 `['demoDock2','demoDock']`）、总宽申请 840；**拖 100px** → 该块 520、总宽 940；
    收起一块 → 420；全收起 → 0；无视图的模式点不动窗口且有说明。
- **长条右缘接缝·扇形（2026-10-13，原型 v2.2；同日第二版按原型 `.edge`/`.fan` 重做）**：
  条状形态下**整条右缘**都是悬停区（26px 宽、整高，原型 `.edge` 同款），中间一道小指示条
  （`.dshWbSeamGrip`，4×44 圆角条，悬停变亮）；悬停/聚焦**以接缝为轴心按角度**弹出圆形图标钮
  （46px，原型同尺寸）：**中间 0°、两端 ±34°**、半径固定 58px（原型 `fanPop` 的终点）、逐颗错峰 45ms，
  **图标与标签反向旋转**（扇形是转出来的，但字要正着读——原型里图标跟着斜，这里改好一点）。
  - 状态点是图标**右下角的小徽标**（原型 `.st`：只有"已拼接/当前"才显示）；
  - 标签在图标**左侧**、悬停才浮出（原型在右侧——那是画在窗外；我们收在窗内，只能反过来），
    标签里带 `已拼接` / `当前` 的 tag；
  - 长条里它是**唯一**的模式入口（瓷砖格已让位），没有模式时留一行说明；
  - **只能收在窗口内**：窗口边界是硬的，原型里"朝窗外展开"在真实产品里画不出来（plan §12-9 的 A）。
  - 探针 **⑩ 组**（按角度判）：角度单调排开、正中那颗 0°、两端分居两侧且**对称**、半径恒定且为正、
    逐颗错峰单调；收起态 `data-wb-seam-open="0"`。
  - **仍未做**：模式拼接的插件侧（见下条）。
- **长条顶栏五钮（2026-10-13 对齐原型 `.topbar`）**：条状形态下渲染
  `←` 回宽窗主屏 / `⚙` 设置 / `—` 小条 / `⎋` 退出 / `✕` 关窗，都是原生 `<button>`（带 `title` + `aria-label`）。
  **`←` 与 `⎋` 不是一回事**：`←` 只申请 `normal`（窗口变宽、主屏还在、瓷砖格随之出现 = 原型的"工作区选择"），
  `⎋` 才退出工具台（有模式在场先过同一套守卫）。`⚙` 走壳既有的 `openSettings`（能力探测，缺席就什么都不做）。
  顶栏中间是"工作台 · 当前模式"（`data-wb-bar-who`）。
- **状态条按原型 `.meter` 补齐（2026-10-13）**：三指标 + **上下文进度条**（`data-wb-meter-fill`，0..100）
  + **模型名**（`data-wb-metric="model"`，取自 `modelSelection` 投影，缺席就不显示）。
  上下文文案从百分比改成原型的 `已用/窗口` 形状（`上下文 15k/64k`；窗口大小缺席时退回百分比，不编造分母）。
- **输入框左侧「+」弹层（原型 `.sheet`，2026-10-13）**：`data-wb-plus` 开合 `data-wb-sheet`；
  里面是「上传」（附件通道还没接，**如实禁用并写明原因**）与「更多工具」（= 模式入口，`data-wb-sheet-mode`，
  与接缝同一批模式）。对话里还加了日期分隔（原型 `.day`，v1 只写"今天"——不编造历史日期）。
- **长条自绘顶栏（2026-10-12 起，2026-10-13 补到五钮）**：条状形态（`strip`/`mini`）下
  门面顶部渲染真 `<button>`（带 `title` + `aria-label`，Tab 可达）：
  `—` 在 `strip ↔ mini` 之间切（小条只留顶栏 + 一行"正在做什么"，Esc 等价 `⎋`）；
  `⎋` 退出工具台并还原 `normal`（有模式在场时先走同一套关闭守卫，被拦下就留在原地不自造文案）；
  `✕` 只说"用户按了关闭"——走壳里**既有的关窗语义**（`shell:close-window` → `win.close()`，
  进托盘还是退出由 `closeToTray` 那份逻辑定），**不顺手改形态、不改置顶**。
  正常宽窗形态下这套按钮不渲染（那时还有系统标题栏）。桥缺席时 `—` 与 `✕` 什么都不做、
  `⎋` 退化成"关主屏"。自查钩子：`data-wb-bar` / `data-wb-bar-shape` / `data-wb-btn="mini|exit|close"` /
  `data-wb-mini` / `data-wb-mini-line`。**拖动仍走系统标题栏**（无边框那一刀再补 app-region）。
  另：`—` 会卸载整块对话列，所以**没发出去的正文**记在 `ui-store.js` 的内存级 `chatDraft` 里
  （刻意不落盘），展开回来字还在——探针的"`—` ⇄ 展开不吞字"那条断言就是在盯这件事。
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
- ~~**扇形呼出的浮标辅助窗（B 方案）最小切片**~~ —— **已于 2026-10-13 移除**（项目所有者目检后：
  "这个浮标没有用就去掉"）。当初它只证明了三件事（透明、无边框、点它不抢长条输入焦点、关主屏跟着没），
  但**对用户没有用处**，扇形菜单又还没做，所以在桌面上只是多一块东西。壳侧两条通道
  （`shell:open-workbench-overlay` / `shell:close-workbench-overlay`）、preload 的两个方法、
  门面调用与相关断言一并删掉；**反向守卫留在门禁里**（`verify:shell-shape` 的 G 段判"dshShell 上没有任何
  `*Overlay*` 方法且 OS 里没有残留窗"，`verify:workbench-ui` 的假桥不再提供这两个方法 + 断言"一次都没调过"）。
  扇形呼出若要做，回到 plan §12-9 重新拍板。
- **最近打开**、**健康总览**：契约里留了 `recent` / `health`，**未实现**。
- **主屏对话列（2026-10-12 刀 4 起）**：显示顶部那条会话的标题 + **最近 6 条真实转录**（只读）+
  状态条三指标 + 「回到完整会话」。转录走 `chat-transcript.js`：0.2.0 用
  `uiConversation.binding(id).target('chat')`、老内核退回会话快照，投影一律经 mode-kit
  `projectChat`（含 `stripInjectedBlocks`——不剥就会把注入给模型的 prompt 端给作者看）。
  卡片常驻 `data-wb-chat-source`（`uiConversation`/`session`/`pending`/`none`/`no-service`/`no-session`）
  供实机自查。**输入框与发送已接**（刀 5）：原语是会话句柄的
  `prompt([{type:'text',text}], 'queue')`（签名照 mode-kit 生产代码 `adapter.js:765`，不自己发明）；
  `accepted / rejected / uncertain` 三种结果分开处理——只有 `ok:true` 才清输入框，原生拒绝与
  "结果不可核"**都一个字不丢作者的正文**，并给可执行出路（重试或回完整会话发）；
  没有发送面时输入框禁用、理由写在 `title` 上。
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
  src/client/shell-shape.js  壳「窗口形态」能力探测 + 申请档位 / 读当前形态（挂载对账）/ 关窗（缺席返回 null，门面自动退回全屏主屏）
  src/client/FooterEntry.js / Settings.js / ui-store.js / use-workbench.js / host-api.js / styles.js / copy.js
  test/registry.mjs · test/host-state.mjs
  client.js             构建产物（esbuild，勿手改；npm run build:workbench）
  runtime-manifest.json 发布集合（profile 同步逐文件比对用）
```

— 记录：deepseek-v4.1-flash（2026-10-11）；L2 主屏轮：Kimi（2026-10-11）；壳"窗口形态"能力已具备、门面未接：Qoder（2026-10-12）；形态接线第一口（主屏开=strip、关=normal，能力缺席降级）：Qoder（2026-10-12）
