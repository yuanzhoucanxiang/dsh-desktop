# 写作模式：独立复核与真实写作验收（2026-09-19）

## 结论与版本边界

基线为 main `0e111510d107f6851aaf080d4a7a8fb65b9e7dc2`，发布 tag v0.1.39 指向 `17eeec1`。
上轮关键问题的独立探针通过；真实模型三场景和同一真实内核下的两个 Electron 窗口已实际运行。
本轮另发现并修复 3 处问题。修复仍在工作区，**未提交、未推送、未发布，不代表正式安装版已更新**。

测试文件与结果在 [revalidation](revalidation/)。不以测试数量代替完整产品验收，也未声称原 30 项全部通过。

## 本轮发现与修复

1. **L01：候选来源被误记为作者。** 真实助手消息点“记为候选”，编辑后保存，磁盘条目为
   `proposed`，但 `source.kind=author`，会话与消息 ID 丢失。原因是父组件消费候选 prop 后将其置空，
   面板只保留文字，保存时重新从已清空的 prop 取来源。
   修复：在备忘编辑器内与文本一起保留来源快照，清空编辑状态时一并清除。
   `scripts/verify-writing-chat.cjs` 新增真实 UI 操作→磁盘断言，覆盖编辑候选后保存及确认后来源不变。
   [修复前数据](revalidation/candidate-source-before.json)、[修复后真实条目](revalidation/live-memory-after-scene2.json)。
2. **L02：Windows checkout 破坏生成产物的字节一致性。** `core.autocrlf=true` 将 client.js 的
   4,990 个 LF 转成 CRLF，仓库显示无内容修改，但构建与包比对失败。归一换行后与发布包完全一致。
   新增 `.gitattributes`，仅固定生成文件 `text eol=lf`；保留严格逐字节门禁。
   用 `git -c core.autocrlf=true cat-file --filters` 实测，并核对发布包哈希。
3. **L03：基线测试的多行替换受 CRLF 影响。** 原基线 wrapper 无法匹配旧业务断言块而退出。
   读取测试模板时归一换行，保留断言内容；33 条基线通过。

## 独立复测结果

| 对象 | 结果 | 证据 / 范围 |
|---|---|---|
| N01 清理范围 | PASS，3 项 | 两个同名测试进程，只清登记 PID；未拿用户正式进程试验 |
| N02 / N04 / N05 | PASS，3 项 | 未知创建不重复、拒绝不被他人消息翻案、根 junction 不写外部 |
| N03 迟到采用 | PASS，1 项 | 加强为界面和当前 checkpoint 都保留后来输入，不只要求某处有副本 |
| 原 B / C Node 探针 | PASS，7 项 | 新目录运行，历史结果未覆盖 |
| 原 B UI 探针 | PASS，4 项 | 真实生成 client + React + HTTP host；原生传输是 fixture |
| 草稿与错误恢复基线 | PASS，33 项 | `baseline-ui-results.json` |
| 当前聊天 UI | PASS，5 组 | 加入 L01 来源断言；`chat-after.log` |
| 备忘 / 上下文 / 引用 | PASS，17 项 | 生产模块测试 `p3-memory-context.mjs` |
| 真实内核 UI | PASS，3 组 | 独立 UI、输入共享、引用切换；`native.log` |
| 缺包负向门禁 | PASS | 不存在的 WM_PKG 返回 1，`verification.json` |
| v0.1.39 原发布载荷 | PASS | LF 问题修复后 9 个主进程模块、15 个插件文件一致；真包 9/9 |
| 本轮修复测试包 | PASS | `%TEMP%/wm-acceptance-2026-09-19`；插件与当前源码一致；真包 9/9 |
| 构建一致性 | PASS | `verify:writing-build` 不覆盖生成文件；语法检查通过 |

