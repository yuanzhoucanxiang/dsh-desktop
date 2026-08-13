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
