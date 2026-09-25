# 官方桌面端 vs 自研外壳：对照与去留判断

**基线时间 2026-09-25**。官方侧证据来自 `deepseek-ai/deepseek-harness` master（blobless 克隆于
`%TEMP%\dsh-official-probe`，版本坐标 `0.1.7-rc.2`，最近 push 2026-09-24）。
自研侧证据来自本仓库工作树。
所有结论标注「已验证 / 推断 / 未查到」。**重读时先复查第 5 节的版本号**，官方迭代以天计。

---

## 0. 一句话结论

官方桌面端**不是"也有一个壳"，而是已经把壳这一层做成了带签名、带更新链、带崩溃恢复、带插件管理入口的正规产品**，
且已公开可下载安装（见 §5，这点此前的判断是错的）。
我们作为「壳」的独立价值塌缩到 6 项小能力；
真正的资产是**插件本体**——其中 `writing-mode` 与 `palis-theme-panel` **对壳零依赖**，可以搬到官方壳上；
但搬过去需要换一条挂载通路，因为**官方壳不接受 `--patch` 注入**。

---

## 1. 官方桌面端做了什么（已验证）

代码规模：`apps/desktop/src` 61 文件 ≈7.1k 行；`apps/desktop/tests` 202 文件（114 个 spec，≈16.8k 行）。
另有 `apps/desktop-host`（`@deepseek-ai/dsh-desktop-host`，"Private Node-mode host process"）。

| 面 | 官方做法 | 证据 |
|---|---|---|
| 加载 | 特权 scheme `dsh-app://app`（standard/secure/corsEnabled/supportFetchAPI/stream）；`/`、`/index.html`、`/assets/*` 由壳从**已发布 npm 包** `@deepseek-ai/dsh-web-frontend/dist` 本地直出，其余全部转发 Host | `apps/desktop/src/main.ts:128`、`614-632` |
| 进程 | Electron RunAsNode 子进程跑私有 Host；Node IPC 承载启动注入/就绪/关闭 | `apps/desktop-host/src/index.ts:104`、`README.zh.md` |
| 端口 | 固定 19387（Web 是 3080），可被 `webserver.config.port` patch 覆盖；**Host 仍真实监听 127.0.0.1** | `apps/desktop-host/src/index.ts:30`、`packages/host/webserver/src/index.ts:127,295` |
| 窗口 | 1 主窗 + 欢迎窗 + 更新浮层 + 策略测试登录窗；**没有**通用多窗口/工作区多视图 | `main.ts:203`、`welcome-window.ts:60`、`update-overlay.ts:26` |
| 托盘/关窗 | 关窗=隐藏（Win 首次需确认，写 `background-close-confirmed`）；Win 常驻托盘，**macOS 无菜单栏图标**；退出前向 Host 查活跃任务与定时提醒 | `tray.ts`、`desktop-host/src/quit-inspection.ts`、`README.zh.md:25-33` |
| 快捷键 | **无 `globalShortcut`**；仅应用内键位，存 `userData/keybindings.json`，主进程抢先拦截 | `keybindings.ts`、`keyboard.ts` |
| 通知 | **只有更新提醒**；关窗明确不发通知 | `update-attention.ts:42` |
| 自启 | **没有**（`setLoginItemSettings` 全库 0 命中） | 全库检索 |
| 深链 | 有 `dsh://`，但 `dsh://open` 只唤窗、**不带凭证** | `scripts/electron-builder-config.mjs:102`、`main.ts:1172` |
| 文件关联 | 没有 | — |
| 崩溃 | 原生恢复对话框：退出/重启/**禁用第三方插件**/备份 profile patch 再重启；崩溃报告写 `logs` 目录留 10 份 + Host stderr 尾 64KiB | `fatal-recovery.ts`、`crash-report.ts`、`README.zh.md:105-113` |
| 安全 | `nodeIntegration:false`/`contextIsolation`/`sandbox`/`webSecurity`；preload 只暴露启动、目录选择、`__DSH_HOST_PATHS__`、browser 租约、更新展示；`<webview>` 仅主窗且需主进程签发租约+分区；Platform 内嵌视图按账号哈希持久分区、打开前清全部存储；麦克风仅允许主 `dsh-app://app` 页；导航一律转外部浏览器。**注意：应用文档不注入 CSP**（全仓仅策略登录窗有 CSP meta） | `main.ts:227-231,235,298`、`preload-app.ts`、`browser-guests.ts:33-41`、`platform-view.ts:101-160`、`microphone-permissions.ts` |
| 更新 | generic provider + 固定 `nightly` 通道；10 分钟基础轮询 ±20% 抖动、失败指数退避至 1h；**服务端强更策略** `/api/v0/check_client_update`（正式包 anonymous，内测包飞书登录）；安装前拿 Host 任务锁，失败可恢复替代 Host | `update-coordinator.ts`、`update-schedule.ts`、`mandatory-update-policy.ts`、`README.zh.md:375-386` |
| 安装包 | NSIS：原生亮暗页、可编辑目录、空目录/已登记路径校验、7-Zip 真实进度、完成页默认启动；卸载删 Electron userData + %APPDATA% 产品目录 + 更新缓存，**绝不动 `~/.dsh`**；`--updated`/`/KEEP_APP_DATA` 保留数据；有期望值夹具 `tests/expected/windows-installer.json` | `installer/`、`README.zh.md:296-306` |
| 签名 | Win EV 硬件令牌 + PE 全量扫描 + 签名缓存；mac dmg+zip + 公证 | `scripts/electron-builder-config.mjs`、`.env.*.example` |
| 首启 | 欢迎窗 + API Key 页 + 浏览器 PKCE 登录 | `welcome-*.ts`、`src/client/WelcomePage.tsx` |
| 其他 | 壳文案 zh/en（`CFBundleLocalizations`）；`nativeTheme.themeSource` 跟随 + Win acrylic；核心依赖全量随包（含内置 Python/Node/pnpm/Office 库）；**无缩放菜单角色**，DevTools 用 F12 | `locale.ts`、`main.ts:699-701,984`、`README.zh.md:96` |

