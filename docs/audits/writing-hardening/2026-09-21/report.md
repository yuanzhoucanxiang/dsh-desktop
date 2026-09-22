# V1–V9 / G1–G4 漏洞 hunt 与修复（2026-09-21）

审查+修复：ox-alpha。基线 HEAD `6783647`（v0.1.41 已发布）+ 工作树里并行修改方（Codex）未提交的 D01–D04 修复。

结论：**13 项缺陷全部实锤复现，13 项全部修复**；归档探针重跑 **V 0/9、G 0/4 复现**；
Node 层 17 项门禁 exit 0。未提交、未推送、未发布、未替换正式安装、未关闭任何正在运行的窗口或预览。

- 复现取证（保留原始负向证据，不以新结果覆盖）：[`hunt-writing.mjs`](hunt-writing.mjs) / [`hunt-git.mjs`](hunt-git.mjs)
- 永久正向门禁：`plugin/writing-mode/test/hardening-v1-v9.mjs`（66 项，`npm run test:writing-hardening`）、`lib/git-review.test.js`（新增 G1–G4 共 14 项）

## 一、缺陷与修复

| 编号 | 级别 | 触发 / 影响 | 根因与定位 | 修复 |
|---|---|---|---|---|
| **V1** | **P0** | 任何 POST body 跨 socket chunk（约 64KB 起）。实测 276KB / 92000 码点中文正文 round-trip 后出现 **7 个 U+FFFD**，首个差异在第 21751 字 → **静默写进手稿**，不可逆、无备份。`save`/`version`/`draft`/`world-draft`/`memory` 全中招；已在 v0.1.36–v0.1.41 发布版里 | `index.js` `readBody` 用 `data += String(chunk)` 逐 chunk 独立 UTF-8 解码；三字节汉字被 chunk 边界切开时两半各自解码失败成 U+FFFD，而 `JSON.parse` 对 U+FFFD 完全合法 | 按字节收集 `Buffer[]` → `Buffer.concat().toString('utf8')` 一次解码；上限改按**字节**（1 MiB，与 CONTRACT 一致）；超限/中断返回 null 由路由报错，不再静默当空对象 |
| **V2** | P1 | 配置文件一次瞬时读失败（原子写中途、坏块、手工误编辑）后，**任意**一次写配置（哪怕只改字号）把库根 / activeRoot / 全部伙伴会话绑定 / 自定义 AI Key 清零，无备份无诊断。并发下两窗口改不同项必丢一次更新 | `store.js` `readConfig()` catch-all 返回空默认值（连 `companions` 键都没有），损坏与 ENOENT 不分；三条写路由各自 readConfig→改→writeConfig，无锁无版本 | 只有 ENOENT 才当空配置；解析失败 → 保留损坏原件字节（按内容哈希命名的 `.damaged-<hash>`，幂等）+ 回 `corrupt-config` + 给 cfg 打 `__damaged`，`writeConfig`/`updateConfig` **拒绝回写**；新增 `updateConfig(mutator)` 把读-改-写圈进同一把锁并带单调 `revision`；三条路由改走它 |
| **V3** | P1 | 窗口 A `claim` → 作者 `forget` → A 的在途 `confirm`/`creating`/`uncertain` 迟到抵达 ⇒ 记录被写成 `phase:null` ⇒ 此后 `readCoordination`/`claim`/`release` 全部 `bad-record` 500，`forget` 只回 `corrupt-record` 且**不删文件**（`force:true` 也不行）⇒ 该作品永久无法再绑定写作伙伴，唯一出路是手工删文件 | `coordination.js` `mutate` 对 stale-token 分支返回的 `{...current,_outcome}` 照样写盘（current 是空记录时 phase=null），而 `normalizeRecord` 判 `PHASES.has(null)=false` | ① `mutate` 守门：没推进到合法相位的结果**不落盘**；② `normalizeRecord` 对 `phase:null` 且无 sessionId/workspaceId 的既有中毒记录**读时自愈**为空记录（仍带绑定的畸形记录继续报 `bad-record`，不掩盖）；③ `releaseCoordination` 兜住坏记录不再 500；④ `forgetCoordination(force)` 先把原件改名保留再清，给作者出路 |
| **V4** | P1 | 任一进程崩溃留下 `.lock` ⇒ 该桶**每次**草稿保存同步忙等 8038ms 再 `lock-stale` 503；期间 `setInterval(1ms)` 触发 0 次 = 内核事件循环完全冻结（所有 HTTP/流式回复一起停）；锁文件对作者不可见、无清理入口。D 修复把 `writeCheckpoint` 接入该锁后，暴露面扩大到每一次自动保存 | `file-lock.js` 获取循环用 `while (Date.now() < waitUntil) {}` 空转，deadline 8000ms，且残留锁与活锁同等对待 | ① 空转换 `Atomics.wait`（不再烧 CPU）；② 残留锁走 `staleFastFailMs`（草稿 250ms）快速失败，草稿路径 deadline 收到 1.5s；③ 新增 `inspectLock`/`quarantineStaleLock`/`listDraftLocks`/`sweepStaleDraftLocks`/`listCoordinationLocks`/`sweepStaleCoordinationLocks`；④ **内核启动清扫** + `maintenance` 路由显式清理，一律改名隔离不删除、活锁绝不动。**实测 8038ms → 275ms** |
| **V5** | P1 | A、B 两部作品都移动过目录后，打开 B 会列出 A 的旧路径；确认即把 A 的草稿写进 B（实测 `copied=1`，B 桶出现「作品A的私密草稿」）。正是 2026-09-21 审查报告 D04 要求挡住的「两个作品错误合并」 | `project-recovery.js` `relocationCandidates` 只判「绝对路径 + ≠target + 已不存在」，与 target 毫无关系；token 只对候选自身求哈希，不构成绑定 | 候选必须携带**关联证据**：`memory-project-key`（随目录搬走的 `state/writing-memory.json` 里记着旧路径）/ `projection-record`（可读稿抬头 `> 项目：<旧路径>`）/ `manuscript-reference`（旧草稿引用的手稿在目标作品同名同位）。有证据 → 可直接导入；无证据 → `relation:'unrelated'`，**默认硬拒**（409 `recovery-source-unrelated`），仅在作者显式知情确认（`confirmUnrelated` 严格 `=== true`）后才导入，并把关系记为 `unrelated-author-confirmed` 写进历史桶供事后追查。host 侧重判一次，客户端/模型绕不过；UI 逐条显示依据或「无关联证据」及风险说明 |
| **V6** | P1 | 库根经 junction/映射盘访问时：`recoverRelocation` 用 realpath 规范身份写桶，UI 用客户端原始串读 → **恢复报成功（copied≥1）但界面永远读不到**。另：路径尾部多一个分隔符即分裂成两个草稿桶（coordination 认为同一作品、draft 认为两个）；`listCheckpoints` 用原始串全等比较，跨窗口草稿列表悄悄为空 | 三套规范化规则并存：draft `bucketKey`（lowercase+换分隔符，**不剥尾斜杠**）、coordination `bucketOf`（**剥**）、`listCheckpoints`（原始串全等）；路由把客户端原始串而非 `resolveUnderRoots().abs` 传下去 | 新增 `lib/project-identity.js` 单一口径 `identityKey()`（分隔符归一+剥尾斜杠+小写，保留 `\0` 分桶后缀）；draft/coordination/recovery 全部改走它；`listCheckpoints` 按身份匹配；路由新增 `draftBucket()` 统一取 `t.abs`。**realpath 故意不进分桶函数**（否则既有桶名会因一次 realpath 结果变化整体失联），改由解析阶段完成；旧口径桶由 `readCheckpoint` **只读回退**（标 `legacyBucket`），写入落新桶，下次保存自然迁移 |
| **V7** | P2 | 12 个窗口桶一次 GET 回 393KB；单桶正文上限 500KB ⇒ 理论峰值 = 历史窗口数 × 500KB。`world-drafts.recoveries()` 每次刷新拉全量并 `JSON.parse` 所有正文 | 并行修改中的 diff 把 `checkpoints: all.slice(0, 8)` 改成 `checkpoints: all` | 列表改**元数据投影** `checkpointMeta()`：`{windowId,rev,updatedAt,cleared,chars,preview(≤120字),hasReference,reference身份}`，世界观桶额外给 `summary:{version,draftCount,titles}`；上限 `MAX_DRAFT_LIST=24` 并回 `total`/`truncated`；正文按 `window=<id>` 惰取（客户端 `fetchDraftSnapshot`/`snapshotOf`，返回结构对调用方保持不变）。**库层 `listCheckpoints` 故意不设限**——移动恢复靠它逐桶搬运，设限会静默漏桶；UI 在截断时明说，并注明导入不走该上限 |
| **V8** | P3 | `PUT/DELETE/PATCH` 绕过「仅 POST」的 `application/json` 门禁；`project-recovery` 在非 GET 方法下一律进**写**分支 | 路由只按 `route` 匹配、不看 method；content-type 门禁条件写死 `req.method === 'POST'` | 新增 `ROUTE_METHODS` 路由×方法白名单：未知 route → 404，白名单外方法 → 405；content-type 门禁改为「非 GET 一律要求 JSON」。理由写进 CONTRACT：`trustedRequest` 把缺失的 `sec-fetch-site` 视为可信（本地非浏览器进程可直连），方法白名单是仅剩的一层 |
| **V9** | P1 | 真实跑 200 次 `save-setting-candidate` 后第 201 次 `operations-full` 409，且 `confirm-setting` 同时被阻 ⇒ **该作品世界观功能永久停摆**；items 满 400 后 `memory-full`，撤回一条也不释放配额（items 从不 splice）；changes 满 800 后 `history-full`。op 白名单无任何 prune/trim/archive，UI 只显示「备忘暂不可用：operations-full」+ 永远失败的重试按钮 | 三个上限只**拒绝**不给**出口**；`memory.operations` 只 push 不裁；`changes` 在 schema2 分支直接抛错 | 新增三个维护 op：`archive-history` / `prune-operations` / `purge-retracted`，一律**先把被裁字节整体写进 `state/backups/` 再裁**；`purge` 只允许终态（`retracted`/`resolved`，其他 → `bad-statuses`），confirmed/proposed 绝不可被清走；被裁 operationId 进**有界墓碑环**，其迟到重试回 `operation-pruned`（绝不当新操作重复建条目）；维护路径**不走 `pushChange`**（否则历史满了就再也清不了）；`memory` GET/POST 均回 `quota`，`capabilities.maintenanceOps` 公开；UI 常驻显示用量 + 三个归档按钮 + 四个码的可读文案。附带：`commitMemory` 补 `fsync` 与孤儿 tmp 清理（原来比配置文件的 `atomicWrite` 还弱，掉电正是 `corrupt-memory` 的成因之一） |
| **G1** | P1 | 真 git 输出 ` M "bible/\344\270\226...md"`，面板 path 是八进制转义串、`diffUnstaged` 空、`hunksUnstaged=0`；`preload.js` 暂存按钮条件 `f.untracked \|\| f.diffUnstaged` 两者皆假 ⇒ **按钮根本不出现**。本项目默认库根是中文路径、写作模式投影生成的正是 `bible/世界观整理.md` | `lib/git-review.js` `parseStatus` 只 `replace(/^"\|"$/g,'')` 脱引号，未做八进制解码（`core.quotepath` 默认 true） | 所有 git 调用统一带 `-c core.quotepath=false`；`status` 改用 `--porcelain=v1 -z`（NUL 分隔，字段内不转义）；保留非 `-z` 兼容分支并实现**按 UTF-8 字节**的 C 风格反转义 `unquoteGitPath`（逐转义 `String.fromCharCode` 会得到 `ä¸\x96` 这种拉丁碎片——回归测试钉死） |
| **G2** | P1 | 对中文未跟踪文件点「删除」→ `revertFile` 返回 `ok:true`、UI 报「已删除」，**文件原封不动**（ASCII 对照组真删）。破坏性按钮给成功回执，之后 `git clean -fd`/提交会把它带上 | G1 的转义路径 + `fs.rmSync(target,{force:true})` 吞掉 ENOENT | 删除前先 `lstatSync` 确认存在且非目录（目录给人话错误）、`force:false`、删完复核已消失；任一步不满足返回 `ok:false` |
| **G3** | P3 | 重命名靠在路径里找 `' -> '` 切分而非 porcelain 的 R/C 状态位；文件名本身含 `' -> '` 时被切成不存在的目标（Windows 禁 `>` 故本机不可达，**macOS dmg 已发布且共用同一份 lib**） | `parseStatus` 不看 XY | `-z` 下重命名由 XY 状态位 + 紧随的第二个 NUL 字段识别，并回 `origPath`；兼容分支也改为**先看 XY 再决定是否切分**（非重命名行的 `' -> '` 原样保留） |
| **G4** | P2 | 新建目录折叠成一行 `dir/`，目录内所有新文件在面板里不可见；对它点「删除」必然 `EISDIR` 失败，而「全部丢弃」走 `git clean -fd` 却能删 ⇒ 单个删不掉、全删能删。写作模式 `create-project` 一次生成整个项目目录，正落在盲区 | `changes()` 用 `git status --porcelain=v1` 缺 `--untracked-files=all` | 加 `-z --untracked-files=all`；配合 G2 的目录判定给出明确文案 |

