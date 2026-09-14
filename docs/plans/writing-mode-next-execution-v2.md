# 写作模式下一阶段执行方案 v2

日期：2026-09-14。交付对象：接手实施的 agent，完成后交回审查。

**目标：在已通过的保存/恢复基础上，完成模块边界、可靠的会话接入、作者可控制的项目记忆，以及可验证的打包体验。** 本文件是待实施方案，不是完成证明。

## 0. 基线、范围与执行方式

- 仓库：`E:\Deepseek harness\dsh-desktop`；当前分支 `feat/writing-mode-architecture`，规划时 HEAD `5a152dc03cf103258e6a7ec0b8b7a0c5a21c96bd`。实际开工先重新记录 HEAD 和工作树，不覆盖其他 agent 改动。
- 依据：[整体复评](../audits/writing-architecture/2026-09-14/overall-assessment.md)、[原执行方案 v1](writing-mode-architecture-v1.md)、[第九轮通过记录](../audits/writing-architecture/2026-09-13/review9.md)。v1 的 30 个验收 ID 保持有效，本方案补充实施顺序与具体决策；冲突时优先遵守用户要求。
- 已确认：当前 UI 32 条时序通过；现有 unpacked 包/profile 的 13 个插件文件与源码一致。它们是回归基线，不代表完整架构/30 项/升级/真实模型验收。
- 当前未提交的复评和本方案文件先整理进文档提交；不要把文档归档提交说成新增生产能力。沿当前架构分支按批提交，不自动合并 main、打 tag、发 Release 或替换正式安装。
- 四批顺序执行，批内采用小提交；技术自检通过后自主进入下一批，无需逐批询问用户。发现故障先修当前批，不把大量互相依赖的未验证修改积压到最后。
- 只实施本方案，不升级内核、不换编辑器、不另建模型网关/聊天历史数据库/向量库，不做全站换肤或后台主动陪聊。

产品原则保持：右栏使用写作专用界面；模型、工具、权限、压缩、完整会话来自 Harness。允许讨论、改口、闲聊及明确要求后的执行，不设固定轮数、输出字数、任务卡或每轮记忆审批。

## 1. 总顺序与交付门槛

| 批次 | 主要工作 | 必须交回的实物 | 结束条件 |
|---|---|---|---|
| P1 | 真正模块化源码与构建 | 模块目录、依赖说明、单一构建入口、包资源清单 | UI 不变，原正向时序通过；不是把巨型入口换名 |
| P2 | Harness adapter 与会话协调 | 稳定 handle/snapshot、创建协调、异常恢复测试 | 跨窗口首次关联、迟到操作、受理不确定可解释且不自动重发 |
| P3 | 记忆、引用、上下文闭环 | 备忘完整操作、历史、恢复比较、当轮参考开关及快照 | 来源/版本可核对、作者可修正、普通交流不被流程绑住 |
| P4 | 30 项、打包与可见预览 | 逐项矩阵、包/安装证据、当前可见实例、完整交回材料 | 必做工程项无缺失，待真实模型项单独列明 |

P1 先做职责提取，不同时重新设计状态机；P2/P3 才按新增行为修改状态。不要一次改造构建、会话协议、存储 schema 和 UI 四个层面后只跑一次测试。

## 2. P1：源码边界与确定性构建

### 2.1 目标结构

```text
plugin/writing-mode/
  client.js                         # 唯一生成的 ModuleLoader 入口
  src/client/
    entry.js                        # apply/inject、依赖装配、卸载
    app/WritingModeApp.js            # 三栏布局与功能编排
    features/editor/                # 稿纸和编辑操作
    features/library/               # 项目树/搜索/新建
    features/companion/             # 对话、输入、引用/恢复 UI
    features/memory/                # 备忘列表/编辑/历史
    features/tools/                 # 检查和文字工具
    features/settings/
    adapters/harness/               # 唯一原生会话接触面
    services/writing-api.js          # HTTP 编码、错误归一化
    services/context-service.js     # 备忘读取及准备发送
    state/companion-drafts.js        # 每项目/窗口草稿、保存状态、冲突
    styles/                         # 样式源码，最终内联进产物
  src/shared/
    editor-session.js               # 保持唯一编辑控制器
    context-builder.js              # 纯函数及不可变 preparedTurn
    contracts.js                    # JSDoc 类型与状态约定
  lib/                              # host 存储/业务；必要新模块可嵌套
  index.js                          # 路由校验与接线
```

