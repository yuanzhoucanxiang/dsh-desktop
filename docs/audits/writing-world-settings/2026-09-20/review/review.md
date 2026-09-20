# 世界观引导与整理：独立复核 1

日期：2026-09-20；复核：Codex。基线 HEAD a9aa8b8，实际被测为未提交工作树，文件哈希见 identity.json。

**结论：退回整改，不接受“P0–P5 工程可交回/工程主体完成”。有已实现且通过的 host 能力，但新包插件不能加载、世界观面板为空、整理请求未真正发送。暂不进入发布或将问题转交作者手工真模型验收。**

## 1. 本轮实际验证

- 复跑 `npm run test:writing-world`：34 + 12 + 23 + 21 全过，保存完整输出。这证明现有用例通过，不证明下列边界。
- 隔离 Electron 复跑原 `verify-writing-chat.cjs`：5 组通过，未关闭任何用户桌面。
- 独立探针：host/包 8 项、组件回调 3 项、真实 Electron DOM 1 项，共 **12 项复现缺陷**。组件回调探针使用真实组件打包代码、hook/API 测试替身，不能冒称真实 UI；空面板另有真实 Electron 截图。
- 未运行完整 reading/native/ui/打包门禁和真实模型五场景；前置流程已经阻塞，无必要用作者真实稿件试错。
- 预览 PID 15584 仍存在，但无主窗口标题；其 kernel.log 明确报插件加载失败。`keptRunning:true` 只是启动脚本写入的字段，不是就绪证据。末尾 ChildProcess.kill 报错原因本轮未确认，也未杀掉该进程。

## 2. 返工清单

### A01 [P1] 新包缺少 host 的传递依赖，预览内核实际失败

位置：`lib/project-memory.js:22`、`lib/setting-projection.js:9`、`runtime-manifest.json`。
两处 import `../src/shared/world-setting.js`，发布清单却不包含它。直接导入交回包中的 project-memory.js 得到 ERR_MODULE_NOT_FOUND；已运行预览的 kernel.log 同样报 writing-mode 插件加载失败。manifest 16 文件逐字节一致只能证明清单自洽，不能证明依赖闭包完整。
修复：让 shared host 依赖正确进入发布集合，或采用单一实现的打包方案；门禁递归检查插件 host 的相对依赖，并从全新包/profile 真导入及等待内核就绪。禁止仅给旧预览手工补文件后宣布新包通过。
证据：host-results.json A01、preview-error.txt。W22/W25 应改 FAIL。

### A02 [P1] 世界观界面与候选卡片的 children 传错位置

位置：`src/client/features/world-settings/index.js:47,259` 及内部多数 jsx 调用。
把 `jsx.jsx(type, props, children)` 当成 createElement 用；jsx-runtime 第三个参数实际是 key，内容应在 props.children。真实 Electron 看到 `<div class="dshWmWorldPanel"></div>`，0 个子节点、0 个按钮。无 console error 不代表界面正常。
修复：全部使用正确 jsx/jsxs 调用；真实 DOM 测试必须点到来源选择、整理、候选编辑、确认及已保存项操作，不能只检查容器存在。
证据：ui-results.json、empty-panel.png。P2 当前不可用。

### A12 [P1] 整理发送违反 adapter 契约，且未绑定本轮结果

位置：`features/companion/index.js:145–154,443–455`；`adapters/harness/adapter.js:388–391`。
现调用 handle.send(prompt字符串, options)，adapter 实际读取 preparedTurn.body。探针返回 rejected/empty-body，原生 prompt 调用数为 0；上层只 await、不检查 rejected/uncertain，因此保持等待。
此外 worldOrganizingRef 只是一位布尔值，未记录发送前节点基线/operationId/冻结来源；effect 遇 running=false 就取最后一个助手消息，失败后仍可能把旧回复或无关回合当整理结果。来源选择也是消费时读取当前 worldSelection，并非冻结快照。
修复：沿既有 preparedTurn/受理三态契约发送；绑定新的回合证据、项目、generation、范围快照。拒绝/不确定/取消/卸载/切项目均有独立恢复路径；必须补迟到与旧回合负向 UI 测试。
证据：host-results.json A12 验证发送拒绝；旧消息/切项目风险为代码确认，尚未跑完整时序。

### A03 [P1] 被拒绝的陈旧请求仍先升级数据 schema

