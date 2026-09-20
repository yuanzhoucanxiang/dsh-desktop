# P0 稳定基线 · 2026-09-20

实施 agent：ox-alpha
方案：`docs/plans/writing-world-settings-v1.md`
状态：P0 工程回归 **PASS**（无 Electron/真包/真模型项，见边界）

## 1. 基线身份

| 项 | 值 |
|---|---|
| HEAD | `a9aa8b801df0ad79c245274139d5f02468d14c8b` |
| 分支 | `main`（与 origin/main 一致时点见 git status） |
| 已发布标签 | v0.1.40 @ `b6db6a4`；发布证据 `a9aa8b8` |
| 方案文件 | `docs/plans/writing-world-settings-v1.md`（untracked，Codex） |
| 策划案 | v0.8 §18 + §18.8（repo `docs/writing-mode-plan.md` 与 `E:\剧本\写作模式-策划案.md`） |

## 2. 工作树归属（保留他人修改，不 restore）

| 路径 | 归属 | 说明 |
|---|---|---|
| `plugin/writing-mode/lib/store.js` `index.js` `src/client/app/WritingModeApp.js` `test/hunt-host.mjs` `test/review5-protocol.mjs` `test/review7-status.mjs` `client.js` | ox-alpha（本实施前） | H3/H4 create-project 加固 + 协议测试 DOM/React stub；**未提交** |
| `docs/plans/writing-world-settings-v1.md` 策划案 v0.8 / 日志 / WORKLOG / CHANGELOG 文档段 | Codex | 世界观执行方案与 v0.8 文档；**未提交** |

P0 **不**把上述代码记作本轮新做；W00 仅独立复核其行为。

## 3. 独立复核结果（工作树）

| 套件 | 结果 |
|---|---|
| `test/hunt-host.mjs` | **21/21** PASS（含 H3 非空目录拒绝、H4 点段/保留名拒绝、H9 空目录允许 / project.md→exists） |
| `test/p1-regression.mjs` | 7/7 |
| `test/architecture-cde.mjs` | 25/25 |
| `test/review-f01-f06.mjs` | 10/10 |
| `test/review5-protocol.mjs` | 9/9（沙箱 document + host React require） |
| `test/review7-status.mjs` | 10/10 |
| `test/p3-memory-context.mjs` M/C/D | 7 + 6 + 4 |
| `verify:writing-architecture` + imports + R7 自检 | PASS |
| `verify:writing-adapter` | coordination 18 + adapter 15 PASS |
| `verify:writing-build` | PASS（client.js 与 src 一致，不覆盖） |

### W00 对应结论

- H3：`prepareProjectTarget` 对无 `project.md` 但非空目录返回 `directory-not-empty`，原文件 intact。
- H4：`safeProjectDirName` 拒绝 `.`/`..`/`...`/`CON`；`title='.'` 不落库根。
- 协议沙箱：factory 可在无浏览器 document 环境加载；草稿/状态协议行为与既有断言一致。

## 4. 未跑（如实）

- Electron：`verify:writing` / `ui` / `chat` / `native` / packaged / 真模型
- NSIS 隔离安装、macOS 实机
- 未提交、未推送、未发版、未改用户已装应用

## 5. 下一阶段

P1：CONTRACT 定稿 schema2/接口；`project-memory` 迁移与去重；`setting-projection`；`world-setting` 纯函数；协议测试。H3/H4 加固按方案应**单独提交**（待用户/方案授权下的 git 操作时执行，本轮先完成复核证据）。

— 署名：ox-alpha
