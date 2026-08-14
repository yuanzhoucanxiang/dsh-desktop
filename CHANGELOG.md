# 变更历史（Changelog）

> 按版本号记录用户可见的变更。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，每条带署名。

## [0.1.9] - 2026-08-14

### 修复

- **侧边栏「修改审阅」点击无反应（0.1.8 引入的严重回归）**：preload 隔离世界里 `window.dshShell` 并不存在（`contextBridge.exposeInMainWorld` 只暴露给页面主世界），0.1.8 在侧边栏注入流程中途调用 `window.dshShell.getPanelWidth()` 抛异常，导致「修改审阅」标签的点击监听没挂上、面板完全打不开；0.1.7 起「打开/撤销/查看」按钮也有同样隐患 → 全部改回 preload 直连 `ipcRenderer.invoke`
- **新增 `--ui-smoke` 真实 UI 回归测试**：真实内核 + 真实窗口 + 真实 preload，自动验证侧边栏注入、标签开关、拖拽调宽与持久化、Git 视图、面板内查看器（Markdown h1/粗体渲染）、返回列表——13 项检查全过；`npm run ui-smoke` 可随时重跑，此类回归从此有测试兜底

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.8] - 2026-08-14

### 新增

- **侧边栏自由拖拽调宽（Codex 式）**：面板左缘新增拖拽把手，向左拖=加宽（320px ~ 800px，自动避让主窗口最小可用宽度），宽度持久化到 settings.json，重启后恢复
- **面板内文件查看器**：改动列表（会话改动 / Git 工作区两视图）每个文件行新增「查看」按钮——在面板内直接读取文件内容：
  - `.md`/`.markdown` 文件**渲染为 Markdown**（标题/列表/引用/代码块/行内代码/加粗斜体/链接，纯 DOM 构建无注入风险），类似 VSCode Markdown 预览
  - 其他文本文件以等宽纯文本展示
  - 上限 512KB（超限截断提示）、二进制文件拒绝并提示；顶部「⟵ 返回」回列表、「打开」跳系统编辑器
  - 查看器打开期间后台数据照常刷新、返回时看到最新列表

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.7] - 2026-08-14

### 改进

- **「会话改动」视图对齐 Codex（完整重做）**：
  - 按轮次分组，组头显示**你的提问文字**（审阅桥新增采集 `user/message`）+ 轮次 + 时间
  - 轮次内**按文件分组**（同一文件的多次改动收进一张文件卡，显示处数、可折叠）
  - 每条改动显示**完整 old→new 着色 diff**（超 12 行折叠、可展开全部），str_replace_editor 正确显示 old_str/new_str
  - **逐条撤销（Codex 式 Undo）**：每条改动一个「撤销」按钮，通过审阅桥新增的 `/api/review-bridge/revert` 端点做精确逆序回退——edit 按 new→old 反向替换（含 replace_all）、str_replace 反向替换、write 恢复写入前状态（从会话日志的完整 read/write 记录重建；Created file 则直接删除文件）；会话运行中拒绝撤销；失败给出明确原因
  - 撤销成功后该条从列表移除（写入 revert 事件流，刷新后保持一致）；操作反馈用 Toast
  - 两个视图的文件行都加「打开」按钮（顺带修复绝对路径被错误拼进工作目录的问题）
- 审阅桥同步采集 `tool/result`（识别 Created file / 失败调用）

### 修复

- `shell:open-file` 用 `path.join` 拼接导致绝对路径（`E:\…`）被拼进工作目录下 → 改 `path.resolve`

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.6] - 2026-08-14

### 新增

- **内置「对话框人性化优化」插件（dialog-optimize）**：随应用分发，启动时自动同步到内核可解析位置并注入补丁（内核零修改），无需任何手动安装：
  - **对话折叠**：Think/工具/命令等展开行吸顶；每条 AI 回复可「收起流程/展开流程」，折叠为最终输出并随滚动吸顶；运行中的块自动展开跟读、完成后自动收起
  - **对话导航**：对话左上角固定导航栏（序号+内容+时间，悬停看全文，滚动高亮跟随，可缩放/最小化）
  - **消息撤回**：悬停用户消息出现「↩ 撤回」——原地移除该消息及之后的对话（不新建会话、不污染模型上下文），自动逆序回退 AI 改过的文件（AI 新建的文件删除），输入框预填原文本供重发
- **启动降级三级保险**：内置插件或审阅桥任一导致内核启动失败时，自动逐级降级重试（全量 → 仅审阅桥 → 无补丁），应用本体永不因插件而启动失败；若用户自己的补丁层已挂载同名插件，则自动跳过内置行避免重复加载

### 修复

- **Windows 自动更新缺 `latest.yml`（检查更新报 404）**：build.ps1 用 `--publish never` 构建，导致更新清单 `latest.yml` 从不生成、未上传到 Release → electron-updater 检查更新报 `Cannot find latest.yml ... 404`。新增 `gen-update-manifest.js`（按 electron-builder 官方格式生成 base64 sha512 清单），build.ps1 构建时自动生成，release.ps1 上传命令补上该文件；v0.1.6 的 `latest.yml` 已补传

### 署名

- deepseek-v4-pro（2026-08-14）

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

## [0.1.5] - 2026-08-13

### 修复

- **长路径问题根治**：0.1.4 剪枝后安装目录仍有 7 个文件超 260（`@mistralai`/`@opentelemetry` 的深层 .js）→ 运行时改用 **hoisted npm 安装**（依赖平铺在 `node_modules/@deepseek-ai/*`，不再嵌套在 dsh/node_modules 下），路径 198–226（安装目录预计 ~232）、彻底低于 260；同时确认 `dsh-base`/`dsh-web-app` 传递依赖已覆盖全部运行时组件（CLI 的 devDeps 是冗余的），hoisted 安装完整可用；剪枝扩展 `.ts`；内核 + 审阅桥启动验证通过；安装包 159.5MB（更小）

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
