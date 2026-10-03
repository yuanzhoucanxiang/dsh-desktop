# writing-mode 契约

> 2026-09-20 v2（世界观设定）：host / client / writing-companion 交接契约。writing-studio 仍是按需严格流程。
> 数据权威见 `docs/plans/writing-world-settings-v1.md` §4：扩展 `state/writing-memory.json`，可读稿 `bible/世界观整理.md` 由确认设定生成。

## 目录

```
{{libraryRoot}}/
  项目名/                    # 含 project.md 即项目
    project.md
    bible/{world,characters,relationships,timeline}.md
    bible/世界观整理.md      # 受管投影（仅由已确认 world 设定生成；不覆盖手写 world.md）
    outline/{structure,units,foreshadow}.md
    draft/novel/第N章-*-vX.md
    draft/script/第N集-vX.fountain | actN-vX.fountain
    state/character-state.md
    state/writing-memory.json  # 备忘权威（schema 2）
    reviews/评审-*-vX.md
```

- 版本：同一目录、同名和扩展名系列的 `-vN`，最大 N 为当前；另存跳过已存在编号，历史拒绝覆盖。
- 以下是可选格式检查，不是聊天或保存的前置条件。小说检查仅适用于 `draft/novel/*.md`：末行独立 `章末钩子：…`。
- 剧本检查：中文角色行 `@` 前缀；对白不加引号；ASCII 引号 = 0。project/bible/reviews 等 Markdown 不套小说门禁。

## 配置 `~/.dsh/writing-mode.json`

```json
{
  "roots": [{ "path": "E:\\剧本", "label": "剧本", "default": true }],
  "activeRoot": "E:\\剧本",
  "prefs": {
    "fontSize": 17,
    "lineHeight": 1.95,
    "autoSaveMs": 800,
    "autoGate": true,
    "aiMode": "harness",
    "aiProvider": "deepseek-official",
    "aiModel": "deepseek-v4-flash",
    "aiApiKey": "",
    "dailyGoal": 0,
    "hemingway": false,
    "typewriter": false
  }
}
```

读写路径必须 realpath 落在某个 library root 内，否则 400。配置还包含 `companions: { [projectRealPath]: sessionId }`；Windows 键忽略大小写。API 不回传 `aiApiKey`，仅返回 `aiKeyConfigured`。

## HTTP API（loopback only）

