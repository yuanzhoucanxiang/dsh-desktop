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
- 连续性来自原生会话记录、上下文压缩与项目文件；没有无限记忆、关闭后后台陪聊或主动通知的承诺。

## 门禁 gate.rows[]

`{ ok: boolean, label: string, detail: string }`

## 模块边界

| 模块 | 职责 | 禁止 |
|---|---|---|
| `lib/store.js` | 配置、库根、扫描、读写、路径安全 | llm、业务门禁语义 |
| `lib/domain.js` | 门禁、台账、版本、AI 路由与补全 | HTTP、cordis |
| `index.js` | cordis 注入 + HTTP 分发 | 业务算法 |
| `client.js` | 编辑器、HTTP、原生 sessions/workspaces/connection 与输入框服务 | 直连 fs / 外部 LLM；复制原生聊天状态 |
