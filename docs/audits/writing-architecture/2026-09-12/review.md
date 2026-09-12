# 写作模式架构独立复核：退回修改

审查对象：`feat/writing-mode-architecture`，`cb99ae7a59d4559e64701434eee023c13aa68cee`；实现差异基线 `bc5245c`。本地 HEAD 与本地 origin 分支引用一致；本轮未重新 fetch，不把本地引用当成远端实时核验。

依据：`docs/plans/writing-mode-architecture-v1.md` §15。日期：2026-09-12。审查人：Codex / GPT-6。

**结论：退回修改，暂不合并或发布。** 已复现串项目、草稿恢复失效、跨进程丢更新、备忘目录越界写入；上下文模块未接入实际发送。不能认定“A–E 核心完成”。以下问题不需要真实模型即可证明。原作者明确承认 F 未全部验收，这一边界应保留；不据此推断其伪造测试，但其阶段完成描述和部分 PASS 映射需要纠正。

## 1. 必须修复的问题

行号均对应被审查提交；路径相对于仓库根目录。

### F01 · P1：项目备忘被写到父目录，兄弟项目共享同一份数据

- 位置：`plugin/writing-mode/index.js:469`、`:501`；调用方 `src/client/entry.js:354`。
- 面板把 `binding.project`（目录）作为 path；新路由直接调用 `findProjectRoot(target.abs)`。该函数从 `dirname(absPath)` 开始找，因此跳过当前项目根，再回落到父目录。已有 companion 路由在 `index.js:137` 正确区分目录/文件，新 memory 路由没有复用这一解析逻辑。
- 实测：同库 A/B 两个含 project.md 的项目，从 A 的目录参数添加 `A_ONLY_SENTINEL`，返回 project 为 library 根，B 的目录参数读取到这条；用 A 内稿件路径读取却为空。证据：`review-probes-results.json` R1，真实 HTTP。
- 修改要求：统一 host 项目解析与规范化身份；文件/项目目录必须指向同一项目。测试两项目、嵌套目录、大小写、重命名及非法根。对已经误存到 library/state 的数据提供显式诊断与归属选择，不能自动复制到所有项目。

### F02 · P1：已确认备忘从未进入实际发送；生成包还漏了默认预算常量

- 位置：`src/client/entry.js:317–329`；`scripts/build-writing-client.mjs:31–36`。
- send 内 `const mem = null`，没有读取项目备忘。构建脚本又只截取导出函数，漏掉 `const DEFAULT_BUDGET = 6000`。实际调用未传 budget，生成包抛 `DEFAULT_BUDGET is not defined`，随后被空 catch 吞掉，回落到旧消息拼接。
- 实测：在 UI 添加并确认备忘，也在正确项目目录补存同一标记以排除 F01 干扰，实际 `session.prompt` 收到的只有“继续讨论”。生成 bundle 的函数默认参数单独调用也复现 ReferenceError。证据：UI1、R2。
- 修改要求：修复真正的模块构建，按发送时项目身份读取备忘并冻结 preparedTurn；包括备忘 revision、来源、选取项、省略数。接通“参考项目备忘 · N 条”、展开和本次关闭；故障需明确提示并允许不带备忘继续。新增从真实组件到 prompt 参数的验证，以及生成 bundle 的默认预算用例。只让源文件单测通过不够。

### F03 · P1：已有会话刷新后跳过全部 checkpoint 恢复

- 位置：`src/client/entry.js:265–274`。
- 恢复条件 `!info` 使已有原生输入 store 的会话同时跳过文本和引用恢复。引用不属于原生输入 store，也不应因此跳过。
- 实测：真实组件/HTTP、稳定 provideInfo 的原生形状 fixture；确认磁盘有未发送文本和选区引用后刷新，同一个 sessionStorage windowId 下输入为空、引用消失，磁盘文件仍在。证据：UI2。此测试模拟刷新后原生 draft 为空；即便特定原生环境保留文本，引用仍被这条条件拦掉。
- 修改要求：区分原生草稿权威与恢复 checkpoint；原生非空时保留并提供冲突选择，原生为空时可恢复；引用独立恢复。恢复期间用户新输入不得被迟到 GET 覆盖。checkpoint 持久化还应有有序写入/版本条件、成功清除的对应 revision、失败可见；当前每次输入 fire-and-forget POST 且吞错，不能作为可靠恢复保证。补 D01–D04 的组件级时序验证。