| route | method | body / query | 返回要点 |
|---|---|---|---|
| `config` | GET | — | roots, prefs, tree |
| `tree` | GET | — | tree |
| `prefs` | POST | patch | prefs（隐藏 Key） |
| `roots` | POST | mode add/remove/activate/set | config+tree |
| `get` | GET | path | doc {path,content,mtime,chars,revision} |
| `save` | POST | path,content,revision | doc；新文件 revision=null，已有文件须匹配 SHA256 |
| `version` | POST | path,content | 独占创建新版本并返回 doc |
| `delete` | POST | path,revision | ok |
| `gate` | POST | path?, content? | gate {kind,rows,pass,fail} |
| `ledger` | POST | path | ledger 摘要 |
| `reorder` | POST | project,order | 章节重排序（卡片拖拽）：order=期望顺序的当前版 abs 数组，与现有系列一一对应才受理；以**重命名事务**落实（项目锁 + 两阶段改名 + 回滚 + 绝不覆盖），返回 {moved,renames}；遗留 .reorder-*.tmp → 409 reorder-leftovers |
| `outline` | GET | project | 大纲视图批量口径：每 draft 系列当前版 `{abs,name,chars,hook,gate}`（自然序）+ `structure.md` 标题行；非法/越界项目 400 `invalid-project` |
| `stats` | GET | path | 码字统计：`{today,streak,days[14 旧→新]}` + `dailyGoal`；只读，解析不出项目（散稿）时 `stats:null` |
| `assist` | POST | action,text,path | result / 501 llm-unavailable |
| `companion` | GET | path | project,sessionId；按最近 project.md 归属，否则按当前目录 |
| `companion` | POST | path,prepare:true | 安装缺失的本地预设并向内核 registry 自举注册（0.1.7 起内核不扫 ~/.dsh/.agent-presets），返回 preset 与 registered；保留已有自定义 |
| `companion` | POST | path,sessionId | 持久化项目与原生会话关联 |
| `templates` | GET | — | 可用项目模板 |
| `create-project` | POST | root,title,templateId,premise | 项目骨架；非法名/非空目录拒绝（见 store.prepareProjectTarget） |
| `compile` | POST | path,include?,title?,titles? | 导出成书：各章当前版按文档树自然序拼成项目根 `<书名>-vN.<ext>`（独占创建、原稿只读；详见末节） |
| `archive-export` | POST | path,title? | 导出作品档案：与档案面板同一口径的**只读投影**，写成项目根自包含单文件 `<书名>-档案-vN.html`（`writeExportFile` 独占创建、绝不覆盖；`.html` 不在 `TEXT_EXTS` 内，故不进文档库、不参与成书候选，也不记码字账）。设定读 `state/writing-memory.json` 的 confirmed 条目（候选不入档），资料只取每篇当前版；文字一律转义，仅放行白名单标记（标题/列表/表格/引用/粗斜体/行内码/http(s) 链接/`[[标注]]`）。页内含**目录与页内锚点**：`[[文稿名]]` 按与客户端 `features/companion/jump.js` 一致的规则（精确名 → 抹 `-vN` → 前缀，取最新）解析到本页的资料/章节锚点，解析不到则退回不可导航的标注；锚点 id 一律 host 生成（`set-N`/`ch-N`/`doc-N`/`sec-*`，篇内小节为 `doc-N-h-M`），作者文字进不了 href；标题 ≥2 的资料篇额外给**篇内小目录**，打印时与主目录一起藏掉。 |
| `wiki` | GET | path | **作品档案页（HTML 文档）**：与 `archive-export` 共用 `assembleArchiveModel`（同一份口径，两个出口），但**不落盘**——这是「档案作为一个页面」的地址，供独立窗口（shell `shell:open-wiki`）或浏览器直接打开。响应 `text/html; charset=utf-8` + `content-security-policy: default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; …` + `nosniff` + `cache-control: no-store`（档案是此刻的投影，缓存里的设定是过期的）。路径必须在库根内、且能解析出作品，否则 400 `path-outside-roots` / `no-project`；备忘坏 JSON / 未知 schema → 409，不猜不清空。比 `archive-export` 多一个**作品切换条**（页头，库里 ≥2 部作品才出现）：条目是同源相对链接 `?route=wiki&path=…`（**不用表单也不靠脚本**，自定义协议下 GET 提交不导航），当前这部渲染成 `<span class="is-current">` 不可点；列表只收 `resolveProjectDir` 解析得出来、且 `resolveUnderRoots` 仍在库根内的作品——库根散稿冒出的「独立文稿」伪条目一律不列（解析为 null 时**严禁**回落空串给 `fs.realpathSync`：Windows 下它返回进程 cwd） |
| `memory` | GET | path | memory, etag, injectable, **schemaVersion**, **capabilities**, **projection** |
| `memory` | POST | path,op,baseRevision,baseEtag,… | 见下表 op |
| `memory-operation` | GET | path,operationId | {found, receipt}；不触发重写 |
| `setting-projection` | GET / POST | GET:path；POST:path,baseRevision,baseEtag[,preserve,expectedFileHash] | GET 返回磁盘稿/拟生成稿/hash；POST 在项目锁内生成固定路径，preserve 显式保留手稿副本后重建；其它 targetPath → 409 |
| `coordination` | GET/POST | … | 会话创建协调（不变） |
| `draft` | GET/POST | project,window | 草稿 checkpoint。**project 用规范路径分桶**（host 侧 `resolveUnderRoots().abs`，不用客户端原始串）；GET 回本窗口全文 `checkpoint` + **其他窗口的元数据列表** |
| `world-draft` | GET/POST | project,window | 世界观窗口编辑日志；与 `draft` 同协议，分桶后缀 `\0world` |
| `project-recovery` | GET/POST | GET:path；POST:path,oldPath,token | 项目目录搬迁后的显式恢复。候选**必须携带关联证据**才 `importable` |
| `maintenance` | GET/POST | GET:[path]；POST:action | GET 回锁诊断 + 当前作品配额；POST `action=clear-stale-locks` 隔离持有者已消失的残留锁 |

