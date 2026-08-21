# DeepSeek Harness Desktop

DeepSeek Harness 的**桌面快捷启动外壳**：用 Electron 原生窗口承载 `dsh web` 内核。

> 设计原则：**内核零修改**。本外壳只负责拉起内核、展示启动画面、承载页面、退出收尾；
> 对 Harness 的配置、UI、代码不做任何改动。内核升级后外壳无需跟进。

## 工作方式

```
启动桌面版
   │
   ├─ 申请空闲端口（127.0.0.1，与浏览器版 3080 互不冲突）
   ├─ 拉起内核子进程：dsh web --port <端口>
   ├─ 深色启动画面（splash）显示实时状态与内核日志尾巴
   ├─ HTTP 就绪探测通过后，窗口切入内核页面
   └─ 退出时用 taskkill /T 收掉整个内核进程树
```

- **单实例**：重复启动只会聚焦已有窗口
- **托盘**：显示窗口 / 重启内核 / 设置工作目录 / 打开日志 / **皮肤（含启动画面预览）** / 回合完成通知 / 全局唤起热键 / 开机自启与"关闭到托盘"开关 / 退出
- **菜单与快捷键**：菜单栏默认隐藏（按 `Alt` 唤出），快捷键始终生效 —— 见下节
- **多窗口**：`Ctrl+Shift+N` 用同一个内核再开一个窗口，长任务并行不互相挡
- **回合完成通知**：仅在主窗口失焦时提醒，点击回到工作区并打开审阅面板
- **深链接**：`dsh://open` / `dsh://review` / `dsh://restart`（仅打包版注册协议）
- **关闭最小化到托盘**（默认开启）：点 × 隐藏到托盘而非退出，退出走托盘「退出」
- **记忆**：窗口位置/大小、工作目录（内核启动目录）跨启动持久化
- **开机自启**：托盘勾选后登录时自动启动
- **内核崩溃恢复**：页面右下角出现浮层，一键"重启内核"
- **外链接管**：内核页面里的外部链接一律交给系统浏览器
- **日志**：完整内核日志写入 `%APPDATA%\DeepSeek Harness Desktop\kernel.log`

## 使用

### 首次安装

```bat
npm install
```

> 国内网络下载 Electron 慢时，先设置镜像再安装：
> ```bat
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> npm install --registry=https://registry.npmmirror.com
> ```

### 运行

- **桌面快捷方式**「DeepSeek Harness」（已创建：指向 electron.exe + 自定义图标，双击无控制台窗口）
- 双击 `启动桌面版.cmd`（不残留控制台窗口），或
- `npm start`（调试时控制台会打印内核日志）
- `npm run dev`：额外支持 F12 打开开发者工具

> 图标：官方鲸鱼（取自 harness 前端 `favicon.svg`，矢量渲染，勿需外部素材）。
> 各版本分工：
> - **快捷方式/窗口/安装包**：黑鲸白色圆角底（`build/icon.png`）
> - **托盘**：黑鲸/白鲸透明底，随系统深浅色主题自动切换（`tray-whale-*.png`）
> - **启动画面**：白鲸透明底（`build/icon-whale-white.png`）直接落在深色场上 —— 不垫任何底板；
>   深海皮肤里外圈是进度光环，海景皮肤里它沉在海面之下（详见下节）
>
> 对比图见 `build/icon-variants.png`；源文件与渲染脚本：`build/whale-source.svg`、`render-whale.js`。

### 启动画面与皮肤（splash / theme）

托盘菜单 →「皮肤」里选，选完立即持久化；下次启动即用新皮肤，也可当场「预览启动画面…」。
三套皮肤共用同一套 DOM 与同一个进度数值，只是表达方式不同：

| 皮肤 | 取向 | 进度的表达 |
|---|---|---|
| **深海 · 单光环**（默认） | 深蓝夜场，一个焦点：柔光 + 白鲸 | 绕徽标的一道渐变弧 + 弧尖光点 |
| **海景 · Seascape** | 致敬杉本博司《海景》(1980– )：单色银盐、天海各半、无事件无时间 | **画面正中那条地平线**，从中心向两侧铺开 |
| **复古科幻档案终端 · PALIS** | 模拟恐怖 × 磁带未来主义 × SCP 档案局：黑白高反差、蓝/红双强调色、全等宽、直角、CRT 扫描线 | **档案窗框里的引导日志**，逐行输出 `[ MOUNT /dev/kernel ]` + 20 格行式进度 |