---

## 2. 外部插件如何被加载（关键差异，已验证）

1. **发现目录**：桌面端独占 `$DSH_HOME/profiles/desktop`；CLI **不能启动也不能修改**该 profile；
   内置 bundle 在前、启用插件在后，写进 `dependencies` + `dsh.profile.bundles`。(`src/paths.ts`、`README.zh.md:77-81`)
2. **`--patch` 通路不存在**：私有 Host 硬编码 `patchFiles: []`。
   唯一补丁层是 profile 自己的 `cordis.patch.yml`（而崩溃恢复流程会把它改名备份）。
   (`apps/desktop-host/src/index.ts:30`，且启动参数固定 `['--no-open','--port','19387']`)
3. **安装通道 = 复用 Web 插件管理器**（认证 HTTP API + 内置 pnpm）：支持包名 / Git / 压缩包 /
   **本地绝对路径**；首次并发 ping `registry.npmjs.org` 与 `registry.npmmirror.com` 择优，可手动指定镜像。
   桌面**没有**专属插件目录，也没有专属管理页。(`packages/client/ui-plugin-manager/README.zh.md:34-46`)
4. **client 半边与 Web 同一条线**：`/plugins/<id>/client.js` 路由仍由内核 `packages/client/modules/src/index.ts:225,311` 提供；
   启动注入行由 `ctx.webServer.collectIndexInjections()` 收集后经 Node IPC 交给壳（`apps/desktop-host/src/index.ts:104`），
   壳经 `dshDesktopBoot.ready()` 返回 `{injections, streamBaseUrl}`（`main.ts:642-644`），
   前端仍消费 `window.__DSH_BOOT__` 并 settle `__DSH_BOOT_READY__`（`web-document.ts:10`、`packages/client/web/src/boot.ts:57`）。
