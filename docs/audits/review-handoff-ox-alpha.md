# 独立审阅任务：dsh-desktop 三轮加固（V/G、S、U）+ 一次自引入回归

> 交接文档 · 作者 `ox-alpha` · 2026-09-21
> 惯例参照 `docs/audits/writing-world-settings/2026-09-21/repair-handoff-codex.md`（Codex 交给我的那份）。
> 本文档里的"基线"全部是作者交出去之前**实跑得到**的输出，审阅方可直接比对。

你是**独立审阅者**。另一位 agent（署名 `ox-alpha`）在本仓库工作树里完成了三轮缺陷修复，全部**未提交**。
你的任务不是接着写代码，而是**推翻它**：验证每项修复是否真的成立、是否引入新问题、
以及它自己标注的判断取舍是否站得住。

以怀疑为默认姿态。作者已经自己抓到过一次回归（§2.4），也自查发现过一次"验收结论已过期"（§5.0），
说明它的改动确实会打破东西、它的结论确实会失效。

---

## 0. 仓库与当前状态（已核对的事实）

- 仓库：`e:\Deepseek harness\dsh-desktop`（Electron 桌面外壳，原则**内核零修改**）
- `git rev-parse --short HEAD` = `6783647`，工作树 **dirty**；version = `0.1.41`
- 工作树：**30 files changed / +2748 −800**，另有 13 个未跟踪新增；`git stash list` 为空
- 最近一次真包（dir 目标）的 asar 哈希 = **`d74ca818…`**；若你重建后哈希不同，说明你审的不是同一份源码
- **工作树混着两位作者的未提交改动**：`ox-alpha`（本次审阅对象）与 `Codex`（D01–D04 世界观数据可靠性：
  窗口草稿、候选标记、坏 checkpoint、目录移动关联）。Codex 的交接文档在
  `docs/audits/writing-world-settings/2026-09-21/repair-handoff-codex.md`，审查报告在同目录 `review.md`。
  **不要把它的文件当成 ox-alpha 的改动来审，也不要"清理"它们。**
- 三份审查报告（作者自述；请重点读每份的**「残留局限」**与**「查过判定干净的」**两节）：
  - `docs/audits/writing-hardening/2026-09-21/report.md`（V1–V9 / G1–G4）
  - `docs/audits/shell-hardening/2026-09-21/report.md`（S1–S6）
  - `docs/audits/release-chain-hardening/2026-09-21/report.md`（U1–U5 + W23 回归）

---

## 1. 基线：先跑这些，确认作者没有虚报

下面是**作者自查时实跑得到的输出**，作为你的比对基线。任何一项对不上，先停下来查环境而不是查代码。

```powershell
# 在 dsh-desktop 目录下。PowerShell 5.1：语句分隔用 ; 不能用 &&
npm run test:writing-hardening     # 基线：HARDENING_OK 77 passed, 0 failed
npm run git-review-test            # 基线：GIT_REVIEW_OK（该脚本不打印条数）
npm run shell-hardening-test       # 基线：SHELL_HARDENING_OK（同上）
npm run plugin-manager-test        # 基线：19 tests passed
npm run verify:release-artifacts -- --allow-stale   # 基线：RELEASE_ARTIFACTS_OK，exit 0
npm run verify:release-artifacts                    # 基线：exit 1，如实报 dist/latest.yml 落后 4 个版本
```

四个复现探针（**修复后应全部 NOT_REPRODUCED，且 PROBE_ERROR 必须为 0**）：

```powershell
node docs/audits/writing-hardening/2026-09-21/hunt-writing.mjs        # 基线：0/9 复现
node docs/audits/writing-hardening/2026-09-21/hunt-git.mjs            # 基线：0/4 复现
node docs/audits/shell-hardening/2026-09-21/hunt-shell.mjs            # 基线：0/6 复现
node docs/audits/release-chain-hardening/2026-09-21/hunt-release.mjs  # 基线：0/4 复现（只读，不改 dist）
```

