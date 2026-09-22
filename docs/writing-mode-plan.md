# 写作模式整合策划案

> 版本：v0.13 · 2026-09-22（已有项目接入与可靠性整改已随 v0.1.42 发布）\
> 范围：原生写作伙伴会话（`writing-companion`）+ 桌面工作台（`writing-mode`）；`writing-studio` 留作按需采用的严格流程\
> 原则：预设管协助方式，UI 管写作交互；文件与会话接口见 `plugin/writing-mode/CONTRACT.md`\
> v0.8：新增世界观执行方案 v1（§18.8）；明确单一权威数据、可靠保存与迁移、P0–P5 和 W00–W25 验收。仅文档。
> v0.7：产品讨论定稿「AI 引导 + 讨论结果整理」的设定条目与双端用法（§18）；**仅文档，未改插件实现**。\
> v0.6：记录 `feat/writing-mode-architecture` 阶段 A–E 与 F/N/T/W 四轮返工。\
> 注（2026-09-20）：GitHub Release **v0.1.40** 已发布；同日 create-project 路径加固（hunt）在工作树**未提交**，不在 0.1.40 安装包内。

> 版本管理：仓库副本 `dsh-desktop/docs/writing-mode-plan.md` 与本地 `E:\剧本\写作模式-策划案.md` 同步；修改任一处需同步另一处并更新工作日志。

---

## 0. 当前状态一览（2026-09-20）

| 范围 | 状态与说明 |
|---|---|
| **v0.1.40 已发布** | 写作伙伴 Markdown 回复排版；候选经编辑/确认保留助手消息与会话来源；备忘新增/编辑支持多行并保留段落 |
| 阅读交互 | 标题、粗体、引用、列表、表格、代码与网页链接；长表格/代码在侧栏内滚动，作者文字和候选原文保持不变；HTML 不执行、图片不自动加载 |
| AI 协助 | 沿用 Harness 原生模型、工具、权限与会话；自由讨论、设定推敲、明确需求后改稿，不增加固定轮数或强制创作步骤 |
| 发布验收 | 严格门禁 19 步通过，真包 9/9；已完成真实模型三场景与同一内核两个真实窗口验证；Windows/macOS 资产已发布，未替用户安装 |
| **工作树修复，未发布** | create-project H3/H4：非空目录保护与非法目录名拒绝。当前整改与测试记录见 2026-09-20 工作日志；不属于 v0.1.40 |
| **v0.1.41 世界观已发布** | 自由讨论 → 选入整理 → 候选编辑/确认；支持修订、撤回、历史与投影冲突恢复。A01–A12 修复后完整 21 步门禁及真包 9/9 通过；真实模型五类场景及两真实窗口并发已通过，Windows/macOS 资产已发布 |
| 未验收范围 | macOS 实机、NSIS 隔离安装、受控离线、长上下文压缩后续聊等仍待验证，不以门禁通过代替这些场景 |

发布说明：`docs/releases/v0.1.40.md`；验收证据：`docs/audits/writing-architecture/2026-09-20/release-0.1.40/`。

以下 9 月 12 日内容保留作阶段记录；其中“未实现/未合并/未发布”仅描述当时状态，不覆盖上表。

### 0.0 历史快照（2026-09-12 架构分支）

| 层 | 状态 |
|---|---|
| writing-companion | 自然交流预设；Harness 原生工具与项目会话 |
| writing-studio 预设 | 旧严格流程保留；三轮放行非默认 |
| writing-mode UI | 右栏持续对话 + 文字工具；备忘/草稿 checkpoint 已接线 |
| **架构分支** | `feat/writing-mode-architecture` @ `53223df`：Stage A/E + 四轮复核 F/N/T/W 返工 |
| 验证脚本 | p1 7/7 · review-f01-f06 10/10 · architecture-cde 25/25 · verify:writing-build PASS |
| 发布 | 正式包仍为 **v0.1.38**；架构分支 **未合并 / 未发版** |

### 0.0a 架构分支进度（feat/writing-mode-architecture）

| 阶段 | 状态 | 要点 |
|---|---|---|
| A 模块/构建 | 部分完成 | `src/client/entry.js` + `src/shared/editor-session.js`；`npm run build:writing` / `verify:writing-build`（不覆盖产物） |
| B 会话适配 | 沿用现有 | `ensureCompanionSession` + companion 路由；未做独立 adapter facade |
| C 草稿恢复 | 已实现 | `draft-checkpoints` schema 2 + **baseRev 单调**；恢复 pending 时 defer POST |
| D 项目备忘 | 已实现 | `project-memory`：双 token、锁不抢、读写 realpath 边界、历史快照 |
| E 上下文 | 已实现 | `context-builder`；send 读入 confirmed 备忘进 preparedTurn |
| F 集成 | 未完成 | 30 项逐项验收、打包可见预览、真实模型未做 |