位置：`lib/project-memory.js:399–413`。
schema1 分支先 backup + commitMemory(schema2)，之后才校验 revision/etag。探针提交 revision=99 的陈旧请求，返回 revision-conflict，但磁盘已从 schema1 变为 schema2。旧版将无法继续读取，且失败请求产生持久副作用；后面的 payload 校验失败也有同类问题。
修复：在锁内先完成令牌/操作/容量/输入校验，准备好新状态及备份，再一次提交迁移后的业务结果。所有失败路径断言原文件字节不变。
证据：host-results.json A03；W08 不能继续全 PASS。

### A04 [P1] 幂等身份未覆盖实际载荷，且 UI 的操作生命周期不正确

位置：`world-settings/index.js:18–20,187,196–202,243–247`；`project-memory.js:229–238,383–394`。
JSON.stringify(payload,Object.keys(payload).sort()) 的 replacer 白名单同样作用于嵌套对象，item.setting 内容被抹掉；两个不同结论得到相同 hash。host 又只相信客户端 hash，同 operationId/同 hash/不同正文被当 replay，返回旧内容而不是冲突。
另外 UI 只有成功后才保存 operationId，丢失响应后重试会生成新 ID；成功保存候选之后确认/改内容又复用旧 ID，op/hash 变化即冲突。固定 ID 应绑定一次逻辑操作，不能绑定整张候选卡。
修复：host 规范化完整请求并自己计算 hash、比较操作类型与目标；客户端请求前持久化 operationId/原载荷，同一次重试复用，新的编辑/确认生成新操作 ID。收据查询接入实际 UI。
证据：host-results.json A04、client-results.json A04；响应丢失及保存候选→确认需补端到端测试。

### A05 [P1] 保存第一张候选会把所有未保存候选关联到同一记录

位置：`world-settings/index.js:242–245`。
条件 `d.id === draft.id || d.savedId === draft.savedId` 在两个未保存候选上均满足 undefined===undefined。保存 A 后，A/B 都获得 savedId=saved-A 和同一个 operationId，后续保存 B 将误更新 A 或发生错误重放/冲突。
修复：只按稳定本地候选 ID 更新，并校验服务端 receipt.itemId；不要用 undefined 比较或“最后一个 item”猜目标。
证据：client-results.json A05，直接执行实际组件保存回调。

### A06 [P1] 投影失败被吞掉，界面没有修复入口

位置：`world-settings/index.js:226–248`。
api 的 HTTP 错误返回 `{ok:false,error}`，不会 throw。投影请求既不检查返回值又 catch 丢弃网络错误，然后统一显示“设定已保存”。探针投影返回 projection-conflict，界面仅显示成功，没有“可读稿待同步”，也没有重试/差异/另存入口。
修复：权威保存与投影同步分别呈现状态；把 pending/conflict/error/synced 纳入可订阅状态；刷新读取投影状态，并提供实际可操作的重试、差异与保留手稿路径。不能让用户手工删文件作为唯一恢复办法。
证据：client-results.json A06；W14/W16 的 UI 子项应为 FAIL/NOT_RUN。

### A07 [P1] 模型伪造的来源优先于作者真实选择

位置：`src/shared/world-setting.js` parseOrganizeResult/normalizeSetting；`world-settings/index.js:128–141`。
解析保留模型 sources，UI 用 `s.sources?.length ? s.sources : sources` 优先采用。模型可填 FAKE_SESSION/FAKE_MESSAGE 和“作者已批准”摘录并被存成作者来源。真实选择生成的摘录还无提示 slice(0,500)，snapshotHash 可为 null。
修复：模型来源字段全部忽略；从 adapter 的冻结真实快照生成，保存 ID/角色/摘录与 hash；超容量明确提示/选择范围，不静默截断。建议/未决 mark 也必须在卡片可见，不能只解析后隐藏。
证据：host-results.json A07；W04/W07 的“伪造来源已挡住”结论不成立。

### A08 [P1] 保存已确认设定的修订候选会立即撤掉生效版本

位置：`project-memory.js:436–446`。
对 confirmed ID 调 save-setting-candidate 会直接覆盖内容并把状态改 proposed。探针 confirmed 条目立即从 injectable 消失。违背“修订未确认时旧确认版仍生效”。
修复：修订草稿和当前生效记录分开；新修订确认时原子替换，历史保留双方。不要仅把 UI 按钮隐藏当 host 语义修复。
证据：host-results.json A08；W12 应改 FAIL。

### A09 [P1] 同名手稿只要含固定提示语就会被自动接管覆盖

位置：`lib/setting-projection.js:134–136`。
无 managedHash 时，只要文件包含 PROJECTION_NOTE 就放行；正文空白也放行。探针创建“提示语 + 作者独有手稿”，无受管记录仍被写成新生成稿。可备份不等于允许未授权覆盖。
修复：只有权威受管记录及完整哈希能授权覆盖；任何既存、无受管记录的同名文件均冲突。合法中断恢复需要保存预期 hash/源 revision，不能凭一句文本认领。
证据：host-results.json A09；W16 的保护范围不足。

