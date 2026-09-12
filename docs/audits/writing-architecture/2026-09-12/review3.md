# 第三轮复核 b66d194：仍退回，剩余三条数据丢失路径

日期：2026-09-12。审查人：Codex / GPT-6。审查实现：`b66d194`，对比 `ca57547`。进入时第二轮审查文件和日志尚未提交，本轮完整保留；未把这些文档改动视为实现差异，也未覆盖。

**结论：仍退回修改。** N01–N03 的原始问题已关闭，N04 的普通活锁场景通过，N05/N06 增加了可见错误，N07 的即时界面覆盖也已阻止。但保护没有贯穿整个事务和状态生命周期，以下三条路径仍会让已保存或已成功响应的数据丢失。本轮未修改生产代码，未合并、推送或发布。

## 1. 已通过范围

| 项目 | 独立复核结果 |
|---|---|
| N01 | GET/POST 都拒绝 state junction 的库外目标；外部文件字节保持不变 |
| N02 | null/空串/缺任一 token 返回 428；空文件 GET 返回 revision=0 与 emptyEtag；两个独立进程同时首次创建，只有一方成功，另一方 409 |
| N03 | library root 等于 project root 时，带有效条件的写入返回 200 |
| N04 普通活锁 | 实际持锁超过 10.5 秒仍运行的进程不被直接抢锁；另一个写入返回 503，原持有者成功提交 |
| N05 错误可见性 | 真实临时备忘损坏时，组件显示“本次未带入已确认设定”，不再静默；仍直接发送，没有原方案的本次降级选择 |
| N06 错误可见性 | checkpoint HTTP 413 在输入区显示草稿未保存错误 |
| N07 即时界面保护 | 延迟 GET 返回后，未绑定会话当前输入仍显示新文字 |
| 前轮正常流程 | 已确认备忘进入实际 prompt、普通绑定刷新恢复、IME 保护均保持通过；原聊天四组回归通过 |

上表限定的是实际测试范围，不代表相关模块全部完成。

## 2. 必须修复的三条路径

### T01 · P1：回收旧锁的判断与删除之间存在竞态，仍会抢掉新活锁

位置：`plugin/writing-mode/lib/project-memory.js:144–158`；提交路径 `:373–379`。

读取 owner、判断 PID、读取 stat、unlink 是多个独立动作。A 进程读到“旧锁持有者已退出”后，B 进程可能先回收旧锁并获得新锁；A 随后仍根据旧信息执行 unlink，删除 B 的活跃锁。A 再取得新锁，两个事务同时进入临界区。退出前的 token 检查只能减少错误释放，不能撤销已经发生的双写；写入前也未因丢失所有权而拒绝提交。

**复现证据：** review3-probes-results.json 的 T01。建立由已退出子进程拥有的陈旧锁 fixture，mtime 明确设为过去 20 秒；A 在读到旧 stat 后暂停，B 回收并持新锁读取原数据，确认 B 仍活跃且文件 token 属于 B，然后继续 A。A 删除新锁并成功写入；再继续 B，B 同样成功。两个返回 revision=2，最终只剩 base/holderB，reclaimerA 的成功更新及审计消失。

测试运行生产 applyMemoryOp 和锁实现，仅在 fs.statSync/readFileSync 边界设置时序屏障；未替换版本比较或写入算法。锁文件是隔离临时 fixture，没有触碰用户应用。

**修订要求：** 回收权也必须受可靠的跨进程互斥保护，不能让一个等待者凭旧 owner 信息删除替代锁。选择经验证的锁方案，或明确设计所有竞争者都遵守的回收协调协议；不要只在 unlink 前再加一次非原子的 token 读取便宣称安全。提交前的所有权检查可作为额外故障保护，但不能代替互斥。覆盖两个回收者、正常竞争者抢先获得锁、活跃长持有、持有者崩溃和释放不能删除新所有者等场景。

### T02 · P1：recoveryGen 只保护 React 状态，旧响应仍污染缓存并覆写磁盘

位置：`plugin/writing-mode/src/client/entry.js:72–80`、`:285–289`、`:313–316`。

loadCompanionDraft 在返回给 effect 之前已经执行 `companionDrafts.set(project, cached)`。之后 recoveryGen 判断虽阻止 setLocalDraft，却无法撤销缓存被旧快照替换。作者再添加引用时，updateReference 从这个旧缓存展开对象，并把旧 text 一起持久化。

**复现证据：** review3-ui-results.json 的 T02。延迟真实草稿 GET，输入 NEW_TYPED_WHILE_RECOVERING，并确认新文字已经写入磁盘；释放旧响应后界面仍显示新文字。此时仅点击“引用稿件/选区”，磁盘 text 就回到 OLD_CHECKPOINT；刷新后输入也恢复成 OLD_CHECKPOINT。可见“没有立即改 UI”不足以证明新输入被保全。

