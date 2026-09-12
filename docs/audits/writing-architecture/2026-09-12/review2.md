# 第二轮复核：仍退回修改，部分修复已验证

审查对象：修复提交 `6ee2539`，文档提交/当前 HEAD `ca57547`。日期：2026-09-12。基线为第一轮 review.md 的 F01–F10 和第 5 节完整交付要求。本轮读取提交与实际产物，测试均隔离；未重启用户 Desktop、未修改生产实现、未合并/发布。

**判定：仍退回修改。** 这轮修复有效改善了正常流程，原聊天回归也恢复通过；但活锁被抢导致丢更新、迟到恢复覆盖新输入、备忘 GET 越界读取仍可触发。因此不能关闭全部 F01–F10，也不能进入合并或发布准备。

## 1. 已验证的修复与尚未关闭范围

| 原编号 | 本轮复核 | 限定范围 |
|---|---|---|
| F01 | 兄弟项目场景通过 | A/B 各含 project.md 时，目录参数正确隔离；库根自身就是项目时仍写入失败，见 N03 |
| F02 | 已确认备忘进入真实组件的 prompt，生成包默认预算正确 | 不再抛 DEFAULT_BUDGET；故障选择、参与条目提示/本次关闭、revision 透明性尚未完成，见 N05 |
| F03 | 普通绑定会话刷新可恢复文本与引用 | 迟到恢复仍覆盖未绑定会话新输入，见 N07；持久化错误仍不可见，见 N06 |
| F04 | 写入的静态 state junction 检查通过 | GET 未做同等检查，见 N01 |
| F05 | 增加了锁与部分版本条件 | 会抢掉超过 10 秒的活跃锁；空条件可绕过校验，见 N04/N02 |
| F06 | 第一轮错误结构用例已修复 | 本轮用精确字节比较确认原件未变；不等于所有字段/审计 schema 已完整验证 |
| F07 | before/after 文本及 sessionId/messageId 可保留 | 历史 UI、分类/候选/编辑流程未补；restore 仍没有历史 revision 选择参数，findHistorySnapshot 只返回最近 before 且未接入 UI |
| F08 | 超限函数返回 413；引用字段不再按旧阈值截断 | 前端吞掉持久化错误，作者仍不知道恢复副本没保存，见 N06 |
| F09 | 校验不写回，陈旧产物返回非零 | 在临时仓库副本跑过负向用例；A 阶段的 dev/mac 构建接线不因此自动完成 |
| F10 | IME composing Enter 不再创建事实 | 稳定 provideInfo、真实组件验证通过 |

另已确认 lib/editor-session.js 改为 re-export，编辑控制器双实现问题解决。原 verify:writing-chat 四组现在全部通过，不再沿用第一轮失败结论。

## 2. 剩余问题与修订要求

行号对应 ca57547，路径相对仓库根目录。下面 N 编号用于第二轮回应，原 F 编号继续保留。

### N01 · P1 · F04 未关闭：GET 可以读取库外备忘并供聊天使用

位置：`plugin/writing-mode/lib/project-memory.js:111–115`；`plugin/writing-mode/index.js:473`。

新增 realpath 校验只在 applyMemoryOp 中执行，readMemory 仍直接拼接路径并 readFileSync。项目 state 为指向库外的 junction 时，POST 拒绝但 GET 返回库外文件。如今 send 已接通 GET memory，因此库外的 confirmed 内容还有进入 prompt 的路径。

实测：项目在允许库内，state 指到库外临时目录；外部文件含 `OUTSIDE_SENTINEL`。HTTP GET=200 并返回该条目，POST=400。证据：review2-probes-results.json N01。

修改要求：读/写共用最终文件、父目录与项目/库根的边界验证；覆盖 state 目录链接、文件链接、缺失文件。拒绝时不回传库外内容；发送读取失败使用明确的失败处理，不能自动带入数据。

### N02 · P1 · F05 未关闭：null/空串使乐观并发条件形同缺失

位置：`lib/project-memory.js:193–204`；UI `src/client/entry.js:126`。

空 baseRevision 被跳过、空 baseEtag 不比较，但“必须提供条件”仅判断两个字段是否都是 undefined。传 `baseRevision:null, baseEtag:""` 即跳过全部检查。当前策略还只要求至少一个条件；UI 仍只发送 etag，与原方案“revision 和字节 etag 同时核对”不符。

