# `@dsh-local/workbench` —— 创作工具台

把 dsh 的若干**创作模式**（写作、GIR 生图，将来还有导演等）收进一个统一门面：**一个入口、一个当前模式、
一套上下文与交接、一块辅助坞**。设计依据 [`docs/plans/workbench-layer-v1.md`](../../docs/plans/workbench-layer-v1.md)；
2026-10-11 从 P0 骨架一路做到 L2 第一刀。

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
  })
})
```

要点：

- **`registerMode` 返回 disposer**，随调用方的 effect 拆除（工具台会清掉 `activeModeId`、解绑 context 订阅）。
- **重复 id 直接抛错**（配置事故要响）；**没有 `context.get` / `dock.view` 就如实算"没有"**，
  不会给一个点开是空白的坞。
- `canDeactivate` 是**纯判定**：只回答能不能走、不改状态（落状态由 `onDeactivate` 做），
  抛错按**拒绝**处理。一次切换只问一次。`reason` 取 `'switch' | 'exit' | 'handoff' | 'restore' | …`。
- **`context` 只报稳定的东西**（作品、当前稿、当前项目/画布）：工具台据此重渲染入口与切换器，
  不要每次敲键都推。
- **`dock.view` 是运行时交过来的 React 组件引用**（不是 import 别的插件）——内核客户端 bundle 的
  **纯净门禁禁止跨插件值导入**，而组件引用走服务传递不违反它。

## 二、工具台对用户可见的部分

| 面 | 位置 | 行为 |
|---|---|---|
| 统一入口 | `sidebar.footer.action`（order 10） | 侧栏底部**一个**「工具台」按钮；**没有任何模式注册时渲染 `null`**（不留死按钮） |
| 模式切换器 | `shell.overlay`（id `workbench`，order 10） | 点入口打开：模式列表 + 「正在做」上下文行 + 退出；平时渲染 `null`，不占屏 |
| 通知出口 | 同上（帧级 toast） | 交接结果等统一走这里；6 秒自动消失、点一下即关 |
| 辅助坞 | `shell.overlay`（id `workbench-dock`，order 11） | 右缘显示**非当前主视图**的模式的轻视图；收起留竖排 rail；展开写 `--dsh-wb-dock-width` |
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
npm run test:workbench           # 注册表 27 + host 状态/路由 20（纯 node）
npm run verify:workbench-build   # 重建 client.js 与仓库产物逐字节一致
npm run verify:workbench-ui      # P0：真实 Electron 隔离窗口 8 组（入口/切换/守卫/host/设置段）
npm run verify:workbench-writing # P1+L1+L1.5+L2：写作接入（双 client 同页）
npm run verify:workbench-gir     # P2+L1：GIR 接入（三 client 同页 + 假 GIR 后端）；跨仓依赖，找不到时 SKIP
npm run test:mode-kit            # 共享库 mode-kit 的导出面/边界
```

`test:mode-kit` / `test:writing-bridge` / `verify:workbench-writing` 都在 `verify:writing-quick` 链里；
`verify:workbench-gir` **故意不进链**（它依赖 `E:\GIR` 那个仓库，找不到就 SKIP 退出 0）。

跑 electron 探针前注意：本机 agent 进程继承着 `ELECTRON_RUN_AS_NODE=1`，**必须先清掉**
（`Remove-Item Env:ELECTRON_RUN_AS_NODE`），否则 electron 会以 node 模式启动、`app` 为 undefined。

## 六、已知边界（别当成已有）

- **最近打开**、**健康总览**：契约里留了 `recent` / `health`，**未实现**。
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
  src/client/Chrome.js  切换器 + 上下文行 + 通知出口
  src/client/Dock.js    辅助坞（rail / 面板 / CSS 变量）
  src/client/FooterEntry.js / Settings.js / ui-store.js / use-workbench.js / host-api.js / styles.js / copy.js
  test/registry.mjs · test/host-state.mjs
  client.js             构建产物（esbuild，勿手改；npm run build:workbench）
  runtime-manifest.json 发布集合（profile 同步逐文件比对用）
```

— 记录：deepseek-v4.1-flash（2026-10-11）