#### 四轮复核收口（审查报告见 `docs/audits/writing-architecture/2026-09-12/`）

| 轮次 | 问题 | 修复提交 |
|---|---|---|
| review | F01–F10 | `6ee2539` |
| review2 | N01–N07 | `b66d194` |
| review3 | T01–T03 | `606f21f` |
| review4 | W01–W03 | `757ff26` + 自查 `53223df` |

关键不变量（已写入实现与测试）：

1. **锁**：owner PID 存活则不抢；死后 `lock-stale`，无取得空档  
2. **备忘**：`baseRevision`+`baseEtag` 必填；GET/POST 同路径边界  
3. **草稿**：`baseRev` 执行时读取；清除写 **tombstone**（rev 递增）  
4. **恢复**：pending 不 POST；adopt rev 后 flush；迟到结果不写 UI/缓存  

#### 五轮收口（R01–R03）\n\n- 恢复完整快照采纳 · 显式空态 dirty flush · 409 冲突暂停与 keep-local/keep-remote\n\n#### 仍开放

- entry feature 拆分与独立 Harness adapter  
- 备忘历史 UI / 候选确认  
- 30 项验收矩阵 + 打包字节 + 可见隔离预览  
- 真实模型体验（方案 §12）  
- 合并 main 与 v0.1.39 发布（审查通过后）

### 0.1 host 分层

```
plugin/writing-mode/
  CONTRACT.md       目录 / prefs / HTTP / gate
  lib/store.js      库根、扫描、读写、路径安全、resolveProjectDir
  lib/domain.js     门禁、台账、AI 路由与补全
  lib/project-memory.js     项目备忘（锁 / token / 历史）
  lib/draft-checkpoints.js  未发送草稿 checkpoint（rev 协议）
  lib/companion.cordis.yml  写作伙伴人格
  src/client/entry.js       模块化前端源（构建产物 client.js）
  src/shared/editor-session.js / context-builder.js
  index.js          cordis inject + /api/writing-mode
```

### 0.2 AI 底座

| 来源 | 行为 |
|---|---|
| **写作伙伴** | 原生 workspace + session + writing-companion；模型、工具、审批、流式回复、取消与上下文压缩由 Harness 管理 |
| **文字工具** | `ctx.llm.stream`；Harness 全局默认模型或显式自定义 Provider / Model / Key |
| **交接** | 稿件或选区先成为可移除的引用，作者随想法一起发送；打开写作台不自动调用模型 |
| **连续性** | 原生会话记录和项目文件；不承诺无限记忆、关闭后后台陪聊或主动联系 |

陪伴的产品目标：允许闲聊、试探、犹豫、讨论人物和生活观察，不要求每次交流产出任务或检查清单；执行需求明确时灵活使用工具。尊重作者决定，区分已确认设定与 AI 建议，可以坦诚提出不同意见。

右栏交互：上方为项目和会话设置，中间为对话记录，下方为轻量输入与可移除引用。授权和提问显式提示；附件、斜杠指令、模型调整及较早历史在完整会话处理。v0.1.40 中助手回复按 Markdown 显示，作者正文保持原文；未发送正文和引用通过按项目与窗口分桶的 checkpoint 恢复。真实模型三场景已验证，长上下文压缩后续聊仍待验收。

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
| UI 插件 writing-mode | `dsh-desktop/plugin/writing-mode/` | **v0.1.38 已发布**；包含独立写作伙伴、模板和资料入口 | 导出 Compile、资料质量验收、better-sidebar、真实模型体验 |
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
7. **世界观：AI 引导 + 讨论结果整理**（§18 设计已定稿 v0.7，**待实现**；非填空模板向导）\

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
- 日志索引已更新至〔140〕；回归报告和实际窗口截图位于 `docs/audits/writing-mode-2026-09-12/`。
- v0.5 首次源码提交包括源码、测试、日志、契约和本策划案仓库副本；随后作者授权发布，结果见 §16。

署名：Codex / GPT-6（v0.5 UI 与推送前核对 · 2026-09-12）。

## 16. v0.1.38 发布记录（2026-09-12）

- Release：https://github.com/yuanzhoucanxiang/dsh-desktop/releases/tag/v0.1.38 ，已设为 Latest。
- tag 对应发布提交 `ebe452c7bf075797c8cea3fcf715bcb004c01fc5`。Windows 安装包、blockmap、latest.yml 与 macOS arm64 DMG、latest-mac.yml 共 5 个产物已上传。
- Windows 包内版本、写作插件 11 个资源与源码比对、启动冒烟和远端资产 SHA256 校验通过。macOS Actions `34673962641` 成功，未在 Windows 上声称完成 macOS 原生启动验收。
- 旧 UI 冒烟存在读取 html 主题令牌和旧 CRT id 的过时断言；按当前 body 令牌与 `.palis-crt-sweep` 实测开启/关闭通过。测试原始失败及补充证据见 `docs/audits/release-v0.1.38/`。
- 真实模型多轮自然度、长期设定保持、工具改稿和多窗口并发边界继续开放，不因发布而改记为已验收。

