# 架构与打包验收（2026-09-13）

实现提交：`1664467`（文档前）→ 当前分支含 `d82750f` 文档归档。  
基线发布：v0.1.38；本分支 **未合并、未发新 Release**。

## 1. 工程回归（全部 exit 0）

| 套件 | 结果 |
|---|---|
| `test:writing-p1` | 7/7 |
| `test:writing-cde` | 25/25 |
| `review-f01-f06` | 10/10 |
| `review5-protocol` | 9/9 |
| `review7-status` | 10/10（含 X01） |
| `verify:writing-build` | PASS，产物与源一致 |
| `verify:writing` | 16/16 |
| `verify:writing-chat` | 4 组 PASS |
| `verify:writing-ui` | 4 绠 PASS |
| `verify:writing-native` | 3 组 PASS，turns=0 |

## 2. 打包验收（`--dir` → `%TEMP%\dsh-arch-accept-0138`）

- electron-builder unpacked 构建成功  
- `resources/plugin/writing-mode` 含 index/client/CONTRACT + lib 9 文件  
- **client.js / index.js SHA256 与仓库源码一致**  
- 未做 NSIS 安装包与替换正式版  

## 3. 可见隔离预览（保持运行，请由你关闭）

| 项 | 值 |
|---|---|
| 可执行文件 | `%TEMP%\dsh-arch-accept-0138\win-unpacked\DeepSeek Harness Desktop.exe` |
| DSH_HOME / DSH_DESKTOP_HOME | `%TEMP%\dsh-arch-home` |
| userData | `%TEMP%\dsh-arch-ud` |
| LOCALAPPDATA（运行时） | `%TEMP%\dsh-arch-localappdata` |
| 预览插件 | 已预置到 isolated home 的 `profiles/node_modules/@dsh-local/writing-mode` |

与正式安装版窗口可并行（单实例锁按 userData 分桶）。

## 4. 建议手工验收（打开预览窗口后）

1. 右下角或 Ctrl+Shift+W 进入写作模式  
2. 添加库根（如 `E:\剧本` 或新建空目录）→ 新建项目（小说/短剧模板）  
3. 打开一篇稿 → 编辑 → 自动保存 → 再改 → 刷新页面，文字应仍在  
4. 右栏写作伙伴：引用选区 → 发送；项目备忘记一条设定再发一句  
5. 门禁 / 台账折叠区是否正常  
6. 有意制造冲突可选：另一窗口同库同项目（风险自负，建议用 TEMP 测试项目）  

## 5. 仍开放（本验收不宣称完成）

- 方案 30 项逐项矩阵未逐条签字  
- Harness 独立 adapter facade、entry feature 级拆分未做完  
- 备忘历史 UI / 候选确认流未做完  
- 真实模型自然度与长对话未验收（无模型回合）  
- NSIS / macOS 发布与正式安装替换未做  
- 锁死锁后的人工恢复路径（lock-stale）仍需运维说明  

## 6. 回退

- 分支未合 main；丢弃分支即回到 v0.1.38 线  
- 预览目录在 TEMP，可删；不影响 `~/.dsh` 真实稿件（除非你把库根指到真实项目）  

— ox-alpha
