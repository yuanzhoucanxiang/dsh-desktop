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
    "aiApiKey": ""
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
| `assist` | POST | action,text,path | result / 501 llm-unavailable |
| `companion` | GET | path | project,sessionId；按最近 project.md 归属，否则按当前目录 |
| `companion` | POST | path,prepare:true | 安装缺失的本地预设，返回 preset；保留已有自定义 |
| `companion` | POST | path,sessionId | 持久化项目与原生会话关联 |
| `templates` | GET | — | 可用项目模板 |
| `create-project` | POST | root,title,templateId,premise | 项目骨架；非法名/非空目录拒绝（见 store.prepareProjectTarget） |
| `memory` | GET | path | memory, etag, injectable, **schemaVersion**, **capabilities**, **projection** |
| `memory` | POST | path,op,baseRevision,baseEtag,… | 见下表 op |
| `memory-operation` | GET | path,operationId | {found, receipt}；不触发重写 |
| `setting-projection` | GET / POST | GET:path；POST:path,baseRevision,baseEtag[,preserve,expectedFileHash] | GET 返回磁盘稿/拟生成稿/hash；POST 在项目锁内生成固定路径，preserve 显式保留手稿副本后重建；其它 targetPath → 409 |
| `coordination` | GET/POST | … | 会话创建协调（不变） |
| `draft` | GET/POST | project,window | 草稿 checkpoint（不变） |

### memory POST op

| op | 附加字段 | 语义 |
|---|---|---|
| `add` / `update` / `restore` / `retract` / `resolve` | id?, item?, actor? | 既有普通备忘。**目标条目若含 setting 且请求无 `clientSchemaVersion>=2` → 428 upgrade-required**（防止旧客户端抹掉扩展字段） |
| `save-setting-candidate` | operationId, requestHash, id?, item.setting, clientSchemaVersion | 新条目/未确认条目为 proposed；confirmed 目标拒绝降级，修订留本窗口直到确认；host 派生 text |
| `confirm-setting` | operationId, requestHash, id?, item.setting, clientSchemaVersion | 作者确认；status=confirmed；projection→pending |
| `retract-setting` | operationId,id,clientSchemaVersion | 幂等撤回，完整历史，projection→pending |
| `update-projection` | — | HTTP 拒绝；投影由 host 的同锁事务更新 |

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

- 容量：setting 结构化文字合计 ≤ **16000** Unicode 码点；来源摘录合计 ≤ 8000；来源 ≤ 20 条；HTTP body ≤ 1 MiB。超限 **413**，保留本地输入，不静默截断。
- schema **1** 只读兼容；**写路径**在锁内校验 token 后原子迁移为 schema 2（原字节进 `state/backups/`）。坏 JSON / 未知 schema 原件不动。
- schema 2 历史达到上限返回 `history-full`（不静默裁剪需恢复记录）；去重收据配额满 → `operations-full`。
- 默认注入只取 confirmed 的 **结论+边界**（派生 text）；`explanation` 不进 preparedTurn 自动部分。

### 统一错误码（memory / projection）

| code | HTTP | 含义 |
|---|---|---|
| revision-required / etag-conflict / revision-conflict | 428 / 409 | 双 token 协议（与既有一致） |
| operation-id-required / request-hash-required / operation-conflict / operations-full | 400 / 400 / 409 / 409 | 幂等 |
| upgrade-required | 428 | 旧客户端写 setting 条目 |
| setting-required / bad-setting / empty-title / empty-conclusion / bad-setting-type | 400 | 设定校验 |
| setting-too-long / sources-too-long / sources-too-many / text-too-long | 413 | 容量 |
| history-full | 409 | schema2 历史配额 |
| projection-conflict / projection-path-fixed / projection-path-escape | 409 / 409 / 403 | 可读稿 |
| unknown-schema / corrupt-memory | 400 / 500 | 损坏诊断，不覆盖 |

请求必须来自 loopback 和可信 Host，Origin 必须同源；POST 为 JSON 对象。route 与 query 分别编码。原子替换失败保留旧文件。该 revision 检查不等于对所有外部进程的文件事务锁。

