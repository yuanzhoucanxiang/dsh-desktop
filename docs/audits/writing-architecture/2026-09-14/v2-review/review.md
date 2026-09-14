# 写作模式 v2 独立复核：退回修改

日期：2026-09-14。被审 HEAD：`95b138d427f445e933e69811f8a775ce968ffe28`，分支 `feat/writing-mode-architecture`。开工工作树干净；对照 `docs/plans/writing-mode-next-execution-v2.md` 和本次 `v2/` 交回材料。

**结论：已有实质进展，旧的 32 条正向时序仍通过；不能验收为“P1–P4 全部完成”。新打包程序启动失败，并复现了发送拒绝后清空草稿、采用候选丢失原稿等问题。先修 B01–B08，再补完整工程验收。**

本轮只新增审查材料和日志，没有修改生产代码、合并、提交、推送、发版或替换正式安装。临时打包程序和隐藏测试窗口均为本轮独立子进程；原可见预览 PID 90764 保持运行。

## 1. 独立验证结果

| 验证 | 本轮结果 | 证明范围 |
| --- | --- | --- |
| `verify:writing-architecture` | PASS，含 R7 自检 5 项 | 当前静态规则通过；不证明 app 已完成职责拆分 |
| `verify:writing-build` | PASS | 已提交 client.js 与构建结果一致，检查不覆盖产物 |
| `verify:writing-adapter` | 17 + 13 PASS | 原协调/adapter fixture 通过；未覆盖本次新增负向场景 |
| `test:writing-p3` | 17 PASS | host/纯函数已有断言通过 |
| `plugin-sync-test` | 10 PASS | 原正常复制/清理测试通过 |
| `test:writing-cde` / `test:writing-p1` | 25 / 7 PASS | 既有存储、上下文、编辑控制器回归 |
| `verify:writing` | 16 PASS | 真实 HTTP host 回归 |
| `verify:writing-ui` / `-chat` / `-native` | 三套 exit 0 | 原编辑 UI、聊天流程及真实内核无模型接入 |
| review9 正向 UI 基线 | **32/32 PASS** | `baseline-ui-results.json`；仅重定位测试入口/结果和更新 SHA，保留原断言 |
| 新增 Node 探针 | **7 条 FAIL** | `probes-results.json`，实际生产模块 + 临时文件；包含下列多个问题分支 |
| 新增 React/HTTP 探针 | **4 条 FAIL** | `ui-results.json`，实际 client.js + React + host，原生会话传输为可控 fixture |
| 本次真实 unpacked 构建 | 构建 exit 0；**启动 FAIL** | actual exe / actual app.asar；启动报缺模块，见 `package-results.json` |
| 该新包插件资源比对 | 15 文件 PASS | 同一个不能启动的包仍能通过 `verify-writing-package --package`，暴露门禁漏检 |

没有重跑完整 `verify:writing-all`；上述入口分别执行，未把未执行项计入通过。本轮未执行 NSIS 安装、macOS、离线限制、双真实窗口并发、真实模型三场景和主题 ui-smoke。review9 最后一条仍沿用旧“备忘失败后发送但保留提示”的预期；它通过不抵销 v2 §4.2 的新要求，见 B04。

## 2. 必须修复的问题

### B01 · P1：新包主进程缺依赖，启动即失败

位置：`main.js:39`、`package.json:66`。

`main.js` 新增 `require('./lib/plugin-sync')`，但 electron-builder 的 `build.files` 未包含 `lib/plugin-sync.js`。本轮用当前配置实际构建到 TEMP：app.asar 含 main.js、不含该模块；运行其中的 `DeepSeek Harness Desktop.exe --smoke`，得到：

```text
Error: Cannot find module './lib/plugin-sync'
Require stack:
- .../win-unpacked/resources/app.asar/main.js
```

启动前通过该测试进程自己的 inspector 安装异常捕获，避免弹出操作系统错误对话框；捕获后测试进程主动 exit 41。未替换模块、未改打包内容，未模拟这次 require 失败。

修复要求：把外壳运行依赖纳入发布集合；门禁同时验证 app.asar 主进程依赖和插件 extraResources。用最终代码重新打包并执行真实包冷启动。不能用 dev smoke 或仅 15 个插件文件一致代替。该缺陷影响发布后的整个桌面启动，是本轮最先处理项。

