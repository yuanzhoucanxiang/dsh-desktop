# 外壳本体（Electron 桌面版）漏洞 hunt 与修复 · S1–S6（2026-09-21）

审查+修复：ox-alpha。基线 HEAD `6783647`（v0.1.41）+ 工作树里未提交的 D01–D04 与 V1–V9/G1–G4 修复。
范围：**外壳本体**（`main.js` / `preload.js` / `renderer/` / `lib/` / `plugin/review-bridge.js`），
不含 writing-mode 插件（那部分见 [`../../writing-hardening/2026-09-21/report.md`](../../writing-hardening/2026-09-21/report.md)）。

结论：**6 项缺陷全部实锤复现，6 项全部修复**；探针重跑 **0/6 复现**；
新增回归 `lib/shell-hardening.test.js` **39 项全过**；`npm run smoke`（隔离 userData）`SMOKE_OK` + `SMOKE_HANDOFF acked=true`；
**真包（dir 目标、装机版 exe）验收：字节核对 9/9、隔离冷启动与升级 12/12、真包验收 9/9、
S1 授权闸在装机版上实机验证 IPC_AUTHZ_OK**。
未提交、未推送、未发布、未替换正式安装、未关闭任何正在运行的窗口或预览。

- 复现取证：[`hunt-shell.mjs`](hunt-shell.mjs)（修复后重跑应全部 NOT_REPRODUCED）
- 永久正向门禁：`lib/shell-hardening.test.js`（`npm run shell-hardening-test`）
- 装机版授权闸实机探针：[`verify-ipc-authz.mjs`](verify-ipc-authz.mjs)（可重复跑，`--exe` 指向解包目录）

## 一、威胁模型：为什么"内核页面能调 IPC"是要紧的

`preload.js` 用 `contextBridge.exposeInMainWorld('dshShell', {...})` **无条件**暴露一份全量桥，
凡是带这个 preload 的窗口（内核页 / 设置 / 启动画面 / 预览）拿到的能力完全相同。
而主窗口承载的是内核页面，**其主世界里跑着第三方插件的 client 代码**——本项目内置就注入了
`dsh-better-sidebar`、`dsh-pet`、`@dsh-local/palis-theme-panel`。

外壳自己早就把这个定为威胁模型并逐个收口过，源码注释是原话：

- `shell:open-file`：「openPath 会按系统关联直接执行 .bat/.cmd/.exe/.js 等——工作区内放一个恶意脚本，
  任何插件 JS 调 openFile 即可触发执行」→ 已改 `showItemInFolder`（不给执行面）
- `shell:quit` / `shell:restart-kernel`：「内核页面主世界的任何插件 JS 都能调这两个 IPC（preload 同权）。
  无确认等于让 XSS/恶意插件一键杀掉用户正在用的会话——必须过原生确认框」
- `shell:revert` / `git-stage` / `git-unstage` / `git-revert-hunk`：一律过 `workspacePath()`（realpath + 越界拒绝）

**本轮找到的就是那次收口漏掉的口子**：同一个桥里还留着一个既不需确认、也不做发送方区分，
却能让主进程 `spawn(任意命令串, { shell: true })` 的入口。

> 边界说明：威胁主体是 **client 侧插件**（跑在沙箱渲染进程、无 Node）与内核页面 XSS。
> host 侧插件（cordis 的 `index.js`）本来就在内核 Node 进程里、自带 `child_process`，不靠这条路径，
> 所以 S1/S4 都**不是**权限提升；但 S1 让"只有页面脚本能力"的攻击者拿到了本机命令执行，这是实打实的越权。

## 二、缺陷与修复