5. **`ctx.webServer.register` 私有端点在桌面可用**：转发器**无路径白名单**，全方法/流式/取消透传，
   仅丢 hop-by-hop 与 `set-cookie`；**唯一的门是 Origin 必须等于 `dsh-app://app`，否则 403**
   (`apps/desktop/src/web-document.ts:76-93`)。
   → 推论：**任何绝对 `http://127.0.0.1:<port>` 的 fetch 必挂**（跨源 + 非安全上下文）；相对路径必须保持。
6. **Slots 完全一致**：槽位注册表是浏览器侧概念，桌面加载同一份前端产物；插件解析规则明说"npm、Desktop 与源码启动共用"
   (`packages/client/ui-slots/README.zh.md`、`docs/user/develop/basic/publish.zh.md:105`)。

### 2.1 自定义边界：壳层收窄、插件层反而比我们预想的宽（已验证）

**壳层 = 没有第三方扩展点。** 官方渲染进程拿不到文件系统 / 原始 IPC / shell / 任意 pnpm 参数（`preload-app.ts` + README 声明），
且 `patchFiles: []`、桌面与内核强制同版本、`desktop-bundle-imports.mjs` 让解析不到的导入直接打包失败。
→ 我们壳做过的那一类能力（自研约 40 个 IPC 通道、preload 任意位置注入、启动时改内核挂载清单、自绘 splash、
任务栏/快捷方式图标、开机自启、全局热键、托盘自定义菜单项）在官方壳上**无从挂载**。桌面层自定义≈0。

**插件层 = 正规且丰富。** 两点新发现：
- **Slots 不是"挂个组件"那么简单**：四种组合形态 `single`/`list`/`keyed`/`chain`（条目自行提名）、
  Component Factory（可复用装配 + 调用方选局部组件）、`defineStore` store 席位（init 推断状态 schema、actions 为 draft-transform 写入集）、
  props 类型从 `inject` 推导、disposer 递归移除子 slot。
  **但严格**："声明即认领"——注册条目成为唯一被允许渲染该键的条目；
  **注册未声明的 slot、重复声明子项、跨 scope 挂同一共享句柄，都在加载时抛出**
  （`packages/client/ui-slots/README.zh.md:28,32,38,42,46`）。
  槽位表由官方用 `declare module` 增补，即**能挂哪儿取决于官方开了哪些槽**。
- **主题有正式扩展位**：`@deepseek-ai/dsh-client-ui-theme` 的 ThemeRuntime 管 `--dsw-*` 令牌基表
  （static scale + alias 语义层），持有 light/dark/system 偏好、经 `theme/change` 发布不可变 ThemeSnapshot，
  且 README 明说**"第三方注册的 theme id 仍是进程内扩展"**（第三方版不写进内置 settings schema、删除不覆写最后的内置持久偏好）。
  → PALIS 目前靠覆盖 `--dsw-alias-*` 换肤（有效、壳无关），但**正规做法是注册主题 id**，这是升级空间而非损失。

**Host 半边的自由度被低估了**：插件的服务端半跑在私有 Host 进程里（RunAsNode），有完整文件与进程权限，
能开 HTTP 端点、订阅会话事件流、注册工具与 LLM 适配器。
→ 「任务完成通知」「开机自启」这类需求插件自己就能实现；**只有托盘图标、系统级 `globalShortcut`、真·多窗口、splash
必须在 Electron 主进程**，那才是官方壳的硬边界。

### 2.2 搬过去前要实测的两个真风险

1. `writing-mode` 的全屏三栏工作台挂在 `shell.overlay`。官方确有该槽位，但"浮层吃掉整个窗口 + 焦点/键位归属"
   是否被官方渲染器允许，**未验证**。
2. 官方对"注册未声明的槽位"**加载时抛错**（我们这边是宽容的）。若我们四个挂载点里有任何一个用的是官方未正式声明的键
   （尤其 `conversation.session.header.utilities`），在官方壳上会**直接挂不上而非静默降级**。

---

## 3. 对照表：我们的壳还剩什么

### 3.1 官方已追平或超过（我们不再有维护理由）