路径名称允许小幅调整，但要有实际独立职责。entry 不含整段样式、功能面板、会话节点转换或保存队列；不以“低于某个行数”代替这个约束。

### 2.2 提取顺序

1. 提取样式、文案和 HTTP 客户端，输出与现有行为保持一致。
2. 提取 library/settings/tools/editor 组件，继续调用同一个 `createEditorSession`。
3. 提取伙伴草稿 store 与 companion/memory 组件。先搬现有已通过行为，保留草稿与业务错误分离；本步不改变持久化协议。
4. 将 native 接触代码集中到 adapters/harness；这一提交可先保留兼容行为，P2 再补齐并发与异常协议。

### 2.3 构建决策

- 使用仓库已有 esbuild 与 lockfile，不新增另一套打包工具。改造 `build-writing-client.mjs` 为真实模块构建，停止用正则截取函数拼装依赖。
- `bundle: true`、CJS 输出，`react` / `react/jsx-runtime` 为 external；外层继续包装成已有 `window.__ModuleLoader__.load({id,factory})`，由 factory 的 require 解析原生 React。客户端不引入 Node fs，不打入第二份 React/ReactDOM。
- `client.js` 继续作为提交产物；不嵌入本机绝对路径、时间戳或密钥；两次构建应字节一致。`verify:writing-build` 仍临时构建、先读现有产物、过期失败且不覆盖。
- dev/start 用 prestart/predev 接到同一构建入口；Windows `build.ps1` 与 macOS `build-macos.sh` 在资源打包前显式调用；直接调用 electron-builder 的 CI/脚本也必须包含此步骤。不要假设接上 npm 命令就覆盖脚本直调。
- 客户端依赖打进 client.js。当前仅用于测试的 `lib/editor-session.js` re-export 不作为 host 运行时依赖；运行时资源清单排除它，测试仍直接使用同一源码控制器。若后续 host 需要共享模块，构建为明确的运行时模块并列入清单，不留下指向包外 src 的导入。
- runtime 文件改用明确清单与递归复制；包、profile 与清单逐文件比对。不能只检查 client/index 两个 hash。不要任意删除 profile 的用户文件；清理旧受管文件时必须能识别它确属上个受管版本，否则保留并记录。

### 2.4 P1 验收

旧四套回归、CDE/P1/status/protocol 及 review9 的 32 条正向时序通过。DOM/构建适配变化可更新测试装配入口，不能删除行为断言或把内部算法抄成测试替身。增加依赖检查：feature 不直接 import 原生模块、adapter 不 import JSX/组件、共享控制器不依赖 React/DOM/fs。先允许少量显式过渡项，批末清零。

## 3. P2：Harness adapter、会话协调和异常恢复

### 3.1 唯一接触面

以下是要新建的应用内接口，不是假设内核已有同名 API：

```text
createHarnessAdapter({sessions, workspaces, connection, api})
  capabilities()
  connect(projectIdentity, operationToken) -> handle
handle:
  getSnapshot() / subscribe(fn)
  getDraft() / setDraft(text)
  send(preparedTurn) -> accepted | rejected | uncertain
  cancel() / openFullSession() / dispose()
```

snapshot 明确包含连接状态、sessionId、稳定消息列表、工具活动、排队状态、待处理请求、能力缺失和错误。无变化时对象引用稳定；UI 不读取 `chat.nodes/order`、`provideInfo` 或工作区创建 API。未知节点保留可见摘要和完整会话入口，授权/问题不隐藏或自动批准。

聊天历史仍只有 Harness 一份；投影可以丢弃重建。dispose 只释放订阅，不擅自取消模型任务或删除会话。

### 3.2 创建协调