路由×方法白名单：未在 `ROUTE_METHODS` 里的 route → **404**；白名单外的方法（PUT/DELETE/PATCH…）→ **405**。
非 GET 一律要求 `application/json`，否则 **415**。理由：`trustedRequest` 把缺失的 `sec-fetch-site`
视为可信（本地非浏览器进程可直连），方法白名单是仅剩的一层纵深防御。

草稿列表（`checkpoints`）**不含正文**：每项为 `{windowId, rev, updatedAt, cleared, chars, preview(≤120字), hasReference, reference?}`，
世界观桶额外给 `summary:{version,draftCount,titles}`；列表最多 `MAX_DRAFT_LIST`(24) 项，并回 `total`/`truncated`。
作者要恢复某一份时再按 `window=<id>` 单独取那一个桶的全文。**移动恢复不走这个上限**（库层 `listCheckpoints` 不设限，不漏桶）。

### memory POST op

| op | 附加字段 | 语义 |
|---|---|---|
| `add` / `update` / `restore` / `retract` / `resolve` | id?, item?, actor? | 既有普通备忘。**目标条目若含 setting 且请求无 `clientSchemaVersion>=2` → 428 upgrade-required**（防止旧客户端抹掉扩展字段） |
| `save-setting-candidate` | operationId, requestHash, id?, item.setting, clientSchemaVersion | 新条目/未确认条目为 proposed；confirmed 目标拒绝降级，修订留本窗口直到确认；host 派生 text |
| `confirm-setting` | operationId, requestHash, id?, item.setting, clientSchemaVersion | 作者确认；status=confirmed；projection→pending |
| `retract-setting` | operationId,id,clientSchemaVersion | 幂等撤回，完整历史，projection→pending |
| `update-projection` | — | HTTP 拒绝；投影由 host 的同锁事务更新 |
| `archive-history` | keep? | 把最早的变更历史整体写进 `state/backups/` 后裁到 keep（默认 100）。**历史已满时仍可用**（否则就是满了再也清不了的死锁） |
| `prune-operations` | keep? | 同上，裁幂等收据（默认保留 40）。被裁的 operationId 进**有界墓碑环**；其迟到重试返回 `operation-pruned`，绝不当新操作重复建条目 |
| `purge-retracted` | statuses? | 先备份再移除终态条目（只允许 `retracted`/`resolved`；其他值 → `bad-statuses`），释放条目配额 |

配额与出口：`items ≤ 400`、`changes ≤ 800`、`operations ≤ 200`。三个上限都是**硬拒**（不静默裁剪需恢复记录），
但必须同时给出口——否则一个长篇写到上限后，它的备忘与世界观就永久停摆。
因此：`memory` GET/POST 均回 `quota:{items,changes,operations,maxItems,maxChanges,maxOperations}`，
`capabilities.maintenanceOps` 公开三个归档 op，UI 常驻显示用量并在撞墙前提供归档按钮。

幂等：setting 类 op 必带 operationId；host 对 op/id/item/actor 完整递归规范化并计算 hash，不信任客户端 requestHash。相同 ID、相同载荷返回原收据与最新文档；同 ID 不同载荷/操作返回 409。客户端发送前将原请求与 operationId 写入本窗口 sessionStorage，响应丢失后重试同一请求，新编辑或确认使用新 ID。

### setting 条目（schema 2）

```json
{
  "id": "uuid",
  "kind": "fact",
  "status": "proposed|confirmed|retracted|resolved",
  "itemRevision": 1,
  "text": "<host 由 conclusion(+boundaries) 派生>",
  "setting": {
    "type": "world",
    "title": "…",
    "conclusion": "…",
    "explanation": "…",
    "boundaries": "…",
    "tags": [],
    "sources": [{ "sessionId": null, "messageId": null, "role": null, "excerpt": "", "snapshotHash": null }]
  }
}
```