Node 门禁全量（基线：**19 步，非零 0 步**）：

```powershell
$steps = @("shell-hardening-test","plugin-manager-test","git-review-test","atomic-file-test",
"profile-inspect-test","pid-cleanup-test","plugin-sync-test","selector-check","verify:writing-build",
"verify:writing-architecture","verify:writing","verify:writing-adapter","verify:writing-memory-ui",
"verify:writing-context","test:writing-f","test:writing-cde","test:writing-p1","test:writing-world",
"test:writing-hardening")
$bad=@(); foreach ($s in $steps) { $null = npm run $s 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { $bad += $s } }
"非零 {0} 步：{1}" -f $bad.Count, ($bad -join ',')
```

Electron 层（基线：**6 项全 exit 0**；会拉真内核，耗时数分钟）：

```powershell
foreach ($s in @("verify:writing-ui","verify:writing-chat","verify:writing-reading",
"verify:writing-native","verify:writing-world-ui","verify:ui-smoke")) {
  $null = npm run $s 2>&1 | Out-String; "{0,-26} exit={1}" -f $s, $LASTEXITCODE }
# 另：review-ui-check / sidebar-skin-check / splash-check 三项基线也均为 exit 0
```

W23 稳定性（基线：**连跑 5 次 5/5 exit 0**；这是间歇性缺陷，跑一次不算数）：

```powershell
for ($i=1; $i -le 5; $i++) { $null = npm run test:writing-world 2>&1 | Out-String; "run {0}: exit={1}" -f $i, $LASTEXITCODE }
```

⚠️ **探针 exit 0 只代表"跑完了"，不代表"没问题"** —— 必须读它打印的 `REPRODUCED` / `NOT_REPRODUCED` 行。

⚠️ **IDE 的行内诊断可能是过期的**（会按旧行号报错）。判断语法一律用 `node --check <file>` 逐文件验。

---

## 2. 要审的四组改动

### 2.1 V1–V9：`plugin/writing-mode`（host + client）

核心文件：`index.js`、`lib/{store,project-memory,draft-checkpoints,coordination,file-lock,project-identity}.js`、`src/client/**`。

其中 P0 一项值得单独看：**大体积中文正文保存时因逐 chunk UTF-8 解码而静默产生 U+FFFD 乱码**
（`data += String(chunk)` → `Buffer.concat(chunks).toString('utf8')`）。这个缺陷**已在 v0.1.36–v0.1.41 发布版里**。
请独立确认：修复是否覆盖所有读 body 的路径，以及 1 MiB 上限触发 `req.destroy()` 后路由会不会挂住。

> **client 是打包产物**：`plugin/writing-mode/client.js` 由 `scripts/build-writing-client.mjs`
> 从 `src/client/**` 生成。改了 src 必须先跑 **`npm run build:writing`** 重建，再用
> `npm run verify:writing-build` 校验新鲜度——注意 **verify 不会覆写**，它只会报
> `FAIL client.js is stale vs src` 并非零退出（作者自己就在这里扑空了一次）。
> **不要直接改 client.js**。
> 新增 host 侧 lib 文件必须登记进 `runtime-manifest.json`（作者为 `lib/project-identity.js` 登记过）。

### 2.2 G1–G4：`lib/git-review.js`

八进制转义路径（`core.quotepath`）、`-z` NUL 分隔、未跟踪文件 revert、重命名判定。
**作者在这里第一版就写错了**：git 的八进制转义是 UTF-8 **字节**不是码点，
逐转义 `String.fromCharCode(parseInt(esc,8))` 会把 `bible/世.md` 解成 `bible/ä¸.md`，被自己的测试抓到才改对。
请重点复核 `unquoteGitPath` 与 `parseStatus` 的兼容分支（含 NUL 与不含 NUL 两条路径）。

### 2.3 S1–S6：外壳本体

`main.js`、`preload.js`、`renderer/settings.js`、`lib/{shell-quote,ndjson-tail,plugin-manager}.js`、`plugin/review-bridge.js`。