- 进程内按 host 返回的 canonical project identity 共用创建中的 Promise。
- 跨窗口由 host 新增“关联预留/确认/状态”协调协议；持久记录放应用 home 下的 writing-mode 专用目录，按项目身份分桶，使用受验证的跨进程互斥更新。
- 持久记录至少包含 operationId、owner、phase、绑定版本、已知 workspace/session 标识；阶段为 reserved → creating → bound，外部结果无法确认进入 uncertain。网络/内核调用不在文件锁内长时间等待。
- 列出并验证真实锁定内核可用的查找/创建能力，再完成 adapter 映射。客户端将创建结果以相同 operationId 确认；过期 token 不得改写新绑定。
- 超时或窗口消失后，不直接把预留删掉再建新会话。先根据已知 ID 和原生记录恢复；如果无法判断外部创建是否发生，保留 uncertain 并给出继续关联/查看完整会话的恢复入口。没有内核幂等依据时，不承诺 exactly-once，也不自动删除疑似孤立会话。
- 心跳/超时只用于发现需要恢复的操作，不授权抢活锁或重复创建。沿用先前“不凭 TTL 删除活锁”的约束。

### 3.3 迟到、删除与不确定受理

- 每个连接/发送记录 project、session、operation token；A→B 后迟到结果只能归回 A，不能切走 B 或把 A 草稿发到 B。
- 原生已有会话保留模型/角色/自定义预设。会话被删时先呈现状态及恢复操作，不静默切到新空会话。
- send 的结果区分明确拒绝与可能已受理。uncertain 状态保留正文，先核对原生回合/队列；无可靠判定时作者可查看完整会话决定，禁止自动重发。
- 普通交流不走额外审核；只在真实异常时出现恢复操作。

### 3.4 P2 验收

H01–H07 逐项：两个隔离窗口同时首次关联；连点发送/设置；A 创建中切 B；workspace 已建但 session 创建结果丢失；绑定确认失败；会话删除；缺失 API；受理后网络断开。检查原生对象数、最终绑定、消息目的地及保留的草稿。fixture 与真实内核分别给证据，不能用 checkpoint 的并发测试代替会话创建协调。

## 4. P3：项目记忆、引用恢复与当轮上下文

### 4.1 备忘 UI 的最小完整操作

保留现有存储、revision + etag、严格校验、审计快照和锁协议，增加以下入口：

| 作者操作 | 状态与来源 |
|---|---|
| 手工新增设定/偏好/待定问题 | 可选类型；点击“保存为项目备忘”是明确作者操作，来源 author |
| 从助手消息选一段“记为候选” | 保存 proposed；来源 assistant，保留真实 messageId/sessionId 或可核对的文本快照，不编造 ID |
| 编辑候选 | 仍为 proposed；不因改了文字自动变 confirmed |
| 确认候选 | 作者明确操作后 confirmed；审计记录操作者，保留原始来源 |
| 编辑已确认条目 | 保存产生新 revision 与 before/after，保留来源及作者修改轨迹 |
| 撤回/问题已解决 | 保留条目与历史，新回合不再自动注入 |
| 查看历史并恢复某版 | 显示差异；明确恢复后产生新 revision，不回退版本号 |

第一版候选采集由作者在消息上主动操作，不额外调用模型自动提炼每轮记忆，也不把助手文本自动升级为事实。未决问题即便被确认保留，仍是问题，不能混入默认事实列表。

冲突时保留编辑框内容，提供刷新与比较，不把自动刷新当成保存成功。坏 JSON/未知 schema 保留原件；提供诊断/导出及安全恢复说明。对遗留死锁给出识别持有者、停止受影响写入并离线恢复的操作路径，禁止运行中盲删锁。

### 4.2 当轮上下文

输入区增加简短入口：“参考项目备忘 · N 条”。可展开查看将采用的条目、来源及省略数量，可按条勾选；一个开关控制本次是否参考备忘。默认开启，对话本身不增加必填项。

- 自动参考限当前项目 confirmed fact/preference；不自动引用 proposed/retracted/resolved。待定问题仅在作者选择时以“待定问题”单独标识。
- 顺序：作者本次勾选/固定的有效条目优先，然后确定性选取其他有效条目。自动部分默认预算 6000 Unicode 字符，明确不是 token 计量；作者消息和显式稿件引用不受这个自动预算截断。
- 展开面板的数据不是发送权威。每次真正发送重新读取备忘：已撤回/修改条目用最新有效状态；读取失败显示重试/不参考发送，保留正文，不静默使用过期缓存，不自动重复已受理消息。
- 每次准备结果包含：projectKey、operationId、message、reference、memoryRevision、memoryEtag、实际采用条目的 ID/状态/来源/文本、选择原因、省略信息、body。对数组元素等嵌套对象也保持不可变。
- 当前缺失的 memoryRevision 必须真正进入 preparedTurn；调试/验收可核对它，主界面不堆内部字段。发送中备忘改变不重写已经冻结的本次请求，下次发送使用新状态。
- 每次可附带短备忘快照，不因“上一轮发过”误判压缩后仍存在。仅在实际验证 compaction API 后做去重优化。
- 备忘/引用使用明确数据边界与来源说明，不升级为系统指令、工具授权或用户执行请求。