### A10 [P1] 新增备份子目录未检查 realpath，可写出项目

位置：`project-memory.js:330–336`；`setting-projection.js:145–149`。
state 本身被检查，但 state/backups 和 state/projection-backups 新建/写入前无真实路径校验。探针让 state/backups 为项目外 junction，迁移在项目外实际写入备份。投影还计算目标 realTarget 后丢弃，未验证文件本身的归属。
修复：备份和投影的每一层已有路径、最终文件/链接都校验；读和写一致，拒绝逃逸后原文件与外部目录保持不变。补两个备份目录与目标文件链接测试。
证据：host-results.json A10 已验证迁移备份越界；其余分支为代码发现，待补探针。W17 仅测项目根不足以覆盖。

### A11 [P1] 投影文件写入不在项目锁事务内，标记失败前已经改文件

位置：`index.js:600–624`；`setting-projection.js:121–161`。
HTTP 先读 memory/check token，随后无锁生成并写可读稿，最后 applyMemoryOp 才获取锁写标记。另一个 host 可在中间确认/投影新版本；旧请求可能覆盖新投影，然后才收到 409。generatedAt 每次重新取时间，崩溃后也没有持久化预期内容 hash 可可靠重建，现有“mark 路径”测试并未证明真实请求的崩溃恢复。
修复：把读取当前权威版本、投影 hash 校验、写投影和更新标记纳入同一受验证锁序列；或采用持久化意图+明确 CAS 的协议。对真实 route 注入每个崩溃点并做两独立进程竞争，不仅直接调用 render/write 后断言。
证据级别：代码审查确认锁范围缺失；本轮未实施完整并发/崩溃复现，不冒称已跑。

## 3. 尚未实现的必做闭环

- 已持久化的 worldItems 只读展示，无重新打开编辑、确认已保存候选、修订、撤回和历史入口。既有普通备忘 UI 未提供 clientSchemaVersion=2，不能代替这些操作。
- 候选只有内存 state；刷新丢稿已由实施者承认。界面写一条说明并不满足离开提示/恢复要求。W05 当前应 FAIL，不是只缺真实模型。
- 格式失败显示原文，但没有“手动整理为候选”的真正入口；投影冲突也没有差异/另存 UI。
- 工程门禁缺少新功能完整 UI 路径，已有聊天 5 组仍全过却不触及空白面板。说明必须加新覆盖，不能删老断言。
- known-issues 中把没跑 Electron 归因为“不擅杀用户桌面”不充分：现有 chat fixture 是隐藏隔离窗口，本轮已安全运行。测试流程如有风险应修正隔离，不能以此跳过全部 UI 验收。

## 4. 建议修复次序

1. **A01/A02/A12**：先让新包加载、界面可见、整理请求真实发送；增加端到端 happy path，并修整来源冻结/结果关联。
2. **A03/A04/A05/A07/A08/A09/A10/A11**：收紧迁移、幂等、数据身份、手稿与路径保护，补负向故障探针。
3. **A06 + 必做闭环**：补投影失败恢复、候选持久化、已存设定修订/撤回/历史；不得拿只读列表算完成。
4. 原完整门禁、新功能真实 UI、两窗口、多进程、全新真包/profile；上述通过后才跑真实模型五场景和提供新的可见预览。
5. 按 W00–W25 修订 acceptance，明确 host PASS 与 UI FAIL，不再把工程未实现归类为“需作者真模型体验”。

## 5. 复跑入口与交回要求

在仓库根运行：

```powershell
node docs/audits/writing-world-settings/2026-09-20/review/probes.mjs
node docs/audits/writing-world-settings/2026-09-20/review/client-probes.cjs
node node_modules/electron/cli.js docs/audits/writing-world-settings/2026-09-20/review/ui-probes.cjs
```

探针当前打印 REPRODUCED；它们是独立反例证据，不是发布门禁。修复后转换为正向保护断言（包含新包路径参数、真实确认流程），不能只让字符串不匹配就算通过。特别是 A12 改正 send 参数后，还必须测 rejected/uncertain/旧消息/切项目；A02 容器有文字后还必须完成确认落盘。

交回新源码 SHA/工作树身份、新包路径与 hash、原基线、新正向/负向证据、真实 UI/模型状态。不要覆盖这份首轮复核证据。未改生产代码、未提交推送、未发版、未关闭预览或正式桌面。

署名：Codex