共同的设计底线：

- **一个焦点**：没有粒子/网格/光束等叠加装饰；海景里除地平线外只有两处极缓呼吸（水平线聚光 16s、长曝光的浪 48s）
- **进度不撒谎**：弧长/线宽/进度格由真实相位里程碑驱动（拉起 → 等待 → 就绪），里程碑之间渐近爬升；
  **单调递增、永不回退**（迟到的旧状态也拉不回去），失败时就地冻结而不是假装跑完
- **一行状态文案**：不用"胶囊 + 进度条 + 三步点"重复表达同一件事；日志尾巴只在出错时出现
- **淡出交接**：就绪后整幕淡出再切入内核页面（主进程 `shell:splash-exit` ↔ 渲染侧 ack），
  窗口背景色与启动画面同色，衔接处是无缝黑场；并保证最短展示 1.25s、就绪后停顿 0.42s，
  内核秒起也不会把开场动画剪断
- `prefers-reduced-motion: reduce` 下全部动画自动关闭

> **皮肤只作用于外壳自己拥有的界面**（启动画面、窗口底色、预览窗口、注入的审阅侧边栏与
> 断连浮层）。内核对话区（消息气泡、输入框）是内核页面的 DOM，外壳不注入样式 ——
> 生态调研（`docs/dsh-ecosystem.md` §4）明确官方扩展点是 Slots、禁止硬编码私有选择器。
> 想把 [USER]/[PALIS CLERK] 气泡做进对话区，正确路径是内核侧主题插件，参考 CSS 与
> 完整设计文档见 [`docs/palis-theme.md`](docs/palis-theme.md)。

三套皮肤的概念约束都写进了回归测试（`splash-check.js`）：海景守"地平线居中 ±1px / 天海等高 /
画面近乎单色"，PALIS 守"直角（radius=0）/ 全等宽 / 引导日志随相位推进 / 错误态 ABORT 且
进度停在 100% 以下"，改样式时不会悄悄跑偏。

调试与回归（都不碰正在运行的桌面版、不拉内核）：

```bat
npm run splash-preview                        :: 真实窗口里循环播放整段启动动画（deep）
npm run splash-preview -- --theme=seascape    :: 预览海景皮肤
npm run splash-preview -- --theme=palis       :: 预览 PALIS 档案终端
npm run splash-preview -- --error             :: 末尾演示错误态（可点"重新启动"看恢复流程）
npm run splash-check                          :: 三套皮肤的布局/进度/概念/像素/握手回归，231 项断言
npm run splash-shot -- --states               :: 每套皮肤三张截图 → build/splash-preview-<theme>[-ready|-error].png
```

### 快捷键与菜单

菜单栏默认隐藏（`autoHideMenuBar`，按 `Alt` 唤出），**但所有快捷键始终生效**。
约定：**命令进菜单，设置留托盘**。完整列表也可在应用内按 `Ctrl+/` 查看。

| 快捷键 | 作用 |
|---|---|
| `Ctrl+Shift+B` | 切换「修改审阅」侧边栏 |
| `Ctrl+Shift+N` | 新窗口（同一内核，多会话并行） |
| `Ctrl+Shift+K` | 重启内核 |
| `Ctrl+Shift+O` | 设置工作目录… |
| `Ctrl+R` / `Ctrl+Shift+F5` | 重载 / 强制重载页面 |
| `Ctrl+0` / `Ctrl+=` / `Ctrl+-` | 缩放复位 / 放大 / 缩小 |
| `F11` | 全屏 |
| `Ctrl+/` | 快捷键一览 |
| `Ctrl+Alt+D` | **全局**唤起/收起主窗口（任何应用里都能按，可在托盘关闭） |
| `Alt` | 临时显示菜单栏 |

> 排后续功能优先级前，先读 [`docs/codex-benchmark.md`](docs/codex-benchmark.md)：那是一份 Codex 全表面 UX 基准表
> （22 行、P0/P1/P2 分级），并明确标出哪些能力**不改内核就做不到**（沙箱/审批、plan mode、模型切换、
> `@` 提及、斜杠命令、AGENTS.md、MCP、session resume），避免在外壳层做无用功。