### F04 · P1：state 目录为 junction 时可以越过库根读写备忘

- 位置：`lib/project-memory.js:40–43`、`:164–170`。
- HTTP 只检查项目根，store 对拼接后的 state/writing-memory.json 直接读写，没有复核中间目录和最终目标。
- 实测：项目仍在授权库内，将它的 state 链接到库外临时目录；从稿件路径 POST memory 返回 200，库外出现 writing-memory.json。证据：R3。仅测试树扫描拒绝 junction 不能覆盖新路由。
- 修改要求：读/写均验证最终 realpath 和父目录边界，覆盖目录 junction、文件链接、替换期间的错误处理；拒绝时保全外部文件。测试只使用临时数据。

### F05 · P1：跨进程 etag 检查不是互斥，两个成功响应丢掉一条更新

- 位置：`lib/project-memory.js:90–99`、`:164–170`。
- 两个进程均可在对方写入前读到同一 revision/etag，再分别 rename。rename 的文件替换原子性不能保护整个读改写过程。revision/etag 还允许省略；UI 只提交 etag，没有 baseRevision。
- 实测：两个独立 Node 进程在读取同一份字节后用屏障同时继续；都返回 revision=2、exit=0，最终只剩 base 与一条新增记录，另一条及其审计丢失。证据：R8。屏障只控制读后时序，没有替换生产修改函数。
- 修改要求：按方案在可跨进程验证的互斥区内读取、检查、修改、写入；强制有效版本条件；锁异常和持有进程退出后的恢复必须有测试。不要求虚构对任意外部编辑器的完整事务保证。known-issues 已承认缺锁，但这是本轮强制数据安全条件，不能降为可发布限制。

### F06 · P1：格式错误但可解析的 JSON 会被当空数据覆盖

- 位置：`lib/project-memory.js:56–64`。
- 非数组 items/changes 被自动替成 `[]`，revision 强制转换，条目本身不做 schema 校验。随后 add 正常写回，原数据消失。
- 实测：合法 JSON、schemaVersion=1、items 为含旧数据的对象；执行 add 成功升到 revision=4，文件里已找不到旧内容。证据：R5。
- 修改要求：完整校验结构、revision、条目及审计；不满足 schema 的现有文件只报错并保留原字节，不能以空结构继续写入。补未知 schema、损坏 JSON、合法 JSON 的错误结构、I/O 失败用例。

### F07 · P2：变更历史没有旧内容，无法实现历史恢复与来源核对

- 位置：`lib/project-memory.js:110–114`、`:122–132`、`:147–159`。
- changes 仅存 op/id/status 等元数据；update 直接替换 text，旧内容在文件中没有任何副本。restore 接受当前 item 或调用方任意新文本，不能按历史 revision 找回旧版本。source 也只保留 kind，传入的 sessionId/messageId 等定位信息被丢弃。
- 实测：新增 ORIGINAL_SENTINEL 后更新，整份 memory 不再包含旧文字；source 只剩 kind。证据：R4。
- 修改要求：保存可重建历史的条目快照或变化记录，历史恢复生成新 revision；保留可核对的实际来源，不伪造原生 ID。UI 补编辑、历史恢复、偏好/问题创建和“存为候选”；当前入口仅能新增已确认 fact，后端有枚举不等于产品闭环完成。

### F08 · P2：持久化静默截断用户草稿和显式引用

- 位置：`lib/draft-checkpoints.js:43–49`。
- 文本超过 200000、引用超过 80000 UTF-16 单元时静默截断，仍返回成功；引用 revision/selection 没有保存。
- 实测：80001 字符引用读回只有 80000，revision 丢失。证据：R6。
- 修改要求：完整保存或明确报超限并保留内存原文；不能以成功恢复的名义返回截断文本。保存路径、revision、selection 等不可变引用信息，恢复后能告知源稿是否变化。

### F09 · P2：构建校验先覆盖产物，因此旧产物也显示 PASS