> **V5 的设计取舍（请评审）** —— 为何不一刀切硬禁到底：真搬迁但从未用过备忘/可读稿/带引用的作品就是没证据，
> 硬禁会把作者逼到「只能把目录改回原名」；而本操作是**非破坏性**的（只往新桶复制、旧桶永不删改、重试不覆盖已恢复的编辑），
> 所以知情同意 + 审计留痕是相称的。token 已把 `relation` 编进去，有证据候选的 token 无法用来走覆盖路径。
> 副作用：按钮标签保持 `导入旧位置草稿` 不变，因此并行修改方的 D04 fixture **一行未改**即通过。
> 若评审倾向硬禁，去掉覆盖分支即可（约 5 行）。

## 二、验收

```
npm run test:writing-hardening   →  HARDENING_OK 66 passed, 0 failed
npm run git-review-test          →  GIT_REVIEW_OK（55 项，含新增 G1–G4 共 14 项）
node docs/audits/writing-hardening/2026-09-21/hunt-writing.mjs  →  复现 0 / 9
node docs/audits/writing-hardening/2026-09-21/hunt-git.mjs      →  复现 0 / 4
```

V1 的对照取证（同一探针内跑两遍，一遍生产实现、一遍逐字复制的旧实现）：

```
请求体字节数=276029 发送码点数=92000
【生产实现】收到码点数=92000 U+FFFD=0 与原文全等=true
【旧实现对照】收到码点数=92003 U+FFFD=5 与原文全等=false
```