- 容量：setting 结构化文字合计 ≤ **16000** Unicode 码点；来源摘录合计 ≤ 8000；来源 ≤ 20 条；HTTP body ≤ 1 MiB（**按字节计**，声明长度超限直接 413，流式超限中断后给 400）。超限 **413**，保留本地输入，不静默截断。
- 请求体必须**按字节收集后一次性 UTF-8 解码**；逐 chunk 解码会把跨 chunk 的多字节字符变成 U+FFFD 并静默写进手稿。
- schema **1** 只读兼容；**写路径**在锁内校验 token 后原子迁移为 schema 2（原字节进 `state/backups/`）。坏 JSON / 未知 schema 原件不动。
- schema 2 历史达到上限返回 `history-full`（不静默裁剪需恢复记录）；去重收据配额满 → `operations-full`；两者均可用 `archive-history` / `prune-operations` 归档后继续。
- 默认注入只取 confirmed 的 **结论+边界**（派生 text）；`explanation` 不进 preparedTurn 自动部分。
- **项目身份单一口径**：所有按作品分桶的键（草稿 / 记忆 / 协调 / 移动恢复）均经 `lib/project-identity.js` 的 `identityKey()`
  （分隔符归一 + 剥尾部斜杠 + 小写，保留 `\0` 分桶后缀）。realpath 由解析阶段完成，不在分桶函数里做，
  避免既有桶名因一次 realpath 结果变化而整体失联；旧口径（不剥尾斜杠）写过的桶由 `readCheckpoint` **只读回退**，下次保存自然迁移。
- **配置文件（`writing-mode.json`）损坏 ≠ 不存在**：只有 ENOENT 才当空配置；解析失败时保留损坏原件字节（`.damaged-<ts>` 副本）、
  回 `corrupt-config`，并拒绝任何回写（`config-damaged-refused`）——否则一次“只改字号”就会把库根/伙伴绑定/AI Key 清零。
  配置写入走 `updateConfig()`（读-改-写在同一锁内）并带单调 `revision`。
- **锁**：跨进程文件锁等待不再空转（`Atomics.wait`）；草稿路径 deadline 1.5s、残留锁 250ms 快速失败（回可重试的 `lock-stale`）。
  持有者已消失的残留锁由**内核启动清扫**与 `maintenance` 入口改名隔离（不删除、保留取证）；**活锁绝不动**（W01），也不在获取路径上抢占。

### 统一错误码（memory / projection）

| code | HTTP | 含义 |
|---|---|---|
| revision-required / etag-conflict / revision-conflict | 428 / 409 | 双 token 协议（与既有一致） |
| operation-id-required / request-hash-required / operation-conflict / operations-full | 400 / 400 / 409 / 409 | 幂等 |
| upgrade-required | 428 | 旧客户端写 setting 条目 |
| setting-required / bad-setting / empty-title / empty-conclusion / bad-setting-type | 400 | 设定校验 |
| setting-too-long / sources-too-long / sources-too-many / text-too-long | 413 | 容量 |
| history-full | 409 | schema2 历史配额（可用 `archive-history` 归档后继续） |
| memory-full | 400 | 条目配额（可用 `purge-retracted` 清理终态条目后继续） |
| operation-pruned | 409 | 收据已归档；迟到重试不得当新操作执行（防重复建条目） |
| bad-statuses | 400 | `purge-retracted` 只接受 retracted / resolved |
| projection-conflict / projection-path-fixed / projection-path-escape | 409 / 409 / 403 | 可读稿 |
| unknown-schema / corrupt-memory | 400 / 500 | 损坏诊断，不覆盖 |

### 统一错误码（host 全局）

| code | HTTP | 含义 |
|---|---|---|
| unknown-route / method-not-allowed | 404 / 405 | 路由×方法白名单 |
| json-required / invalid-json | 415 / 400 | 非 GET 必须 JSON 对象 |
| body-too-large | 413 | 声明长度超 1 MiB |
| corrupt-config / config-damaged-refused / config-read-failed / config-conflict | 409 | 配置文件损坏与并发保护 |
| corrupt-draft / draft-read-failed / draft-rev-required / draft-rev-conflict / draft-too-large | 409 / 409 / 428 / 409 / 413 | 草稿 checkpoint |
| recovery-source-changed / recovery-source-unrelated | 409 / 409 | 移动恢复：候选已变 / 无关联证据 |
| lock-stale / lock-timeout / lock-failed / lock-lost | 503 / 503 / 500 / 503 | 跨进程锁；前两个可重试，在线仅诊断残留锁，maintenance 拒绝清理；关掉所有写入进程后才可离线处理 |