- 位置：`scripts/verify-writing-build.mjs:16–30`。
- 在读取待校验文件前先执行会写回 client.js 的构建，只比较两次新生成结果；后面 git diff 最多打印 NOTE。与脚本声明“不覆盖，过期失败”不符。
- 实测：在隔离副本把 client.js 改为 deliberately stale，verify 退出 0，并把文件替换成新生成产物；生成结果与当前提交的产物相同。证据：R7。说明本提交产物可重复生成，但校验器无法拒绝未来过期产物。
- 修改要求：构建输出到临时路径，与运行前的工作树产物逐字节比较，差异返回非零且不写回；检查所有构建子进程状态。dev/macOS 构建入口尚未接线，应一并补齐。新增负向校验，覆盖只改源、只改产物、缺源模块和构建失败。

### F10 · P2：备忘输入框的中文输入法确认键会直接创建已确认事实

- 位置：`src/client/entry.js:147–149`。
- 新输入框仅判断 Enter，不检查 isComposing/keyCode229；与同文件聊天输入框已有保护不一致。
- 实测：dispatch `Enter, isComposing:true` 后生成 confirmed 的 IME_CANDIDATE。证据：UI3。
- 修改要求：中文组合输入不触发保存；普通 Enter 或明确“记下”可保存，并处理提交中重复触发、网络失败和新输入保留。

## 2. 原有回归失败需要单独处理

`npm run verify:writing-chat` 复跑两次均在 `scripts/verify-writing-chat.cjs:95` 失败，exit=1：发送成功后期望引用消失，实际仍存在。

新增 loadCompanionDraft 每次读取会替换缓存里的引用对象，而清理使用引用对象相等性判断。旧 fixture 的 provideInfo 每次返回新对象，会触发 `[project, info]` effect 重复读取；当前锁定原生实现返回缓存的 provideInfo，不能据 fixture 失败推断真实内核每次发送均失败。审查新增 UI 用例已改用稳定 provideInfo，F02/F03/F10 仍复现。

要求执行 agent 修正或证明该时序边界：覆盖首次绑定、重挂载和恢复请求在发送期间返回的情况，用明确的草稿/引用版本判定清除；旧 fixture 如需按真实契约修正，应保留等价的迟到恢复测试，不能简单删除断言或改成通过。

## 3. A–F 的实际状态

| 阶段 | 审查判定 | 仍需完成 |
|---|---|---|
| A | 部分且存在构建缺陷 | entry 仍 3166 行；尚无 feature 级拆分；lib/editor-session.js 与 src/shared/editor-session.js 是两份完全相同的实现，P1 引用前者而产物用后者，单源已被破坏；补正确 bundle/只读 verify/dev 与 mac 接线 |
| B | 新适配层未交付 | 沿用旧 ensureCompanionSession；组件仍直读原生 sessions/chat.nodes；没有项目连接去重协调、统一生命周期/能力 facade；“已有会话功能”不能替代本阶段 |
| C | 存储函数存在，恢复闭环失败 | F03/F08，版本化持久化、跨窗口发现/恢复、新输入与迟到加载保护 |
| D | 基础 CRUD 存在，不可验收 | F01/F04/F05/F06/F07/F10；来源/编辑/历史恢复/候选等产品流程不完整 |
| E | 纯函数存在，发送未接通 | F02；透明提示、本次关闭、revision、故障选择与实际 prompt 证据 |
| F | 工程子集，存在回归失败 | 未逐项验收 30 项；未打包/可见预览；缺 architecture.md/preview.md；未真实模型 |

不能把 19 条底层断言直接映射成 19 条完整验收。`acceptance.md` 中 D01 的文件 roundtrip 不证明“未绑定→原生草稿单权威”；M01–M02 没覆盖 UI 编辑、历史恢复和完整状态流程；C01 只有函数预算测试，不证明下一次真实发送中的来源/撤回行为。应标明“单测子集”，补真实验收后再改 PASS。

这轮只需修复内部可靠性、架构与作者可控性，保持自由对话、轻量右栏和 Harness 模型/工具能力；不要用固定写作流程、每轮审批或输出配额掩盖接线和状态问题。

## 4. 本轮实际执行与边界