| 编号 | 级别 | 触发 / 影响 | 根因与定位 | 修复 |
|---|---|---|---|---|
| **S1** | **P1** | 内核页面里任意 client 插件 JS（或一处 XSS）调 `dshShell.notifyCommand('…')` + `notifyCommandTest()` ⇒ 主进程立即 `spawn(命令串, {shell:true, detached:true})`，**零确认、零发送方校验**；且写进 `settings.json` 后**每个回合结束都重放**。等于把 sandbox + contextIsolation 直接穿透成本机命令执行 | `main.js` 的 `shell:notify-command` / `-test` 两个 handler 既不弹确认也不看发送方；`preload.js` 无条件暴露；`runNotifyHook` 用 `shell:true` 执行 | ① 新增 `isSettingsSender(event)`（`BrowserWindow.fromWebContents(event.sender) === settingsWin`），读写与试跑**三个通道全部**按发送方窗口授权，非设置窗口一律拒绝并记日志；② 命令**变更**时过原生确认框，正文原样展示要执行的命令串，取消则回显仍生效的那一份；③ 每次变更写审计日志。授权放在主进程（渲染侧 `window.confirm` 可被页面改写，不算数） |
| **S2** | P2 | `shell:plugins-restore` 在隔离列表非空时会 `restoreQuarantinedBundles()` → `restartKernel()`，**不需要任何确认**；而 `shell:restart-kernel` 明文要求确认。两道门只锁一道等于没锁：内核页面任意插件 JS 可绕过确认中断用户正在用的会话，并顺手把"之前因把内核搞崩而被自动隔离"的插件重新启用 | `main.js:2220` handler 无 `confirm`；`main.js:847` `if (restored > 0) restartKernel()` | 补原生确认框（与 restart-kernel 同一分寸：`defaultId`/`cancelId` 都指向"取消"），文案点明会重启内核、会重新启用哪些插件、以及它们当初为什么被隔离。同时**移除** `renderer/settings.js` 里那个渲染侧 `window.confirm`（可被页面脚本改写，且会与原生框叠成两次询问），并让 UI 区分"已取消"与"失败" |
| **S3** | P2 | `{cwd}`/`{workspace}` 直接裸拼进 `shell:true` 的命令串。工作区路径里的 `& \| > < ^ "` 被 cmd.exe 当命令分隔符——**实测**工作区名为 `ws & node s3-payload.js` 时，钩子命令 `echo hook {cwd}` 真的执行了 `&` 后面的载荷（生成 marker 文件）。既是安全问题（路径可由「设置工作目录」选定，也可来自 `DSH_DESKTOP_CWD`），也是正确性问题（含 `&` 的合法路径会让钩子静默跑错命令） | `main.js` `runNotifyHook` 用 `replaceAll` 直接插入未加引号的路径 | 抽出零依赖可单测的 **`lib/shell-quote.js`**：`shellQuotePath()` 按平台加引号（win32 → 双引号 + `""` 逸出；POSIX → 单引号 + `'\''` 逸出），`expandNotifyCommand()` 统一替换并把 `{files}` 强制成整数（它本来是计数，不该成为注入面）。**只含安全字符时原样返回**，保证既有钩子命令逐字节不变、不引入回归 |
| **S4** | P3 | `setEntryDisabled` 把 entry id **原样插值**进 `- id: ${id}`。id 来自插件自己的 `dsh.bundle.patch`（`entryIdsFromBundlePatch` 只做去引号）。实测一个含换行的 id 能把 `- id: hijacked` + `name: '@attacker/pkg'` 这样的**额外补丁条目**写进 profile 的 `cordis.patch.yml`——而这份文件决定内核加载什么；另一种 payload 能写出解析器不认的形状，把整个插件开关功能锁死（正好绕过本模块开头承诺的「解析不了的文件一律拒绝写入」） | `lib/plugin-manager.js` `setEntryDisabled` 无 id 校验 | 加 `SAFE_ENTRY_ID = /^[A-Za-z0-9_@./:+-]+$/` 白名单，不符即拒写并返回可读错误（含被拒的 id 片段），**绝不猜**。已验证不误伤真实形态：`dsh-better-sidebar`、`@dsh-local/palis-theme-panel`、`review-bridge`、`a.b-c_d:e/f` 均照常切换 |
| **S5** | P3 | `/api/review-bridge/revert` 用 `for await` 无上限收集全部 chunk，本机任意进程/浏览器标签页 POST 一个巨体就能把内核进程内存撑爆。同仓库的 writing-mode 早已限 1 MiB —— 自家两处口径不一致 | `plugin/review-bridge.js` handler 缺体积闸（回环闸是有的，且挡不住本机调用方） | 补 `MAX_BODY_BYTES = 1 MiB`，边收边计，超限立即 **413 `body-too-large`** 并停止收集。回环闸保留（上限不替代它） |
| **S6** | P2 | 审阅侧栏的数据源 `review-events.ndjson` 里，每条 write 的 `tool-call` 都带 `new: <整个文件内容>`，会话期间单调增长（只在内核启动时清一次）。`readSessionChanges()` 每次刷新都整份 `readFileSync` + 逐行 `JSON.parse` + **全量过 IPC**。实测 20 次 400KB 写入 = 7.8MB 流、每次刷新搬 7.8MB（主进程与渲染侧双份内存）；长会话 + 大文件的 agent 工作能把面板拖到卡顿乃至 OOM | `main.js` `readSessionChanges` 无任何上限/分页/截断 | 抽出零依赖可单测的 **`lib/ndjson-tail.js`**：`readNdjsonTail(file, {maxBytes:4MiB, maxEntries:2000})` 只读尾部、丢掉起读处的残行（顺带避免把多字节字符切半）、返回 `truncated`/`streamBytes`/`readBytes`。**尾部截断是安全的**：逐条回退不依赖这份流（bridge 用自己内存里的 session events 按 callId 查），流只用于展示，而展示关心的恰恰是最近的改动。侧栏在截断时用 `textContent` 如实告知（含全量体积），并指路 Git 工作区视图看全量 |