- 自包含运行时（含 Python/pnpm/Office 库）——超过：我们还额外做「安装目录之外落盘 + 原子交换 + `.prev` 回退」，官方也全量随包。
- `dsh-app://` 协议本地直出 —— 比我们的「起 `dsh web` 再把窗口指过去」更干净；我们的方案要求真实监听端口 + 抓 stdout 拿一次性 token（`main.js:1297-1302`，契约 `shell.launch-line` critical）。
- 托盘 / 关窗隐藏 / 退出前查任务 —— 追平（我们多了 macOS 菜单栏与动态托盘项）。
- 崩溃恢复 —— **明显超过**：官方是原生对话框 + 可"一键禁用第三方插件" + 备份 profile patch + 崩溃报告留 10 份；我们只有渲染侧「重启内核」浮层 + 自研坏 bundle 隔离链（`main.js:713-719,752-755,792-860`）。
- NSIS 定制 / 卸载清理 / 签名 / 公证 —— **超过**：我们 mac 走 `CSC_IDENTITY_AUTO_DISCOVERY=false` 不签名，且 NSIS 有历史安装失败账（见 `docs/kernel-upgrade-checklist.md`、0.1.43 发布坑）。
- 自动更新 —— **超过**：官方有服务端强更策略 + 抖动轮询 + Host 任务锁；我们是 GitHub Releases + 自编重试队列。
- 插件管理入口 —— **超过**：官方复用 Web 管理页（安装/配置/启停/运行时卸载），支持镜像择优与本地路径；我们是「首启种子 + 自研写 `cordis.patch.yml` 实现启停 + 刮 stdout 认坏 bundle」。
- 深浅色跟随 + acrylic —— **超过**：我们的外壳根本没有深浅色开关，只有托盘图标响应 `nativeTheme`。
- 安全边界 —— **严于我们**：官方渲染进程拿不到 fs/原始 IPC/shell/任意 pnpm 参数；我们自觉记录的技术债是「`dshShell` 桥暴露在内核页主世界，第三方插件 client JS 与外壳同权」（`main.js:187-193`），已靠 `isSettingsSender` 分级、确认框、realpath 闸门逐轮收口（`docs/audits/shell-hardening/2026-09-21/`）。
- 深链 `dsh://` —— 追平（我们的 `review`/`restart` 动作是额外增量，但官方刻意不带凭证）。
- 内置目录选择、原生"关于"面板、壳 i18n —— 追平。

### 3.2 官方明确没有（我们的剩余增量，全部只有 6 项）

1. **系统级全局快捷键**（官方无 `globalShortcut`）——我们的热键带白名单校验 + 占用退避重试（`lib/hotkey.js`，68 项单测）。
2. **开机自启**（官方 0 命中）。
3. **任务完成的系统通知**：官方只有更新提醒且"关窗明确不发通知"；我们有「回合完成且主窗失焦才提醒」（`main.js:573-645`）。
   → 这是唯一一项**看起来属于产品需求**而非边角能力的增量。
4. **同一内核的多会话并行窗口**（官方仅 1 主窗）+ 面板宽度持久化。
5. ~~**Git 信任闭环的注入式侧栏**~~ —— **已于本日（2026-09-25）由用户决定移除**：
   用户反馈外壳自带的「审阅」侧栏效果不如内核插件 `dsh-better-sidebar` 的右侧栏，要求去掉外壳版
   （`logs/2026-09-25.md`〔移除外壳审阅侧栏 UI〕：`preload.js` 1591 → 335 行，四个注入 UI 检查脚本删除；
   保留 `review-bridge` 插件与 NDJSON 流供窗口标题/托盘的"运行中"提示使用，回退端点亦保留）。
   官方 Web UI 亦自带"会话文件改动在卡片和侧边栏审阅，diff 逐行/左右分栏/高亮/同步滚动"（v0.1.7-rc.1 发布说明）。
   → **这条已经不再是我们的增量**，而且是用户自己用脚投的票：内核插件层胜过了外壳注入层。
   剩余净增量只有「逐 hunk 暂存/丢弃 + commit/push」这一段，且现在没有承载界面。