Node 层门禁 17 步全部 exit 0：`verify:writing-build`、`verify:writing-architecture`（R1–R8 + R7 自检 5/5）、
`verify:writing` 16/16、`verify:writing-adapter`（coordination 18 + adapter 15）、`verify:writing-memory-ui` 7、
`verify:writing-context` 4、`plugin-sync-test` 10、`test:writing-f` 10、`test:writing-cde` 25、`test:writing-p1` 7、
`test:writing-world`（p1 32 + context 12 + p3 23 + hunt 21 + repair 10 + draft-reliability 6）、
`test:writing-hardening` 66、`git-review-test` 55、`selector-check`、`atomic-file-test` 14、`profile-inspect-test` 7、`pid-cleanup-test` 3。

Electron 层（真实内核 + 隔离 userData，全部 exit 0）：

| 套件 | 结果 |
|---|---|
| `verify:writing-ui` | `WRITING_UI_OK`（文件切换不串稿 / 升版本与历史只读 / 退出重进 / 冲突保全外部稿） |
| `verify:writing-chat` | `WRITING_CHAT_OK`（失败保留输入与引用 / 不擦除等待期新输入 / 流式与工具折叠 / 中文输入法不误发 / 备忘带入与撤回） |
| `verify:writing-reading` | `WRITING_READING_OK`（markdown-and-streaming / candidate-uses-original-markdown / narrow-column-and-long-history 均 PASS） |
| `verify:writing-world-ui` | `WORLD_UI_OK` + 并行修改方 `repair-ui.cjs` 的 `AUDIT_UI_COMPLETE`：**D01/D02/D03/D04 四项 PASS**（连跑两次均 exit 0） |
| `verify:ui-smoke` | PASS（主题开启 × 恢复两次均 `UI_SMOKE_OK`，内置插件种子 3/3） |
| `verify:writing-native` | `WRITING_NATIVE_OK`（独立输入区在侧栏内 / 未产生模型回合 / 无控制台错误） |