## 三、验收

```
npm run shell-hardening-test   →  SHELL_HARDENING_OK（39 项，exit 0）
node docs/audits/shell-hardening/2026-09-21/hunt-shell.mjs  →  复现 0 / 6
npm run smoke -- --user-data-dir=%TEMP%\dsh-smoke-shell-hardening
                               →  SMOKE_HANDOFF acked=true / SMOKE_OK url=http://127.0.0.1:3960（exit 0）
```

### 真包（装机版）验收 —— 按 AGENTS.md「涉及打包分支的改动必须实测打包版」

构建：`WM_OUT=%TEMP%\dsh-pkg-verify-0.1.41-hardening node scripts/rebuild-package-tmp.mjs`
（dir 目标、离线用本地 electron dist、不签名不发布、**输出在工作区外**）→ `BUILD_OK`。

| 验收 | 结果 |
|---|---|
| `verify-writing-package.mjs --package <win-unpacked>` | **9/9 通过**：app.asar 内 11 个主进程本地模块齐全（含新增的 `lib/shell-quote.js` / `lib/ndjson-tail.js`）、与仓库**逐字节一致**、无仓库路径引用（A02）、extraResources 完整、manifest↔产物 19 文件一致 |
| `verify-writing-coldstart.mjs all` | **12/12 通过**：空环境冷启动、profile 逐文件哈希一致、不多发测试/源码、受管记录落盘、包内 14 个 JS 逐个 `node --check`、旧环境升级不清空不重建、**旧数据可发现/可读/可继续保存（revision 4→5）**、无法证明归属的旧文件只上报不删、设置与备忘字节不变、坏 JSON 备忘诊断且原件保留 |
| `WM_PKG=<…> verify-writing-packaged.mjs` | **9/9 通过**：真包空环境启动到就绪 `SMOKE_OK`（即 `app.isPackaged` 分支）、自动同步的 profile 19 文件哈希一致、首启种子（内置插件 + palis 主题）、主题开启/恢复两次 `UI_SMOKE_OK`、**清理只按本轮 PID**。被测身份已记录：源码 `6783647 (dirty)` · asar `a59c3550c8870d0e…` |
| `verify-ipc-authz.mjs --exe <装机版 exe>` | **IPC_AUTHZ_OK，0 项失败**（见下） |

### S1 授权闸的实机验证（新增探针 `verify-ipc-authz.mjs`）

在**装机版 exe** 上真拉起外壳（`DSH_DESKTOP_HOME` / `DSH_DESKTOP_USER_DATA` / `DSH_HOME` / `DSH_DESKTOP_CWD` 全部隔离到 %TEMP%），
用 `--remote-debugging-port` 连 CDP，在**真实内核页面**（`http://127.0.0.1:7405/`，也就是第三方插件 client 代码所在的主世界）里求值：