### 修改审阅（信任闭环）

右侧「修改审阅」面板（`Ctrl+Shift+B`）有两个视图：

- **会话改动**：本次会话 agent 改了什么，按轮次分组，可**逐条精确撤销**（数据来自内置审阅桥插件）
- **Git 工作区**：未提交改动，按文件列出，展开后**按 hunk 分档**：
  - 「已暂存 · N 块（提交时会带上）」→ 每块可**取消暂存这块**
  - 「未暂存 · N 块」→ 每块可**暂存这块** / **丢弃这块**
  - 文件级还有 **暂存 / 取消暂存 / 还原**
  - 底部提交条：写信息 → **提交**（只提交已暂存内容）→ **推送**
- **分寸**：可逆操作（暂存/取消暂存）直接执行；**丢弃**与**推送**会弹原生确认框；空暂存区/空提交信息会被拒绝
- **逐块补丁是"现读现切"的**：渲染侧只说「哪个文件、第几块」，补丁由主进程重新从 `git diff` 切出，
  文件已变脏时会干净失败而不是打错位置

> **与内核侧右侧栏共存**：若检测到内核已装右侧栏类插件（如 `dsh-better-sidebar`、`dsh-workbench`、
> `dsh-web-shell`），面板自动进入**共存模式** —— 隐藏自己的竖条、不再挤压页面（改为浮层），
> 入口只保留菜单与 `Ctrl+Shift+B`，不与它抢屏幕右缘。判据用插件 bundle 的网络请求 id，不刮 DOM。

```bat
npm run git-review-test   :: git 层单测（真仓库真 git，33 项，秒级，不用 Electron）
npm run review-ui-check   :: 面板 UI 回归（逐块暂存/分档/提交/共存让位，17 项）
npm run selector-check    :: 内置插件依赖的内核私有选择器是否还在（已挂进 npm run dist 门禁）
```

### 打包安装包（NSIS，自包含）

```bat
npm run prepare:runtime   # 准备自包含内核运行时（拷贝全局 dsh 树 + node.exe 到 runtime/）
npm run dist
```

- 自包含：安装包内置 dsh 内核 + Node 运行时，**目标机器无需装 Node / 全局 dsh**，装完即用
- 产物在 `dist/`（`Setup ... .exe` 安装程序），安装后开始菜单/桌面有「DeepSeek Harness」快捷方式
- 首次打包会下载 NSIS 打包器；国内网络先设：
  ```bat
  set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```

### 自动更新（GitHub Releases）

打包后的应用通过 electron-updater 检查 GitHub Releases 更新：

- 启动后 8 秒静默检查一次；托盘「检查更新…」手动检查
- 下载完成弹窗「立即重启安装」
- 更新源：默认 GitHub `yuanzhoucanxiang/dsh-desktop`；可覆盖（`settings.updateRepo` > `DSH_DESKTOP_UPDATE_REPO` > `settings.updateUrl`/`DSH_DESKTOP_UPDATE_URL`）
- 发布流程（手动）：
  1. 改 `package.json` 的 `version`
  2. `npm run release`（= 构建 + 打印上传命令）
  3. 把 `dist/` 的安装包 + `latest.yml` + `.blockmap` 上传到 GitHub Release（tag 形如 `v0.1.0`）；`release.ps1` 会打印现成的 `gh release create ...` 命令

## macOS 构建

外壳代码已平台中立。macOS 产物需**在 Mac 上构建**，一条命令出 dmg：

```bash
git clone git@github.com:yuanzhoucanxiang/dsh-desktop.git
cd dsh-desktop
bash build-macos.sh          # 准备运行时 → 装依赖 → 打 dmg，全自动
```

产物：`dist/dsh-desktop-0.1.0-mac.dmg`（双击 → 拖到「应用程序」即可用）。

要点：

