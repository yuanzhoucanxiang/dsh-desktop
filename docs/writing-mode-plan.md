# 写作模式整合策划案

> 版本：v0.5 · 2026-09-12（推送前一致性核对）\
> 范围：原生写作伙伴会话（`writing-companion`）+ 桌面工作台（`writing-mode`）；`writing-studio` 留作按需采用的严格流程\
> 原则：预设管协助方式，UI 管写作交互；文件与会话接口见 `plugin/writing-mode/CONTRACT.md`\
> v0.5：独立写作对话 UI，不嵌入 Harness 欢迎页与输入区。根据作者要求，以自然的持续对话为主，按需调用 Harness 能力。当前为未发布源码与隔离预览；已发布版本仍为 v0.1.37。

> 版本管理：仓库副本 `dsh-desktop/docs/writing-mode-plan.md` 与本地 `E:\剧本\写作模式-策划案.md` 同步；修改任一处需同步另一处并更新工作日志。

---

## 0. 当前状态一览（2026-09-12）

| 层 | 状态 |
|---|---|
| writing-companion | 新的自然交流预设；使用 Harness 原生工具与项目会话，不硬设阶段、轮数或配额 |
| writing-studio 预设 | 旧严格流程保留；三轮放行不是所有写作对话的默认规则 |
| writing-mode UI | 默认右栏为持续对话；文字工具与检查可选；冲突与历史稿保护已补强 |
| 验证脚本 | 源码回归与原生 UI 验收见当日日志；CLI checker 尚未统一实现，不能声称无漂移 |
| 发布 | https://github.com/yuanzhoucanxiang/dsh-desktop/releases/tag/v0.1.37 |

### 0.1 host 分层（已落地）

```
plugin/writing-mode/
  CONTRACT.md       唯一契约（目录 / prefs / HTTP / gate）
  lib/store.js      库根、扫描、读写、路径安全
  lib/domain.js     门禁、台账、AI 路由与补全
  index.js          cordis inject + /api/writing-mode
  client.js         shell.overlay UI + 原生 sessions/workspaces/connection
  lib/companion.cordis.yml  写作伙伴人格与原生工具组成
```

### 0.2 AI 底座

| 来源 | 行为 |
|---|---|
| **写作伙伴** | 原生 workspace + session + writing-companion；模型、工具、审批、流式回复、取消与上下文压缩由 Harness 管理 |
| **文字工具** | `ctx.llm.stream`；Harness 全局默认模型或显式自定义 Provider / Model / Key |
| **交接** | 稿件或选区先成为可移除的引用，作者随想法一起发送；打开写作台不自动调用模型 |
| **连续性** | 原生会话记录和项目文件；不承诺无限记忆、关闭后后台陪聊或主动联系 |

陪伴的产品目标：允许闲聊、试探、犹豫、讨论人物和生活观察，不要求每次交流产出任务或检查清单；执行需求明确时灵活使用工具。尊重作者决定，区分已确认设定与 AI 建议，可以坦诚提出不同意见。

右栏交互：上方为项目和会话设置，中间为对话记录，下方为轻量输入与可移除引用。授权和提问显式提示；附件、斜杠指令、模型调整及较早历史在完整会话处理。当前正文按纯文本显示；引用未发送时仅在当前页面按项目保留。真实模型自然度和长对话仍待验收。

### 0.3 设置页（内核 设置 → 写作模式）

库根增删 · 字号 · 行距 · 自动保存 · 保存后门禁 · AI 模型 · 一键打开工作台。

---

## 1. 目标与非目标

### 1.1 目标

1. 在 DeepSeek Harness Desktop 里**一键切换**：编码布局 ⇄ 专用写作工作台。\
2. 写作台支持项目建立、设定、结构、正文、检查与评审；作者按需使用，授权和复杂会话交互可进入完整会话。\
3. 明确要求可检查、可回显；格式门禁不强制阻断聊天或保存，作者按需采用严格流程。\
4. 后续改预设或改 UI 时**互不拖累**，契约变更可追踪。

