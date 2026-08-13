# 变更历史（Changelog）

> 按版本号记录用户可见的变更。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，每条带署名。

## [Unreleased]

参考对象：OpenAI Codex 桌面版（后台驻留/托盘、极简、跨平台）。

### 新增

- 外壳设置持久化（`%APPDATA%\DeepSeek Harness Desktop\settings.json`）
- 关闭窗口 → 最小化到托盘（可开关，默认开启；退出走托盘「退出」）
- 开机自启（托盘勾选，`app.setLoginItemSettings`）
- 记住窗口位置/大小（跨屏校验、防抖落盘、最大化状态记忆）
- 工作目录记忆：托盘「设置工作目录…」选目录并持久化，重启内核生效
- 托盘菜单扩充：工作目录、打开日志、开机自启/关闭到托盘开关
- 启动画面：四版鲸鱼按固定节奏循环轮换（与真实启动阶段解耦，快启动也能看清）；就绪显示内核启动耗时；失败界面加「复制日志」按钮
- 右侧「修改审阅」侧边栏（外壳级覆盖层，默认折叠，点右缘标签展开）：
  - 读工作目录的 `git status` / `git diff` 列出改动文件（改/增/删/重命名/未跟踪）
  - 点文件展开 diff（增/删行着色）；「还原」= `git restore`（未跟踪文件则删除），带确认
  - 需工作目录为 git 仓库（与 Codex 同假设）；非仓库给出提示
- 自包含打包（方案 B）：`prepare-runtime.ps1` 把全局 dsh 内核树（含嵌套依赖）+ node.exe 拷入 `runtime/`，经 electron-builder `extraResources` 打进安装包——装完即用，无需目标机装 Node/dsh
- 自动更新：electron-updater；托盘「检查更新…」、启动后 8s 静默检查、下载完弹窗重启安装；更新源默认 GitHub Releases（`yuanzhoucanxiang/dsh-desktop`，可用 `updateRepo`/`updateUrl`/环境变量覆盖），未配置时静默禁用；`release.ps1` 打印发版上传命令
- 平台中立化 + macOS 构建准备：`main.js` 按平台分支（node 二进制路径、`which`/`where`、进程组收尾、AppUserModelID 守卫）；新增 `prepare-runtime-macos.sh`、`build/icon-512.png`、`package.json` 的 `mac`(dmg) 配置
- 修改审阅侧边栏：非 git 仓库时提供「在此目录初始化 git 仓库」按钮（`git init`），点击即可开始审阅
- **审阅桥（会话级改动，Codex 式）**：新增 `plugin/review-bridge.js` 内核监听插件，经 `--patch` 注入桌面内核实例（内核源码零修改），订阅 `session/event` 实时采集 `edit`/`write`/`str_replace_editor` 工具调用（文件路径、old/new、轮次），写入 NDJSON 流；侧边栏新增「会话改动」视图（按轮次分组、写/改徽章、old→new 片段），与「Git 工作区」视图可切换

### 修复

- **打包版启动即崩（无窗口）**：`autoUpdater` 误从 Electron 内置模块导入，却按 `electron-updater` 的 `{provider:'github'|'generic'}` 格式调用，`setFeedURL` 抛 TypeError 打断启动链 → 改用 `require('electron-updater')`，并对 `setupAutoUpdater`/`checkForUpdates` 加 try/catch 兜底（v0.1.1，双平台）

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.4] - 2026-08-13

### 修复

- **升级卸载失败（`Failed to uninstall old application files: 2`）**：运行时树里有 36 个文件路径超 Windows 260 字符上限（最深的在 `@mistralai/mistralai` 的 `.d.ts.map`），NSIS 卸载器用经典 API 删除时报"找不到文件" → `prepare-runtime` 脚本剪掉 `.d.ts`/`.d.ts.map`/`.map`（开发期产物，运行时不需要），路径 269→228、超限 0 个、体积 339→280MB；剪枝后内核 + 审阅桥启动验证通过

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.3] - 2026-08-13

### 改进

- **侧边栏改为分割式布局**：打开时把内核页面向左挤开 360px（而非覆盖浮层），页面真实重排——与 Codex 分栏一致
- **侧边栏样式改用内核主题变量**（`--dsw-alias-*`）：背景/边框/文字/徽章/按钮全部跟随 DeepSeek Harness 自身明暗主题，不再是自定义深蓝
- 新增 `sidebar-layout-test.js` 布局回归测试

### 修复

- 分割挤压曾被 `transition` 干扰（computed 取到动画中间值）→ 去掉 body 过渡，改为直接内联 margin
- **自动更新下载失败**：两步构建法（`--dir`+`--prepackaged`）不生成 `app-update.yml`，electron-updater 检测到新版但下载阶段 ENOENT → 构建脚本显式生成 app-update.yml（Win `build.ps1` + mac `build-macos.sh`）

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.2] - 2026-08-13

### 新增

- **审阅桥（会话级改动）**：内核监听插件经 `--patch` 注入桌面实例（内核源码零修改），订阅 `session/event` 实时采集 `edit`/`write`/`str_replace_editor`（文件、old/new、轮次）→ NDJSON 流；侧边栏新增「会话改动」视图（按轮次分组、写/改徽章、old→new 片段），与「Git 工作区」可切换
- 审阅桥失败自动降级：内核升级若致插件加载失败，外壳自动去掉补丁重试一次，应用始终可用（审阅降级为仅 git 视图）

### 修复

- 打包构建失败：package.json 被 PowerShell 编码往返写坏（UTF-8 BOM + 中文乱码）→ 恢复并改用 node 改版本号

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.0] - 2026-08-13

首个可运行版本：内核零修改的 Electron 桌面外壳。

### 新增

- Electron 桌面外壳：自动拉起 `dsh web` 内核（随机空闲端口）、HTTP 就绪探测、退出 `taskkill /T` 收尾
- 深色启动画面：状态胶囊、流光进度条、内核日志尾巴、错误/重试界面
- 启动画面随启动阶段轮换四版官方鲸鱼图标（初始化→拉起内核→等待就绪→就绪）
- 单实例锁、托盘（显示/重启内核/退出）、内核崩溃恢复浮层、外链接管
- 托盘鲸鱼随系统深浅色主题自动切换黑白（`nativeTheme`）
- 桌面快捷方式「DeepSeek Harness」+ 双击启动入口 `启动桌面版.cmd`
- 官方鲸鱼图标四版（取自 harness 前端 `favicon.svg`，sharp 矢量渲染）
- 冒烟测试 `npm run smoke`、调试工具 `splash-shot.js`、图标生成器 `make-ico.js` / `render-whale.js`

### 修复

- 内核改用真实 `node.exe` 拉起（`ELECTRON_RUN_AS_NODE` 下 HMR 插件崩、内核静默退出）
- 批处理改 GBK 编码 + CRLF（原 UTF-8 在中文 cmd 下乱码）
- 批处理应用路径改 `"%~dp0."`（原 `"%~dp0"` 尾反斜杠导致引号转义、Electron 找不到应用）
- `icon.ico` 改为 DIB 多尺寸格式（原 `GetHicon()` 生成的文件损坏，Explorer 显示默认图标）

### 署名

- deepseek-v4-pro（2026-08-13）
