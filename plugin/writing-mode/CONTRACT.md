# writing-mode 契约

> 2026-09-12：host / client / writing-companion 的交接契约。writing-studio 是既有严格流程预设，按需使用，不是所有写作对话的入口。

## 目录

```
{{libraryRoot}}/
  项目名/                    # 含 project.md 即项目
    project.md
    bible/{world,characters,relationships,timeline}.md
    outline/{structure,units,foreshadow}.md
    draft/novel/第N章-*-vX.md
    draft/script/第N集-vX.fountain | actN-vX.fountain
    state/character-state.md
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
| `create-project` | POST | root,title,templateId,premise | 项目骨架（字段以 handler 为准） |
| `memory` | GET | path | memory{items,changes,revision}, etag, injectable（作者确认的 fact/preference） |
| `memory` | POST | path,op,baseRevision,baseEtag,id?,item?,actor? | op = add/update/restore/retract/resolve；原 revision 冲突返回 409，缺 token 返回 428；坏 JSON/未知 schema 保留原件并报诊断 |
| `coordination` | GET | path | record{phase,operationToken,sessionId,workspaceId,version,stale} |
| `coordination` | POST | path,op,operationToken,… | op = claim/creating/confirm/uncertain/release/forget；过期 token 返回 stale-token，不改写新绑定 |
| `draft` | GET | project,window | checkpoint（本窗口）+ checkpoints[]（其他窗口的恢复候选，带 windowId/updatedAt） |

`assist.action`: polish | continue | outline | compress | expand | research | spark

请求必须来自 loopback 和可信 Host，Origin 必须同源；POST 为 JSON 对象。route 与 query 分别编码。缺 revision 返回 428；外部修改或历史覆写返回 409；冲突稿保留在编辑器，可另存新版本。原子替换失败保留旧文件。该 revision 检查不等于对所有外部进程的文件事务锁。

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
- **当轮上下文**：`buildPreparedTurn` 产出全嵌套冻结的 preparedTurn（projectKey/operationId/message/reference/memoryRevision/memoryEtag/selectedMemory/omissions/body）。只自动参考**已确认**的设定/偏好；待定问题仅在作者勾选时带入并标注；作者固定优先、其余确定性补齐；自动部分默认 6000 **Unicode 字符**预算，作者正文与显式引用不受限；每次发送重新读备忘。
- **引用身份**：`path + revision + selection{start,end} + snapshotFingerprint`，比较用结构相等（label/正文不参与）；源稿未打开时报 `unknown`，不谎报新旧；旧 `{label,text}` 引用按原样兼容，缺字段保持 null。
- 连续性来自原生会话记录、上下文压缩与项目文件；没有无限记忆、关闭后后台陪聊或主动通知的承诺。（v2 未做跨轮去重：方案要求"仅在验证 compaction API 之后"才做。）

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
| `lib/project-memory.js` | 备忘 schema/revision/etag/审计/历史 | HTTP、内核会话 |
| `src/shared/context-builder.js` | preparedTurn 选择与冻结（纯函数） | DOM/React/适配器 |
| `src/shared/reference.js` | 引用身份与状态（纯函数） | IO、UI |
| `src/client/adapters/harness/*` | 唯一 native 接触面 + 会话投影 + 协调客户端 | React/JSX/组件/样式 |
| `runtime-manifest.json` | 发布集合唯一来源（repo→包→profile 逐文件比对） | — |
| `client.js` | 编辑器、HTTP；native 接触已收进 `adapters/harness` | 直连 fs / 外部 LLM；在组件里直接读 `chat.nodes/order` |