### B02 · P1：旧消息被当成本轮受理证据，明确拒绝后仍清稿

位置：`projection.js:69–85`、`adapter.js:416–419`、`features/companion/index.js:295–337`，均在 `plugin/writing-mode/src/client/` 下。

`turnEvidence` 扫描整个历史/队列，以正文前 80 字的包含关系判定已受理，没有发送前基线或本轮标识。preparedTurn 把备忘放在正文前面；两轮问题完全不同，只要备忘前缀相同，旧 user 节点就会命中。adapter 还在处理明确 `ok:false` 之前采用这份“证据”。

复现：历史只有一个旧问题；本轮输入全新问题，原生返回 `busy/ok:false`，没有添加任何节点。adapter 返回 `accepted/user-node`。真实 React/HTTP 探针进一步确认输入框和磁盘 checkpoint 都被清空。不是只有 UI 文案错误。

修复要求：核对发送前后的新回合/队列标识及目的会话；仅完整文本匹配仍不足以区分作者重复发同一句。不能把既有历史当当前请求证据。新增“相同备忘不同正文”“相同正文再次发送”“旧队列项”“发送前拒绝”“受理后丢回包”测试；明确拒绝/不可确认时保留正文与引用。

### B03 · P1：恢复关联缺身份，并可能另建会话

位置：`adapters/harness/adapter.js:144`、`:198–219`、`:453–462`；`plugin/writing-mode/lib/coordination.js` 的 forget 路径。

创建分支直接返回 `createNow` 的结果，而它没有带回 `key/path/binding`。随后 makeHandle 解构这些字段，新建返回的 handle 丢失项目身份；首次创建部分成功后，恢复也无法可靠定位原项目。旧测试只检查 sessionId，没有断言新 handle 身份。

另一个独立问题：`recover()` 对 missing/uncertain/waiting 都先 forget 再 connect。对于**已知会话仍存在、只是确认失败**的 uncertain，重进后的“继续关联”没有核对原会话，反而清记录另建。真实 host 协调模块 + 内核 fixture 实测 `s1 → s2`，两个会话都仍存在，创建数由 1 变 2。

修复要求：所有返回分支完整携带 canonical identity。恢复先查已知 ID/原生关联并补确认；等待中的活操作不可被“继续关联”清掉。forget 必须受互斥和记录版本/token 条件保护，且不要把“继续原关联”实现成“放弃并新建”。补现有会话、部分成功、确认回包丢失和另一个窗口仍创建时的恢复测试。

### B04 · P1：备忘读取失败没有等待作者选择

位置：`features/companion/index.js:277–294`。

读取失败后只 setError，随即 `target.send(prepared)`。UI 说“正文已保留，可以重试或不参考发送”，实际已经发送；受理成功又清掉正文。新 UI 探针：memory GET 503 → 原生 prompt 调用 1 次 → 输入为空，仍显示“正文已保留”。

这沿用了旧回归的允许降级发送行为，但 v2 §4.2 明确改为作者在“重试/不参考发送”之间选择，实施并未完成新契约。它只应影响真实读取异常，不增加正常聊天审批。

修复要求：开启参考时，读取失败不得继续发出请求；保留输入，提供真正可执行的重试和不参考发送。作者已经关闭参考时不应依赖备忘读取成功。更新旧测试的预期，同时保留“草稿保存成功不能误清独立业务错误”的原不变量。

### B05 · P1：profile 同步未限制真实路径，能改写/删除目录外文件

位置：`lib/plugin-sync.js:85–90`、`:149–168`、`:174–188`。

两条 TEMP 复现：

1. 目标 profile 的 `lib/` 是指向插件目录外的 junction；使用 manifest 发布集合同步 `lib/owned.js`，外部文件从 `USER DATA` 被改成 `NEW PLUGIN`，结果仍 `ok:true`。
2. 旧 `.dsh-managed.json` 含 `../outside-note.txt` 和该文件 hash；清理把目录外文件删除，仍 `ok:true`。该场景需要被改写/异常的受管记录，不声称它是远程攻击入口。