- **electron-builder 的 `extraResources` 会跳过 `node_modules`**：`build-macos.sh` 已用「`--dir` 打包 → 手动补 `runtime/node_modules` → `--prepackaged` 做 dmg」绕过（与 Windows `build.ps1` 同思路）
- **签名/公证**：未签名 `.app` 会被 Gatekeeper 拦截——自己用可右键「打开」或 `xattr -cr /Applications/DeepSeek\ Harness\ Desktop.app` 放行；要发给别人或真正双击免打扰，需 Apple Developer 证书签名 + 公证
- **架构**：默认按当前 Mac 架构构建（Apple Silicon=arm64）；要同时支持两架构加 `--universal`
- **托盘图标**：macOS 惯例是 template 图标（黑+alpha 自动反色），当前用黑/白鲸按主题切换，可用但非原生观感
- **更新**：把 `dist/latest-mac.yml` + `.dmg` 一起发到 Releases，electron-updater 会自动按平台选

### macOS 安装 / 更新（给 Mac 上的 agent）

```bash
# 安装（首次）：下载指定版本 dmg 并装到 /Applications
bash update-macos.sh 0.1.1

# 更新到最新 Release：自动查最新版 → 下载 → 覆盖安装 → 启动
bash update-macos.sh
```

> 未签名版无法走 electron-updater 自动更新；`update-macos.sh` 提供等效的一键手动更新。
> 需 Mac 上已 `gh auth login`（私有仓库）。

## 可选环境开关

| 变量 | 作用 | 默认 |
|---|---|---|
| `DSH_LAUNCHER` | 内核入口 `bin.js` 的完整路径（覆盖内置运行时） | 自动解析：内置 runtime → 全局 |
| `DSH_DESKTOP_HOME` | 桌面实例专属 `DSH_HOME`（独立会话/配置） | 与 CLI 共享 `~/.dsh` |
| `DSH_DESKTOP_CWD` | 内核工作目录（优先于设置里的工作目录） | 用户主目录 |
| `DSH_DESKTOP_UPDATE_REPO` | GitHub 更新源 owner/repo | `yuanzhoucanxiang/dsh-desktop` |
| `DSH_DESKTOP_UPDATE_URL` | generic 更新源 URL（备选） | 无 |

## 冒烟测试

```bat
npm run smoke
```

流程：拉起内核 → 等 HTTP 就绪 → 二次探测 → 杀进程树 → 退出。成功打印
`SMOKE_HANDOFF acked=true` 与 `SMOKE_OK url=http://127.0.0.1:<port>` 且退出码为 0；
失败打印 `SMOKE_FAIL <原因>`。

> **已安装的桌面版正在运行时**，加一个独立 userData 再跑，避免撞单实例锁（会把用户窗口拉到前台）：
> ```bat
> npm run smoke -- --user-data-dir=%TEMP%\dsh-smoke
> ```
> 冒烟/UI 冒烟本身不会写开机自启（否则测试实例的默认设置会抹掉真实用户的自启项）。

## 目录结构

```
dsh-desktop/
├── main.js             # Electron 主进程：内核拉起/就绪探测/生命周期/托盘/启动画面交接
├── preload.js          # IPC 桥 + 内核断连浮层（仅异常时出现）
├── renderer/
│   ├── splash.html     # 启动画面（两套皮肤共用一套 DOM）
│   ├── splash.css      # deep（深海 · 单光环）+ seascape（海景 · Seascape）
│   └── splash.js       # 进度引擎（单调递增）+ 皮肤切换 + 淡出交接 + 预览模式
├── splash-preview.js   # 真实窗口预览启动动画（--theme= / --error / --check）
├── splash-check.js     # 启动画面回归（两套皮肤 · 布局/进度/概念/像素/握手，163 项断言）
├── splash-shot.js      # 启动画面截图（--states / --theme=）
├── build/              # 图标（icon.png / icon.ico / tray-whale-*.png / icon-whale-white.png）
├── 启动桌面版.cmd        # 双击启动入口
└── package.json        # npm run dist → NSIS 安装包
```

## 已知边界

- 内核本体由全局安装的 `@deepseek-ai/dsh` 提供；本外壳不捆绑、不修改它。
  如果全局 CLI 升级后行为变化，外壳会如实反映（这正是"内核不动"的代价与好处）。
- 默认与 CLI 共享 `DSH_HOME`，两边看到的会话/设置一致；如需完全隔离，
  设 `DSH_DESKTOP_HOME` 指向独立目录。
- 关闭窗口即退出应用（含内核）；托盘菜单可显式"重启内核"。