```
PASS 前置：页面里 dshShell.notifyCommand 存在（桥确实暴露给了内核页面）  [function]
PASS 前置：同一窗口调 status() 正常（说明拒绝是针对通道，不是桥整体失效）  [true]
PASS S1 非设置窗口写 notifyCommand 被拒   [{"ok":false,"error":"only-settings-window"}]
PASS S1 非设置窗口触发 notifyCommandTest 被拒  [{"ok":false,"error":"only-settings-window"}]
PASS S1 settings.json 里的命令一字未改（没有被注入）  [before="" after=""]
PASS S2 pluginsRestore 在无隔离记录时安全返回  [{"ok":true,"restored":0}]
PASS 清理：只结束本轮 spawn 的 PID 树  [pid=73660 alive=false]
```

两条**前置**断言是防假通过的关键：先证明桥真的在页面上可用、且同一窗口的其他通道正常，
才能把「被拒」归因于授权闸而不是桥整体没加载。清理走 `lib/pid-cleanup.js`（只按本轮 PID，绝不扫同名进程）。

受影响的既有回归全部重跑通过：

| 套件 | 结果 |
|---|---|
| `plugin-manager-test` | 19 tests passed（S4 白名单未误伤既有行为） |
| `git-review-test` | GIT_REVIEW_OK |
| `review-ui-check` | REVIEW_UI_OK（改了 preload.js 侧栏渲染，必须复跑） |
| `sidebar-skin-check` | SIDEBAR_SKIN_OK |
| `splash-check` | exit 0 |
| `atomic-file-test` / `profile-inspect-test` / `pid-cleanup-test` / `plugin-sync-test` / `selector-check` | 全部 exit 0 |

S3 的关键取证（真跑 shell，不是只看字符串）：

```
工作区路径 = ...\ws & node s3-payload.js
旧写法（裸拼）    = echo hook ...\ws & node s3-payload.js      → 载荷被执行，生成 S3_PWNED
expandNotifyCommand = echo hook "...\ws & node s3-payload.js"  → 载荷未执行，marker 不存在
安全路径回归       = echo C:\Users\me\dsh-workspace            → 与旧写法逐字节一致
```

## 四、查过但判定干净的（避免误伤，也说明覆盖面）

- **`preload.js` 注入 UI 无 XSS 面**：侧栏与断连浮层全部 `createElement` + `textContent`，源码注释明写「无 innerHTML」；
  2026-08-31 那次已修掉唯一一处把不可信输入喂给 `href` 的坑（恶意 README 的 `javascript:` 链接），现在只放行 http/https/mailto。
- **`renderer/settings.js` 的 innerHTML 全部过了 `esc()`**（插件名/版本/registry 返回值/更新说明/隔离原因逐个核过），无遗漏插值。
- **`renderer/splash.js` 的 innerHTML 只拼常量与数字**（`BOOT_ROWS` + 进度格），不含任何外部输入。
- **`workspacePath()` 收口到位**：`path.resolve` + `realpathSync`（跟 symlink/junction，防"工作区内一个指向 ~/.ssh 的链接"）+ 越界返 null；
  `revert` / `git-stage` / `git-unstage` / `git-revert-hunk` / `open-file` / `read-file` 全部经过它。
- **`read-file` 有边界与上限**：工作区内、512KB 截断、目录拒绝、NUL 字节判二进制拒绝。
- **`togglePluginDisabled` 已收口**：`key` 必须命中 profile manifest 的 `dependencies` 白名单（源码注释明写这是防 `../x` 路径穿越），
  entryIds 从插件自己的 bundle patch 解析，**不是**渲染侧可控——所以 S4 不是权限提升，只是该守的输入校验。
- **`lib/plugin-sync.js` 的删除逻辑很稳**：只删"上一版受管 且 sha256 未变 且 realpath 在根内"的文件，
  受管记录指向 profile 之外一律拒删并上报；既不在发布集合也不在受管清单的文件只上报不动。
- **`review-bridge.js` 主体收口到位**：回环闸（并明写"Host 头可伪造，以 socket 对端为准"）、`withinCwd` 路径闸、
  会话运行中禁止回退、精确匹配才改写、`Buffer.concat` 后一次解码（**正是 writing-mode 那边 V1 写错的正确写法**）。
- **`ensureExternalRuntime` 的解包与原子交换**：解压不完整绝不碰现有运行时、交换失败自动回滚备份、
  EPERM/EBUSY 时降级沿用现有运行时照常启动。