**修订要求：** 把读取与采用恢复快照分开，读取本身不能无条件修改共享缓存；只有项目、编辑代次及恢复请求都有效时，才能原子地采用文本/引用/缓存。用户编辑、清空、移除引用、首次绑定或切项目后，旧恢复结果对所有状态都应失效。补“迟到响应 → 添加/移除引用 → 再保存 → 刷新”的完整回归，不只断言当前 textarea 未变。

### T03 · P1：checkpoint 保存没有顺序或条件，延迟旧请求覆盖已保存的新稿

位置：`src/client/entry.js:87–99`；`lib/draft-checkpoints.js:44–77`。

每次编辑发起独立 POST，后端无对应的条件 revision 或单桶有序提交规则；原子 rename 只能保护单文件完整性，不能阻止较旧请求最后覆盖较新结果。revision 字段仅被存储，前端也没有提交它。新增失败提示无法发现“两次都成功，但内容倒退”的情况。

**复现证据：** UI T03。暂缓 OLDER_POST 的传输，随后输入 LATEST_POST，确认新稿已在真实 host 写入磁盘；释放旧 POST 后，磁盘被改回 OLDER_POST，界面还显示 LATEST_POST。刷新后只剩旧文字。这个场景与 T02 独立，不需要恢复 GET。

**修订要求：** 为项目/窗口桶建立明确的保存顺序与版本条件，前后端共同拒绝过期提交；批量/防抖可以减少请求，但不是正确性保证。刷新、新 renderer、重试和多个写入来源不能绕过顺序；成功发送后的删除也要与对应草稿版本绑定，不能由迟到写请求复活旧稿。清除 checkpoint 的错误仍需反馈，当前发送后的 persist 调用没有 onStatus，后端删除失败也会吞错返回 cleared，需要与同一套协议收口。

## 3. 仍待完成的产品和架构要求

N05 的“出现警告”已达到本次修复描述；原方案要求的失败时重试/本次不带备忘选择、参与条目展开/本次关闭、preparedTurn 中的 revision 仍未交付。当前 memoryRevision 虽由 send 传入，context-builder 返回值和消息正文未使用。保留自由对话和轻量界面，不应引入每轮审批来实现这些控制。

原执行方案的 Harness adapter、feature 级模块拆分、首次连接协调、多窗口恢复入口、备忘分类/编辑/候选/历史 UI、dev/mac 构建接线、30 项验收和打包可见预览仍开放。本轮修复不能代替这些工作；参照 review.md §5、review2.md §5 完成后统一交回，避免只逐行响应最近一张问题表。

另记录一个较小的就绪状态问题：本轮 UI 探针第一次在备忘初始 GET 尚未更新 etag 时点击“记下”，得到 revision-required，文本没有写入。后续探针等待初始读取后通过；未把这一首次失败隐藏成通过。面板应在加载版本条件期间显示加载状态并禁用提交，不能依赖用户输入速度比请求慢。该问题未作为新的 P1 阻断。

## 4. 执行结果与证据

| 检查 | 本轮结果 |
|---|---|
| architecture-cde / p1 | 21/21、7/7 |
| review-f01-f06 | 10/10；在临时仓库副本执行，避免测试暂写工作树 client.js |
| verify:writing-build | PASS，生成产物未变化 |
| verify:writing | 16/16，review3-host-results.json |
| verify:writing-chat / verify:writing-ui | 各 4 组 PASS |
| verify:writing-native | 3 组 PASS，真实锁定内核、零模型回合；review3-native-results.json |
| review3-probes.mjs | 5 组通过、T01 复现；review3-probes-results.json |
| review3-ui.cjs | 5 组通过、1 组 PARTIAL、T02/T03 复现；review3-ui-results.json |
| 打包/可见预览/真实模型 | 本轮未执行；确定性丢数据问题仍未解决 |

所有测试使用 TEMP 项目与隔离宿主；真实稿件、账号、密钥、既有 Desktop/electron 窗口未变。两套 review3 脚本 exit=0 表示测试按预期完成，**REPRODUCED 仍表示产品存在故障**。复跑方式：

```powershell
node docs/audits/writing-architecture/2026-09-12/review3-probes.mjs
node_modules/.bin/electron.cmd docs/audits/writing-architecture/2026-09-12/review3-ui.cjs
```

## 5. 给执行 agent 的收口任务

> b66d194 的正常路径修复已验证，但第三轮仍退回。先完整阅读 review3.md。修复 T01 的锁回收竞态、T02 的恢复缓存污染、T03 的 checkpoint 顺序与删除协议；把新增测试断言改为正确行为并覆盖完整生命周期。不要再只修当前报错的一行：列出恢复/编辑/绑定/保存/发送清除的状态权威及请求代次，确保迟到结果不能写 UI、缓存或磁盘；锁的取得、回收、提交和释放都要在并发测试中有证据。继续完成原方案未交付的架构、产品入口和 30 项验收，再提交打包字节一致性及可见隔离预览。保留旧报告、修复阶段提交及用户数据，不关闭用户应用，不发布。下一次提供 T01–T03 的最终 SHA、正确行为回归和完整交付状态，避免只报告单测数量。

— Codex / GPT-6