三个必须如实披露的过程事故（详见当日日志「坑 / 备注」）：

1. 我在一条诊断命令里误带了真实的 `git stash push -- plugin/writing-mode`，把并行修改方未提交的 D01–D04 改动
   连同我的一起暂存了约 15 秒；随即 `git stash pop` 干净恢复（stash 列表已空），事后重跑
   draft-reliability / hunt-host / world-settings-p3 / coordination 全绿，**无内容丢失**。
2. 我用 20 分钟前的旧读取结果整文件覆盖了 `src/client/services/world-drafts.js`，抹掉了并行修改方 19:03 新加的
   「每项目复用 journal 实例 + `listen()`」；已按其原样合并回来，V7 只叠加 `snapshotOf`/元数据列表/预取。
3. 跑 `repair-ui.cjs` 会覆写它自己的证据文件：`repair-ui-results.json` / `repair-ui.png` 现在是我这轮的产物
   （结论不变，仍 D01–D04 四项 PASS，但时间戳与截图已非其 19:07 那一份）。

> 更正一条历史记录：WORKLOG/CHANGELOG 里写的 `world-settings-p1 34/34` 与当前测试文件不符——该文件自身只有 **32** 条 `ok()`，
> 本轮 32 passed / 0 failed，无静默丢项（测试文件本轮未被修改）。

