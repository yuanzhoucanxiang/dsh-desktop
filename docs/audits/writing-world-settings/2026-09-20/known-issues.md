# 已知问题与边界（2026-09-20）

## 功能 / 产品

1. **真模型体验未验收**（W24 五场景、整理 JSON 成功率、长说明预算下的伙伴行为）。预览实例可手工验证。
2. **Electron UI 自动化套件未跑**（`verify:writing-ui/chat/native/reading`）：不擅杀用户桌面；隔离 smoke 已用 coldstart/打包路径覆盖 host。
3. **候选未保存编辑的跨刷新恢复**：方案要求保留本窗口草稿或明确提示；当前 drafts 仅内存态，刷新会丢（note 有说明）。后续可用 sessionStorage。
4. **双真实窗口并发 UI**：host 协议已测；界面层冲突提示未实机。
5. **模型格式失败**：解析失败展示原文、不自动落盘——成功率取决于模型；fixture 已覆盖围栏 JSON。

## 数据 / 迁移

6. schema1→2 在**首次写**时迁移并备份到 `state/backups/`；只读不升级。降级安装不会自动回写 schema1。
7. schema2 历史满返回 `history-full`，不静默裁剪；已裁剪的 schema1 历史无法补造。
8. 去重收据配额满 → `operations-full`；收据与可查询历史同寿命策略见 CONTRACT。
9. 投影目标固定 `bible/世界观整理.md`；作者同名手稿无受管记录 → `projection-conflict`，可删/另存后重试。
10. 投影 `generatedAt` 参与内容 hash 时，崩溃恢复需按**同一 meta** 重渲染或只补 mark（p3 已覆盖 mark 路径）。UI 确认后 POST projection 会用当前时间戳重新生成。

## 工程

11. 工作树未提交：H3/H4 加固 + 世界观实现 + 文档；**v0.1.40 安装包不含这些改动**。
12. 用户 profile 内旧 writing-mode 与仓库漂移：应用下次启动会同步；冷启动/upgrade 探针已证明受管 16 文件一致。
13. coldstart 曾出现一次 `SMOKE_FAIL probe-after-ready`（环境/时序），复跑 `cold`/`upgrade` 均 6/6 PASS。
14. 构建输出在 `%TEMP%\wm-world-settings-20260920`，避免工作区 asar 锁。

## 安全

15. 路径仍受 library roots + realpath 约束；**不是**对外部进程的完整沙箱。
16. 模型输出视为数据：confirmed/targetPath/actor 不可信；显式整理请求不附加默认写文件指令。

— 署名：ox-alpha


## 2026-09-20 Codex 整改后状态（覆盖上文当前结论，不改历史记录）

A01–A12 已修复；完整 21 步门禁通过，新增协议 10 组、真实 Electron UI 5 组通过，最终真包 9/9、17 个发布文件一致。原 ui/chat/native/reading 已补跑通过。真实模型五场景、两真实窗口世界观并发与跨平台/安装验收仍未完成，总体 PARTIAL。修复和证据见 [repair/report.md](repair/report.md)。未提交、未推送、未发布。

署名：Codex


## 2026-09-20 发布前真实验收补充

原方案 W24 五类故事场景及两个真实窗口并发已实测通过，详情见 live/README.md。此结果补充并覆盖此前 NOT_RUN 状态；NSIS隔离安装、macOS实机、受控离线、目录移动与压缩后连续性仍未验收。正在准备 v0.1.41，不把准备中写成已发布。— Codex