署名：Codex / GPT-6（发布同步 · 2026-09-12）。

## 17. 下一轮架构完善方案（待执行）

详细执行与审查基线见 `docs/plans/writing-mode-architecture-v1.md`；本机交付副本为 `E:\剧本\写作模式-架构完善执行方案-v1.md`。

范围为前端模块化、集中 Harness 适配、草稿与引用恢复、可确认撤回的项目备忘、上下文组装和打包验收。由接手 agent 完成后交回审查，不把本节计划当成 v0.1.38 已实现能力，也不自动发布下一版本。

— Codex / GPT-6，2026-09-12

## 18. 世界观：AI 引导与整理（设计定稿 · 待实现）

> 2026-09-20 · v0.7 · 与作者对齐后的设计记录。**不是已实现功能**；实现前须按 CONTRACT 增补 host/client 并回归。

### 18.1 产品判断

1. **不要照搬模板填空**：`bible/*` 模板仍是脚手架，可选；主路径是 AI **引导创作** + **整理讨论结果**。
2. **整理来源**：用户与 AI 讨论出来的结论，而不是让模型对着空表生成设定集。
3. **双读者**：整理产物既要**可读**（人阅读、回想），又要**可用**（AI 助手默认能引用；需要细节时能读到全文）。

### 18.2 设定条目（讨论整理结果）

| 字段 | 给谁用 | 约定 |
|---|---|---|
| 标题 | 人 | 短，能一眼定位（如「夜行禁令」） |
| 结论 | 人 + AI | **一句可独立成立的话**；当轮默认注入的就是它 |
| 说明 | 人为主 | **一小段（约 2–4 句）**：为什么成立、怎么用、常见误解；**不进默认注入** |
| 边界 / 例外 | 人 + AI | 可选；**有则必须随结论一并注入**，避免伙伴当绝对规则用 |
| 来源 | 人 | 哪次讨论 / 哪条消息，便于回想 |
| 状态 | 系统 | `候选` → 作者确认 → `已确认`；撤回/修订对齐项目备忘语义 |

作者已确认：说明允许一小段，**不是**只能口令式短句。执行约定：一句结论、两到四句说明是整理建议，不作硬校验；作者可写长说明或保留疑问。

### 18.3 双端用法（同一份内容）

- **人读**：确认后同步到本功能受管的 `bible/世界观整理.md`，按「标题 / 结论 / 说明（/ 边界）」排版，便于翻阅与回想；既有手写文稿不自动改写。
- **AI 用**：当轮上下文默认只带 **已确认结论**（+ 边界）；需要展开时伙伴再读 `bible` 原文或项目简报，而不是每次灌入全部说明。
- **存储关系（v0.8 修订，待实现）**：扩展现有 `state/writing-memory.json` 作为结构化设定的唯一权威来源；`bible/世界观整理.md` 是可重建的阅读稿。可注入结论与边界由同一条设定派生，不进行两份权威数据的独立双写。作者已有的 `bible/world.md` 等手稿不自动接管；生成稿被外部编辑时先处理差异，不静默覆盖。

### 18.4 最小流程（实现顺序）

1. 对话中引导（基于现有 `project.md` / 正文 / 备忘追问后果、代价、势力与日常，不弹强制空表）。
2. 伙伴产出**候选设定条目**（**不直接改文件**）。
3. 作者修改 / 确认 / 丢弃。
4. 确认先原子保存权威设定，再同步 `bible/` 可读稿；生成失败明确显示“设定已保存，可读稿待同步”，重试不重复新增。结论与边界一起供上下文选择。

### 18.5 本阶段非目标

- 设定关系图 / 结构化实体库（势力网、种族库等 UI）。
- `bible/` 与正文的一致性门禁（`runGates` 仍只作用于 `draft/novel` 与 Fountain）。
- 强制分步「世界观向导」或强制先填完整模板。

### 18.6 与现有能力的关系

| 已有 | 关系 |
|---|---|
| `templates.js` 的 `bible/*` 骨架 | 保留为新建项目脚手架，**不是**世界观功能本体 |
| `project-memory` + `context-builder` | 复用候选/确认与 confirmed 注入；说明段默认不进 preparedTurn 自动部分 |
| 写作伙伴自由对话 | 引导与讨论主入口；工具/整理为可选增强 |
| 资料 assist / knowledge | 仍作旁注与查证，不代替讨论整理 |