修复要求：先校验清单及旧记录结构、相对路径、归属；所有复制/清理/写记录操作核对源和目标 realpath，拒绝越界 reparse point/绝对路径/`..`。记录可写在用户 home 里，不能直接作为任意删除依据。另有错误处理缺口：`result.removedFailed` 未初始化，删除报错分支会再次 TypeError；修同步错误分支时一并覆盖。

### B06 · P1：采用恢复候选未留原稿副本，还会混用旧引用

位置：`features/companion/index.js:455–469`。

“采用这一份”调用 updateDraft 后直接写当前 checkpoint；所谓“原来的草稿仍在其他窗口候选里”只有文案和注释，没有保存副本的实现。真实 UI 探针先把独有原稿保存到当前窗口，再采用另一个窗口候选：落盘后两个窗口桶都只剩候选文本，原稿不在任何 checkpoint 中。

候选 `reference:null` 时，`if (c.reference)` 又跳过引用更新，当前窗口的旧引用被保留并与新文本一起保存。作者下一轮实际可能带入不属于该候选的稿件。

修复要求：采用前先保存可恢复的完整原快照，成功后原子应用新 text/reference，包括显式 null；持久化失败保留原稿和可见错误。UI 显示的恢复入口必须能真正找回原稿。补采用后刷新、再恢复原稿、空引用候选、保存失败四个场景。

### B07 · P2：验收门禁和矩阵不能支持“P4 完成”

位置：`scripts/verify-writing-coldstart.mjs:42`、`:127–160`，`package.json:44`，交回 `v2/acceptance.md`。

- 标题“30 项”的主表实际 **27 项**，漏 A01/A02/A03；三处 `PASS(V2 口径)` 不在约定的四种状态内，且掩盖项目移动、完整压缩续聊、双窗口等未测部分。
- coldstart 执行 `npm run smoke`，运行仓库 Electron 开发态，没有选择实际包的入口。本轮 B01 正是 dev 不会暴露而新包无法启动的问题。
- upgrade 声明了 `fixture.checkpoint` 但没有将它写入草稿目录，也没有通过 UI/API 读取恢复；配置里的库根为 `C:/tmp/作品`，实际备忘 fixture 却在隔离 LOCALAPPDATA 下另一目录，没有验证作者能从库里打开该作品。因此“字节没变”不能证明旧数据可被发现和使用。
- 坏 JSON fixture 没有注册/打开成作品、也未调用备忘读取 API；仅启动后字节不变不能证明诊断/安全恢复。`node --check` 只检查语法，不能证明 import 链无悬空依赖。
- `verify:writing-all` 没正式纳入 review9 32 条；本轮另外执行才获得 32/32。旧主题 ui-smoke 明明是 v2 必做项，却在交回中写“本批次范围外”。

修复要求：保留原 30 个 ID，分别写实际方法、SHA、证据和限制；一个 ID 含未覆盖子场景则 PARTIAL。建立明确的工程交付门禁，缺包参数/关键工程项 NOT_RUN 不得计作全过。升级 fixture 使用真实路径和旧 schema，验证作者能打开/恢复/继续保存，保留异常原件；补完主题等既定工程项。真实模型/macOS 外部条件可继续如实待测。

### B08 · P2：引用身份在持久化和旧格式比较中丢失

位置：`plugin/writing-mode/lib/draft-checkpoints.js:70–80`；`src/shared/reference.js:46–55`。

P3 的 `makeReference` 为未保存引用生成 snapshotFingerprint，但 checkpoint 写入白名单遗漏该字段。实际 round-trip 后指纹消失，同源同 revision 的引用被 referenceStatus 判为 `current`，失去“取自未保存快照”的状态。

同一身份比较又把缺字段统一转成空串，两个不同旧格式 `{label,text}` 引用会返回 sameReference=true，与函数注释“字段缺失按不同处理”矛盾。发送完成后的引用清理使用它，不能证明清的是发送时那一份。

修复要求：新引用完整身份字段贯穿 write/read/list/adopt/preparedTurn；旧引用缺身份时保守比较完整快照，不伪造来源。草稿 store 的成功判据也仍为 `text + '|' + reference.text`（`:211/:239`），应改成完整快照/代数，避免不同来源的同文引用被旧请求提前确认。