请求必须来自 loopback 和可信 Host，Origin 必须同源；POST 为 JSON 对象。route 与 query 分别编码。原子替换失败保留旧文件。该 revision 检查不等于对所有外部进程的文件事务锁。

## 写作伙伴与 Harness

- 默认展示专用写作对话，文字工具单独切换。首次发送或进入会话设置时建会话——双栈：0.1.7 起先 `workspaces.create({path})`（按规范路径幂等，同路径复用）再用 `remote.session.create({workspaceId, agentPreset})` 一把建并绑 preset（免 select、免 `agent-preset/locked` 竞态）——必须走 workspaceId，用 cwd 建的会话不挂任何工作区，主视图 hero 的输入框会停在 inert（「选择工作区」，0.1.7-rc.2 实测）；旧内核走「创建工作区 → 建会话 → 选择 `writing-companion`」三步。聚焦会话：优先 `uiWorkspace.openSession(id)`（公开入口 = `replaceMain(id, signal, 'reveal')`：释放旧 mainReference + 清掉盖住主区域的全局面板；publishMain 有粘性规则，绕过 uiWorkspace 直接 retain 切不动视图），退路 `replaceMain` 必须传 `'reveal'`（`'preserve'` 会让「选择工作区」hero 盖住会话），再退 `sessions.retain(id, {source:'mainView'})` 由 handle 持有、切换/dispose 时释放，最后旧 `sessions.open`。已有会话保持其角色与模型，不修改全局默认。
- 右栏三区：伙伴（交流；顶部折叠「写作会话」列表 = config.companions × sessions 列表快照，点击行打开该作品 project.md 随之切换会话）/ 文字工具（生成动作）/ 检查（门禁 + 台账，默认收起）。「另存为新版」归拢到文档名旁的版本条（单版本文档也显示版本条），顶栏不再放 v+1。
- 预设首次按需安装到 `$DSH_HOME/.agent-presets/writing-companion/agent.cordis.yml`，以当前锁定内核 standard 的工具组成为基础；人格偏自然交流，不规定每轮任务、评分、固定字数、阶段或三轮放行。已存在的本地预设不覆盖。0.1.7 起该目录仅供旧内核读取；新内核由 host 向 `agentPresets` registry 自举注册，行表来自 `lib/companion-preset.js`（`scripts/sync-companion-preset.mjs` 从 companion.cordis.yml 生成；`test/companion-preset.mjs` 逐字节漂移门禁，改 yml 必须重跑生成器；重复注册 = 幂等成功）。
- 不自动发送消息。稿件或选区先成为可移除的快照引用，点击发送时附在作者消息后；文字工具仍追加到项目会话草稿。已连接输入双通道：0.1.7 走 `conversation.input.shell(id)`——`state.getSnapshot().draft` 读、`actions.setDraft` 写、`state.subscribe` 订阅，前提是该会话已有 retained binding（否则 shell 抛 `resolved no binding`，所以先聚焦再写草稿，binding 缺失时不创建 shell、按输入面未就绪处理）；旧内核走 `provideInfo(id).hooks.input` + `inputActions.setDraft`。两条都缺才报软缺口 `input:sessions.provideInfo|conversation.input.shell`，不影响发送。`Session.prompt(content, "queue")` 发送，`Session.cancel()` 停止。发送失败保留草稿，发送成功也不得擦除请求期间的新输入。
- 右栏为独立 React 视图，不移动或嵌入原生中心栏。通过 `Session.getSnapshot/subscribe` 读取 `chat.order/nodes`，渲染历史和流式文字；工具和其他活动折叠，`turn-tail` 不重复正文。会话设置、较早历史、授权/提问卡片、附件或斜杠指令进入同一完整会话处理，不自行批准。升级需验证这些会话 API 与节点 schema。未发送引用和初始草稿仅在当前页面生命周期按项目保存，不承诺刷新页面后恢复引用。
- 原生工具沿用 Harness 自己的权限；文档库根校验仅约束 writing-mode HTTP API，**不是**原生工具的沙箱。保留旧版本、讨论不自动落盘是预设行为指引，不宣称强制拦截所有工具写入。
- 每 2 秒和窗口重获焦点检查打开文件：无未保存内容时刷新外部修改，有未保存内容时保留输入并提示冲突。新建版本可在文档树刷新后查看。
- 文字工具使用 `agentDefaultModel.currentSelection()` 或显式自定义路由；伙伴使用原生会话模型。写作模式的自定义文字工具 Key 不会自动配置原生会话。
- **唯一 native 接触面（v2）**：客户端不再直接调用 sessions/workspaces/connection，一律经 `adapters/harness/adapter.js`。`capabilities()` 区分硬缺口（创建会话所需）与软缺口（读草稿/打开会话）；`connect(projectIdentity, operationToken)` 建关联、`attach(projectIdentity, sessionId)` 采用已有会话（不创建、不写协调记录）；handle 暴露 `getSnapshot/subscribe/getDraft/setDraft/send/cancel/openFullSession/dispose/recover/refresh`。创建能力双栈判定：modern=`remote.session.create`+`workspaces.create` 齐备，legacy=三步齐备；两端都缺时 missing 并列双栈缺口，不再只报 `agentPresets.select`。
- **send 三态**：`accepted`（原生已受理，含"有原生证据"的情形）· `rejected`（明确未受理，改完可再发）· `uncertain`（交出去过但无法核对）——uncertain 必须保留正文、先核对原生回合/队列，**不自动重发**。
- **创建协调**：进程内按 host 规范作品身份共用创建 Promise；跨进程由 `lib/coordination.js` 的持久记录仲裁（`reserved → creating → bound / uncertain`，按作品身份分桶，受验证跨进程锁）。会话被删 → `missing` + 恢复入口（重查/继续关联/查看完整会话），**不静默新建**；外部创建结果无法确认 → `uncertain` 并保留已知标识。不承诺 exactly-once。
- **当轮上下文**：`buildPreparedTurn` 产出全嵌套冻结的 preparedTurn。只自动参考**已确认**的设定/偏好；world 设定注入文本 = **结论+边界**（host 派生 text），**说明不注入**；待定问题仅在作者勾选时带入并标注；作者固定优先；自动部分默认 6000 **Unicode 字符**预算；每次发送重新读备忘。
- **引用身份**：`path + revision + selection{start,end} + snapshotFingerprint`，比较用结构相等（label/正文不参与）；源稿未打开时报 `unknown`，不谎报新旧；旧 `{label,text}` 引用按原样兼容，缺字段保持 null。
- 连续性来自原生会话记录、上下文压缩与项目文件；没有无限记忆、关闭后后台陪聊或主动通知的承诺。