## 写作伙伴与 Harness

- 默认展示专用写作对话，文字工具单独切换。首次发送或进入会话设置时创建项目工作区，再创建原生会话并选择 `writing-companion`。已有会话保持其角色与模型，不修改全局默认。
- 预设首次按需安装到 `$DSH_HOME/.agent-presets/writing-companion/agent.cordis.yml`，以当前锁定内核 standard 的工具组成为基础；人格偏自然交流，不规定每轮任务、评分、固定字数、阶段或三轮放行。已存在的本地预设不覆盖。
- 不自动发送消息。稿件或选区先成为可移除的快照引用，点击发送时附在作者消息后；文字工具仍追加到项目会话草稿。已连接输入使用 `provideInfo(id).hooks.input` 订阅与 `inputActions.setDraft`；`Session.prompt(content, "queue")` 发送，`Session.cancel()` 停止。发送失败保留草稿，发送成功也不得擦除请求期间的新输入。
- 右栏为独立 React 视图，不移动或嵌入原生中心栏。通过 `Session.getSnapshot/subscribe` 读取 `chat.order/nodes`，渲染历史和流式文字；工具和其他活动折叠，`turn-tail` 不重复正文。会话设置、较早历史、授权/提问卡片、附件或斜杠指令进入同一完整会话处理，不自行批准。升级需验证这些会话 API 与节点 schema。未发送引用和初始草稿仅在当前页面生命周期按项目保存，不承诺刷新页面后恢复引用。
- 原生工具沿用 Harness 自己的权限；文档库根校验仅约束 writing-mode HTTP API，**不是**原生工具的沙箱。保留旧版本、讨论不自动落盘是预设行为指引，不宣称强制拦截所有工具写入。
- 每 2 秒和窗口重获焦点检查打开文件：无未保存内容时刷新外部修改，有未保存内容时保留输入并提示冲突。新建版本可在文档树刷新后查看。
- 文字工具使用 `agentDefaultModel.currentSelection()` 或显式自定义路由；伙伴使用原生会话模型。写作模式的自定义文字工具 Key 不会自动配置原生会话。
- **唯一 native 接触面（v2）**：客户端不再直接调用 sessions/workspaces/connection，一律经 `adapters/harness/adapter.js`。`capabilities()` 区分硬缺口（创建会话所需）与软缺口（读草稿/打开会话）；`connect(projectIdentity, operationToken)` 建关联、`attach(projectIdentity, sessionId)` 采用已有会话（不创建、不写协调记录）；handle 暴露 `getSnapshot/subscribe/getDraft/setDraft/send/cancel/openFullSession/dispose/recover/refresh`。
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
| `lib/domain.js` | 门禁、台账、版本、AI 路由与补全 | HTTP、cordis |
| `index.js` | cordis 注入 + HTTP 分发 | 业务算法 |
| `lib/file-lock.js` | 跨进程锁（owner token，不抢活锁不盲删） | 业务语义 |
| `lib/coordination.js` | 会话创建协调记录（阶段机 + token 语义） | 内核调用、长事务 |
| `lib/project-memory.js` | 备忘 schema1/2、revision/etag、setting、幂等收据、投影元数据 | HTTP、内核会话 |
| `lib/setting-projection.js` | 固定路径可读稿生成、hash 冲突 | 模型、任意路径写入 |
| `src/shared/world-setting.js` | setting 规范化/派生 text/结果解析/排序（纯函数） | IO/DOM |
| `src/shared/context-builder.js` | preparedTurn 选择与冻结（纯函数） | DOM/React/适配器 |
| `src/shared/reference.js` | 引用身份与状态（纯函数） | IO、UI |
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
- 本地候选和保存中的原请求按项目放 sessionStorage，跨刷新恢复但不承诺关闭整个窗口后恢复；缓存失败显式提示，无法持久化操作编号则不发送保存。停止等待只取消本地等待，原生回合在完整会话核对。

署名：Codex