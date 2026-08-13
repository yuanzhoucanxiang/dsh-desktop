# 给协作 Agent 的约定（AGENTS.md）

进入本仓库工作的 agent / AI 助手 / 协作者，请先读本文件，并遵守以下约定。

## 1. 运行与测试（最重要）

- **不要擅自杀掉正在运行的进程**：桌面应用「DeepSeek Harness Desktop」可能正被用户使用。
  测试/冒烟前，**禁止**直接 `Stop-Process` / `taskkill` / `kill` 掉 `DeepSeek Harness Desktop`、`electron` 等进程——
  否则用户正在看的窗口会瞬间消失，被误认为「闪退」，造成困扰。
  - 确实需要清理残留进程才能测试时，**先向用户说明并征得同意**，或改用不打扰的方式（新端口起独立实例、窗口隐藏）。
- 冒烟测试统一用 `npm run smoke`（窗口隐藏、不弹窗、测完自动退出，exit 0 = 通过）。
- **涉及打包分支（`app.isPackaged` 为 true 的路径）的改动，必须实测打包版**，不能只测 dev 模式。
  历史教训：`autoUpdater` 导入错误导致打包版启动即崩、窗口永不显示，而 dev 模式根本不走那条分支，未暴露。

## 2. 记录与署名

- 每次改动：在 `logs/YYYY-MM-DD.md` 追加当日日志（做了什么 / 改了哪些文件 / 结果 / 坑），并同步 `CHANGELOG.md`。
- 每条记录末尾署名（agent 用 id/模型名，人类用姓名）。只增不改他人历史条目。
- 详见 `WORKLOG.md`。

## 3. 构建 / 发布

- Windows：`npm run dist`（= `build.ps1`，自包含 + NSIS 安装包）
- macOS：推送 `v*` tag 或手动触发 GitHub Actions `build-macos`（在 mac runner 上构建 dmg 并自动发布）
- 发布：`npm run release`（打印 `gh release upload` 命令）；Windows 与 macOS 资产进**同一个**版本 Release

## 4. 项目原则

- **内核零修改**：外壳只负责拉起 `dsh web`、读 git（审阅）、承载页面；不改 DeepSeek Harness 内核代码。
- 文档分工：`README.md`（用户向使用说明）、`WORKLOG.md`（日志索引 + 协作规范）、`AGENTS.md`（本文件，协作约定）。
- 关键坑速查见 `WORKLOG.md` 的「踩坑速查」与 `logs/` 里的历史条目。