## 三、残留局限（不冒充已解决）

1. **V4 的等待仍是同步的**。锁 API 是同步的（调用方全是同步函数，改异步会波及上百条既有断言），所以等待期间事件循环仍被占住，探针里 `setInterval` 计数仍为 0。改善的是**时长**（8038ms → 275ms）与**可恢复性**（启动清扫 + `maintenance` 入口 + 诊断可见），不是彻底不阻塞。彻底解法要把 draft/memory/coordination 的写路径改成异步，属于独立重构。
2. **`quarantineStaleLock` 仍是 check-then-rename**，不是 CAS。已把窗口收敛到微秒级（改名前复核 owner 未变、未复活、仍存在），且只从锁外的启动清扫与显式维护入口调用（不在获取路径上抢占）；极端重叠下写入侧还有 revision/etag 与 `draft-rev-conflict` 兜底，降级成 409 而非静默覆写。
3. **V6 的 realpath 不进分桶函数**是刻意取舍：进了会让既有用户的桶名随一次 realpath 结果变化整体失联。代价是「客户端拿到的路径串」必须已经是规范路径——这由路由层 `draftBucket()` 保证；若将来有新的调用方直接把用户输入传进 `writeCheckpoint`，同样的分歧会重现。
4. **V9 的墓碑环有界（200）**。超出环的极老 operationId 迟到重试会被当新操作；这是配额与幂等之间的取舍，环大小与 `MAX_OPERATIONS` 同阶。
5. **G3 的 `*nix` 场景只在兼容分支取证**（Windows 文件名禁 `>`），未在 macOS 实机跑过。
6. **未做**：真包（NSIS/dir）重建与字节核对、隔离冷启动、macOS 实机、受控离线、真实模型场景。这些属于并行修改方交接文档里的「下一步统一验收」，本轮不以 Node/Electron 门禁通过代替。

