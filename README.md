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
- **托盘**：显示窗口 / 重启内核 / 设置工作目录 / 打开日志 / 开机自启与"关闭到托盘"开关 / 退出
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
> 四个版本全部上岗：
> - **快捷方式/窗口/安装包**：黑鲸白色圆角底（`build/icon.png`）
> - **托盘**：黑鲸/白鲸透明底，随系统深浅色主题自动切换（`tray-whale-*.png`）
> - **启动画面**：随启动阶段轮换四版鲸鱼——初始化=黑鲸透明底 → 拉起内核=白鲸深色圆角底
>   → 等待就绪=黑鲸白色圆角底 → 就绪=白鲸透明底（`renderer/splash.js` 的 `PHASE_MARK`）
>
> 对比图见 `build/icon-variants.png`；源文件与渲染脚本：`build/whale-source.svg`、`render-whale.js`。

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

外壳代码已平台中立（node 二进制/进程收尾/任务栏 ID 均按平台分支）。macOS 产物需**在 Mac 上构建**：

```bash
# 1. 准备 darwin 版自包含运行时（全局装 dsh + 拷贝 node 二进制到 runtime/）
bash prepare-runtime-macos.sh

# 2. 安装依赖（Electron darwin + electron-builder）
npm install

# 3. 打 dmg
npx electron-builder --mac dmg --dir      # 先看 win-unpacked 对应物 app 目录
npx electron-builder --mac dmg
```

要点：

- **electron-builder 的 `extraResources` 同样会跳过 `node_modules`**：mac 上也要像 Windows 一样「`--dir` 打包 → 手动补 `runtime/node_modules` → `--prepackaged` 做 dmg」（可参照 `build.ps1` 改写成 `build-macos.sh`）
- **签名/公证**：未签名的 `.app` 会被 Gatekeeper 拦截，需右键打开或 `xattr -cr`；正式分发要 Apple Developer 证书签名 + 公证
- **托盘图标**：macOS 惯例是 template 图标（黑 + alpha 自动反色），当前用黑/白鲸按主题切换，可用但非原生观感
- **更新**：发布到 Releases 时加 `latest-mac.yml` + `.dmg`，electron-updater 会自动选对应平台

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
`SMOKE_OK url=http://127.0.0.1:<port>` 且退出码为 0；失败打印 `SMOKE_FAIL <原因>`。

## 目录结构

```
dsh-desktop/
├── main.js             # Electron 主进程：内核拉起/就绪探测/生命周期/托盘
├── preload.js          # IPC 桥 + 内核断连浮层（仅异常时出现）
├── renderer/
│   ├── splash.html     # 启动画面
│   ├── splash.css
│   └── splash.js
├── build/              # 图标（icon.png / icon.ico / tray.png）
├── 启动桌面版.cmd        # 双击启动入口
└── package.json        # npm run dist → NSIS 安装包
```

## 已知边界

- 内核本体由全局安装的 `@deepseek-ai/dsh` 提供；本外壳不捆绑、不修改它。
  如果全局 CLI 升级后行为变化，外壳会如实反映（这正是"内核不动"的代价与好处）。
- 默认与 CLI 共享 `DSH_HOME`，两边看到的会话/设置一致；如需完全隔离，
  设 `DSH_DESKTOP_HOME` 指向独立目录。
- 关闭窗口即退出应用（含内核）；托盘菜单可显式"重启内核"。