6. **启动画面的质感**：三皮肤 + 单调递增进度引擎（永不回退、失败就地冻结）+ 231 项断言（`splash-check.js`）。官方是共享加载页。这是体验细节，不是能力。

**注**：第 5 项被移除后，§3.2 只剩 5 项边角能力，而其中 4 项（自启、全局热键、多窗口、启动画面）
都不值得整套签名/公证/双平台打包/更新链的长期税。

另外：PALIS 换肤与「按账号哈希的 Platform 分区」不冲突——PALIS 覆盖的是内核 `--dsw-alias-*` 设计令牌，属内核级、与壳无关。

### 3.3 版本代差（必须正视）

| | 我们 | 官方 |
|---|---|---|
| 外壳版本 | 0.1.43（今日发布） | — |
| 内置内核 | **`@deepseek-ai/dsh@0.1.1-rc.1`** | **`0.1.7-rc.2`**（2026-09-24） |
| 桌面端历史 | 2026-08 前已有 | `apps/desktop` 首现于 tag `dsh-v0.1.5-alpha.1`（2026-09-08）→ **约 17 天** |
| 桌面端提交活跃度 | — | 近三周 ≥100 次，最新 2026-09-24T13:24Z |
| 更新源 | GitHub Releases（私有仓库） | 自建 CDN，见 §5 |

我们落后 6 个 alpha/rc 周期。`contracts/kernel-surface.json` 那 17 条契约探针正是为「跟官方内核」而准备的税。
官方架构上是 lockstep：桌面版与 `@deepseek-ai/dsh` 强制同版本，且 `desktop-runtime.json` + `scripts/desktop-bundle-imports.mjs`
让任何无法在包内解析的导入**直接打包失败**（`README.zh.md:47-75,159-163`）。

---

## 4. 迁移可行性：插件对壳的接缝清单

分三档：**必断 / 需重做 / 不断**。完整表格见本次调研原文，此处只列影响决策的。

### 4.1 好消息：真正的资产零壳依赖

- **`writing-mode`**：`index.js` 978 行 + `lib/` ≈3890 行 + 客户端源码 ≈6422 行（bundle `client.js` 20818 行）。
  双面 Cordis 插件；宿主 inject `['webServer','llm','agentDefaultModel']`；客户端 inject `['slots','sessions','connection','workspaces']`；
  单一路由 `GET|POST /api/writing-mode?route=<name>`，21 个 route 白名单；注册 4 个**官方槽位**
  （`shell.overlay`、`sidebar.footer.action`、`conversation.session.header.utilities`、`settings.section`）；
  鉴权一律 `req.socket.remoteAddress` 回环判定（不信 Host 头）。
  **全仓 grep `dshShell` = 0 命中**；DOM 只碰自有的 `#dsh-writing-mode-float` 与自有 `data-wm-*`/`data-world-*` 钩子，**不刮内核私有 DOM、不用 hash 类名**。
  → 在官方壳上可用：相对路径 fetch 经转发器可达（Origin 是 `dsh-app://app`），Slots 一致，安装走插件管理器本地路径。
- **稿件数据安全**：writing-mode 自有状态在 `~/.dsh/writing-mode.json`、`~/.dsh/writing-mode/drafts`、`~/.dsh/.writing-mode/coordination`，
  官方桌面与 CLI **共享 `~/.dsh`**（仅 profile/包/激活/锁文件隔离），且官方 NSIS 卸载**绝不动 `~/.dsh`**。
  → 换壳不丢稿件；就算装错再卸也不丢。
- **`palis-theme-panel`**（独立仓库 v0.5.13）：不刮 DOM、不用 hash 类名；对壳只有一处**软依赖**
  （`src/client/index.ts:815-833` 特性探测读 `dshShell.status()/pluginsReport()` 显示版本对账，拿不到则留空）→ 不崩，只是少一块信息。