## 门禁 gate.rows[]

`{ ok: boolean, label: string, detail: string }`

## 模块边界

| 模块 | 职责 | 禁止 |
|---|---|---|
| `lib/store.js` | 配置、库根、扫描、读写、路径安全 | llm、业务门禁语义 |
| `lib/compile.js` | 成书候选/版本归并/排序/拼接（纯函数） | IO、HTTP |
| `lib/domain.js` | 门禁、台账、版本、AI 路由与补全 | HTTP、cordis |
| `index.js` | cordis 注入 + HTTP 分发 | 业务算法 |
| `lib/file-lock.js` | 跨进程锁（owner token，不抢活锁不盲删） | 业务语义 |
| `lib/coordination.js` | 会话创建协调记录（阶段机 + token 语义） | 内核调用、长事务 |
| `lib/project-memory.js` | 备忘 schema1/2、revision/etag、setting、幂等收据、投影元数据 | HTTP、内核会话 |
| `lib/setting-projection.js` | 固定路径可读稿生成、hash 冲突 | 模型、任意路径写入 |
| `src/shared/world-setting.js` | setting 规范化/派生 text/结果解析/排序（纯函数） | IO/DOM |
| `src/shared/context-builder.js` | preparedTurn 选择与冻结（纯函数） | DOM/React/适配器 |
| `src/shared/reference.js` | 引用身份与状态（纯函数） | IO、UI |
| `src/shared/filename.js` | 版本号/文件名/章节题纯函数（VERSION_RE/versionOf/stemOf/chapterTitleOf 等） | IO/DOM |
| `src/client/state/*` | prefs 与 library 的模块级缓存 + 订阅广播（prefs-store / library-store） | 直接渲染、React 组件 |
| `src/client/adapters/harness/*` | 唯一 native 接触面 + 会话投影 + 协调客户端 | React/JSX/组件/样式 |
| `runtime-manifest.json` | 发布集合唯一来源（repo→包→profile 逐文件比对） | — |
| `client.js` | 编辑器、HTTP；native 接触已收进 `adapters/harness` | 直连 fs / 外部 LLM；在组件里直接读 `chat.nodes/order` |

