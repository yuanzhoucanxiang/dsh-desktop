# 已有项目接入 · 独立开发交回

状态：独立副本功能与定向回归通过，未合并到共享工作树，未提交、未打包、未发布。

开发副本：`C:/Users/DL/AppData/Local/Temp/dsh-existing-project-20260921-192541`。

## 能力

- “打开已有”选择 `kind=project`，只更新 DSH_HOME 的作品配置，不写 project.md、不改目录、不自动建立确认备忘。
- 按原分类目录显示 Markdown / markdown / fountain / txt 文件。排除隐藏目录、node_modules、vendor，不跟随目录 junction；沿用 realpath 边界校验。
- 目录标签保留完整相对父目录，避免不同层级同名稿件混淆。
- 显式接入根作为会话/备忘身份；重启仍有效。嵌套显式根以更具体的根为准。
- 超过12层/2000个访问目录/目录内5000文件的扫描预算时提示列表不完整，不能声称全量索引。

## 结果

- `node plugin/writing-mode/test/existing-project.mjs`：6/6，包括越界 junction、配置持久化、统一身份、嵌套根、旧库语义和目录深度提示。
- `electron scripts/verify-existing-project-ui.cjs`：5/5，真实host与Electron。通过UI打开未添加任何标记的13份资料副本；跨文件同原生会话；配置重载；非法目录拒绝；源资料逐字节不变。
- `verify-writing-architecture` / `verify-writing-build`：PASS。
- P1 7/7、architecture-cde 25/25。
- 这是接入验证，没有新增真实模型回合。此前真实模型资料试用在 `../.. /2026-09-21/hel-trial/`（实际同一 writing-world-settings 目录下）有独立记录。

## 可见预览

PID 73432，标题“已有项目接入 · 赫尔帝国 · 独立测试版”，详见 preview.json。保持运行，由用户关窗。全部资料在临时副本，真实资料与正式profile未改动。

此预览没有配置API密钥，内核可能显示“稍后配置”；本次验收不包含预览模型发送。截图人工检查发现顶部文档库标题在当前侧栏宽度下换行，后续整合时应调整入口布局；不能用5条行为断言冒充全面视觉验收。

## 合并方式与边界

`existing-project.patch` 仅包含本次4个源码文件的增量，base/new hash见 hashes.json。**基线是19:25的在制快照，并非HEAD**；共享树在此后有加固变更，不可用整文件替换或强行应用补丁。逐段合并，冲突时优先保留新加固并重新接入本功能。

新增测试分别放回 `plugin/writing-mode/test/existing-project.mjs`、`scripts/verify-existing-project-ui.cjs`；界面测试目前引用本机资料路径，作为真实资料验收入口，尚未做成可移植CI fixture。

副本还补了 runtime-manifest 中 project-identity.js 的登记；共享树交回已登记，**无需重复添加**。生成 client.js 应在合并后重新构建，不拷贝旧副本的产物。该补丁不含两项新的交回缺陷修复，见上一层 handoff-review.md。

合并后再补 CONTRACT/用户文档与总门禁入口，运行最终源码回归和真包验收。目前没有宣称已完成正式版接入。

— Codex，2026-09-22

2026-09-22 更新：本补丁已整合到共享工作树，并补过综合门禁和最终真包；此处旧独立副本与旧预览仅为阶段证据。最新状态见 ../integration.md。— Codex