- **`dialog-optimize`**：不 import `dshShell`，但**重度依赖内核私有 DOM**（`[data-chat-flow-key]`、`[data-composer-seat]` 等
  + 4 个编译 hash 类名集中在 `client.js:426-431`）。→ 换壳不断，**换内核版本会断**，风险远高于壳。
  它同时用 `ctx.webServer.tapIndex()` 运行时改写内核 index HTML（`index.js:42-44,418`），属灰色用法。

### 4.2 会断的：全是"壳自己造的那条通路"

| 接缝 | 用途 | 换官方壳 |
|---|---|---|
| `--patch <yml>` 每次启动动态生成插件行（`main.js:462-516`） | 挂 `review-bridge` + 3 个内置插件 | **必断**（官方 `patchFiles: []`）→ 改为「装进 `profiles/desktop`」，可用本地绝对路径 spec 或写 profile 自身 `cordis.patch.yml`（但会被崩溃恢复流程改名） |
| `@dsh-local/*` 同步到 `$DSH_HOME/profiles/node_modules`（`main.js:418-435`） | 让裸包名可解析 | **需重做**：官方独占 `profiles/desktop` 且**启动从不跑 pnpm**；我们另外还直接读写 `profiles/web`（`main.js:743-745`），与官方 profile 不同名 |
| 首启种子 `resources/builtin-plugins` → `profiles/web`（`main.js:1362-1381`） | better-sidebar/dsh-pet/palis 开箱可用 | **必断** → 官方有插件管理页，不需要种子 |
| 写 profile `cordis.patch.yml` 的 `disabled:` 做插件启停（`main.js:901-978`） | 内核 Web UI 无启停 RPC 时补按钮 | **必断且已无必要**：官方管理页支持启停与运行时卸载 |
| 刮 stdout 认坏 bundle 三条正则（`main.js:756-766`） | 运行期防砖安全网 | **必断**（文案一改即失效）；官方崩溃恢复对话框承担了同一职责 |
| `window.dshShell` 桥 + `shell:*` 约 40 方法 6 事件（`preload.js:12-96`、`main.js:2485-2673`） | 审阅侧栏 / 设置四页签 | **必断**，官方不会暴露同名桥 |
| `shell-settings` 插件（client 223 行） | 内核设置里的"桌面外壳"页签 | **必断**——它的全部意义就是那个桥 |
| `review-bridge` + `userData/review-events.ndjson`（`main.js:479-481,523-528`） | 会话改动采集与按 callId 回退 | **必断**：插件本体不碰 `dshShell`，但它能跑起来完全依赖壳写 patch 行 + 壳读那份 NDJSON |
| 抓 stdout `dsh web: <url?token=…>` 拿一次性 token + cookie 换取舞步 + 就绪认 200/401/303（`main.js:1297-1335`） | 壳侧调内核 HTTP | **必断**（官方不打印该 URL，认证走 launch token → 持久签名 Cookie） |
| 运行时布局/目录字面量（`<runtime>/node_modules/@deepseek-ai/dsh/lib/bin.js`、`LOCALAPPDATA\...\runtime`、`dsh-desktop-updater`、`app.setAppUserModelId('com.deepseek.dshdesktop')`） | 解包/更新/任务栏分组 | **必断**（且 `dsh-desktop-updater` 这个名字在 4 个文件里交叉校验，由 `verify-release-artifacts.mjs` 把守） |
| 环境变量族 `DSH_DESKTOP_*` / `DSH_BUILTIN_*` / `DSH_WRITING_SRC` | 隔离实例、E2E 钩子 | 官方有对应物 `DSH_DESKTOP_USER_DATA_DIR` + 隔离开发 home（`README.zh.md:41`、`scripts/development-app.ts`）→ **不必自研** |
| writing-mode 直写 `~/.dsh/.agent-presets/writing-companion/*.yml` 后 `emit('settings/document-updated','agent-presets')`（`lib/store.js:53-66`、`index.js:299-306`） | 写作伙伴 Agent 预设 | 换壳**不断**（同一内核），**换内核版本会断** ← 这是目前唯一一处插件对内核磁盘布局的私有依赖，升级验收时必须列入探针 |
| 共存让位检测：`performance.getEntriesByType('resource')` 匹配 bundle id（`preload.js:603-627`） | 不与内核侧栏抢右缘 | **需重做**（判据依赖官方 `/plugins/<id>/client.js` 路径形态） |

