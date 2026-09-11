# writing-mode 契约

> host / client / writing-studio 预设共用。改这里必须同步改代码与预设。

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

- 版本：文件名 `-vN`，最大 N 为当前；历史不删
- 小说：末行独立 `章末钩子：…`
- 剧本：中文角色行 `@` 前缀；对白不加引号；ASCII 引号 = 0

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

读写路径必须 realpath 落在某个 library root 内，否则 400。

## HTTP API（loopback only）

| route | method | body / query | 返回要点 |
|---|---|---|---|
| `config` | GET | — | roots, prefs, tree |
| `tree` | GET | — | tree |
| `prefs` | GET? | POST patch | prefs |
| `roots` | POST | mode add/remove/activate/set | config+tree |
| `get` | GET | path | doc {path,content,mtime,chars} |
| `save` | POST | path,content | doc |
| `delete` | POST | path | ok |
| `gate` | POST | path?, content? | gate {kind,rows,pass,fail} |
| `ledger` | POST | path | ledger 摘要 |
| `assist` | POST | action,text,path | result / 501 llm-unavailable |

`assist.action`: polish | continue | outline | compress | expand | research | spark

## 门禁 gate.rows[]

`{ ok: boolean, label: string, detail: string }`

## 模块边界

| 模块 | 职责 | 禁止 |
|---|---|---|
| `lib/store.js` | 配置、库根、扫描、读写、路径安全 | llm、业务门禁语义 |
| `lib/domain.js` | 门禁、台账、版本、AI 路由与补全 | HTTP、cordis |
| `index.js` | cordis 注入 + HTTP 分发 | 业务算法 |
| `client.js` | UI；只调 `/api/writing-mode` | 直连 fs / 外部 LLM |