最严重一项（P1）：`dshShell` 桥无条件暴露给所有窗口，而 `shell:notify-command` 原先零确认、
零发送方校验就能让主进程 `spawn(任意命令串, {shell:true})` 并每回合重放 —— 内核页面里的第三方插件
client JS 由此穿透 sandbox 拿到本机命令执行。修复用 `isSettingsSender(event)` + `dialog.showMessageBox`。

装机版实机验证探针（可重复跑；基线 `IPC_AUTHZ_OK 0 项失败`）：

```powershell
node docs/audits/shell-hardening/2026-09-21/verify-ipc-authz.mjs --exe "<解包目录>/DeepSeek Harness Desktop.exe"
```

它带**两条前置断言防假通过**（先证明桥在页面上可用、同窗口 `status()` 正常，才把"被拒"归因于授权闸）。
**如果你能构造出"前置通过但授权闸其实没生效"的情形，那是重大发现。**

### 2.4 W23：作者自己引入、又被门禁抓到的回归（**最该审的一项**）

`plugin/writing-mode/lib/file-lock.js` + `lib/{draft-checkpoints,coordination}.js`。

上一轮 V4 把"陈旧锁快速失败"从等满 8s 收到 250–400ms，却沿用 `!isOwnerAlive(owner)` 判死，
把三种状态压成一种：① 锁刚被释放（应立即重试获取）② 对方已 `openSync('wx')` 未 `writeSync` 的空文件
（是活锁）③ 令牌可解析且 PID 已消失（才是陈旧锁）。结果 `world-settings-p3.mjs` 的 W23
间歇性报 `lock-stale`（连跑 3 次 1 红 2 绿）。修复引入 `ownerIsProvablyDead()`，
并让 `quarantineStaleLock()` 与两处启动清扫**只认 `dead`**。

**请特别挑战这个语义选择**：现在"持有者读不出来"一律按活锁预算等满 deadline（8s）。
那么一个内容是垃圾字节的锁文件，会让每次写入都白等 8 秒。这个取舍对吗？
有没有比"当活锁等"和"当死锁快速失败"都更好的第三选项？请给出判断和理由。

---

## 3. 作者自己最没底、请你优先推翻的判断

1. **V5 的设计取舍（最需要第二意见）**：目录移动后导入旧位置草稿，作者是
   "默认硬拒 + 作者显式知情覆盖（`confirmUnrelated` 严格 `=== true`）+ 关系记为
   `unrelated-author-confirmed` 写进历史桶"。保留覆盖通道的理由是：让 Codex 的 D04 fixture
   （造的是一个**无关**目录）继续通过、且按钮标签不变。
   **如果你认为应当硬禁到底，只需去掉约 5 行。** 请明确裁决，并说明你是否认为
   "为了让别人的 fixture 通过而放宽安全语义"这个理由成立。
   注意 `plugin/writing-mode/lib/project-recovery.js` 是 **Codex 新建、ox-alpha 为 V5 改写**的，
   同一文件叠加了两轮意图，最需要审。
2. **V7 的 `PREFETCH = 4`**：草稿列表改成只回元数据 + 惰性取正文后，Codex 的 `repair-ui.cjs`
   出现渲染竞态（三次运行结果不一致）。作者的修法是预取最近 4 份快照，让点击时 handler 能同步完成，
   从而**一行 fixture 都没改**就通过。请判断这是正当的预取优化，还是**用预取掩盖了一个真实竞态**。
3. **V4 的残留局限**：锁等待仍是**同步**的（`Atomics.wait`），改异步会波及上百条既有断言，
   所以只改善了时长（8038ms→275ms）与可恢复性。这个"不改"的决定你同意吗？
4. **S1 的收口范围**：`dshShell` 桥仍是"一份全量、所有窗口同权"，只按通道收紧了 notify-command 一族；
   `shell:get-state` 仍向所有窗口返回 `notifyCommand`（只读，外部主题面板可能消费，删字段有回归风险）。
   这个边界划得对不对？有没有别的通道同样该收？