实测：已有 revision>0 的备忘，用上述空条件 POST add，返回 200 并升版本。证据：N02。

修改要求：把缺省、null、空串、错误类型统一判为无效条件；对修改强制提交有效 baseRevision/baseEtag，且在锁内比较。首次创建也必须有明确的版本 0/空文件 etag 协议，使同时创建只有一方成功。UI 提交两个值；补合法/无效/旧值/外部只改字节等真实 HTTP 用例。

### N03 · P2 · F01 不完整：项目目录就是库根时，读取正常、写入失败

位置：`lib/project-memory.js:184–188`。

inLib 要求 `rel !== ''`，因此项目根与配置的 library root 相等反而被排除。库根并不必然是多个项目的父目录；作者可直接把已有作品文件夹设为库。

实测：把包含 project.md 的 A 目录本身设为唯一库根，GET memory=200，使用有效 etag/revision 的 POST=400/path-outside-roots。证据：N03。

修改要求：允许经项目解析确认的项目根等于库根；只拒绝逃逸，保持 sibling/目录/文件解析一致。另需落实第一轮要求的父目录误存诊断，不能猜归属迁移。

### N04 · P1 · F05 未关闭：超过 10 秒就删除活跃锁，仍然丢更新

位置：`lib/project-memory.js:67–74`、`:88–93`。

实现没有存储/验证持有进程身份，只根据 mtime 超过 10 秒 unlink。锁内 token 也未用于校验所有者，finally 无条件删除同一路径。进程暂停、磁盘阻塞或调试停顿并不代表持有者退出，删除锁会让两个事务同时存活。

实测使用两个实际进程：第一个进程已取得锁并读到旧字节，保持 fd 打开，等待测试屏障；实际等待 10.5 秒后，确认该进程仍运行，再提交第二次写入。第二次返回 revision=2 成功；释放第一个后它也成功，最终只剩 base/holder，第二次写入的 other 及对应审计丢失。没有伪造 mtime，也没有替换生产锁函数。证据：N04。

修改要求：不以 TTL 单独判死；采用可验证所有者身份的跨进程机制，释放前验证所有权。无法证明持有者已退出时只报锁等待/诊断，不抢锁。测试正常并发、持锁超过阈值仍活跃、崩溃恢复、所有者更换以及清理不能删掉别人的锁。

### N05 · P2 · F02 不完整：备忘损坏被静默当空数据发送

位置：`src/client/entry.js:101–107`、`:327–338`；`src/shared/context-builder.js:46–56`。

loadProjectMemory 抹掉错误原因，send 在 ok=false 时使用空 items 并继续 prompt。用户没有看到备忘读取失败，也没有选择“这次不带备忘”。此外 send 虽传入 memoryRevision，builder 根本没有保留或序列化该字段；memoryHint 仍未接入界面，没有参与条目展开/本次关闭入口。

实测将隔离项目真实备忘文件写成损坏 JSON，让真实 host 返回错误；组件仍发送消息，prompt 不含已确认标记，界面无错误。另对生成包传 memoryRevision=42，返回对象没有该字段。证据：review2-ui-results.json N05、Node F02 evidence。

修改要求：保留可诊断错误，失败时提供重试/本次不带备忘的轻量选择；正常聊天不增加逐条审批。完成原方案提示、展开、本次关闭、参与快照 revision 与来源记录，明确区分参与和省略的条目。

### N06 · P2 · F03/F08 不完整：HTTP 413 被吞掉，恢复副本未保存却无提示

位置：`src/client/entry.js:87–98`。

persistCompanionDraft fire-and-forget，既不检查 `{ok:false}`，也吞掉 fetch 错误。后端从静默截断改为 413 后，UI 仍不知道 checkpoint 写入失败，刷新时可能恢复旧稿或没有恢复副本。

实测在真实组件的 fetch 边界注入与新后端一致的 413/reference-too-large，确认拒绝发生，界面没有错误。后端真正超限返回 413 的函数行为已在独立 Node 用例验证。证据：UI N06、Node F08。

修改要求：将持久化成功/失败显示为简短状态，保留新输入，提供重试/保存出口；不要因为每次键入弹窗。补有序或 revision 条件写入，成功发送只清除对应版本，防止延迟的旧 POST 把草稿复活或覆盖新内容。

### N07 · P1 · F03 未关闭：恢复响应迟到会覆盖未绑定会话的新输入

位置：`src/client/entry.js:269–285`，缓存写入 `:72–80`。

