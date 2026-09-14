# 交回说明（handoff）— 写作模式 v2

- 提交：`4649b59`（P1-①/②/③、P2、P3 全部落地；P4 文档与打包探针随本目录提交）
- 一键回归：`cd dsh-desktop && npm run verify:writing-all`（退出码 0 = 全绿；本次实测 0）
- 目录：`docs/audits/writing-architecture/2026-09-14/v2/`
  - `acceptance.md` 30 项矩阵（含未验证项，不得被总体通过覆盖）
  - `architecture.md` 分层、契约、依赖边界、数据流
  - `known-issues.md` 剩余边界（两窗口并发只到 fixture 级、NSIS 未在隔离目录安装等）
  - `preview.md` 可见预览实例信息 + 建议验收步骤 + 真实模型体验三场景

## 这一轮做了什么

| 批次 | 内容 | 关键提交 |
| --- | --- | --- |
| P1-① | `entry.js` 3526 → 165 行；`app/` 只留装配，抽出 `features/{editor,library,tools}`；架构检查加 R8（目标结构在位） | `d28b6ce` |
| P1-② | `runtime-manifest.json` 成为**唯一发布集合**；`lib/plugin-sync.js` 清单驱动同步 + 受管记录 + 逐文件哈希比对 + "只删受管且未改动"的安全清理 | `c875304` |
| P1-③ | R7 漏报根因（跨行括号正则）修复 + R7 **自身敏感性自检**（注入缺陷必须报错） | `a56baf7` |
| P2 | `createHarnessAdapter`：唯一 native 接触面（capabilities/connect/attach + handle）；host 侧 `lib/coordination.js` 跨窗口创建协调（reserved→creating→bound/uncertain，token 语义）+ 复用受验证跨进程锁；send 三分、迟到归位、不静默新建 | `adae8e2` |
| P3 | 备忘最小完整操作（候选/编辑/确认/撤回/历史恢复 + 审计 actor）；`preparedTurn` v2 契约（选择/固定/预算/全嵌套冻结）；`reference.js` 引用身份与旧快照判定；跨窗口草稿只作候选 | `4649b59` |
| P4 | 五个目标入口接线（architecture/adapter/memory-ui/context/package）；空环境冷启动 6/6 + 升级路径 5/5；30 项矩阵与交回文档；可见隔离预览 | 本目录 |

## 怎么继续（按优先级）

1. **拿到获授权测试配置后**跑 `preview.md` 的三场景，把结果补进 `acceptance.md`（当前 NOT_RUN）。
2. **补两窗口真实 Electron 并发 E2E**（H01/D04 的强口径）：同时点"会话设置"，断言 `sessions.create` 只调用一次。
3. **普通终端里 `npm run dist`**，再用 `node scripts/verify-writing-package.mjs --package "<dist/win-unpacked>" --profile "<隔离 home>"` 复核包与 profile；NSIS 在隔离用户环境安装（覆盖 P03）。
4. 作品目录移动后的**备忘/协调记录迁移**策略（见 `known-issues.md` 第 7 条）。
5. 主题侧 `ui-smoke` 的过时断言（本批次范围外）。

## 纪律基线（改这块代码时请继续遵守）

- 构建产物出工作区（`%TEMP%`）；不要在工作区里跑 `npm install`；不要杀用户正在用的桌面应用。
- 任何"检查器"都要配一条"注入缺陷必须报错"的证据（R7 自检就是这么来的）。
- 无法证明归属的文件**不删**（受管记录之外的旧文件一律保留并上报）。
- 运行中不盲删锁；不凭 TTL 抢活锁、不重复创建会话；不确定受理**不自动重发**。
- 试验只在临时作品与隔离环境里做，不碰真实稿件/密钥。

— ox-alpha
