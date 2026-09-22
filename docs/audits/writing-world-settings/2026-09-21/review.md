# v0.1.41 后续可靠性审查（2026-09-21）

审查 HEAD 6783647，writing-mode 生产实现与 v0.1.41 标签一致。仅隔离探针与文档，不修改用户作品、不关闭用户桌面、不改生产实现、不提交或发布。

结论：4 项可复现问题/功能缺口，其中 D01、D03 优先修复。原有设定冲突保护仍有效，不应把所有问题概括成“备忘会丢失”。

| 编号 | 优先级与结果 | 触发 / 影响 / 根因 |
|---|---|---|
| D01 | P1 · REPRODUCED（已披露限制现已实测） | 输入未保存世界观候选，正常关闭真实 Electron 窗口，再以同一 userData/host/project 新建窗口：候选消失且无拦截。已保存候选仍在。编辑只写 sessionStorage，beforeunload 仅在缓存写失败时保护；缓存写成功不等于跨窗口持久化。 |
| D02 | P2 · REPRODUCED | 带 modelMark=open/pending 的未决候选存为候选，另一真实窗口重新打开：仍是 proposed，但“仍待讨论”标记丢失，变成通用待确认提示。settingOf 与 host规范化都不持久化此字段。探针在窗口缓存注入合法候选标记，只测试持久化语义，无真实模型调用。 |
| D03 | P1 · REPRODUCED | 已有普通聊天草稿checkpoint被截断为坏JSON，读取返回null；随后baseRev=0的新保存成功，把损坏但可能可抢救的原文件覆盖，无备份。readCheckpoint把损坏/读取异常与文件不存在混为一谈。不是声称正常JSON每次都会丢。 |
| D04 | P2 · REPRODUCED（已披露的移动兼容缺口） | 在临时目录移动项目，state/writing-memory.json随目录保留；新路径列不到旧checkpoint，也取不到旧coordination会话。原文件仍在旧路径哈希桶，数据未删除但正常入口断联。项目身份依赖绝对路径，缺少显式迁移/重绑。 |

## 定位

- D01：plugin/writing-mode/src/client/features/world-settings/index.js:19–24、63–68、85–88。
- D02：同文件 settingOf:27–29、标记展示:35、openItem:91–95；lib/world-setting.js normalizeSetting 与 parseOrganizeResult。
- D03：plugin/writing-mode/lib/draft-checkpoints.js:34–47、57–65。
- D04：draft-checkpoints.js:20–24、130；coordination.js:47–50；index.js companion route 的绝对路径key。

## 保持有效的保护

本轮重跑 world-settings-repair 10/10：过期/非法迁移请求不动原文件、完整载荷幂等、确认态修订保护、手稿保护、备份junction拒绝、投影失败intent恢复、双进程投影竞争、来源去伪、整理受理与回合归属均通过。

真实两个Electron窗口冲突/解决2组通过（本轮临时目录 dsh-writing-native-QsWrVo）。后保存窗口拒绝过期写入并保留本地文字；显式比较后再确认才更新，历史保留。冲突面板目前用JSON显示远端内容（index.js:187），属于交互改进，不是本轮确认的数据覆盖漏洞。

证据：ui-probes.cjs / ui-results.json，host-probes.mjs / host-results.json。探针断言“缺陷能复现”，退出0表示探针成功运行，不代表产品没有问题。所有文件操作都在本轮临时目录，不覆盖真实草稿。

## 建议修复顺序与验收

1. D03：区分not-found与corrupt/io-error；坏文件保留、禁止自动覆盖，提供显式恢复/另存。测试必须核对原文件字节与备份。
2. D01：世界观编辑及pendingOperation持久化到host独立窗口桶；重启提供候选恢复，恢复确认前不覆盖现有编辑。测试正常关闭、崩溃、保存丢响应与多窗口隔离。
3. D02：持久化候选的建议/未决标记，旧条目缺字段明确降级；作者确认仍是独立显式操作。
4. D04：采用稳定项目身份或显式迁移与绑定恢复，防止目录复制把两个作品错误合并；旧桶保留，迁移可回滚。
5. 冲突界面改为可读字段差异，保留现有revision/etag保护和显式确认。

没有重跑真实模型或安装器；本轮范围为本地数据/窗口行为。NSIS注册表、macOS实机、受控离线等维持未验收，不能由本轮替代。

署名：Codex