### 4.3 引用与恢复候选

- 新引用填写现有 reference 的 path、revision、selection、label、text；selection 使用明确的起止字符偏移，revision 对应源稿基线，未保存内容另带可识别的快照指纹/标记。指纹比较覆盖完整引用身份，不用正文字符串拼接代替结构相等。
- 新引用正文与来源字段分开。旧 checkpoint 的 text 原样兼容；不要猜测解析旧文本前缀或假造缺失的 revision/选区。
- 源稿变化时提示“引用来自旧快照”，提供重新引用，不能悄悄替换正在讨论的文本。
- 原生非空输入与 checkpoint 不同：保留原生输入，旁边提供恢复稿预览/比较；只有明确采用才替换，并保留可恢复副本。
- 其他窗口草稿作为有窗口/时间标记的恢复候选，不自动合并。不按同名项目跨路径关联。
- 保存状态继续使用单一 store：状态绑定当前项目及编辑代数；成功只确认对应快照，错误保留 dirty，重试不要求修改正文。保留 X01 的草稿/业务错误隔离。

### 4.4 P3 验收

覆盖 D01–D05、M01–M06、C01–C04。增加完整作者流程：助手建议 → 记为候选 → 不注入 → 确认 → 实际发送带入 → 编辑/撤回 → 下轮变更；历史恢复生成新版本。关闭参考后实际请求不包含自动备忘；预算省略与面板一致；发送中的版本固定；源稿改动不改变旧引用。

## 5. P4：逐项验收、打包和预览

### 5.1 30 项矩阵与测试入口

在最终交回目录建立 acceptance.md，沿用 v1 全部 30 个 ID。每项列状态、测试方式、实际 SHA、命令、结果文件、限制。只允许 PASS / FAIL / NOT_RUN / PARTIAL；“总体通过”不能覆盖未验证项。

下面命令为需要新增并接线的目标入口，当前不能当作已存在：

```text
verify:writing-architecture   # 依赖边界与受管资源清单
verify:writing-adapter        # 适配与会话创建/异常时序
verify:writing-memory-ui      # 候选/编辑/历史/撤回
verify:writing-context       # 选择/开关/来源/版本/预算
verify:writing-package       # 包、自动同步、冷启动与升级证据
```

既有 verify:writing/build/ui/chat/native、CDE/P1/status/protocol 与 review9 正向探针保留。将必要审查探针接入正式回归入口，消除“只有某个 TEMP 脚本能跑”的依赖；适配测试装配时不得复制生产状态机。

旧主题 ui-smoke 的过时断言需修正，或提交可一键执行的等价验证，包含主题开启和恢复两种行为，不删失败检查换通过。

### 5.2 打包测试必须分开做

1. 最终提交构建：记录 commit、源文件和生成产物 hash，输出位于 TEMP。
2. **空环境冷启动**：DSH_HOME、DSH_DESKTOP_HOME、userData、Windows LOCALAPPDATA 全隔离；启动前证明 profile 不存在。由打包程序自动解压/同步插件，不手工预置 profile 来证明自动同步通过。
3. **离线加载**：限制外部网络，验证本地资源、模式开启和编辑保存；不把模型在线能力混入离线加载结论。
4. **已有环境升级**：使用脱敏 fixture，包含 v0.1.38 设置/角色/正文、旧 schema 草稿/备忘和历史版本；记录前后字节与迁移记录。未知 schema 保留原件并诊断，不能重置为空。
5. **安装包路径**：Windows 在隔离目录/用户环境验证 NSIS 构建及安装启动，不覆盖真实安装、不注册替换真实快捷方式。无法提供这种隔离时先完成构建，明确安装执行 NOT_RUN。
6. **macOS**：本地无 macOS 环境时完成脚本接线/静态验证并列待测；有受控环境则补产物验证。不触发现有自动发布 workflow 来冒充只做验收。
7. 所有运行时文件按 manifest 核对 repo → package → 自动生成 profile；检查 import 链。包里的测试兼容入口或源码依赖不能悬空。