## 世界观整改后的运行约定（2026-09-20）

- 共享纯实现位于 `lib/world-setting.js`，客户端 shared 入口只 re-export；17 文件清单包含 host 依赖，发布门禁递归检查插件相对 import。
- schema1 写入在锁内先完成 token/输入/容量校验，再备份并一次提交迁移和业务变更；失败不先升级 schema。
- 投影 source read、持久化 intent、文件 hash 校验及最终 mark 处于同一项目锁；intent 记录稳定生成时间/源 revision/内容 hash，写完后 mark 失败可重试而不误接管手稿。备份与目标所有已有父目录均校验 realpath。
- 无受管记录的同名文件一律冲突，固定提示语不是授权。差异面板允许作者明确“保留手稿副本并重建”；需 expectedFileHash 匹配才执行，副本路径回传。外部编辑器不受本锁约束，重查 hash 加可恢复副本降低竞争风险，不宣称完整文件系统事务隔离。
- 已存结构化设定由世界观面板编辑、确认、撤回、查看历史；普通备忘面板过滤 setting，防止用旧协议误编辑。
- 整理基于点击时冻结的真实消息、来源 ID/角色/原文/SHA256；模型 sources 被丢弃。只关联新出现且完整匹配本次带唯一编号作者请求的最终助手回复；遇其他回合插入、切会话、拒绝或不确定时保留输入、提示核对，不自动重发。
- 本地候选和保存中的原请求按项目写入浏览器持久缓存与 host 窗口 checkpoint；关闭窗口后可从恢复副本找回，保留 modelMark/pending 与操作编号。落盘失败显式提示；恢复等待期间保留新编辑，关闭面板后忽略迟到结果。停止等待只取消本地等待，原生回合在完整会话核对。

署名：Codex
## 已有项目接入与恢复（2026-09-22，工作树未发布）

- roots 的 kind 为 library（默认，保持原作品库语义）或 project（所选目录本身就是作品）。打开已有目录不需要 project.md，不自动创建备忘或改写正文。
- project 根递归识别 Markdown 自定义目录，分组保留完整相对父路径；隐藏目录、依赖目录和越界链接不进入递归。扫描有深度、目录与文件数量上限，达到上限提示扫描未完整。
- 文档、会话、备忘、设定都按同一个显式项目根识别；嵌套配置取最具体项目根。旧设置页未传 kind 时保留原配置类型。
- 旧位置恢复只把备忘或投影记录中的旧路径视为关联证据；同名稿件甚至相同内容不构成作品身份。无关联导入需作者单独确认来源与目的，导入成副本，不重绑原生会话工作区。
- 第五份及之后的恢复副本按需读取；失败可重试、等待期间不得覆盖新编辑、面板卸载后不得采用迟到内容。
- lock-owner-unknown 表示未知持有者，503，可重试；在线绝不移走他人的锁，包括貌似已死的残留锁。

## 轻量项目创建（开发中，2026-09-22）

POST create-project 默认仅生成 project.md 与首篇正文；fullTemplate:true 保留完整模板模式。POST project-resource 接收 path 与 resource，仅接受固定资料路径白名单，按项目类型生成一份资料；存在时 409 resource-exists，禁止覆盖。正文文件继续通过原编辑接口保存。导航中文标签仅为显示，不改磁盘路径。

## 导出成书（compile，2026-09-26）