- **`hardenWindow`**：`setWindowOpenHandler` 一律 deny + 外链交系统浏览器；`will-navigate` 只放行内核页同源
  （`file://` 不再无条件放行，注释明写否则带 dshShell 的 preload 会跟着导航落到任意页面）。

## 五、残留局限（不冒充已解决）

1. **dshShell 桥仍是"一份全量、所有窗口同权"**。本轮是按通道做发送方授权（只收紧了 notify-command 这一族），
   没有重构桥本身。更彻底的做法是把桥按窗口角色分层（内核页只拿审阅相关能力，设置窗口才拿设置能力），
   那是一次涉及 preload + 所有消费方的重构，本轮没做。
2. **`shell:get-state` 仍返回 `notifyCommand`** 给所有窗口（含内核页面）。这是读，不是写，
   泄露的是用户自己配的命令串；且外部主题面板可能消费该状态，贸然删字段有回归风险，故本轮保留。
   写入与执行已被 S1 完全收紧，读到的值无法被用来改命令。
3. **S3 的引号是按平台规则做的静态转义，不是"不用 shell"**。真正消灭这一类问题的做法是改成
   `spawn(file, args, { shell: false })` + 让用户配"程序 + 参数数组"，但那会破坏现有钩子命令的写法
   （用户依赖 shell 的管道/重定向能力），属于产品决策，本轮不做。
4. **S6 的上限是字节 + 条数双闸（4 MiB / 2000 条）**，取值来自"够展示最近改动、又不至于把上百 MB 搬过 IPC"的权衡，
   没有做成可配置项。若将来有人需要看全量会话改动，正确出口是 Git 工作区视图（侧栏提示里已指路）。
5. **两个原生确认框仍未人工目检**（S1 保存钩子命令 / S2 恢复被隔离插件）。它们是原生模态框，探针点不了；
   安全属性（非设置窗口被拒 + settings.json 不变）已在**装机版**上自动验过（见 §三）。
   曾拉起可见隔离实例（PID 77680）交作者目检，该实例已关闭；从其日志可额外确认两件事：
   ① **装机版的正常（非 --smoke）启动路径也通**：内核 21:25:03 就绪、首启种子完成、内置插件重载后二次就绪；
   ② `writing-mode synced … [manifest] +19 ~0 -0` —— 新增的 `lib/project-identity.js` 已随 19 文件发布集合在装机版里端到端同步到位。
   同时观察到：全局热键 `Control+Alt+D` 被占而拒绝（无害，已有降级）；`autoUpdater` 因无网络报
   `net::ERR_CONNECTION_CLOSED` 并按 8s/30s/120s 退避重试（设计行为）；首启时 `plugin inspect: 无法读取 profile 清单` 属空环境正常现象。
   注：装机版的内核运行时目录（`%LOCALAPPDATA%\DeepSeek Harness Desktop\runtime`）**不按 userData 隔离**，
   本次因 marker 匹配而未重写它（`ensureExternalRuntime` 提前返回），但与已安装版共用同一份运行时这一点值得记住。
   目检两个确认框需重新拉起实例，尚未完成。
6. **NSIS 安装向导/注册表、macOS 实机、受控离线、真实模型场景仍未验收**。本轮只做了 dir 目标真包（不签名、不发布），
   没跑 `npm run dist` 的 NSIS 步骤，也没生成新的 `latest.yml`。

## 六、本轮改动文件

新增：`lib/shell-quote.js`、`lib/ndjson-tail.js`、`lib/shell-hardening.test.js`、本目录 `hunt-shell.mjs` / `report.md`。

修改：`main.js`（isSettingsSender / notify-command 授权+确认 / plugins-restore 确认 / runNotifyHook 走 shell-quote /
readSessionChanges 走 ndjson-tail）、`preload.js`（侧栏截断如实告知）、`renderer/settings.js`（去掉可被改写的
渲染侧 confirm；区分"已取消"与"失败"；试跑前先落盘）、`lib/plugin-manager.js`（entry id 白名单）、
`plugin/review-bridge.js`（请求体上限 + 413；顺带把 `parseReadText` 的正则字面量改成 `String.raw` + `new RegExp`，
语义不变，避免编辑工具把 `\n` 转义展开成真实换行导致语法错）、`package.json`（新增 `shell-hardening-test`、
`plugin-manager-test` 两个入口）。

— 署名：ox-alpha