### 1.2 非目标（本阶段不做）

- 不改 DeepSeek Harness 内核源码。\
- 不做云端协作 / 多人实时共编。\
- 不做完整排版印刷流水线（导出 PDF/EPUB 留 M4）。\
- 不另建模型传输与聊天记录存储；独立写作视图订阅 Harness 会话状态。\
- 不引入 IndexedDB / TipTap（参考旧项目「沉浸式剧本写作平台」时只借架构思想，见 §3.5）。

---

## 2. 现状盘点（2026-09-12 核对）

| 资产 | 位置 | 成熟度 | 仍开放 |
|---|---|---|---|
| Agent 预设 writing-studio | `~/.dsh/.agent-presets/writing-studio/` | 真项目跑通；3 轮放行已写死 | 工具面未挂 check-*.mjs |
| 验证通道 | `E:\剧本\验证\` | gates/fountain/runner | 未自动进 preset |
| UI 插件 writing-mode | `dsh-desktop/plugin/writing-mode/` | **v0.1.37 已发布**；独立写作伙伴、模板和资料入口在当前源码 | 导出 Compile、资料质量验收、better-sidebar、真实模型体验 |
| 内置接线 | BUILTIN + extraResources + **递归同步 lib/** | dist 已带上分层 host | — |

---

## 3. 成熟产品对照（借鉴什么、不抄什么）

### 3.1 长文写作台

| 产品 | 可借鉴 | 我们不抄 |
|---|---|---|
| **Scrivener** | Binder（项目树）+ 稿纸编辑器 + 一键 Compile；**文档即文件夹**，不把结构藏在数据库 | 复杂编译预设、Windows 旧 UI |
| **iA Writer** | 专注模式（一键收侧栏）、Markdown 纯文本、语法高亮弱化修饰词 | 过度极简导致无结构工具 |
| **Ulysses / LivingWriter / Dabble** | 左库 / 中稿 / 右目标（字数、章节、状态）；大纲与正文同源 | 订阅制同步、闭源格式 |
| **Notion / Obsidian** | 双向链接与块引用可选；库可被外部工具打开 | 把正文做成不可 diff 的私有块 |

**落地结论**：文档库 = 文件系统上的项目目录（对齐 Scrivener/Obsidian）；编辑器 = 纯文本 Markdown/Fountain（对齐 iA Writer）；右侧栏 = 独立写作伙伴对话，文字工具与检查按需切换；会话数据由 Harness 管理。

### 3.2 剧本工具

| 产品 | 可借鉴 | 我们不抄 |
|---|---|---|
| **Final Draft / Fade In** | 元素强制（场景标题/角色/对白）；页时估算 | 专有二进制格式 |
| **WriterSolo / Arc Studio** | 节拍表、卡片视图、协作评审批注 | 云端强制 |
| **Fountain 生态** | 纯文本 + 可 git 的剧本源 | — |

**落地结论**：剧本线继续 **Fountain 纯文本**；门禁用 `check-fountain` 类脚本，不自研格式。

### 3.3 AI 编码/写作工作流

| 产品 | 可借鉴 | 我们不抄 |
|---|---|---|
| **Cursor / Claude Code** | 会话在侧、编辑器在主；工具结果可回写文件；可测量门禁 | 把 UI 变成第二个模型壳 |
| **Arc 浏览器 Spaces** | 「模式」= 一整套布局+侧栏状态的切换，而不是换主题 | 为换而换的动画 |

**落地结论**：切换模式 = **整套布局状态机**（`data-writing-mode` + overlay 可见性 + 面板开关），不是皮肤；持续对话由 Harness Session 处理，文字工具走 Harness `llm`。

### 3.4 对照总表 → 我们的形态

```
┌─────────────────────────────────────────────────────────┐
│ 顶栏：写作台 · 库 · 专注 · AI · 保存 / v+1 · 退出         │
├──────────┬─────────────────────────────┬────────────────┤
│ 文档库    │  专注编辑器（MD / Fountain） │  右栏（可收）   │
│ 项目树    │  稿纸排版 · 自动保存          │  · AI 助手     │
│ 版本徽标  │                             │  · 门禁        │
│ 搜索折叠  │                             │  · 台账速览    │
└──────────┴─────────────────────────────┴────────────────┘
```

### 3.5 旧项目「沉浸式剧本写作平台」架构参考

路径：`E:\沉浸式剧本写作平台`（Next + TipTap + IndexedDB + 自建 Agent）。

| 借鉴 | 我们落地 |
|---|---|
| Repository 接口先于存储 | `lib/store.js` 单独一层，未来可换实现 |
| types / interfaces / modules 分层 | CONTRACT + store / domain / api |
| AI 出口收敛（gateway） | 文字工具走 host `ctx.llm.stream`；持续对话走原生 Session |
| 配置唯一权威 | `writing-mode.json` 由 host 读写 |
| 领域知识可替换 | 已有本地知识与联网资料入口；来源和匹配质量待验收 |
| 意图→动作 Agent 管线 | 交给原生写作伙伴会话；writing-studio 严格流程按需选择 |
| IndexedDB / TipTap / 客户端 API Key | **不抄** |

---

## 4. 总体架构

### 4.1 两层 + 一契约

| 层 | 组件 | 职责 | 升级独立性 |
|---|---|---|---|
| Agent 层 | `writing-companion`（默认）/ `writing-studio`（按需） | 自然交流与工具使用；严格流程单独选择 | 改规则不碰 UI |
| UI 层 | `@dsh-local/writing-mode` | 布局切换、文件浏览/编辑、门禁回显、发送到会话 | 改布局不碰人设 |
| 契约 | `CONTRACT.md` + 项目目录 | 唯一交接面 | 变更三处同步（preset / host / client） |

### 4.2 文档库根目录

**用户可自定义多根**（`~/.dsh/writing-mode.json` 的 `roots[]`）。顶栏 `+` / 设置页添加；读写 `realpath` 限根内。

### 4.3 与会话的连接

| 能力 | 实现 | 状态 |
|---|---|---|
| 阅读/写入项目文件 | host store API | ✅ |
| 持续交流 / 选区交接 | 原生项目会话 + 独立输入 + 可移除选区引用 | 源码接通；原生回归见日志 |
| 模型补全 | `ctx.llm.stream` | ✅ |
| 门禁 / 台账 | domain | ✅ |
| 评审改稿 | reviews → prompt | ✅ |

---

## 5. 产品形态与交互

### 5.1 模式切换

| 入口 | 行为 |
|---|---|
| 右下角浮动钮「写作模式」 | 打开 overlay |
| 侧栏底 / 会话顶栏槽位（有则） | 同上 |
| **Ctrl+Shift+W** | 全局切换 |
| Esc / 顶栏「退出写作」 | 回到编码布局 |
| 设置页「打开写作模式」 | 同上 |

### 5.2 三栏职责

**左 · 文档库**：项目折叠、搜索、draft 版本徽标、历史稿置灰、vN 芯片。\
**中 · 编辑器**：稿纸排版、自动保存（可调）、另存为新版、专注、对比上一版。\
**右 · 写作伙伴**：默认持续对话，可带入稿件、聊人物或尚未成形的想法；“文字工具”按需切换，门禁与台账默认收起。

### 5.3 空态与错误态

- 无库：一键加入示例根 / 内联路径输入（**不用 window.prompt**）\
- 无 LLM：输出框给「可发送到会话」提示\
- 路径越权 / JSON 坏：400；失败顶部 flash\

---

## 6. 里程碑与验收边界

### 原型功能已存在；稳定性按回归证据逐项验收

已交付（摘要）：多库根、门禁、台账、版本导航/diff、评审改稿、设置页、Harness llm、**v0.1.37 Release**、host 分层 + CONTRACT.md。

### 仍开放

1. 导出 Compile（Fountain/MD → 拼接或 PDF）\
2. 台账口径漂移扫描（对照 v5 报告 D 类问题）\
3. 已有本地知识与联网资料入口；来源边界、引用准确性和匹配质量仍需专项验收\
4. better-sidebar 可选 Tab\
5. 新建项目模板已加入；根据真实写作反馈调整，不强制先填完整模板\
6. `verify:writing` / `verify:writing-ui` / `verify:writing-chat` / `verify:writing-native` 自动回归；另需真实模型多轮体验验收\

---

## 7. 契约

权威文件：`dsh-desktop/plugin/writing-mode/CONTRACT.md`（目录 / prefs / HTTP / gate / 模块边界）。

### 7.1 目录契约

```
{{root}}/
  项目名/
    project.md
    bible/{world,characters,relationships,timeline}.md
    outline/{structure,units,foreshadow}.md
    draft/novel/第N章-*-vX.md
    draft/script/第N集-vX.fountain | actN-vX.fountain
    state/character-state.md
    reviews/评审-*-vX.md