### 4.3 一条需要纠正的自我认知

调研自研侧时确认：`window.__DSH_BOOT__` / `dsh.client` 行的解析**我们的壳完全不碰**，那是内核 `dsh-client-modules` 的职责，
壳只做「写 `--patch` 插件行 + 把包同步到可解析位置」。
→ 含义：我们既没有绕过内核契约，也没有改内核编译产物（**全仓无一处替换上游 bundle 或改 hash 类名**）；
壳层的全部耦合集中在 §4.2 那张表上，是可以逐项拆的。

---

## 5. 官方安装包是否对外发布 —— **是（更正此前判断）**

- **CI 完全不构建桌面端**：`.github/workflows/*.yml` 中 `desktop`/`electron` 0 命中，`release*.yml` 只 pack/publish npm tarball；
  `.gitlab-ci.yml` 只构建 Python runtime wheel。打包与版本号确认是**人工驱动**（`README.zh.md:157-160`）。
- 产物上传到**腾讯云 COS**：生产 origin 固定 `https://download.deepseek.com`，清单 `dsh-desk/feeds/<target>/`、
  安装包 `dsh-desk/bin/<target>/`，凭据来自 `DOWNLOAD_PROD_COS_*`；测试环境 `download-test.deepseek.com` + 32 位 release id。
  (`apps/desktop/scripts/desktop-auto-update-environment.mjs:9-24,128-156`、`README.zh.md:236-243`)
- **本会话实网验证（2026-09-25）**：
  - `GET https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` → 200，`version: 0.1.7-rc.2`，
    `deepseek-harness-0.1.7-rc.2-win-x64.exe`，288,245,480 B，`releaseDate: 2026-09-24T14:11:01Z`
  - 该 exe `HEAD` → **200 OK，Server: tencent-cos，Content-Length 与清单一致**
  - `mac-arm64/nightly-mac.yml` → 200，zip 372,794,444 B
- **但仓库内没有任何面向用户的下载入口**：`README.zh.md`「运行」只写 `npx @deepseek-ai/dsh web`；
  `docs/user/**` 无"桌面"字样；GitHub Release 附件数 0；官网页面（WebFetch）也无桌面下载。
  `download.deepseek.com/` 根路径返回一个 2.2KB 的 "DeepSeek App" JS 页面，**未查到其中是否有桌面卡片**。
- 更新通道字面量是 `channel: 'nightly'`，且存在**内测包需飞书登录**的强更分支
  （`mandatory-update-policy.ts`）。→ 推断：桌面端处于「公开可下但灰度/半保密」状态，而非 GA。

---

## 6. 官方对"第三种壳"的态度

- 无 CHANGELOG（全仓无 `CHANGELOG*`）；对 `marketplace|插件市场|第三方桌面` 的 grep 为空 → **没有任何明面上的排他条款**（未查到）。
- 但架构姿态是收敛排他的（推断）：渲染进程拿不到 fs/原始 IPC/shell/任意 pnpm 参数；
  "Electron 不提供插件管理 IPC 或独立管理页面"；产品页"不能选择安装产物或授权安装"；
  桌面与内核**强制同版本**；导入解析不了就打包失败。
  → 官方把"壳"收敛为**唯一签名产物 + 私有 desktop-host**，扩展面只留给插件。

---

## 7. 待实测确认（本次调研无法判定，必须跑起来）

1. **官方壳上我们的插件能不能挂上**：通过插件管理器的**本地绝对路径**安装 `writing-mode`，
   验证 4 个 Slots 是否照挂、`/api/writing-mode` 相对路径 fetch 是否通、`~/.dsh` 里既有稿件是否可见、
   `trustedRequest()` 的回环判定在 Electron 转发链路下是否仍成立（**风险点：转发后 `remoteAddress` 会不会变成别的**）。