5. **U3 只消除了一处硬编码**：`build.ps1` 改为从 `package.json build.publish` 派生，
   但另外四处仍各自硬编码，只是**加了检查**而没有统一来源。够不够？
6. **U1 未闭环**：`install-update.ps1` 的 sha512 校验依赖"安装包旁边有 `latest.yml`"；
   `-Download` 从 GitHub 拉下来的包落在 `%TEMP%`，那里没有清单，此时只提示
   "skipping hash verification" 而**不失败**。可接受吗？还是应同时下载 release 里的 `latest.yml`？
7. **卫生问题只警告不失败**：孤儿 blockmap、遗留 `win-unpacked.tmp`、20 个历史安装包共 3.9 GB 只 WARN。
   作者的理由是"当硬门禁会让 `npm run dist` 在无关的陈旧文件上挂掉"。你同意这个校准吗？

---

## 4. 硬性纪律（违反会伤到用户）

1. **禁止杀正在运行的 `DeepSeek Harness Desktop` / `electron` 进程** —— 用户可能正在用。
   清理只能按**你自己 spawn 出来的 PID**（用 `lib/pid-cleanup.js` 的 `killTree` / `pidAlive`），
   绝不按镜像名批量结束。`scripts/verify-writing-packaged.mjs` 是正面样板。
2. **不要提交、不要推送、不要发布、不要替换正式安装**，除非用户明确要求。
3. **⚠️ 隔离陷阱（作者踩过，你很可能也会踩）**：`DSH_DESKTOP_USER_DATA` **只隔离 userData**
   （单实例锁按它分桶），**不隔离 `DSH_HOME`**（`dshHome()` = `DSH_DESKTOP_HOME` → `DSH_HOME` → `~/.dsh`）。
   所以 `npm run smoke -- --user-data-dir=…` 是拿**用户真实的 `~/.dsh`** 启动的，
   外壳首启的 plugin-sync 会把工作树里的**在制插件同步进用户真实 profile**。
   任何要拉起外壳的命令，都必须**同时**设 `DSH_DESKTOP_HOME` + `DSH_HOME` + `DSH_DESKTOP_USER_DATA`。
   `scripts/verify-writing-native.cjs`、`verify-ui-smoke.mjs`、`verify-writing-ui.cjs`、
   `verify-writing-coldstart.mjs` 是隔离正确的样板，照抄它们。

   > **现状告知**：用户真实 profile 已经 carrying 在制代码（`.dsh-managed.json` 记
   > `syncedAt = 2026-09-21T12:44:24Z`，19 文件）。而且它目前**比工作树落后 3 个文件**——
   > 正是 W23 修的 `lib/{coordination,draft-checkpoints,file-lock}.js`，即里面还是**带间歇性
   > `lock-stale` 的中间态**。这是既成事实，**不要擅自回退或手动同步**（回退需用户明确同意）；
   > 下次启动 plugin-sync 会在内核加载插件之前自动换成当版。
   >
   > 你可以用 `node scripts/verify-writing-package.mjs` 观察这个漂移：它会把 profile 项记为
   > **"待跑"(NOT_RUN)** 而不是 FAIL —— 这是该脚本的**有意设计**（profile 是机器运行态、不是仓库属性），
   > 别把它当成失败或去"修"它。

4. **⚠️ 并发编辑纪律**：树里有 Codex 未提交的改动。共享文件**改前必重读**；
   优先定点替换，**绝不用整文件覆盖**（作者曾用 20 分钟前的旧读取覆盖掉 Codex 新加的逻辑）；
   **绝对不要运行 `git stash`**（作者误跑过一次 `git stash push --keep-index`，
   把 Codex 的改动一起卷走约 15 秒）；诊断命令里不要混入任何改状态的 git 子命令；
   日志/CHANGELOG 只**追加**，不改他人历史条目。