- `POST compile`：`{ path, include?, title?, titles? }`。`path` 是项目内任意路径（经 `resolveProjectDir` 定位项目根）；`title` 默认取项目目录名；`titles`（默认 true）只为 **Markdown** 稿在「正文不带标题行」的章前补 `# 文件名标题`，fountain 稿一律用题页 + `===` 分页、不插标题。
- 候选：`include`（rel 数组）给定时**顺序即章节顺序**且原样尊重（历史版也可显式收）；省略时默认收 `draft/` 下文本文件，按 `-vN` 系列只取最大 N 的当前版，被略过的历史版列入 `stats.skipped`。
- 排序：默认候选按 rel 中文 + 数字自然序（与文档树一致，第2章 < 第10章）。
- 输出：项目根 `<书名>-v<N>.<ext>`，从 v1 起第一个空位，`writeDoc(revision=null)` 独占创建——已有成片永不覆盖，原稿一律只读。成片自身不在 `draft/` 下，不进后续默认候选。
- 错误码：`no-project`（识别不出项目）、`no-drafts`（默认候选为空）、`empty-include` / `bad-include`（越界或不安全段）/ `unknown-include`（不在项目扫描内）、`mixed-formats`（扩展名不一致）、`invalid-title`、`source-changed`（扫描到读取之间文件变动，409 可重试）。
- 字数口径与状态栏一致（去空白计字）；成片统一 LF（原稿字节不动）。

## 码字统计（writing-stats，2026-10-02）

- 存储：`{{project}}/state/writing-stats.json`（跟随项目目录）：`{ version:1, days:{"YYYY-MM-DD":净增CJK}, files:{"<项目内相对路径小写>":上次记录CJK} }`；保留最近 400 天。坏 JSON 按空账本起步并标 `corrupt`，绝不挡保存。
- 记账点：`save` / `version` 路由**成功之后** host 侧记账（compile 导出的成书不算）；`get`（打开）只**播种基线**——`files` 里首见的稿件记当前字数、计 0 增量，防止老项目首次保存把整章存量算成「今天写的」。
- 净增口径：`max(0, 本次CJK − 该篇上次记录)`；大删减不倒扣。CJK 计数与门禁同源（`[一-鿿]`）。
- `GET stats?path=`：任意库内稿件路径 → 解析项目根，返回 `{ today, streak, days:[{day,total}×14 旧→新], corrupt }` + `dailyGoal`（来自 prefs）；解析不出项目返回 `stats:null`。越界 400 `path-outside-roots`。
- 连击口径：从今天往回数 >0 的日；今天还没写不清零（从昨天往回数，保留进行中的连击）。
- prefs 新增 `dailyGoal`（0–200000，默认 0=不显示目标），经既有 `prefs` 路由读写。

## 专注深化与改稿预览（2026-10-02 第二批）

- prefs 新增 `hemingway` / `typewriter`（布尔，默认关）：海明威模式在稿面 keydown 拦 Backspace/Delete/Ctrl+X（`isComposing` 时不拦，保住拼音输入法）；打字机滚动用隐藏镜像层按 textarea 同款排版测光标行高，输入/点选/方向键后把光标行保持在一屏中部。两开关在顶栏，随 prefs 路由持久化。
- 选区改稿 diff 回路：文字工具「替换选区」不再一步覆写——先在稿面下方出「改稿预览」（`data-wm-rewrite`，复用行级 diff：`- 原文行 / + 建议行`），作者「采纳改稿」才落稿（预览期间继续打字的错位用「原偏移校验 → 附近窗口重定位」两级兜底），「丢弃」原稿不动。动作名（润色/扩写…）进预览头。产出仍然只是建议稿，不碰版本协议。

## 伙伴引用跳回与 mention 可见化（2026-10-02 第三批）

- 伙伴人设新增 `[[文稿名]]` 标注约定（companion.cordis.yml 单一事实源 → companion-preset.js 生成物 + 漂移门禁）。v0.1.40 的「模型输出不能导航编辑器」改为**点击制**：[[名]] 在助手消息里渲染为 chip，作者点击才跳，目标只在作者自己的库内文件清单里解析（`features/companion/jump.js`：文件名全等 → 抹 -vN 题名（多版本取最新）→ 无扩展名前缀；解析不到原地提示，模型编造名不开任何东西）。
- 参考预览行新增「正文提及」徽标（`worldSettingMentioned`，与注入排序同一规范化口径 NFKC+lowercase 标题/标签包含匹配；turnText 与 send 完全同口径 = 作者本轮消息草稿）。只做展示，不改 `selectMemory` 选择语义。