2. **PALIS 面板**能否装、`/api/palis-theme` 契约路由与外壳皮肤联动会怎样（那条联动是我们壳消费的，官方壳不会有）。
3. **官方 Web UI 自带的会话改动审阅** 与我们注入侧栏 + Git 闭环的**实际差距**有多大。
4. 官方 README 已知限制里"账号登录尚未接入（Sign in 禁用）"这一条 —— 与它同时存在的又有 PKCE 登录实现，
   **两处证据冲突，未证实**，需要实机看。
5. macOS 包只带 `allow-jit` entitlement，插件 Node 半边若自行监听端口是否可行 —— 官方侧结论为**推断**，需实机。

---

## 8. 建议路线（未执行，等用户拍板）

**主线：弃壳保插件。** 把工程重心从「维护一个壳」转向「在官方壳上把写作工作台跑顺」。

理由：
1. §4.1——差异化资产本身零壳依赖，搬得动。
2. §3.2——壳的剩余增量只有 5 项，全是边角（全局热键、开机自启、任务完成通知、多会话并行窗口、启动画面质感），
   其中只有「任务完成通知」像产品需求，而这一项不值得整套签名/公证/双平台打包/更新链/崩溃恢复的长期税。
   更要紧的是：**原来最像差异化那一项（外壳审阅侧栏）已由用户本日主动移除**，理由是内核插件版效果更好
   （`logs/2026-09-25.md`）。这等于一次自我对照实验：壳层注入打不过插件层。
3. §3.3——跟官方内核 lockstep 的成本由我们自己付了 43 个版本；官方桌面端 17 天 ≥100 次提交，追平只是时间问题。
4. §6——官方扩展面只留给插件，继续在壳层打补丁是逆着官方架构走。

保留项：`writing-mode`、`palis-theme-panel`（去掉 `dshShell` 软依赖）、以及 §7 里实测后确认官方没有的那部分审阅能力。
归档候选：`shell-settings`、`review-bridge`（除非实测证明官方审阅补不上）、外壳的坏 bundle 隔离链与自研更新链。

执行第一步是 §7.1 的实机实验，**代价约 30 分钟**，产出"能挂/不能挂 + 哪几条断"。
安装包 288MB、要往本机写东西，**必须先拿到用户同意**，且用隔离 home，不动现有安装。

---

## 9. 现场状态记录（写这份报告时观察到的）

- HEAD 已推进到 `4cb99d3`（2026-09-25 15:35），v0.1.43 今日发布并设为 Latest，五件资产齐（见 `logs/2026-09-25.md`）。
- 工作树**有另一路正在进行的改动未提交**：`main.js`、`preload.js`、`package.json`、`lib/hotkey.test.js` 为 M，
  且 `review-ui-check.js`、`sidebar-test.js`、`sidebar-layout-test.js`、`sidebar-skin-check.js` 处于删除状态。
  已核对：这不是失控改动，而是 `logs/2026-09-25.md` 最后一条〔移除外壳审阅侧栏 UI（改用 dsh-better-sidebar）〕
  记录的用户决定 —— 外壳自带审阅侧栏效果不如内核插件 better-sidebar，故移除界面层（preload 1591 → 335 行），
  保留 `review-bridge` 插件、NDJSON 流（供"运行中"提示）与回退端点。同一轮还修好了 better-sidebar/palis/dsh-pet
  在 profile `node_modules` 里悬空缺失导致真包从未落地的问题。本报告未触碰这些文件。
- 这条决定本身是 §8 结论的**直接证据**：连我们壳层最强对标点，也被用户判给了插件层。
- 本机 4 个 `DeepSeek Harness Desktop` 进程（19:56 起）与预览实例 PID 49888 均未受影响。

---

— 调研与撰写：Qoder（ox-alpha 会话外的第三方视角）／证据基线 2026-09-25