5. **构建产物必须落在工作区外（`%TEMP%`）** —— 工作区内新产物会被 ZCode 文件监视锁住 `app.asar`。
   用 `WM_OUT=<temp> node scripts/rebuild-package-tmp.mjs`（dir 目标、离线用本地 electron dist、不签名不发布）。
   **不要删 `dist/` 里任何东西**（3.9 GB 陈旧产物；删除是破坏性动作且需用户授权）。
6. **第三方调研快照只读**：`dsh-routing-suite*/`、`dsh-super-injector-main/`、`dsh-router-standard-main/`、
   `dsh-auto-mode/`、`dsh-better-sidebar-upstream/`、`readmes/`、`codex-docs/`、`downloads/`、`backups/`。
   （这些在工作区根 `e:\Deepseek harness\`，不在 dsh-desktop 内。）
7. **`.ps1` 必须 ASCII-only**：PS 5.1 把无 BOM 的 `.ps1` 当 ANSI/GBK 读，非 ASCII 字节能吞掉行尾弄坏解析器
   （`build.ps1` 头部记着真实事故）。现在有闸门检查，别绕过它。
8. **⚠️ 编辑工具陷阱（作者真的因此把 `build.ps1` 改坏过）**：往 `.ps1` 写 Windows 路径时，
   反斜杠转义序列会被工具吃掉——例如写成 `$proj` + 反斜杠 + `gen-update-manifest.js`，
   落地后变成 `$projgen-update-manifest.js`（反斜杠连同后面那个字母一起消失；
   危险的是 `\r` `\n` `\t` `\b` `\f` 这些合法转义，以及 `\g` `\s` `\d` 这些非法转义被直接丢弃）。
   对策：PowerShell 脚本里的路径一律用**正斜杠**（PS / node / .NET 在 Windows 上都接受）或 `Join-Path`；
   定点替换的锚点**避开含反斜杠的行**；改完必须用 PowerShell 解析器复核
   （`scripts/verify-release-artifacts.mjs` 已内置这项检查：ASCII 字节 + `Parser::ParseFile`）。
9. **PowerShell 的 `-Filter` 不支持 `[67]` 这类括号字符集** —— 会得到空结果，
   别据此断定"文件不存在"（作者因此差点误报 0.1.37 的安装包丢失）。要列举就用 node `readdirSync` 或 `-Include`。
10. **PowerShell 一行命令别嵌套太深**：作者在自查时写过一条多层 `$(...)` + `.Substring()` 的命令，
    结果 shell 卡在续行提示符 `>>` 上。宁可拆成小批次或写成脚本文件。
11. **日志约定**：改动记 `logs/2026-09-21.md`（做了什么 / 改了哪些文件 / 结果 / 坑，末尾署名），
    同步 `CHANGELOG.md` 的 `[Unreleased]`，只追加不改他人条目。用户可能对日志文件做过
    CRLF↔LF 行尾归一，**别整体重写这些文件**。

---

## 5. 已知未验收 / 已知状态（别误以为已经验过）

0. **⚠️ 验收结论会过期**：作者上一轮报过"真包字节核对 9/9"，但那之后又改了 `main.js` 与三个插件 lib，
   结论立刻失效；自查时重打重验（asar `a59c3550…` → `d74ca818…`）才重新成立。
   **你如果改了任何进入 asar 的文件，必须重建真包再验，不能引用作者的哈希。**
1. **NSIS 全流程从未跑过**：所有真包验收都是 **dir 目标**（不签名、不发布）。
   因此 `build.ps1` 新加的 `app-update.yml` 派生逻辑与步骤 5b 闸门**只在源码与 dir 包上验过**。
2. **两个原生确认框从未人工目检**（S1 保存钩子命令 / S2 恢复被隔离插件）。原生模态框，探针点不了。
3. macOS 实机（`build-macos.sh` / `update-macos.sh` / `prepare-runtime-macos.sh` **完全未纳入审查**）、
   受控离线、真实模型场景、NSIS 安装向导/注册表：全部未验收。
4. `dist/latest.yml` 陈旧（0.1.37 vs 0.1.41）**只是被闸门挡住了，没有被修好**。
   `dist/` 已 gitignore（git 跟踪 0 个文件），所以它是本地工作区隐患、不随仓库分发。
5. 真包验收命令备忘（**`WM_PKG` 要指向 `win-unpacked` 的上一级**，脚本自己拼后半段；
   而 `--package` 要指向 `win-unpacked` 本身 —— 两者口径不同，作者在这里错过一次）：

   ```powershell
   $env:WM_OUT = "$env:TEMP\dsh-review-pkg"; node scripts/rebuild-package-tmp.mjs
   node scripts/verify-writing-package.mjs --package "$env:TEMP\dsh-review-pkg\win-unpacked"  # 基线 8通过/0失败/1待跑
   node scripts/verify-writing-coldstart.mjs all                                              # 基线 12/12
   $env:WM_PKG = "$env:TEMP\dsh-review-pkg"; node scripts/verify-writing-packaged.mjs         # 基线 9/9
   node docs/audits/shell-hardening/2026-09-21/verify-ipc-authz.mjs --exe "$env:TEMP\dsh-review-pkg\win-unpacked\DeepSeek Harness Desktop.exe"
   ```

---

## 6. 请这样输出

对 §2 的每一项，给出四选一的结论并附证据：
**确认修复** / **修复不完整** / **引入新问题** / **判定有误（原本不是缺陷）**。

另外必须包含：

1. 你**实际跑过**的命令与**实际看到**的输出，并与 §1 的基线逐项比对（不要复述作者的报告）。
2. 对 §3 那 7 个判断取舍的**逐条裁决**，尤其是 V5（要不要硬禁到底）与 W23 的锁语义。
3. 你新发现的缺陷，**必须附可复现的取证**（脚本或命令 + 输出），并说明严重度与触发前提。
   没有复现的怀疑请单独列在"未证实的怀疑"里，不要混进结论。
4. 一条历史记录已由作者核实，**你只需抽查、不必重查**：WORKLOG/CHANGELOG 写的
   `world-settings-p1 34/34` 是**笔误**。证据：源码里 `ok(` 调用 **32** 处，
   实跑汇总行打印 **"32 passed, 0 failed"** —— 文件报告的条数与它自己包含的完全一致，**无静默丢项**。
5. 如果你要改代码：改完必须重跑 §1 全部命令 + `test:writing-world` **连跑 5 次**；
   若改动进入 asar，还必须**重建真包并重跑 §5.5 那组**，并把新的 asar 哈希写进结论。**不要提交。**

---

## 附：作者自查记录（2026-09-21，交审阅前最后一次全量复核）

| 项目 | 实测 |
|---|---|
| Node 门禁 19 步 | 非零 **0** 步 |
| `test:writing-hardening` | `HARDENING_OK 77 passed, 0 failed` |
| `test:writing-world` 连跑 5 次 | **5/5 exit 0** |
| 四个探针 | 0/9、0/4、0/6、0/4 复现；`PROBE_ERROR` 均 0 |
| `verify:release-artifacts` | `--allow-stale` → OK(0)；严格 → exit 1（如实报陈旧清单） |
| 真包重建 | `BUILD_OK`，asar `a59c3550…` → **`d74ca818…`** |
| 真包字节核对 | **8 通过 / 0 失败 / 1 待跑**（待跑 = profile 漂移，见 §4.3） |
| 隔离冷启动与升级 | **12/12** |
| 真包验收 | **9/9**（`app.isPackaged` 分支 `SMOKE_OK`） |
| 装机版 `verify-ipc-authz` | **IPC_AUTHZ_OK 0 项失败**（内核页 127.0.0.1:9146） |
| Electron 层 6 项 + 根级 3 项 | 全 **exit 0**（含 Codex 的 `repair-ui.cjs`） |
| 用户真实 `~/.dsh` | 未被再次写入（`syncedAt` 仍为 `12:44:24Z`） |
| 残留进程 / `git stash` | **0** / **空** |