## 3. 架构与上下文仍开放的完成项

**C01 · 模块拆分仍不完整。** `entry.js` 已缩到 165 行、构建已使用 esbuild，这是实际进展。但 `WritingModeApp.js` 仍 1563 行，包含新建项目/文稿、库切换、文字工具执行、编辑保存定时和多块界面；editor 目录只有 diff、tools 只有 prompts/selection，不能把“目录有文件”当作完成组件提取。UI 仍通过 harnessSessions 读取原生列表/刷新，并非全部消费 adapter。按 v2 §2.2 提取实际组件/控制器，app 留编排；避免为追行数再换文件名。

**C02 · 上下文控制仍有契约偏差。** `selectMemory` 用 JS `.length` 算 UTF-16 代码单元，非约定 Unicode 字符数；3500 个 emoji 被按 7000 计并整条省略，已加负向探针。当前逐条复选框只表示固定优先，取消勾选仍可能自动注入；面板没有实际预算选择/省略列表，不能帮助作者准确核对本轮。应明确“选择参考”与“优先固定”的含义，支持排除单条，并用同一选择函数显示实际采用/省略及来源。这个改动不要添加固定写作步骤或限制自由交流。

## 4. 返工顺序与复审条件

1. **先保启动和数据：B01/B02/B05/B06。** 小提交逐项修，保留每条负向场景并改为正向通过；不先扩模型功能。
2. **修身份和作者选择：B03/B04/B08。** 测完整恢复生命周期和实际请求/磁盘结果。不要用手写状态机替身测状态机自身。
3. **完成 C01/C02，修 B07 的正式门禁。** 旧 32 条中与 v2 已明确变更的业务预期更新，但原数据保护断言不能删。
4. **最终 HEAD 重新出 TEMP 包并验收。** 真实包空 profile 自动同步、离线加载、旧环境可读可恢复；主题开启/恢复；双真实窗口；NSIS 至少构建，若无法隔离安装则明确 NOT_RUN。补齐 30 项，每项有证据。
5. **最后交回可见隔离预览与文档。** 预览保留给用户关闭；先前 PID 可读验证不等于最终新代码已运行。最终源码/包/profile hash、实际进程和测试 SHA 必须对应。没有模型测试配置继续标 NOT_RUN，不伪称陪伴效果已验收。

这是一轮有边界的复核，不是所有模块的穷尽审计。当前已证实的故障足以退回；修完后仍需复跑完整工程门禁，不能把本报告的问题数量当作剩余缺陷总数。

## 5. 复现入口与证据

在仓库运行（只操作临时 fixture/测试实例）：

```powershell
node docs/audits/writing-architecture/2026-09-14/v2-review/probes.mjs
.\node_modules\.bin\electron.cmd docs/audits/writing-architecture/2026-09-14/v2-review/ui-probes.cjs
.\node_modules\.bin\electron.cmd docs/audits/writing-architecture/2026-09-14/v2-review/baseline-ui.cjs
```

前两项 exit 1 表示实际不变量未满足；修复后必须满足原意，不能改成断言故障存在。基线入口 exit 0。证据分别为同目录 `probes-results.json` / `ui-results.json` / `baseline-ui-results.json`。

打包使用 electron-builder API，配置继承 package.json，只把 output 改为唯一 TEMP 目录并关闭签名/资源编辑（无发布）：

```javascript
const b = require('electron-builder')
b.build({
  targets: b.Platform.WINDOWS.createTarget(['dir'], b.Arch.x64),
  publish: 'never',
  config: {
    directories: { output: process.env.WM_REVIEW_OUTPUT },
    win: { signAndEditExecutable: false }
  }
})
```

本次目录见 `package-results.json`。`package-probe.cjs` 读取 `%TEMP%/wm-v2-review-package-path.txt` 中的该目录，运行其中真实 exe，四套路径全部隔离；需先构建新包并更新该指针才能复测修复。此脚本不会访问/关闭用户现有进程。包 hash、启动日志、异常、PID 均已归档；本轮没有制作/安装 NSIS。

— 审查：Codex / GPT-6