| 检查 | 结果 | 证据 |
|---|---|---|
| p1-regression | 7/7 PASS | 复跑 stdout；注意当前测试读取 lib 副本 |
| architecture-cde | 19/19 PASS | 复跑 stdout；仅模块用例 |
| verify:writing | 16/16 PASS | review-host-results.json |
| verify:writing-ui | 4 组 PASS | 临时目录 dsh-writing-ui-GaBmlT；exit=0 |
| verify:writing-chat | FAIL，exit=1 | 两次相同断言失败，见 §2 |
| verify:writing-native | 3 组 PASS | review-native-results.json；真实锁定内核，turns=0 |
| 构建副本 + 负向探针 | 可重复生成；校验器误放行 | R2/R7，未改生产产物 |
| 新增 Node 审查探针 | 8 个缺陷场景复现 | review-probes-results.json |
| 新增 React/HTTP 审查探针 | 3 个缺陷场景复现 | review-ui-results.json；稳定原生形状 store |
| 打包/可见预览/真实模型 | 本次未执行 | 已有确定性阻断，先修复再进行这部分验收 |

测试均用独立临时数据；既有 Desktop/electron 窗口未关闭，真实项目/账号/密钥未改动。本轮未修改生产实现、未合并、未提交推送或发版。这里只新增独立审查材料并追加日志。

用户粘贴的两条 “String to replace not found” **没有证明当前文件语法损坏**：现有 entry/client 已包含 Memory CSS、合法的列表 JSX 收尾；生成包 node --check 和实际 React 加载通过。不能用那两条旧工具报错替代上述实际问题的定位，也不能因此认定功能已经完整。

复跑入口（仓库根目录）：

```powershell
node docs/audits/writing-architecture/2026-09-12/review-probes.mjs
node_modules/.bin/electron.cmd docs/audits/writing-architecture/2026-09-12/review-ui.cjs
```

这两个脚本是**故障复现探针**：退出 0 表示成功复现当前缺陷，不表示产品通过。修复后应另写正向回归断言并保留本次证据；不能为了继续得到 REPRODUCED 而保留 bug。Node 跨进程测试用屏障控制时序；UI 脚本复用旧测试的隔离宿主，生产 client 与 host 均不替换实现。探针临时目录保留供核查。

## 5. 可直接交回执行 agent 的修订任务

> 审查对象 cb99ae7 已退回。先完整阅读本 review.md 及原执行方案，不发布，不重置用户数据，不关闭现有 Desktop。保留阶段提交。
>
> 1. 先修 F01/F04/F05/F06：项目身份、最终路径、跨进程事务和损坏文件保护；对误存父目录的数据只诊断，不猜归属迁移。补真实 HTTP、双进程、junction、损坏数据负向回归。
> 2. 完成 A/B 的实际模块边界：shared 编辑控制器单源；正确 ModuleLoader 构建和 external React；只读过期产物校验；Harness adapter 的会话连接协调、状态投影、生命周期与能力降级。保留已有自由对话/完整会话入口，补 H01–H07。
> 3. 完成 C：原生草稿与 checkpoint 的恢复规则、不可变引用、有序/版本化写入、发送清除对应版本、迟到恢复保护、多窗口恢复、I/O 失败提示；修 F03/F08 及聊天回归。
> 4. 完成 D：可核对来源、候选/作者确认、分类与编辑、可恢复历史和正常状态转换；修 F07/F10，不引入每轮强制提炼。
> 5. 完成 E：真实发送读取正确项目备忘，冻结带 revision 的 preparedTurn；显示参与条目/省略数与本次关闭，撤回在下一次发送生效。同时测试源函数与生成 bundle，修 F02。
> 6. 逐项补原方案 30 项验收，不能用底层断言数量代替；维护旧 theme smoke 或提交等价入口。产物放 TEMP；打包字节与最终 SHA 对齐，拉起可见隔离预览并保持运行。没有模型凭据时明确留待验收，不复制正式密钥。
> 7. 更新 handoff/architecture/acceptance/preview/known-issues、CONTRACT、策划案双份及签名日志。逐条回应 F01–F10：修复提交、复跑命令、证据、仍存边界。把审查用例转换为正确行为的回归。交回本审查 agent 后再决定是否可进入发布准备。

— Codex / GPT-6