### 18.7 实现后验收边界（预告，非当前断言）

- 讨论 → 候选 → 确认 → `bible` + 备忘 落盘可回读。
- 未确认条目不进默认上下文。
- 默认注入不含「说明」段；含边界时边界可见。
- 路径与锁语义对齐现有备忘/文档协议；不破坏 `CONTRACT.md` 既有 route。

— 署名：ox-alpha，2026-09-20


### 18.8 执行与审查入口（v0.8 · 待实施）

详细方案：`docs/plans/writing-world-settings-v1.md`；本机副本：`E:\剧本\写作模式-世界观引导与整理执行方案-v1.md`。

- P0：先独立复核现有创建项目 H3/H4 加固，保留并辨认工作树修改。
- P1–P3：schema 兼容与迁移、来源快照、候选/确认/修订、操作去重、可读稿冲突与恢复。
- P4：结论与边界整体参与预算、实际参考预览、说明按需读取；不限制普通聊天。
- P5：W00–W25 逐项验收，真实模型五场景、两真实窗口与多进程分别验证、新包与可见隔离预览。
- 此节及执行方案均不代表新增功能已经实现；已发布版本仍按 §0 区分。实施完成后交回证据审理，发布另按届时授权。

— 署名：Codex，2026-09-20

## 19. 世界观整改交回（2026-09-20）

工程实现与 A01–A12 修复详见 `docs/audits/writing-world-settings/2026-09-20/repair/report.md`。设定以 schema2 项目备忘为权威，bible 为可恢复投影；作者确认前不改变已有生效设定。AI 沿用原生会话自由讨论，整理为可选动作，不强制创作流程。新增状态明确区分主记录保存与投影失败；手稿冲突可比较、保留副本后重建。

完整门禁 21 步、真包 9/9、协议修复测试 10 组与 UI 5 组通过。W24 真实模型五场景等仍未验收；总体 PARTIAL。当前工作树未提交、未发布，正式版本仍为 v0.1.40。


## 20. v0.1.41 发布验收

W24 五类真实故事场景已通过：模糊想法整理、作者中途改主意、矛盾设定讨论、修改已确认设定、长说明超过默认预算。两个真实窗口并发修改时显示冲突并保留本地文字；显式比较再确认后才更新，历史保留。证据：`docs/audits/writing-world-settings/2026-09-20/live/README.md`。此结果覆盖 §19 的待验收状态。NSIS 隔离安装、macOS 实机、受控离线、目录移动与压缩后连续性仍未验收，发布说明如实列出。


### v0.1.41 最终发布状态（2026-09-21）

已发布：https://github.com/yuanzhoucanxiang/dsh-desktop/releases/tag/v0.1.41 。五项资产齐全，Latest为v0.1.41；发布提交738066a（应用实现b3a72eb）。上文“准备/未发布”保留为阶段记录，以本状态为准。未替用户安装；未验收环境边界继续按发布说明保留。

## 19. 已有作品接入与恢复收口（2026-09-22）

当前工作树新增“打开已有”：选择作品目录即把它作为单一项目，保留原有设定、故事、笔记等文件夹，不要求模板标记。作品库入口仍按原方式列子项目。此项尚未进入正式 v0.1.41。

接入只建立配置，不自动确认资料、不自动整理或改写文件；作者阅读、选择引用、与写作伙伴讨论，必要时再明确整理成设定候选。多份文档共用所选项目的会话与备忘身份。

可靠性补齐：关闭窗口后的世界观候选可恢复；恢复期间继续输入优先保留；迟到读取不能写回已关闭面板。移动作品和无关联手动导入分开验收，界面展示来源及目的。在线残留锁只诊断，不能自动夺走或清除。

工程验收加入已有项目协议与真实 Electron 界面两个入口，整套 writing-all 共 24 步；此次最终结果、包身份和预览以 docs/audits/writing-world-settings/2026-09-22/integration.md 为准。正式目录只读取，实测使用隔离副本。

仍开放：原子锁所有权长期方案、稳定作品 ID、完整 IPC 通道面、更新下载到同一 Release 清单的哈希闭环、NSIS 与 macOS 实机验收。不得用本轮 dir 包验收代替这些事项，也不宣称已发布。

署名：Codex

### 19.1 发布状态更新

v0.1.42 于 2026-09-22 公开，代码 ac00c15，Release ID 393502728；五项跨平台资产与更新清单核验一致。§19 的未发布描述保留为整合阶段历史，本节覆盖当前发布状态。发布不等于本机已经安装更新；剩余验收边界见 docs/audits/release-0.1.42/report.md。— Codex