### 5.3 可见预览

最终实例放 `%TEMP%/dsh-preview/writing-v2-<commit>/`，四套 home/userData/runtime 路径隔离。准备空项目和含正文/设定/旧版本的临时示例；不要引导用户用真实稿件制造冲突。

预览不能无头，也不带自动退出钩子。启动后记录 exe、commit、PID、窗口标题、启动时间、所有隔离路径和步骤，保持运行，由用户自行关闭。交回时重新确认进程/窗口存在；截图仅作辅助。

## 6. 真实模型体验与陪伴目标

有获授权的可用测试配置时，只在临时作品中完成三种场景，记录模型/预设/输入输出及实际变更：

1. 随意谈人物动机，中途改口或暂不解决：能顺畅交流，不强行生成任务表/落盘。
2. 候选设定 → 确认 → 修改/撤回：使用当前有效设定，能说明不确定性，不伪造永久记忆。
3. 先讨论，再明确要求改稿：按需使用 Harness 工具和权限流程，引用正确、旧版本保留、编辑冲突不被覆盖。

压缩后的连续性仅在真实触发并验证后标通过；不以少量回合证明无限记忆。没有测试配置时标 NOT_RUN，继续做完工程和隔离预览，不索取密钥明文、不复制正式凭据到日志。

## 7. 回归纪律、风险与交回物

### 7.1 重点防止再次出现的退步

- 不抢活锁、不恢复版本归零、不把迟到 GET 写入已编辑缓存，不自动重发 uncertain 回合。
- 不重新把草稿错误写进通用业务 error；成功清理草稿错误不抹发送失败或备忘警告。
- 不在恢复完成前丢弃显式空状态；不因旧请求成功清掉新版本 dirty。
- 不把作者消息/引用截断来“修性能”；不自动把 AI 建议标为 confirmed。
- 拆分阶段保持 UI 风格/交互，不借机重新嵌入 Harness 原生欢迎页/composer。
- schema 如需变更，先提供兼容读取/保留旧文件与失败回退测试。不能为了重构清空用户数据。

### 7.2 每批提交与验证记录

建议提交组：构建与边界 → 无行为变化的提取 → adapter → 会话协调 → 备忘 UI → 上下文/引用 → 集成验收。每组记录 HEAD、生产变化、运行命令、退出码和证据；失败后修好再扩下一组。

最终目录：`docs/audits/writing-architecture/<实际完成日期>/v2/`，包含：

- handoff.md：最终 SHA、完成/未完成、运行与回退方法。
- architecture.md：实际模块图、状态权威、依赖规则、偏离方案及原因。
- acceptance.md：原 30 项逐项表及新测试映射。
- preview.md：当前可见实例及空环境复现步骤。
- known-issues.md：触发条件、影响、恢复办法、是否阻断交付。
- 模型体验单独记录；机器测试 JSON、包 manifest/hash、安装/升级证据。
- 更新后的 CONTRACT（memory/draft/关联协调 API、schema、错误、引用恢复、权限边界）、策划案、CHANGELOG、当日日志和 WORKLOG。

完整工程项达标才可申请“架构完成”验收；缺模型/macOS等外部条件须明确列明交审查判定，不自行改成 PASS。本阶段交付止于实现、验收证据与可见预览，未经用户后续授权不发布。

## 8. 给执行 agent 的启动指令

> 请在 `E:\Deepseek harness\dsh-desktop` 接手写作模式下一阶段，完整阅读 `docs/plans/writing-mode-next-execution-v2.md`，按 P1→P2→P3→P4 落地。以实际 HEAD/工作树为准保留其他改动；维护已经通过的 review9 正向行为，不重复修复已关闭问题。先完成真正的模块化构建与 Harness adapter，再补会话创建协调、备忘候选/编辑/历史、当轮上下文控制和引用恢复，最后补原方案 30 项及空环境/旧环境打包验收。保留自由交流、原生模型/工具/权限，不添加固定写作轮次或每轮审批。常规实现选择自主推进；无模型配置时明确标待验收并继续其他工作。所有试验使用临时作品与隔离环境，不改内核、不关闭用户桌面、不触碰真实稿件/密钥。按批提交并记录证据，完成后交回规定材料和保持运行的可见隔离预览；不要自动合并 main、发版或替换正式安装。

— 编写：Codex / GPT-6