`verification.json` 保存的是**L01 修复前**的发布载荷复核，不能拿它的源码/plugin 哈希说明修复已发布。
本轮修复包对应 `patched-package.json` 与 `patched-packaged.log`；asar 未变化是因为本轮产品改动只在 extraResources 的写作插件。
原安装器 SHA256 为 `f668f973ae76ce264c23615776d456b4429afc9f04358382a21706fa7621c064`，与仓库发布记录一致；本轮没有重新查询远端资产或执行 NSIS 安装。

## 真实模型三场景

配置：用户本机已配置的 `deepseek-official / deepseek-v4-flash / max`，真实 Harness 工具链。
使用临时《灯塔来信》，未打开作者正式稿件。密钥仅通过子进程环境使用，不复制凭据文件到测试目录，不写日志。
共 6 次真实发送：[对话记录](revalidation/live-transcript.json)。模型结果是本次样本，不是所有后续输出的保证。

| 场景 | 实测结论 |
|---|---|
| 随意讨论→改口→搁置 | 跟随作者从“为何不拆信”转到“停电后的安静”；未强制任务流程；原稿不变，未自动写入项目备忘 |
| 候选→确认→修改→撤回 | L01 修复后，来源保持 assistant+sessionId+messageId。确认后采用“无法启动”，修改后采用“可以启动”，撤回后主动重读项目并明确“目前没有生效的设定”，未回退到旧版 |
| 讨论→明确要求改稿 | 实际生成 [v2](revalidation/story-v2.md)，[v1](revalidation/story-v1.md) 字节保持不变；引用正确，未将已撤回的发电机状态写死 |

体验观察：表达自然、有自己的判断，能使用 Harness 读文件来核对当前事实。但回答偏长；简单确认问题时多次向作者报告
`state/writing-memory.json`、revision 等实现细节。下一批应优化默认表达与 UI 展示，不以固定长度、固定回合或逐轮确认限制能力。
对话中的灯塔技术细节与外部链接未逐条事实核查，不当作知识可靠性验收。

## 两个真实窗口

`two-window.cjs` 启动两个独立 Electron renderer，共用一个真实 Harness host、同一作品。

- 两个 windowId、两份独立 checkpoint；刷新第二窗口恢复其自身文字，第一窗口不变。
- 两窗口同时点“会话设置”，实际持久化原生会话总数为 1。
- 返回写作模式后，各自输入仍为 `WINDOW_ONE_DRAFT` / `WINDOW_TWO_DRAFT`。
- [证据](revalidation/two-window-evidence.json)。未覆盖两个独立桌面主进程/两个 host，以及并发期间 host 崩溃。

## 可见预览

新测试包已启动，实际 PID、路径在 [preview.json](revalidation/preview.json)，保持运行，由作者关窗。
临时作品位于 `%TEMP%/dsh-writing-live-NPAeSL/library/灯塔来信`；预览 home、userData、LOCALAPPDATA 均在
`%TEMP%/dsh-preview/` 下，正式 `~/.dsh` 未被修改。
保留原临时作品路径是为了复用真实会话身份；没有篡改原生会话记录以迁移作品。
打开“灯塔来信”可看六轮对话、已撤回备忘的历史，以及 v1/v2。

预览启动曾因复制 profile 链接后变成普通目录而失败；launcher 已改为只复制必要用户态数据，不复制 profiles/runtime 链接，交给应用首启生成。

## 尚未完成

- 受控断网下的真包加载/编辑保存，NSIS 隔离安装、macOS 实机。
- 窄窗口及长历史视觉矩阵、实际触发 compaction 后的连续性。
- 作品目录移动后的身份迁移；应用层 C01 继续按功能边界拆分。
- 两个独立 host 的并发及中途崩溃恢复；真实模型改稿与作者同时修改文件的冲突场景。

下一批建议优先做窄栏/长对话体验和默认表达，再补离线/安装/压缩边界。不新增复杂自动记忆或主动改稿。

署名：Codex
