# 世界观引导与整理 · 交回包（2026-09-20）

实施 agent：ox-alpha
方案：`docs/plans/writing-world-settings-v1.md`
基线 HEAD（实施前）：`a9aa8b8` · 分支 `main` · 已发布 tag `v0.1.40` @ `b6db6a4`

本目录：

| 文件 | 内容 |
|---|---|
| `p0-baseline.md` | P0 基线与 H3/H4 独立复核 |
| `protocol.md` | schema/接口/模块落实摘要 |
| `acceptance.md` | W00–W25 逐条状态 |
| `known-issues.md` | 限制与未跑项 |
| `handoff.md` | 本文件 |
| `preview/preview.json` | 可见隔离预览实例元数据 |

## 实施改动（工作树，未提交）

- host：`plugin/writing-mode/lib/project-memory.js`（schema2）、`lib/setting-projection.js`（新）、`index.js`（memory/operation/projection 路由）
- shared：`src/shared/world-setting.js`（新）、`context-builder.js`（world 注入）
- client：`src/client/features/world-settings/`（新）、`features/companion/index.js`（选入整理）、`styles/writing-css.js`
- 契约/清单：`CONTRACT.md`、`runtime-manifest.json`
- 测试：`test/world-settings-p1.mjs` / `-context.mjs` / `-p3.mjs`、`hunt-host.mjs`
- 文档：策划案 v0.8（Codex）、本审计目录、日志/CHANGELOG/WORKLOG

## 复跑命令

```powershell
# 在 dsh-desktop 仓库根
npm run build:writing
npm run verify:writing-build
npm run verify:writing-architecture
npm run test:writing-world
npm run test:writing-f
npm run test:writing-cde
npm run test:writing-p1
npm run test:writing-p3
npm run verify:writing
npm run verify:writing-adapter
npm run verify:writing-memory-ui
npm run verify:writing-context
node scripts/verify-writing-package.mjs --package "$env:TEMP\wm-world-settings-20260920\win-unpacked"
node scripts/verify-writing-coldstart.mjs
```

## 包与预览

| 项 | 路径 |
|---|---|
| 隔离打包 | `%TEMP%\wm-world-settings-20260920\win-unpacked` |
| 可见预览 base | 见 `preview/preview.json`（`base` / `pid`） |
| 试用步骤 | `preview.json.trialSteps` |

**预览窗口保持运行，请由你关闭。** 未替换正式安装版，未发布新 Release。

## 完成度（诚实）

- 工程主机/协议/投影/上下文/客户端接线：**已实现并单测/门禁通过**
- Electron UI 自动化、真实模型五场景、NSIS 隔离安装、macOS 实机：见 `known-issues.md` / `acceptance.md`
- 状态结论：**PARTIAL（工程主体完成，体验与真包矩阵未全部实测）** — 不得当作已发版

— 署名：ox-alpha


## 2026-09-20 Codex 整改后状态（覆盖上文当前结论，不改历史记录）

A01–A12 已修复；完整 21 步门禁通过，新增协议 10 组、真实 Electron UI 5 组通过，最终真包 9/9、17 个发布文件一致。原 ui/chat/native/reading 已补跑通过。真实模型五场景、两真实窗口世界观并发与跨平台/安装验收仍未完成，总体 PARTIAL。修复和证据见 [repair/report.md](repair/report.md)。未提交、未推送、未发布。

署名：Codex


## 2026-09-20 发布前真实验收补充

原方案 W24 五类故事场景及两个真实窗口并发已实测通过，详情见 live/README.md。此结果补充并覆盖此前 NOT_RUN 状态；NSIS隔离安装、macOS实机、受控离线、目录移动与压缩后连续性仍未验收。正在准备 v0.1.41，不把准备中写成已发布。— Codex