## 四、对并行修改方交接清单的逐条回应

Codex 在 `docs/audits/writing-world-settings/2026-09-21/repair-handoff-codex.md` §并行编辑交界 提出 6 条待核实边界：

| 交接项 | 处理 |
|---|---|
| 身份规范化改变桶键时，既有尾分隔符桶的兼容读取与迁移 | 已做：`readCheckpoint` 对旧口径桶**只读回退**（标 `legacyBucket`），写入落新桶、`baseRev` 从旧桶 rev 接着算 ⇒ 下次保存自然迁移；不带尾分隔符时新旧口径完全相同，`legacyDraftFile` 返回 null，零开销零行为变化。回归：hardening V6 组两条断言 |
| `quarantineStaleLock` 的 check 与 rename 之间是否可能移走替换后的活锁；是否用于自动清扫；是否与「不抢锁」契约一致 | 已加固：改名前复核 owner 未变/未复活/仍存在；只从**锁外**的启动清扫与 `maintenance` 显式动作调用，不在获取路径上抢占；活锁一律跳过。另移除 `forgetCoordination` 里的同名调用——那里是持锁执行，锁的持有者就是自己（alive），调用永远空转，属误导性死代码。残留局限见 §三.2 |
| 列表上限与移动恢复的交互：完整迁移不可无提示漏掉旧桶 | 已分离两层：路由列表限 `MAX_DRAFT_LIST` 并回 `total`/`truncated`，UI 在截断时明说；**库层 `listCheckpoints` 不设限**，`recoverRelocation` 走库层 ⇒ 迁移不漏桶。回归：hardening V7 组「库层 listCheckpoints 不设上限（移动恢复不漏桶）」 |
| 新模块必须进入 runtime manifest，并由依赖闭包与真包检查实际覆盖 | 已加：`runtime-manifest.json` 的 `files` 增加 `lib/project-identity.js`（`lib/project-recovery.js` 并行修改方已加）。`verify:writing-architecture` / `plugin-sync-test` exit 0；**真包字节核对未做**（见 §三.6） |
| 世界观 journal 的面板重挂载、写入队列、存储失败与晚到回包保持作者编辑 | **保留**并行修改方的「每项目复用 journal 实例 + `listen()`」实现（我一度用 20 分钟前的旧读取整文件覆盖掉它，已按其原样合并回来，见当日日志的事故记录）；我的 V7 改动只加 `snapshotOf`/元数据列表，未动队列、`pending()`、`beforeunload` 保护与 `revision` 复用逻辑。`verify:writing-world-ui`（含其 `repair-ui.cjs`）结果见当日日志 |
| 备忘面板同时打开时世界观编辑区被挤压、恢复提示裁切 | **未修**。这是右栏高度分配的可用性问题，属并行修改方 D01 的界面范围，且需要真实窗口目检；本轮不碰 `writing-css.js`，留给统一收尾 |

## 五、本轮改动文件

生产代码：`plugin/writing-mode/index.js`、`lib/{store,project-memory,draft-checkpoints,coordination,file-lock,project-recovery}.js`、
**新增** `lib/project-identity.js`、`lib/git-review.js`、`src/client/features/{memory,world-settings}/index.js`、
`src/client/state/companion-drafts.js`、`src/client/services/world-drafts.js`、`plugin/writing-mode/client.js`（重建产物）、
`plugin/writing-mode/runtime-manifest.json`、`plugin/writing-mode/CONTRACT.md`。

测试与门禁：`plugin/writing-mode/test/hardening-v1-v9.mjs`（新增 66 项）、`lib/git-review.test.js`（+14 项）、
`package.json`（新增 `test:writing-hardening`，接入 `verify:writing-all` / `verify:writing-quick`；**保留**并行修改方对 `test:writing-world` 与 `verify:writing-world-ui` 的改动）。

证据：本目录 `hunt-writing.mjs` / `hunt-git.mjs`。

— 署名：ox-alpha