```

### 7.2 HTTP

见 CONTRACT.md 表：config / tree / prefs / roots / get / save / version / delete / gate / ledger / assist / companion / templates / create-project。

### 7.3 脆弱面

| 面 | 策略 |
|---|---|
| `shell.overlay` / slots | register(options, React)；失败降级 |
| composer 预填 | 独立右栏订阅原生 `provideInfo` / `inputActions.setDraft`，按项目绑定；文字工具追加输入，稿件作为引用 |
| 设计令牌 | 只用 `--dsw-alias-*` |

---

## 13. 踩坑与注意点（写代码/改 UI 前必读）

> 2026-09-10/11 实测逼出来的，每条都对应过真实故障。

### 13.1 Cordis / 插件挂载

| 坑 | 现象 | 约定 |
|---|---|---|
| **`inject` 与服务面不一致** | 缺依赖会导致起不来 | host：webServer/llm/agentDefaultModel；client：slots/sessions/connection/workspaces |
| **正式版 vs 源码** | 改 BUILTIN 不会自动进已装包 | profile 补丁 + 同步 profile；要进安装包必须 dist |
| **host 变更 ≠ 刷新页面** | client Ctrl+R；**host 必须完全退出桌面** | 改 `index.js`/`lib/*` → 重启 |
| **内置同步漏子目录** | 只拷三文件会丢 `lib/` | `syncBuiltinPlugin` 递归拷 js/json/md/yml |

### 13.2 React（shell.overlay 组件）

| 坑 | 现象 | 约定 |
|---|---|---|
| **Hooks 顺序** | useMemo 在 early-return 后 → 进台崩溃 | hooks 全在 return 前 |
| **浮钮** | overlay 坏了退不出 | 开台时 CSS 藏浮钮；关台显示 |
| **setFilePath 死循环** | loadFile 无条件回写 path | 仅路径真变化时 set |

### 13.3 文件扫描与路径

| 坑 | 现象 | 约定 |
|---|---|---|
| **重叠目录扫描** | 同章两条 | 只扫顶层契约目录 + realpath 去重 |
| **路径逃逸** | 任意 path 读写 | 必须落在库根内 |

### 13.4 构建 / 安装 / 网络

| 坑 | 现象 | 约定 |
|---|---|---|
| **setup.exe 被占用** | dist 失败 | 先移开旧包 |
| **GitHub 下载超时** | palis tgz / electron zip | `DSH_BUILTIN_CACHE` 本地缓存；`ELECTRON_MIRROR=npmmirror` |
| **工作区锁 asar** | EBUSY | 构建输出到 `%TEMP%\dsh-dist-*` |
| **git main ≠ 应用更新** | 检查更新无新版本 | 必须 tag + Release 上传 setup |

### 13.5 与 writing-studio 预设协作

| 坑 | 现象 | 约定 |
|---|---|---|
| **库根 ≠ 预设 cwd** | 两套稿 | 库根指向含项目的根（如 `E:\剧本`） |
| **会话数据接口** | 升级后 Session / chat 节点 schema 可能改变 | 独立视图订阅原生状态；授权、复杂请求及附件保留完整会话入口；升级必须实机验收 |
| **门禁口径** | UI 与 check-*.mjs 漂移 | 改阈值两边同步（domain ↔ 验证脚本） |

### 13.6 修 bug 优先检查清单

1. 进不去写作台 → Hooks / React 报错；浮钮能否退出\
2. 列表重复 → 是否又 walk 了重叠子目录\
3. 内核起不来 → writing-mode inject / apply\
4. 改了没生效 → client 刷新 vs host 重启；是否只改了源码未同步 profile\
5. 正式版没入口 → dist / 安装 / profile 补丁\
6. AI 没反应 → prefs.aiMode、llm inject、501 降级文案\
7. 分层后启动失败 → `lib/store.js`、`lib/domain.js` 是否被 sync 进 profile\

---

## 附录 · 落地清单（截至 v0.1.37）

- 模式：shell.overlay + DOM 浮钮 + 槽位入口 + Ctrl+Shift+W\
- 库：多根、搜索、折叠、版本徽标、历史稿、vN 对比、评审改稿\
- 编辑：稿纸排版、自动保存、另存为新版、专注\
- 测量：门禁、台账、状态条角标、与上一版 diff\
- AI：Harness llm / 自定义 Provider；找资料/灵感；发送到会话\
- 设置：settings.section 全套\
- 架构：CONTRACT + store/domain/api；main 递归同步\
- 发布：**v0.1.37** GitHub Release（setup + blockmap + latest.yml）\

署名：ox-alpha（策划更新 · 2026-09-11）

## 14. v0.4 接手记录与后续边界

- v0.3 曾复现路由编码、保存切换竞态、历史覆盖、库外读取等问题。原评估保留在 `dsh-desktop/docs/audits/writing-mode-2026-09-11/评估.md`；修复证据见新日志，不能把“存在功能”当成“稳定闭环”。
- 新会话必须关联 workspace；不能只传 cwd。原生 `reuseWorkspaceBlank` 只接受 true 或省略，false 会被拒绝。
- 伙伴预设首次安装到 `$DSH_HOME/.agent-presets/writing-companion`（带点），后续保留本地自定义；旧 writing-studio 未改写。
- 编辑器按 revision 校验、保存排队、历史拒写，另存独占创建；外部改稿在无未保存内容时刷新，有未保存内容时保留输入并提示冲突。
- 原生工具权限由 Harness 管理。文档库根只约束 writing-mode HTTP API，预设的保留版本要求是行为指引，不能宣称为所有工具写入的防火墙。
- 未验收：真实模型多轮自然度、上下文压缩后的设定保持、真实工具改稿行为、所有多窗口并发情况。优先用真实作品验证体验，再决定是否增加记忆卡片或阶段工具。
- 本轮未发布、未替换正式安装版。v0.3 原文保留于 `调研/写作模式-策划案-v0.3-20260911.md`。

署名：Codex / GPT-6（v0.4 接手更新 · 2026-09-12）。

## 15. v0.5 独立写作界面与推送核对

- 已移除原生中心栏停靠和整套欢迎页；专用 UI 包含项目栏、聊天记录、可移除稿件引用及底部输入。
- 原生会话承担模型、工具、队列与上下文管理；授权/提问和复杂输入提供完整会话入口，不自动批准。
- 测试证据：host/controller 16 项、编辑器 4 组、聊天 fixture 4 组、真实内核 3 组通过。真实内核验证 turns=0，fixture 不代表真实模型回复质量。
- 日志索引已更新至〔138〕；回归报告和实际窗口截图位于 `docs/audits/writing-mode-2026-09-12/`。
- 本次提交包括 v0.4/v0.5 尚未提交的源码、测试、日志、契约和本策划案仓库副本；推送到 main，不创建版本 tag 或应用 Release。

署名：Codex / GPT-6（v0.5 UI 与推送前核对 · 2026-09-12）。
