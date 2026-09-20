# 世界观设定 · 协议落实摘要（P1）

日期：2026-09-20 · 实施 agent：ox-alpha
权威方案：`docs/plans/writing-world-settings-v1.md`
契约全文：`plugin/writing-mode/CONTRACT.md`（2026-09-20 v2）

## 数据

| 项 | 值 |
|---|---|
| 权威文件 | `state/writing-memory.json` schema **2** |
| 设定条目 | `kind=fact` + `setting{type,title,conclusion,explanation,boundaries,tags,sources}` |
| `text` | host 由 **结论 +（有则）边界** 派生；说明不进 text |
| 可读稿 | `bible/世界观整理.md`（受管投影；不覆盖手写 `world.md`） |
| 迁移 | schema1 **只读**；写路径锁内备份 `state/backups/` 后升 schema2 |
| 容量 | setting 合计 ≤16000 码点；来源摘录 ≤8000；来源 ≤20；超出 **413** |

## 接口（已实现 host）

- `GET memory` → + `schemaVersion` / `capabilities` / `projection`
- `POST memory` op：`save-setting-candidate` | `confirm-setting` | `update-projection`（+ 既有 add/update/…）
- 幂等：setting op 先查 `operationId`+`requestHash` 收据，再校验 revision/etag
- 旧客户端写含 setting 的条目且无 `clientSchemaVersion>=2` → **428 upgrade-required**
- `GET memory-operation?operationId=` → 收据查询
- `POST setting-projection` → 仅固定路径；`projection-conflict` 保护作者手稿

## 模块

- `src/shared/world-setting.js` — 纯函数（规范化/派生/解析/排序）
- `lib/project-memory.js` — schema2 / 幂等 / 历史 full / 投影元数据
- `lib/setting-projection.js` — Markdown 生成 + hash 冲突
- `src/shared/context-builder.js` — world 注入 = 结论+边界；说明不注入；排除优先
- `src/client/features/world-settings/` — 候选卡片与确认 UI（整理发送接 companion adapter）

## 测试入口

```powershell
npm run test:writing-world
# 或
node plugin/writing-mode/test/world-settings-p1.mjs
node plugin/writing-mode/test/world-settings-context.mjs
```

## 状态（诚实边界）

| 阶段 | 状态 |
|---|---|
| P0 基线 | PASS（见 p0-baseline.md） |
| P1 契约/数据/投影 host | **实现 + 单测 PASS**（34+12） |
| P2 客户端整理流 | **代码已接线**（消息多选→整理请求→解析候选→确认写入）；**未经 Electron/真模型验收** |
| P3 可靠落盘 | host 投影冲突/备份/幂等已测；两进程/故障注入矩阵 **未完整跑** |
| P4 上下文 | 纯函数已测；预览 UI 与发送一致性 **未在 Electron 核对** |
| P5 真包/真模型/可见预览 | **NOT_RUN** |

— 署名：ox-alpha
