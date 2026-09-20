# 验收矩阵 W00–W25（2026-09-20）

统一结果：PASS / FAIL / NOT_RUN / PARTIAL。禁止把缺环境写成 PASS。
实施：ox-alpha · 包：`%TEMP%\wm-world-settings-20260920\win-unpacked` · 预览：`preview/preview.json`

| ID | 结果 | 证据 / 说明 |
|---|---|---|
| W00 | **PASS** | `p0-baseline.md` + `test/hunt-host.mjs` 21/21（H3/H4） |
| W01 | **PARTIAL** | 产品原则：整理仅在作者点「整理为设定」时发送额外请求；自由对话不自动整理。**真模型未测** |
| W02 | **PARTIAL** | UI 以点击时消息列表冻结 scope；迟到 ingest 只消费 organizing 期间最终 assistant 行。**双窗口/切项目未实机测** |
| W03 | **PARTIAL** | 拒绝/取消路径：adapter send 失败保留 selection 与 note；解析失败展示原文不落盘。**真模型拒绝态未测** |
| W04 | **PASS（host/fixture）** | `parseOrganizeResult` 丢弃 confirmed/targetPath/actor；畸形结果 `ok:false` 不自动写。`world-settings-p1` / `p3` |
| W05 | **PARTIAL** | 候选未确认不进 injectable（context 测 proposed 排除）；UI 有未保存 drafts 状态。**刷新恢复 drafts 未做完整 sessionStorage** |
| W06 | **PASS** | 长说明允许；超限 413 `setting-too-long`（p1） |
| W07 | **PASS** | sources 与 actor 分离；确认后 setting.sources 保留；失效链接 UI 可标 unavailable（host 字段） |
| W08 | **PASS** | p3 W08 corrupt-memory 原件不动；schema1 读兼容、写迁移+backup（p1） |
| W09 | **PASS（host）** | setting 条目无 `clientSchemaVersion>=2` → upgrade-required（p1） |
| W10 | **PASS（host）** | 陈旧 etag → etag-conflict，仅一条设定（p3 W10）。**两真实窗口 UI 未跑** |
| W11 | **PASS** | 幂等 replay + operation-conflict + receipt 查询（p1/p3） |
| W12 | **PASS（host）** | 候选编辑 itemRevision++；确认完整替换；history before 含 setting（p1） |
| W13 | **PASS** | history-full 拒绝写、不静默裁剪（p3 W13） |
| W14 | **PASS** | 投影冲突时权威仍在；重试幂等；清手稿后可恢复 synced（p3 W14） |
| W15 | **PASS（模拟）** | 磁盘已是预期内容时只补 mark synced（p3 W15） |
| W16 | **PASS** | 外部编辑 → projection-conflict，手稿字节保留（p3 W16） |
| W17 | **PASS** | 库外 project path-outside-roots（p3 W17） |
| W18 | **PASS** | 注入 text=结论+边界；说明不进 preparedTurn（context 12/12） |
| W19 | **PASS（shared）** | 排除优先、固定优先、world 匹配排序、同分按 id；预览与发送共用 selectMemory。**UI 预览与发送一致性未在 Electron 核对** |
| W20 | **PARTIAL** | 撤回后 isInjectable=false 不再自动注入（既有 M 组）。**真实模型新旧识别 NOT_RUN** |
| W21 | **PASS** | p1/cde/review-f/verify:writing 16/16/adapter/p3 回归通过（基线未回退） |
| W22 | **PASS** | `verify-writing-package --package TEMP...`：manifest 16 文件一致、asar 主进程一致、extraResources 完整 |
| W23 | **PARTIAL** | host 锁/etag 并发探针通过；**两真实窗口 Electron 未跑** |
| W24 | **NOT_RUN** | 五个真实故事场景需真模型交互验收；预览已提供项目与试用步骤 |
| W25 | **PASS** | 可见隔离预览已启动并 `keptRunning:true`（PID 见 preview.json）；请用户关窗 |

## 汇总

- PASS：W00,W04,W06–W19(多数),W21,W22,W25
- PARTIAL：W01–W03,W05,W19(UI),W20,W23
- NOT_RUN：W24 真模型五场景；Electron UI 套件 `verify:writing-ui/chat/native/reading`；NSIS 隔离安装；macOS 实机

**总体：PARTIAL（工程主体完成）**

— 署名：ox-alpha


## 2026-09-20 Codex 整改后状态（覆盖上文当前结论，不改历史记录）

A01–A12 已修复；完整 21 步门禁通过，新增协议 10 组、真实 Electron UI 5 组通过，最终真包 9/9、17 个发布文件一致。原 ui/chat/native/reading 已补跑通过。真实模型五场景、两真实窗口世界观并发与跨平台/安装验收仍未完成，总体 PARTIAL。修复和证据见 [repair/report.md](repair/report.md)。未提交、未推送、未发布。

署名：Codex


## 2026-09-20 发布前真实验收补充

原方案 W24 五类故事场景及两个真实窗口并发已实测通过，详情见 live/README.md。此结果补充并覆盖此前 NOT_RUN 状态；NSIS隔离安装、macOS实机、受控离线、目录移动与压缩后连续性仍未验收。正在准备 v0.1.41，不把准备中写成已发布。— Codex
