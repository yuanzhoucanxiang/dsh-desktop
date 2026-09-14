# 写作模式 v2 架构（提交 4649b59）

## 分层与目录职责

```
plugin/writing-mode/
├─ index.js                 # host：inject + /api/writing-mode 路由分发（唯一 HTTP 出口）
├─ lib/                     # host 侧（node，无 DOM/React）
│  ├─ store.js              #   库根/扫描/读写/路径安全
│  ├─ domain.js             #   门禁/台账/AI 路由
│  ├─ project-memory.js     #   项目备忘：schema + revision/etag + 审计 changes + 历史恢复
│  ├─ file-lock.js          #   跨进程锁（owner token，不抢活锁）——备忘与协调记录共用
│  ├─ coordination.js       #   会话创建协调记录：reserved → creating → bound / uncertain
│  ├─ draft-checkpoints.js  #   草稿 checkpoint（按窗口分桶，供跨窗口恢复候选）
│  ├─ templates.js / knowledge.js / websearch.js / companion.cordis.yml
│  └─ editor-session.js     #   仅供测试的 re-export（不入运行清单）
├─ src/shared/              # 客户端与 host 共享的纯函数（无 React/DOM/适配器/服务）
│  ├─ editor-session.js     #   编辑器会话控制器（唯一实现）
│  ├─ context-builder.js    #   preparedTurn v2：选择/固定/预算/不可变契约
│  └─ reference.js          #   引用身份（path+revision+selection+指纹）与状态判定
├─ src/client/
│  ├─ entry.js              #   入口：守卫、name/inject、apply(ctx) 装配、测试钩子导出
│  ├─ copy.js               #   文案表
│  ├─ adapters/harness/     #   **唯一 native 接触面**
│  │  ├─ runtime.js         #     服务引用 + 本进程唯一 adapter 实例
│  │  ├─ adapter.js         #     capabilities/connect/attach + handle（send 三分/迟到归位/dispose）
│  │  ├─ identity.js        #     项目身份归一（host canonical 优先）
│  │  ├─ projection.js      #     会话投影（UI 不读 chat.nodes/order）+ 受理证据
│  │  └─ coordination-client.js  # 协调协议 HTTP 客户端
│  ├─ app/                  #   装配与布局（入口挂载、浮动入口、三栏组合）
│  ├─ features/{editor,library,companion,memory,tools,settings}/
│  ├─ services/writing-api.js    # HTTP 封装（超时/错误归一）
│  ├─ state/{mode,prefs,companion-drafts}.js
│  └─ styles/writing-css.js
├─ test/                    # node 验收（真实 host 模块 + 临时 DSH_HOME）
└─ runtime-manifest.json    # 发布集合的唯一来源（repo → 包 → profile 逐文件比对）
```

## 关键契约

1. **唯一 native 接触面**：`createHarnessAdapter({sessions, workspaces, connection, api})`
   - `capabilities()` → `{flags, missing(硬缺口=创建所需), degraded(软缺口=读草稿/打开会话), canCreate, canSend}`
   - `connect(projectIdentity, operationToken)` / `attach(projectIdentity, sessionId, …)`
   - handle：`getSnapshot/subscribe/getDraft/setDraft/send/cancel/openFullSession/dispose/recover/refresh`
   - `send()` 返回 `accepted | rejected | uncertain`；uncertain 先核对原生证据（user 节点/queue 行），无证据才算不确定且**保留正文、不自动重发**
2. **创建协调**：进程内按 host 规范身份共用创建 Promise；跨进程由 `lib/coordination.js` 的持久记录仲裁
   （`reserved → creating → bound/uncertain`，按项目身份分桶，token 语义：过期 token 不得改写新绑定）
3. **当轮上下文**：`buildPreparedTurn` 产出全嵌套冻结的 preparedTurn
   （projectKey / operationId / message / reference / memoryRevision / memoryEtag / selectedMemory / omissions / body）
4. **备忘数据**：`<作品>/state/writing-memory.json`，schemaVersion + revision + etag + changes（含 before/after 与 actor）
5. **发布集合**：`runtime-manifest.json`（root/entry/files/docs/exclude）；`lib/plugin-sync.js` 按它同步并写受管记录 `.dsh-managed.json`

## 依赖边界（可静态判定，R1–R8）

- R1 客户端不得引入 Node 内置；R2 `src/shared/**` 不依赖 React/DOM/适配器/服务
- R3 `adapters/**` 不 import React/JSX/组件/样式；R4 相对 import 必须解析到真实文件
- R5 运行清单与 `lib/*.js` 一一对应（仅测试专用可排除）；R6 入口不得再持有样式数组/草稿保存队列
- R7 跨模块漏 import（严格括号配对 + 只取绑定名；并含"注入缺陷必须报错"的自检）
- R8 目标结构 11 个目录在位；`src/client` 根下只允许 `entry.js` 与 `copy.js`

## 数据流（一轮对话）

```
作者输入 → (每次发送) 重读备忘 → buildPreparedTurn（冻结）
        → adapter.send → 原生 session.prompt(parts, 'queue')
        → accepted / rejected / uncertain（附原生证据）
        → 会话投影（projection.js）→ UI 行视图（UI 不接触 native 内部结构）
```

记忆写入：UI → `POST /api/writing-mode?route=memory`（带 baseRevision/baseEtag/actor）
→ host 锁内读改写 → 新 revision + change（before/after + actor）→ 返回新 etag。

— ox-alpha