loadSeq 是 effect 内局部变量，每次只从 0 变到 1，与用户输入没有关联。未绑定会话没有 info，nativeDraft 始终空；恢复请求返回时不管 localDraft 已被用户编辑多久，都会 setLocalDraft(c.text)。loadCompanionDraft 还会先覆盖缓存。`[project]` 仅减少 effect 次数，没有防住这个时序。

实测：同一窗口已有 OLD_CHECKPOINT、项目没有绑定会话；暂缓真实 GET 的响应，输入 NEW_TYPED_WHILE_RECOVERING，界面先正确显示新文字；释放旧响应后输入变成 OLD_CHECKPOINT。证据：UI N07。

修改要求：用稳定的 edit/recovery generation 追踪请求开始后本地是否变化；过期恢复不得更新文本、引用或缓存。原生非空保留只是一个分支，还需保护未绑定本地草稿，以及作者主动清空/移除引用、切项目、首次绑定期间的状态。

## 3. 本轮测试证据与局限

| 检查 | 结果 |
|---|---|
| 执行 agent 的 review-f01-f06 | 9/9，在临时仓库副本运行；原测试会暂写 client.js，未在用户工作树执行它 |
| architecture-cde / p1-regression | 20/20、7/7 |
| verify:writing-build | PASS，工作树产物未改变；陈旧产物负向用例非零且保持原字节 |
| verify:writing | 16/16，review2-host-results.json |
| verify:writing-chat / verify:writing-ui | 各 4 组 PASS |
| verify:writing-native | 3 组 PASS，真实锁定内核，无模型回合；review2-native-results.json |
| review2-probes.mjs | 5 组修复确认，4 个剩余缺陷复现；review2-probes-results.json |
| review2-ui.cjs | 3 组修复确认，3 个剩余缺陷复现；review2-ui-results.json |
| 打包、可见预览、真实模型 | 本轮未执行；有确定性数据安全阻断，先修复 |

两个 review2 脚本混合正向确认和负向复现；打印 PASS 表示对应修复用例通过，REPRODUCED 表示故障仍在，exit=0 仅代表脚本按预期执行完成。不能用其 exit=0 冒充整体验收通过。第一轮探针保留不变作为历史；本轮转换了修复场景的断言并补时序/读取方向，避免“旧脚本不再 REPRODUCED 就算全修好”。

执行 agent 新测试有两个薄弱断言，返工时应加强：坏文件检查只判断包含 `{`，不能证明字节保全；junction 测试检测的是 outside/state/writing-memory.json，而实际逃逸目标应是 outside/writing-memory.json，且 setup catch 会报 PASS。本轮审查已用正确目标/字节检查独立复核，不沿用这两条弱断言作为保证。

## 4. 架构与交付未因修 bug 自动完成

本次 diff 仍没有完成独立 Harness adapter、feature UI 拆分、项目首次连接协调、跨窗口草稿恢复入口、候选/历史操作 UI，以及原方案 30 项逐项验收。package.json 增加的是测试命令，start/dev 和 macOS 构建并未接入构建步骤。handoff/acceptance/known-issues 仍沿用上一轮内容，尚未按本轮实际测试更新。

ca57547 的文档差异是 CHANGELOG、WORKLOG 和日志归档上一轮审查；不能把它当本轮 F01–F10 验收对照已经完成。请提交一份新的修复回应，按本报告“已通过的限定范围”和 N01–N07 填写结果，不覆盖旧报告。

用户粘贴的两条替换失败：当前 entry 和生成包已有 IME 守卫，context-builder 也已使用函数内字面量 6000；实测均通过。这两条历史工具报错不构成本轮残留缺陷证据。

## 5. 可直接交回执行 agent

> 第二轮仍退回。完整阅读 review2.md；保留第一轮已通过部分，先修 N01/N02/N04/N07（读路径、有效并发条件、活锁安全、迟到恢复），再修 N03/N05/N06。补正向集成测试及受控时序，不只跑原单测；对照 F01–F10 逐项说明“关闭范围/未关闭范围”。随后完成原 review.md §5 尚缺的 A/B 架构与 C/D/E 产品流程、30 项验收、打包字节校验及可见隔离预览。更新 handoff、acceptance、known-issues、CONTRACT/策划案及本轮日志，不自动发布。交回最终 SHA、每项命令及机器证据后复审。

— Codex / GPT-6
