## [Unreleased]

## [0.1.43] - 2026-09-25

- 设置新增「外观」页：可自定义应用图标——内置「默认 · 鲸鱼」与「看板娘」两个预设，也可选择任意 PNG/ICO；窗口与任务栏图标即时生效，桌面/开始菜单/任务栏固定快捷方式同步改写，重启后保持（安装或更新重建快捷方式时会自动重新指回）。exe 内嵌图标与托盘的主题色状态指示不随此设置变化。— 署名：ox-alpha
- 修复 Windows 安装包丢失应用图标的问题：v0.1.39–v0.1.42 的安装器构建时误用了跳过「图标/版本信息资源编辑」的开关，装出来的应用是默认 Electron 图标；自本版起图标随安装包正确写入（v0.1.42 的 Windows 资产已于 2026-09-25 在 release 页替换为修复版）。— 署名：ox-alpha
- 设置新增「外观」页：可自定义应用图标——内置「默认 · 鲸鱼」与「看板娘」两个预设，也可选择任意 PNG/ICO；窗口与任务栏图标即时生效，桌面/开始菜单/任务栏固定快捷方式同步改写，重启后保持（安装或更新重建快捷方式时会自动重新指回）。exe 内嵌图标与托盘的主题色状态指示不随此设置变化。— 署名：ox-alpha
以下为全局热键静默失效的排查与修复（用户报“回来 debug”，按正式版 kernel.log 挖出）。— ox-alpha

- **修复：全局热键失败一直是静默的，而且用户无法自救。** 正式版 `kernel.log`（跨 08-13→09-22，4098 行）里热键**成功注册 17 次、被拒 92 次**，最后一次成功是 `2026-09-15T14:22:28Z`，此后三次启动全部 `rejected`；Win32 `RegisterHotKey` 直接探测证实 `Ctrl+Alt+D` 当前**真的被其他进程占着**（`Win32Error=1409 ERROR_HOTKEY_ALREADY_REGISTERED`），所以注册逻辑本身没 bug。真正的缺陷是：这件事**唯一的信号是日志里一行字**，用户按了没反应看不到任何解释；而托盘只能开关、**不能改键**，一旦被占就只能手改 `settings.json`。现改为：注册结果进 `state.hotkey` 并经 `shell:get-state` 下发，托盘标签直接写“· 被其他程序占用”，重试到头仍失败发系统通知并指路设置面板；失败后按 **1s/3s/8s 退避重试**（占用可能是瞬时的，例如两个实例启动重叠），任一次成功都补一条“已生效”通知，并用代号作废旧重试以免覆盖新设置。— ox-alpha

- **新增：设置面板可改全局热键。** 新增 `shell:set-global-hotkey`，**只允许设置窗口**调用（与 notify-command 同一口径：全局热键是系统级的，让内核页面里的插件 JS 能改它等于给它一个键盘劫持面）；「通知」页新增热键卡片（状态行 + 4 个候选键 + 自定义输入 + 关闭按钮，渲染全走 `textContent`）。新增 `lib/hotkey.js` 做 accelerator 白名单校验，拦两类 Electron **不会替你挡**的自我伤害：裸键（如 `D`，注册成功后全系统再按 D 都不会输入字母）与 `Control+字母`（`Control+C`/`Control+S`/`Control+Z` 会 shadow 掉所有应用的复制/保存/撤销）；字母/数字主键必须搭配 Alt 或 Super/Command。同时拒控制字符/换行/引号/尖括号（这个串会进 settings.json、日志与菜单标签）。— ox-alpha

- 验收：新增 `npm run hotkey-test` → **HOTKEY_OK 68 项**；`shell-hardening-test` 42 → **47 项**；`verify-ipc-authz` 11 → **23 项**且 **dev 与装机版各跑一次均 IPC_AUTHZ_OK**——这轮补上了一个**一直存在的验证缺口**：此前只测过“非设置窗口被拒”，从没测过“设置窗口被放行”（万一 `isSettingsSender` 恒为假，S1 就是静默的功能损坏，而只看“被拒”断言是全绿的）。现在探针会真开设置窗口，实测：面板状态行渲染为 `Control+Alt+D · 被其他程序占用（…）`、4 个候选按钮齐备、改成 `Control+Alt+K` 后 `status:"ok"`、裸键/`Control+C`/换行注入各自被对应错误码拒、`attempts:3` 证明退避重试真在跑。外壳侧 Electron 4/4；真包重打 asar `d2c94c55…` → **`5e633510…`**，字节核对 8通过/0失败/1待跑、冷启动 12/12、真包 9/9（`lib/hotkey.js` 已被主进程依赖闭包与 asar 齐全两项覆盖）。**未查出到底哪个进程占着 Ctrl+Alt+D**（Windows 不提供热键归属查询，逐个关应用需用户授权）；但 6 个候选逐个探测的结果是**只有 `Control+Alt+D` 被占**，H/K/F1/J/Insert 全部空闲。未提交、未发布。— ox-alpha

以下为复核裁决中**影响面小的两条**（裁决 4 / 裁决 6）。本轮刻意避开正在进行的“项目模板创建 + 库分组导航”那一轮的文件，也未跑 `build:writing`（会覆写对方在改的 `client.js`）。— ox-alpha

- **加固（复核裁决 4）：`shell:get-state` 不再向所有窗口无差别返回通知钩子命令。** 该通道无条件暴露给所有窗口，而主窗口承载内核页面（第三方插件 client 代码就跑在那里）；钩子命令可能带敏感参数（令牌、内网地址、个人路径）。动手前先查清消费面：本仓库唯一消费者 `renderer/settings.js` 走的是**已按发送方授权**的专用 getter、不读 get-state；外部主题面板（palis）的 `ShellState` 只声明 `version/kernelVersion/port/workspace/elapsedMs`——所以这个字段在 get-state 里无任何消费者，可安全收紧。现改为 sender-aware：只有设置窗口拿真值，其余给空串（**保留键**，避免形状突变）并额外给一个不含内容的 `hasNotifyCommand` 布尔位，UI 仍能显示“已配置钩子”。**未一并改的**：`logTail` / `lastError` / `workspace` 同样是敏感面，但确有消费方（审阅侧栏与主题面板），不属本轮“影响小”的范围。— ox-alpha

- **修复（复核裁决 6）：`install-update.ps1 -Download` 不再零校验就静默安装。** 原实现从 `/releases/latest` 挑第一个 `*-setup.exe` 下到 `%TEMP%` 就直接 `/S` 安装。现改为：从**同一个 Release** 取 `latest.yml`，缺清单直接拒绝自动安装（并指路 `-Installer` 是明确未验证的手工路径）；交叉校验 release tag 与从包名解析出的版本；两者下到**按 tag 命名的独立子目录**（`%TEMP%` 里可能早摆着一份无关的 `latest.yml`，拿陈旧清单校新包比不校更糟）；下完立即校 version + sha512(base64) + size，不符则删掉下载物并失败。删除只针对本脚本自己拥有的那两个文件，不做递归删除；文件仍严格 ASCII-only。— ox-alpha

- 验收：`shell-hardening-test` 39 → **42 项**；`verify:release-artifacts` 新增 U6 断言（同源清单 / 缺清单拒绝 / 独立下载目录 / tag 交叉校验）→ `RELEASE_ARTIFACTS_OK`；`verify-ipc-authz` 扩成 **11 项**（预置带秘密的钩子命令后从真实内核页面读 `status()`，断言命令为空、`hasNotifyCommand=true`、秘密串一字不出现、其余字段未被误伤），**dev 态与装机版各跑一次均 `IPC_AUTHZ_OK`**；外壳侧 Electron 4 项全绿；`main.js` 变动导致 asar 变化，已重打真包重验（asar `d74ca818…` → **`d2c94c55…`**，字节核对 8通过/0失败/1待跑、冷启动 12/12、真包验收 9/9）。writing-mode 那几套门禁**本轮未跑**（属在飞那一轮的文件，且 `verify:writing-build` 会因对方 src/client 与 client.js 未同步而报 stale）。未提交、未发布。— ox-alpha

- 审查：v0.1.41后续数据可靠性检查复现D01–D04（窗口草稿、候选标记、坏checkpoint、目录移动关联），尚未修复；既有投影/冲突保护回归通过。见 docs/audits/writing-world-settings/2026-09-21/review.md。— Codex

以下为独立复核（Codex，2026-09-22）复现的 CXR01/CXR02 整改，含复核裁决 3 的第三条。报告：`docs/audits/writing-world-settings/2026-09-22/`。

- **修复（P1）：残留锁清扫能把别人刚取得的活锁移走，打破互斥。** 原实现是“改名前再复核一次 owner”，并声称窗口已收敛到微秒级、即使重叠也有 revision/etag 兜底。复核正确地推翻了两点：**check-then-rename 本质上不是原子的**，把窗口缩短不等于互斥保证（时序：清扫 B 复核后暂停 → 清扫 A 移走旧死锁 → 写入 W 取得新锁进临界区 → B 恢复并把 **W 的活锁**改名 → 写入 X 又取同路径锁 → W/X 重叠）；而 **revision/etag 兜不了这个底**——它们是临界区**内部**的读后比较，前提是互斥已成立，互斥失效后不会自动变成 CAS。现改为：**在线一律不移动他人的锁**。`quarantineStaleLock` 必须显式传 `{ offline: true }` 才动作；会移动的 `sweepStale*Locks()` 删除，改为只读的 `listStale*Locks()`；内核启动只把残留锁的**绝对路径**打进警告日志；维护接口 `clear-stale-locks` 改为 **409 拒绝**（`stale-lock-clear-refused-online`）并返回可操作指引；`lock-stale` 错误新增 `lockPath`/`lockOwner`。**代价**：崩溃留下的残留锁会一直卡着那个桶直到作者关掉应用手动删除——宁可暂时不可写，不要重叠静默覆写。— ox-alpha

- **修复（P1）：同名稿件被当成同一部作品的证据。** 两部完全不同的作品都会很自然地有 `draft/第一章.md`，而 `relocationRelation` 只要看到“旧草稿引用的手稿在目标作品里同相对路径”就判 `importable=true`，界面于是声称“有证据属于当前作品”并跳过无证据确认（复核实测 `copied=1`）。现把该分支移除：证据只剩两种——作品备忘里记过这个旧路径（`memory-project-key`）、可读稿抬头里记过（`projection-record`）；同相对路径的观察降级为 `unrelated-filename-hint`、**importable 永远 false**；内容指纹只当辅助线索写进 detail，同样不授予导入资格。客户端确认框按复核裁决 **同时显示来源（旧位置）与目的（当前作品）**，面板说明不再把“同名同位”列为证据。显式知情覆盖（`confirmUnrelated === true`）与审计留痕（`unrelated-author-confirmed` 写进历史桶）保持不变；真迁移的强证据路径未被误伤。— ox-alpha

- **改进：未知锁持有者不再白等 8 秒（复核裁决 3）。** `withFileLock` 现有三种等待预算对应三种状态：活的持有者 → 8000ms 报 `lock-timeout`；可证明已死 → 400ms 报 `lock-stale`；读不出持有者 → 800ms 报新错误码 **`lock-owner-unknown`**（可重试，带 `lockPath`/`lockOwner`）。垃圾内容的锁文件不再让每次写入白等 8s；而对方 `openSync` 后、`writeSync` 前的微秒级空档仍会在几轮重试内变成可解析的活令牌。新分支在放弃前会**再确认一次锁是否已消失**（否则就会重演 W23：`existsSync` 为真后文件被释放、`readLockOwner` 拿到空串，把本该成功的获取变成硬失败），并已用源码形状断言钉住这一行。— ox-alpha

- 验收：`test:writing-hardening` 77 → **92 项全过**；新增 `fix-verification.mjs`（照复核探针原场景重放，含同一个 `fs.renameSync` 注入 seam）→ **CXR_FIX_OK 25 项 0 失败**，其中在线调用 `quarantineStaleLock` 的 **rename 尝试次数 = 0**；复核的 `handoff-probes.mjs` 现停在 `assert.ok(quarantined)`（它 assert 的是缺陷成立，这正是修复生效的证据，未改它）；Node 门禁 19 步 0 非零、Electron/根级 9 项 0 非零（含复核方的 `repair-ui.cjs`）、`test:writing-world` 连跑 5/5；真包重打后字节核对 8通过/0失败/1待跑、冷启动 12/12、真包验收 9/9（asar 仍 `d74ca818…`，main.js 本轮未改）。**未做**：D04 fixture 未按裁决 1 拆成两组（属复核方文件，未动）；裁决 2/4/5/6 未做；原子所有权锁机制与作品稳定 ID 属长期解法，未做。未提交、未发布。— ox-alpha

以下为打包 / 更新供应链的 U1–U5 hunt 与修复（5 项全部实锤复现并全部修复）。报告与只读探针：`docs/audits/release-chain-hardening/2026-09-21/`。

- **修复：`install-update.ps1` 无参数时会静默把应用装成旧版。** 它按 **LastWriteTime** 从 `~/Downloads` / 脚本目录 / `dist` 里挑安装包，不解析版本、不校验哈希、无降级防护；而 `dist/` 堆着 20 个历史安装包（实测会挑中 `0.1.37`，而当前版本是 **0.1.41**）。更要紧的是它的动作顺序：**先强杀正在运行的桌面与内核**，再静默 `/S` 安装，事后只在“版本没变”时给 WARNING——降级不报。现改为按解析出的版本降序选包（名字解析不出的候选直接跳过）、若旁边有 `latest.yml` 则校验 version + sha512（base64）+ size 不符即拒装、比已安装版本旧时默认拒绝（需显式 `-Force`）；三项检查全部前移到**杀进程之前**。— ox-alpha

- **修复：发布前没有任何一致性闸门，陈旧 `latest.yml` 可被当成本轮产物发上去。** `release.ps1` 在未认证分支会把 `gh release upload` 命令**打印出来让人手工执行**，而它上传的 `dist\latest.yml` 是 electron-updater 唯一信任的清单；实测本机那份是 **0.1.37**（清单自身自洽，sha512/size 与 0.1.37 的 exe 实算一致，但整份指向 4 个版本前的构建），发上去就会把全量自动更新客户端指向旧版或 404。新增 `scripts/verify-release-artifacts.mjs`（`npm run verify:release-artifacts`），接进 `build.ps1` 步骤 5b 与 `release.ps1` 步骤 1b；硬失败项含版本不符、path/url 不指本轮包、exe 缺失、**sha512/size 与实算不符**、本轮 blockmap 缺失、更新源或缓存目录名漂移、.ps1 非 ASCII/不可解析；孤儿 blockmap、遗留 `.tmp`、历史包堆积等卫生问题只警告不失败。开发态用 `--allow-stale`（`dist/` 已 gitignore，陈旧清单属本地工作区隐患，不随仓库分发）。— ox-alpha

- **修复：GitHub 更新源在 5 处各自硬编码且零校验。** owner/repo 同时写在 `package.json build.publish`、`main.js DEFAULT_UPDATE_REPO`、`build.ps1` 的 `app-update.yml` heredoc、`release.ps1`、`install-update.ps1`；`updaterCacheDirName` 同样散在三处。当前取值一致纯属巧合，改任一处都不会有检查报错，而 `--dir` + `--prepackaged` 两步流程不会自动生成 `app-update.yml`，所以它不会跟着 `package.json` 走。现让 `build.ps1` **从 `package.json build.publish` 派生** owner/repo（消除一处硬编码），并由新闸门比对全部来源、含 `--dir` 指定的解包产物里**真正生效的** `resources/app-update.yml`。— ox-alpha

- **加固：`killStaleUpdaterInstallers()` 不再把路径裸拼进 PowerShell。** 旧写法把 `LOCALAPPDATA` 派生的目录拼进单引号串（`StartsWith('" + dir + "'`），路径含单引号（如 `C:\Users\o'brien\…`）时拼出的命令串单引号数为奇数=字符串未闭合，而紧邻的正是 `Stop-Process -Force` 管道。改为经 `$env:DSH_UPDATER_DIR` 传值、完全不做拼接，并加了变量非空判断（避免缺失时 `StartsWith($null)` 匹配一切）。实际可控性有限（需能控制启动外壳的父进程环境），但没理由留着这个形态。— ox-alpha

- **拆哑弹：`build.ps1` / `prepare-runtime.ps1` 里的中文注释违反了它们自己的 ASCII-only 规则。** `build.ps1` 头部明文写着 PS 5.1 把无 BOM 的 .ps1 当 ANSI/GBK 读、非 ASCII 字节能吞掉行尾并弄坏解析器，还记了真实事故（"This actually bit us: adding Chinese comments here produced 'Unexpected token' and the build died"）——但它自己有 2 行中文（**v0.1.31 / commit `31f5943`** 引入），`prepare-runtime.ps1` 还有 1 行且未声明该规则，至今碰巧能解析。全部改为 ASCII，并给 `prepare-runtime.ps1` 补上声明；新闸门对四个 .ps1 断言零非 ASCII 字节 + 能被 PowerShell 解析器解析（只解析不执行）。— ox-alpha

- **回归修复（门禁抓到）：上一轮 V4 的锁快速失败把三种不同状态压成了一种。** 把“陈旧锁快速失败”从等满 8s 收到 250–400ms 后，`world-settings-p3.mjs` 的 **W23**（子进程持锁 2.5s）间歇性报 `lock-stale` 而不是获取成功（连跑 3 次：1 红 2 绿）。根因：“读不出持有者”其实有三种成因——锁刚被释放（应**立即重试获取**）、对方已 `openSync('wx')` 但未 `writeSync` 的空文件（它是**活锁**）、令牌可解析且 PID 已消失（才是陈旧锁），而 `!isOwnerAlive(owner)` 把它们全归为“死”。旧代码同样误判，但陈旧分支要等满 8s，下一轮 `tryAcquire()` 就成功了，所以从未暴露——缩短 deadline 等于把一颗一直存在的哑弹点了火。现新增 `ownerIsProvablyDead()`（必须能解析出 PID **且**该 PID 确实不存在）、获取循环里先判锁文件不存在就 `continue`、读不出持有者一律按活锁预算等；`inspectLock()` 增 `dead` 字段，`quarantineStaleLock()` 与两处启动清扫改为**只认 `dead`**（否则空锁文件会被改名隔离，那是真会丢数据的路径）。`hardening-v1-v9.mjs` 加 11 条断言钉住（含真子进程持锁→unlink 的 6 轮并发复现，要求 `lock-stale` 计数为 0），**66 → 77 项全过**；`test:writing-world` 连跑 3 次 3/3。— ox-alpha

以下为外壳本体（Electron 桌面版）的 S1–S6 hunt 与修复（6 项全部实锤复现并全部修复）。报告与可复跑探针：`docs/audits/shell-hardening/2026-09-21/`。

- **修复（P1）：内核页面里的插件 JS 可零确认拿到本机命令执行。** `dshShell` 桥是无条件暴露给所有用该 preload 的窗口的，而主窗口承载内核页面（其主世界跑着第三方插件的 client 代码）；`shell:notify-command` / `-test` 既不弹确认也不看发送方，主进程收到就 `spawn(命令串, {shell:true})`，而且写进 settings.json 后每个回合结束重放。外壳对同类风险早有明文策略并逐个收口过（open-file 改 showItemInFolder「不给执行面」、quit / restart-kernel / update-install 一律过原生确认框），这个入口是那次收口漏掉的。现在读/写/试跑三个通道全部按发送方窗口授权（仅设置窗口），命令变更时过原生确认框并原样展示要执行的命令串，每次变更写审计日志。— ox-alpha

- **修复：「重新启用被隔离的插件」会重启内核却不弹确认。** `restoreQuarantinedBundles()` 在恢复成功后调 `restartKernel()`，而 `shell:restart-kernel` 明文要求确认（「无确认等于让 XSS/恶意插件一键杀掉用户正在用的会话」）——两道门只锁一道等于没锁，且它还会把「之前因把内核搞崩而被自动隔离」的插件顺手重新启用。补上原生确认框（文案点明会重启、会启用哪些插件、它们当初为何被隔离）；同时移除设置页里那个可被页面脚本改写的渲染侧 `window.confirm`，并让 UI 区分「已取消」与「失败」。— ox-alpha

- **修复：通知钩子的 `{cwd}` / `{workspace}` 未加引号就拼进 shell 命令串。** 工作区路径里的 `& | > < ^ "` 会被 cmd.exe 当命令分隔符——实测工作区名为 `ws & node s3-payload.js` 时，钩子命令 `echo hook {cwd}` 真的执行了 `&` 后面的载荷。新增 `lib/shell-quote.js` 按平台加引号（win32 双引号 + `""` 逸出；POSIX 单引号 + `'\''` 逸出），`{files}` 强制成整数；**只含安全字符时原样返回**，既有钩子命令逐字节不变。这也修了正确性问题：含 `&` 的合法路径以前会让钩子静默跑错命令。— ox-alpha

- **修复：插件开关写入的 entry id 未校验就插值进 YAML。** `setEntryDisabled` 把 id 原样拼进 `- id: ${id}`，而 id 来自插件自己的 `dsh.bundle.patch`；实测一个含换行的 id 能把 `- id: hijacked` + `name: '@attacker/pkg'` 这样的额外补丁条目写进决定内核加载什么的 `cordis.patch.yml`，另一种 payload 能写出解析器不认的形状、把插件开关功能锁死（正好绕过该模块「解析不了就拒写、宁可不给开关也不毁手工编辑」的承诺）。加白名单校验，不符即拒写；已验证不误伤 `dsh-better-sidebar` / `@dsh-local/palis-theme-panel` / `a.b-c_d:e/f` 等真实形态。— ox-alpha

- **修复：审阅侧栏每次刷新都搬运整个会话事件流。** 流里每条 write 的 tool-call 都带 `new: <整个文件内容>`，会话期间单调增长（只在内核启动时清一次），而 `readSessionChanges()` 无任何上限：实测 20 次 400KB 写入 = 7.8MB 流、每次刷新搬 7.8MB（主进程与渲染侧双份内存），长会话 + 大文件的 agent 工作能把面板拖到卡顿乃至 OOM。新增 `lib/ndjson-tail.js` 只读尾部（4 MiB / 2000 条双闸，丢掉起读处残行以免切碎多字节字符）；逐条回退**不依赖**这份流（bridge 用自己内存里的 session events 按 callId 查），所以尾部截断安全；截断时侧栏如实告知并指路 Git 工作区视图看全量。— ox-alpha

- **加固：** `/api/review-bridge/revert` 补 1 MiB 请求体上限与 413（原本 `for await` 无上限收集，本机任意进程 POST 巨体就能撑爆内核内存；同仓库 writing-mode 早已限 1 MiB，两处口径现在一致）。新增 `lib/shell-hardening.test.js`（39 项，`npm run shell-hardening-test`）与 `plugin-manager-test` 入口；探针重跑 0/6 复现；隔离 userData 冒烟 `SMOKE_HANDOFF acked=true` / `SMOKE_OK`；review-ui-check / sidebar-skin-check / splash-check / plugin-manager 19 / git-review / atomic-file 14 / profile-inspect 7 / pid-cleanup 3 / plugin-sync 10 / selector-check 全绿。— ox-alpha

- 发版条件补齐（外壳 S1–S6 + 插件 V1–V9/G1–G4 两轮修复）：在 %TEMP% 建 dir 目标真包（离线、不签名、不发布、输出在工作区外），**字节核对 9/9**（app.asar 内 11 个主进程本地模块齐全且与仓库逐字节一致、无仓库路径引用、extraResources 完整、manifest↔产物 19 文件一致）、**隔离冷启动与升级 12/12**（含旧数据可发现/可读/可继续保存 revision 4→5，正好压到旧草稿桶只读回退）、**真包验收 9/9**（`app.isPackaged` 分支启动到就绪 SMOKE_OK、profile 哈希一致、首启种子、主题开启/恢复、清理只按本轮 PID；被测身份已入档：源码 6783647 dirty · asar a59c3550…）。新增 `verify-ipc-authz.mjs`：在**装机版 exe** 上连 CDP、在真实内核页面里证明 `notifyCommand`/`notifyCommandTest` 被拒且 `settings.json` 一字未改（**IPC_AUTHZ_OK 0 项失败**），并带两条前置断言防假通过。**仍未验收**：两个原生确认框需人工目检（已拉起可见隔离实例 PID 77680 交作者，保持运行由其关窗）、NSIS 安装向导/注册表、macOS 实机、受控离线、真实模型场景。— ox-alpha

以下为本轮 V1–V9 / G1–G4 hunt 与修复（13 项缺陷全部实锤复现并全部修复）。报告与可复跑探针：`docs/audits/writing-hardening/2026-09-21/`。

- **修复（P0，已在 v0.1.36–v0.1.41 发布版里）：大体积中文正文保存时静默出现乱码。** host 的 `readBody` 逐 chunk 独立做 UTF-8 解码，socket chunk 边界把一个三字节汉字切开时两半各自变成 U+FFFD，而 `JSON.parse` 对它完全合法，于是乱码一路写进手稿。实测 276KB / 92000 码点正文 round-trip 后出现 7 个 U+FFFD（首个差异在第 21751 字）。改为按字节收集后一次性解码；body 上限改按字节计（1 MiB，与 CONTRACT 一致），超限不再静默当空对象。影响 `save`/`version`/`draft`/`world-draft`/`memory` 全部 POST 路由。— ox-alpha

- **修复：审阅面板对中文文件名失效。** git 默认 `core.quotepath=true` 会把非 ASCII 路径转成八进制转义，而 `parseStatus` 只脱引号不解码——中文文件在面板里路径是乱码、diff 空白、块数 0，且暂存按钮的显示条件两个都不成立，**按钮根本不出现**（本项目默认库根就是中文路径，写作模式投影生成的正是 `bible/世界观整理.md`）。所有 git 调用统一带 `-c core.quotepath=false`，status 改用 `-z --untracked-files=all`，并补上按 UTF-8 字节的 C 风格反转义。— ox-alpha

- **修复：对中文未跟踪文件点「删除」会报成功而文件原封不动。** `revertFile` 用 `rmSync(force:true)`，ENOENT 被 force 吞掉；配上上一条的转义路径就是活生生的假成功（破坏性按钮给出成功回执）。改为删除前确认存在且非目录、删除后复核已消失，任一步不满足即 `ok:false`。同时新目录不再折叠成一行 `dir/`（目录内新文件此前全部不可见，而单个删不掉、全部丢弃却能删）。— ox-alpha

- **修复：配置文件损坏后一次「只改字号」就会清空库根、全部伙伴会话绑定与自定义 AI Key。** `readConfig` 原先把损坏与「文件不存在」一律降级成空默认值（连 `companions` 键都没有），下一条写配置路由就把空值落盘，无备份无诊断。现在只有 ENOENT 才当空配置；解析失败保留损坏原件字节（按内容哈希命名的 `.damaged-<hash>`，幂等）、回 `corrupt-config` 并拒绝任何回写。另修并发丢更新：`prefs`/`companion`/`roots` 三条路由改为 `updateConfig()`，读-改-写在同一把锁内并带单调 `revision`。— ox-alpha

- **修复：一部作品的写作伙伴绑定可能被永久锁死。** 窗口 A 预留后作者放弃关联（记录被删），A 在途的确认迟到抵达时会把 `phase:null` 写进协调记录，此后读取/预留/释放全部 `bad-record` 500，连 `forget --force` 也只回 `corrupt-record` 且不删文件——唯一出路是手工删文件。现在没推进到合法相位的结果不落盘，既有中毒记录读时自愈，`forget --force` 先把原件改名保留再清。— ox-alpha

- **修复：残留锁会让每次草稿保存卡满 8 秒并冻结整个内核。** 跨进程文件锁的等待是 `while (Date.now()<waitUntil) {}` 空转、deadline 8s；任一进程崩溃留下 `.lock` 后，该桶每次保存都卡满 8s 再 503，期间内核所有 HTTP 与流式回复一起停（实测 `setInterval(1ms)` 触发 0 次），而锁文件对作者完全不可见、无清理入口。改为 `Atomics.wait` 休眠、残留锁 250ms 快速失败、草稿路径 deadline 收到 1.5s，并新增内核启动清扫与 `maintenance` 维护入口（改名隔离、保留取证、活锁绝不动）。**实测 8038ms → 275ms。** 残留局限：等待仍是同步的，彻底不阻塞需把写路径改异步（独立重构）。— ox-alpha

- **修复：项目目录搬迁后的草稿恢复可能张冠李戴，也可能「报成功但界面永远读不到」。** 前者：恢复候选此前只判「绝对路径 + 不等于当前 + 已不存在」，与当前作品毫无关系，两部作品都移动过时打开 B 会列出 A 的旧路径，确认即把 A 的草稿写进 B。现在候选必须携带关联证据（作品备忘/可读稿里记录的旧路径，或旧草稿引用的手稿在本作品同名同位）才可直接导入；无证据的默认硬拒，仅在作者显式知情确认后才导入，并把关系记为 `unrelated-author-confirmed` 写进历史桶供追查。后者：草稿桶此前用客户端原始路径串分桶，而记忆/协调/恢复用 realpath 规范身份，库根经 junction 或映射盘访问时两者不一致。新增单一口径 `lib/project-identity.js`，全部子系统改走它，旧口径写过的桶由只读回退接住、下次保存自然迁移。— ox-alpha

- **修复：备忘与世界观写到配额上限后永久停摆。** 条目 400 / 历史 800 / 操作收据 200 三个上限原本只拒绝、不给出口：一部长篇写到 200 次世界观操作后，保存与确认全部 409，而作者只看到「备忘暂不可用：operations-full」和一个永远失败的重试按钮；撤回条目也不释放配额。新增三个归档 op（`archive-history` / `prune-operations` / `purge-retracted`），一律先把被裁字节整体备份到 `state/backups/` 再裁；清理只允许终态条目，已确认与候选绝不可被清走；被裁收据的 operationId 进有界墓碑环，其迟到重试回 `operation-pruned` 而不是重复建一条设定。备忘面板常驻显示用量并在撞墙前提供归档按钮，四个错误码有可读文案。附带：权威记录落盘补 `fsync`（此前比配置文件还弱，掉电正是 `corrupt-memory` 的成因之一）。— ox-alpha

- **加固：** host 路由新增路由×方法白名单（未知 route → 404，白名单外方法 → 405），非 GET 一律要求 `application/json`；此前 `PUT`/`DELETE`/`PATCH` 能绕过 JSON 门禁，且 `project-recovery` 在非 GET 方法下一律进写分支。草稿列表改为元数据投影（不含正文，上限 24 项并回 `total`/`truncated`），正文按窗口惰取（世界观副本预取最近 4 份避免渲染竞态）；库层列表刻意不设限，移动恢复不漏桶。— ox-alpha

- 测试与门禁：新增 `plugin/writing-mode/test/hardening-v1-v9.mjs`（66 项，`npm run test:writing-hardening`，已接入 `verify:writing-all`/`verify:writing-quick`）与 `lib/git-review.test.js` 的 G1–G4（+14 项，共 55 项）。归档探针重跑 V 0/9、G 0/4 复现；Node 层 17 步门禁 exit 0，Electron 层 ui/chat/reading/world-ui（含并行修改方 `repair-ui.cjs` 的 D01–D04 四项 PASS）/ui-smoke/native 通过。**未提交、未发布**；真包字节核对、隔离冷启动、macOS 实机、受控离线与真实模型场景仍未验收。— ox-alpha

- 发布自动化：macOS上传前查询已有Release，避免重复创建同标签条目导致Windows/macOS资产分散。YAML检查通过，下次工作流尚待实跑。— Codex

## [0.1.41] - 2026-09-20

- 写作模式世界观讨论整理、候选确认/修订/撤回/历史与可读稿冲突恢复；真实模型五类故事场景、两真实窗口并发验收通过。发布详情见 docs/releases/v0.1.41.md。— Codex

以下保留本版开发与整改的阶段记录，历史未验收状态以最终交回证据为准。

- 世界观整改 A01–A12：修复启动/空面板/整理发送与数据保护，补齐候选修订、撤回、历史、刷新恢复和投影冲突恢复；21 步完整门禁、真包 9/9 通过，真实模型五场景仍待验收。详见 repair/report.md；未发布。— Codex

- 独立复核：世界观实现退回整改；新增包导入、真实空面板及数据保护反例共 12 个探针结果，详见 `docs/audits/writing-world-settings/2026-09-20/review/review.md`。仅审查，未修复或发布。— 署名：Codex

- **世界观引导与整理（P0–P5 工程收口，总体 PARTIAL，未发布）**：含 P3 投影/幂等/并发探针 23/23；隔离真包 `%TEMP%\wm-world-settings-20260920` 与可见预览已启动；交回 `docs/audits/writing-world-settings/2026-09-20/`。真模型五场景与 Electron UI 套件 NOT_RUN。原条目：：memory schema2 + 设定条目/幂等/迁移；`bible/世界观整理.md` 投影；上下文注入结论+边界；客户端「选入整理→候选→确认」接线。单测 world-settings 34+12 通过；**Electron/真模型/真包未验收**。见 docs/plans/writing-world-settings-v1.md 与 audits/writing-world-settings/2026-09-20/。— 署名：ox-alpha
- 文档：新增世界观引导与整理执行方案 v1（P0–P5、W00–W25），策划案 v0.8 明确权威数据、投影恢复与迁移；仅方案，功能尚未实现。— 署名：Codex

- 文档：策划案补齐 v0.1.40 功能说明，将旧架构状态标为历史快照，区分已发布功能、工作树修复与 §18 世界观待实现设计；同步本地副本和工作日志。— 署名：Codex

- **策划案 v0.7**：世界观能力设计定稿为「AI 引导 + 讨论结果整理」（设定条目含标题/结论/一小段说明/边界/来源/状态；可读写 bible，AI 默认只注入已确认结论）。**仅文档，功能未实现。** 同步 `docs/writing-mode-plan.md` 与 `E:\剧本\写作模式-策划案.md`。— 署名：ox-alpha
- **写作模式 create-project 路径加固（Hunt）**：拒绝非空目录静默覆盖模板；拒绝点名/纯点段/Windows 保留名把项目落到库根或根外；模板 rel 写入前校验不可含上级路径。新增 `hunt-host.mjs`（21 项）；协议测试沙箱补 document/React stub。**尚未进入已发布的 v0.1.40**。— 署名：ox-alpha

## [0.1.40] - 2026-09-20

- Node 控制器回归沙箱兼容 Markdown 模块初始化；真实 DOM 渲染继续由 Electron 阅读测试验证。— 署名：Codex

- 写作伙伴回复支持 Markdown 阅读排版（标题、粗体、引用、列表、表格与网页链接），长代码/表格在侧栏内滚动；保留原始候选文本，备忘改为多行编辑，修复换行丢失。新增流式/链接/候选/窄栏/长历史验证，接入门禁；隔离真包与预览已验证。— 署名：Codex

- 写作模式：修复从助手消息“记为候选”后来源丢失、误记为作者的问题；候选经编辑和确认仍保留助手会话与消息 ID。新增 UI 回归。— 署名：Codex
- 固定写作生成文件的 LF 换行，修复 Windows checkout 后构建/包比对误失败；基线测试模板匹配兼容 CRLF。真实模型三场景、两个真实窗口与隔离测试包验收记录见 `docs/audits/writing-architecture/2026-09-19/review.md`。— 署名：Codex

## [0.1.39] - 2026-09-15

- **写作模式架构整改（P1–P4）**：`entry.js` 3526→165 行并拆到 features/adapters/services/state；`runtime-manifest.json` 成为唯一发布集合（清单驱动同步 + 受管记录 + 逐文件哈希，只清理"上一版受管且未被改动"的文件）；新增"跨模块漏 import"检查器与它的敏感性自检（注入缺陷必须报错）。— 署名：ox-alpha
- **Harness adapter 成为唯一 native 接触面**：`capabilities()` 区分硬/软缺口；`connect()`/`attach()`；handle 提供快照订阅、草稿读写、发送、取消、打开完整会话与释放。发送受理分三态：明确拒绝 / 已受理 / 无法确认（保留正文、先核对原生回合、不自动重发），只认可证明的本轮标识。— 署名：ox-alpha
- **跨窗口会话创建协调**：进程内共用创建 Promise；跨进程用持久协调记录（预留→创建中→已绑定/不确定）仲裁，过期 token 不得改写新绑定；创建结果无法确认时保持不确定并保留已知标识、不另建会话；会话被删除时给恢复入口而非静默新建。— 署名：ox-alpha
- **作者可控的项目备忘与当轮上下文**：候选/编辑/确认（记录操作者）/撤回/已解决/历史对照与恢复（新版本不回退）；当轮上下文只自动参考已确认的设定与偏好，待定问题需勾选并单独标识，自动部分 6000 字符预算（正文与显式引用不受限），每次发送重读备忘并冻结本轮请求。— 署名：ox-alpha
- **引用与恢复候选**：引用身份 = 路径+版本+选区+快照指纹（结构相等判定），源稿变化提示旧快照并可重新引用，旧格式引用原样兼容；其他窗口草稿只作候选（带窗口/时间），采用前先留可恢复副本。— 署名：ox-alpha
- **打包与门禁**：内置插件按清单发布（测试/源码不进用户机器）；外壳主进程依赖纳入发布集合并逐字节校验，包内不得含仓库路径；新增架构/适配/备忘/上下文/打包/冷启动/升级/复核探针等一键入口，严格门禁缺件即非零退出；升级 fixture 用生产模块验证"可发现/可读/可继续保存"。— 署名：ox-alpha
- **桌面外壳**：修复打包漏发主进程模块导致的启动失败；清理测试只按本轮 PID（不再按镜像名结束进程）；主题冒烟断言改为验证真实契约（注入样式表与调色、关闭后移除），并加主题开启/恢复两段验证。— 署名：ox-alpha
- 两轮独立复核的 15 条负向探针与 33 条正向基线全部通过；`verify:writing-all`（18 步）退出码 0。— 署名：ox-alpha

- 2026-09-15 写作模式 v2 整改复核 dcc2c88：旧 11 探针、33 条基线与真包启动通过；新增 N01–N06，覆盖测试全局关进程、未知创建重复执行、迟到采用丢新稿、并发消息误认受理、根 junction 越界和验收缺项仍成功。新增独立探针/报告/证据，保留已修复范围；未改生产实现或发布。— 署名：Codex / GPT-6

- 2026-09-14 独立复核写作模式 v2（95b138d）：旧 UI 时序 32/32 及现有主要回归通过，但新增探针复现发送拒绝清稿、恢复候选丢原稿、关联恢复另建会话、备忘失败继续发送、profile 同步越界及引用身份丢失；真实 TEMP unpacked 包因缺 `lib/plugin-sync.js` 启动失败。新增 B01–B08 审查、证据和返工顺序，修正“P1–P4 全部完成”的验收结论；仅审查材料，未修改生产实现、合并或发布。— 署名：Codex / GPT-6


- 2026-09-14 写作模式 v2（P1–P4）@4649b59：`entry.js` 3526→165 行并拆出 `features/{editor,library,tools}`；`runtime-manifest.json` 成为唯一发布集合（清单驱动同步 + 受管记录 + 逐文件哈希，只删受管且未改动的旧文件）；R7 漏 import 检查修复跨行括号正则漏报并新增"注入缺陷必须报错"的自检；新增 `createHarnessAdapter` 唯一 native 接触面（send 三态、迟到归位、不静默新建）与 host 侧会话创建协调协议（reserved→creating→bound/uncertain，受验证跨进程锁）；备忘最小完整操作（候选/编辑/确认/撤回/历史恢复 + 审计 actor）与 preparedTurn v2 契约（选择/固定/6000 字符预算/全嵌套冻结）；引用身份（path+revision+selection+指纹，结构相等）与跨窗口草稿恢复候选。验收：`verify:writing-all` 退出码 0（架构 R1–R8+R7 自检、适配 30、备忘 7、上下文 10、空环境冷启动 6、升级 5、三套 Electron E2E）；30 项矩阵与交回文档见 `docs/audits/writing-architecture/2026-09-14/v2/`。NSIS 隔离安装 / macOS / 离线加载 / 真实模型体验 = NOT_RUN（原因见 known-issues）。— 署名：ox-alpha
- 制定写作模式下一阶段执行方案 v2：分四批完成模块/构建、Harness 适配与协调、作者可控记忆/上下文、30 项及隔离打包验收。属于待实施计划，不代表功能已完成。— 署名：Codex / GPT-6

- 2026-09-14 整体复评 5a152dc：32 条 UI 时序重跑通过；包及隔离 profile 13 文件与源码一致。明确原方案 A/B/D/E 和完整打包/30 项验收仍有缺口，新增整体评估与只读证据，未改生产实现。— 署名：Codex / GPT-6

- 第九轮复核 1664467：X01 正向验收通过，草稿错误成功后清除且保留独立业务错误；UI 32/32、存储/并发 8/8。当前故障返工收口，原架构/打包验收仍开放。新增 review9 报告与证据，无生产代码改动。— 署名：Codex / GPT-6

- 第八轮复核 c88705f：V01 的失败提示、重试落盘和新文字 dirty 保护通过；仍有 X01，旧回调错误在保存成功后残留。新增 review8 报告/探针/证据，无生产代码改动。— 署名：Codex / GPT-6

- 第七轮复核 a58b3c7（实现 2c3ab6e）：S01/S03 及恢复 409 通过；S02 仍缺统一保存错误状态，恢复 413/网络失败与解决冲突后 503 无准确提示。新增 review7 报告与隔离证据，未改生产实现。— 署名：Codex / GPT-6

- 第六轮复核 985851e：R01–R03 原复现路径及保留本地通过；新冲突恢复仍有原生输入未同步、恢复 flush 冲突不可见、失败远端读取被当空草稿三项缺陷，继续退回。新增 review6 报告/探针/隔离证据，无生产实现改动。— 署名：Codex / GPT-6

- 第五轮复核 53223df：不抢锁、墓碑版本、连续输入和恢复中非空编辑通过；仍复现恢复缓存缺正文、恢复中清空未保存、冲突刷新版本后队列覆盖远端三项问题，继续退回。新增 review5 报告与隔离证据，无生产实现改动。— 署名：Codex / GPT-6

- 第四轮复核 606f21f：串行请求及恢复缓存修复部分有效，但活锁移走空档、队列旧版本、清除后版本归零仍破坏数据持久化，继续退回。新增 review4 报告与隔离复现证据，无生产实现改动。— 署名：Codex / GPT-6

- 第三轮复核 b66d194：确认 N01–N03、普通活锁、错误可见性与即时恢复保护；仍复现旧锁回收竞态及两条草稿倒退路径，继续退回。新增 review3 报告与隔离证据，未改生产实现。— 署名：Codex / GPT-6

- 第二轮复核 6ee2539/ca57547：确认正常备忘注入、绑定草稿恢复、IME 与旧聊天回归修复；仍复现活锁被抢丢更新、迟到恢复覆写、GET 越界等 7 项问题，结论继续退回。新增 review2 报告与隔离证据，无生产代码变更。— 署名：Codex / GPT-6

- 独立复核写作架构分支 cb99ae7，结论退回修改；新增审查报告、8 个 Node 故障探针与 3 个 React/HTTP 故障场景证据，记录串项目、备忘未注入、草稿恢复及持久化缺陷。本条为审查材料，不代表修复或发布。— 署名：Codex / GPT-6

- 增加写作模式架构完善执行方案，明确模块拆分、会话适配、项目备忘与 30 项验收；属于待实施计划。— 署名：Codex / GPT-6

## [0.1.38] - 2026-09-12

- 写作模式默认右栏改为独立的“写作伙伴”界面：按项目续接会话，使用 Harness 的模型、工具、审批、取消与上下文管理；新预设不强制阶段、轮数或字数配额，文字工具和格式检查按需使用。— 署名：Codex / GPT-6
- 稿件和选区作为可移除引用，由作者随消息发送；外部改稿在编辑器干净时刷新，冲突时保留输入。回归覆盖保存排队、历史版本保护、项目会话隔离、原生输入共享与独立右栏。— 署名：Codex / GPT-6
- 增加 `verify:writing`、`verify:writing-ui`、`verify:writing-native`、`verify:writing-chat`；P1 测试改为直接读取生产编辑控制器，避免维护第二份状态机。— 署名：Codex / GPT-6

- 右栏去掉原生欢迎页、工作区选择器和整套 composer；自有输入支持流式展示、失败保留、发送期间继续编辑、中文输入法保护、停止与授权处理入口。— 署名：Codex / GPT-6

- 策划案 v0.5 纳入 `docs/writing-mode-plan.md`，核对独立 UI、会话接口和验收边界，与外部策划案同步。— 署名：Codex / GPT-6

- Windows / macOS arm64 产物与更新清单已发布；打包验收及旧主题冒烟断言的补充核验见 `docs/audits/release-v0.1.38/`。— 署名：Codex / GPT-6

## [0.1.37] - 2026-09-11

### 写作模式（内置插件 writing-mode）

- 全屏写作台：文档库 / 稿纸编辑器 / AI 助手；`Ctrl+Shift+W` 切换
- 文档库多根可配置；搜索、项目折叠、版本徽标、历史稿、vN 对比、评审改稿
- 量化门禁（小说 md / Fountain）+ 台账速览；设置页可调字号/行距/自动保存/门禁
- **AI 以 Harness `ctx.llm` 为底座**（默认跟会话模型；设置可自定义 Provider/Model/Key）
- 修复：`webServer` inject 缺失导致内核起不来；Hooks 顺序；按钮重叠；`prompt` 无响应

### 已知

- 文档库根与门禁脚本见 `~/.dsh/writing-mode.json` 与设置页

- 署名：ox-alpha（2026-09-11）

## [0.1.36] - 2026-09-10

### 新增：写作模式内置插件

- **写作模式**（`@dsh-local/writing-mode`）：右下角一键切入全屏写作工作台——
  左文档库 / 中专注 Markdown·Fountain 编辑器 / 右 AI 助手（润色·续写·大纲·压缩·扩写，
  可插入文末或「发送到会话」）。Esc / 退出钮回到编码布局。
  走官方 `shell.overlay` 槽位，内核零修改。随桌面启动自动同步并注入。
- **文档库用户可自定义多根**：配置落 `~/.dsh/writing-mode.json`；顶栏切换库 /「添加库…」；
  扫描含 `project.md` 的子项目；读写 realpath 限制在库根内（防目录逃逸）。
- **量化门禁回显**：右栏对 `.md` / `.fountain` 跑小说/剧本门禁（PASS/FAIL 红绿列表），
  打开文件自动跑一次。修复 host `inject` 缺 `webServer` 导致内核启动失败的问题。
- **版本导航**：draft 版本徽标、历史稿横幅、同章 vN 芯片、对比上一版行 diff、另存为新版。
- **评审改稿**：打开 `reviews/*` 一键把报告预填到主会话。
- **快捷键**：`Ctrl+Shift+W` 切换写作台；`Ctrl+S` 保存；`Ctrl+Shift+S` 存新版；`Esc` 退出。
- 署名：ox-alpha（2026-09-10）

### 新增：审阅批量操作 · 运行中状态 · 通知钩子

- **审阅面板**：Git 视图显示当前分支徽章；「全部暂存」（`git add -A`，可逆）与
  「全部丢弃」（确认后还原跟踪文件并删除未跟踪文件）。
- **运行中状态**：审阅流 `turn/start`/`turn/end` 驱动——忙时窗口标题前缀 `●`，
  托盘提示带「运行中」。
- **通知钩子**：设置 →「通知」页配置回合完成时执行的外部命令（占位符
  `{files}` `{cwd}`/`{workspace}`），可试跑；与系统通知相互独立。
- 署名：ox-alpha（2026-09-10）

### 安全：外壳 IPC 攻击面收口

- **默认工作区**从主目录收成 `~/dsh-workspace`（不存在则创建）。要拿 home 当工作区，
  托盘/菜单「设置工作目录…」显式选一次。原因：`workspacePath` 闸门把工作区等同于
  shell IPC 合法范围，落在 home 会把 SSH 密钥等纳入可读/可删面。
- **`shell:open-file`** 改为 `showItemInFolder`（资源管理器定位），不再 `openPath`
  按系统关联执行 `.bat/.cmd/.exe/.js` 等。
- **`shell:quit` / `shell:restart-kernel` / `shell:update-install`** 补原生确认框；
  托盘/菜单与程序内部直连路径不受影响。
- **`workspacePath`** 判定前 `realpathSync`，防工作区内 symlink/junction 逃逸。
- **review-bridge** `/api/review-bridge/revert` 补回环校验（socket 对端，与 palis 同口径）。
- 署名：ox-alpha（2026-09-10）

## [0.1.35] - 2026-09-10

### 新增：内核版本对账 + 视觉打磨工具链

- 主题的角标与状态栏铭牌改为**真实数据**后，需要外壳提供"外壳·内核·主题"三方对账所需的字段：
  `shell:get-state` 新增 `kernelVersion`（读运行时 `runtime.json` 的 dsh 字段）。
  装本版后主题铭牌即可显示 `SHL 0.1.35 · KRN 0.1.1-rc.1 · REV 0.5.13`。
- 内置插件 pin 提至 **palis-theme-panel 0.5.13**（累计：角标/铭牌换真值、开机自检改为真实
  接入报告、极简（删 6 类无信息装饰 + 四级视觉比重 token）、声纳波前化、边框语言）。

### 工具（开发用，随仓库发布）

- `verify-render-invariants.mjs` 新增四个视觉打磨用开关：`--eval-file`（实时页面任意表达式
  求值，量几何/计算样式）、`--shot-sel`（只截某元素）、`--shot-scale`（放大倍数，
  小元素细节必用）、`--settle`（可调稳定等待，抓短命动效如只活 2.5s 的开机自检）。
- `--shot` 前自动点掉内核首次启动的弹窗，避免挡住取景。

- 署名：ox-alpha（2026-09-10）

## [0.1.34] - 2026-09-10

### 新增：内核升级工程化（契约 + 验收套件 + 升级手册）

- **内核接触面契约** `contracts/kernel-surface.json`（18 条：依赖什么 / 期望什么 / 怎么探针 /
  坏了怎么降级），配套可执行验收 `npm run verify:kernel`（Hermetic 独立 DSH_HOME +
  随机端口，critical 失败即退出码 1；pending 行显式报未接入）。基线快照存
  `contracts/baselines/`，升级时 diff 即知"变了什么"。
- **渲染不变量探针** `npm run verify:render`：headless Chrome + DPR 仿真 + 40 帧几何采样 +
  LayerTree，检查祖先包含块 / fixed 层视口对位 / 圆形宽高恒等 / 输入区主题。
  把 0.1.2 那类"静态截图看不出来、只有实时合成可见"的变形变成跑一次就点名。
- **插件 × 内核实测** `npm run verify:plugins` + 候选内核入口
  `scripts/prepare-candidate-runtime.mjs`（装任意内核版本到工作区外验收，不动已安装实例）。
- **升级运行手册** `docs/kernel-upgrade-checklist.md`：何时跟版、四条照跑的命令、
  实测版本矩阵、回滚姿势、安全网与工具索引。

### 变更：内置插件集 4 → 3（移除 auto-mode）

- 移除 `@nanmicoder/dsh-auto-mode`：实测其在 0.1.5-rc.1 上不可用（0.1.2 缺
  `effectivePermissionPreset`；0.1.7 自带版本守卫拒绝未知内核版本并拖垮内核启动）。
  内置集现为 dsh-better-sidebar 0.15.2 / dsh-pet 0.1.4 / palis-theme-panel 0.5.8。
- 既装实例不受影响：插件种子是一次性封嘴（userData 的 `builtin-plugins-seeded.json`）。

### 修复

- 内置插件树裁剪：改为按插件**实测 import** 推导依赖闭包（原写死名单漏了 palis 经 cordis
  间接到 `cosmokit`，会 Cannot find module），且不再从插件名起步（否则拖进仅声明未使用的
  mermaid 全家 300MB）。
- 内置插件树不再携带 `@deepseek-ai/*`：这些子包 npm 上只到 0.0.1-rc.1（0.1.x 随内核分发），
  pnpm 的 auto-install-peers 去装必然失败；改由 profile 的运行时链接提供——既省事又天然
  版本一致，也避免种子用旧副本遮蔽运行时链接。
- 署名：ox-alpha（2026-09-10）

## [0.1.33] - 2026-09-09

### 修复：外壳启动与稳定性（内核保持 0.1.1-rc.1）

- 内核版本钉回 0.1.1-rc.1：0.1.2-rc.1 实测导致 palis 主题球体/月面渲染变形
  （A/B 实锤，同主题下同外壳，换内核即现），本版不捆绑 0.1.2。
- 保留并发布 0.1.32 的外壳修复（向前兼容，不影响 0.1.1 内核）：
  - 内核重启路径弃用 `webContents.reload()` 改 `loadURL(新地址)`——重启后
    旧端口旧地址已失效，reload 只会重请求死地址（老内核下的潜伏 bug）；
  - `probeReady` 接受 401/303（服务应答即就绪）；
  - 新增 `kernelApiFetch` / `captureWebUrl` / `kernelPageUrl`：为内核未来
    启用 Web token 鉴权预留适配，老内核下自动退化为原行为。
- 新增：内核运行时切换失败的降级韧性——`ensureExternalRuntime` 换目录撞
  EPERM/EBUSY（旧内核进程未退净、文件被占）时，先把备份捞回原位，再检查
  现有运行时完整性：完整则降级沿用、照常启动（标记不变，下次启动自动重试
  解包，锁释放后自愈），只在本地完全无可用内核时才报错。修复实测的
  「boot failed: 内核运行时切换失败 EPERM」三连启动失败。
- 署名：kimi（2026-09-09）

## [0.1.32] - 2026-09-08（未发布，内容并入 0.1.33）

### 适配：内核 0.1.2-rc.1（Web 一次性 token 鉴权）

- 内核 0.1.2 起 Web 界面启用一次性 token 认证（`dsh web:` 启动行携带
  launch token，`GET /?token=X` → 303 + 签名 cookie，无 cookie 恒 401）。
  旧外壳就绪探测只认 200 → 恒 401 被判「永不就绪」→ 补丁降级链空转后
  放弃启动。本版修复：
  - `probeReady` 接受 401/303（服务应答即就绪）；
  - 解析内核 stdout 的 `dsh web:` 行捕获带 token 完整 URL（state.webUrl），
    窗口加载一律走它；
  - 新增 `kernelApiFetch`：外壳侧 /api 调用先以 token 换签名 cookie 再直达
    （palis-theme 联动、review-bridge/revert、ui-smoke 全走此路）；
  - 内核重启路径弃用 `webContents.reload()` 改 `loadURL(新地址)`——重启后
    旧端口旧 token 均已失效，reload 只会重请求死地址（老内核下的潜伏 bug，
    0.1.2 变必现）。
- 全部改动向后兼容：老内核无 token 行、无 set-cookie，自动退化为原行为。
- ~~runtime 捆绑内核 0.1.1-rc.1 → 0.1.2-rc.1~~（0.1.2-rc.1 实测致 palis 主题
  渲染变形，撤回；0.1.33 起内核钉回 0.1.1-rc.1，外壳 token 适配保留）。
- 署名：kimi（2026-09-08）

## [0.1.31] - 2026-09-07

### 新增：内置插件（mac 版开箱即用）

- 安装包随附 4 个插件（构建期锁定版本打进包）：
  dsh-better-sidebar 0.15.2 / @nanmicoder/dsh-auto-mode 0.1.2 /
  dsh-pet 0.1.4（npm registry）+ @dsh-local/palis-theme-panel 0.4.3
  （自研，构建产物随其仓库 tag v0.4.3 的 Release 资产分发）。
- 首启种子：内核第一次启动（loadProfile 自愈式初始化 profile）后，外壳把内置
  插件种入 ~/.dsh/profiles/web——只复制缺失包、profile 清单只增补
  （dependencies / bundles 原有条目与顺序原样保留）、加入 bundles 前逐个过
  bundleBootable 体检、stamp 一次性（用户之后卸载内置插件不会被顶回来）。
  种子有新增时静默重启内核一次，老 profile 全程 no-op。
- 版本选型约束：插件 peer 的 @deepseek-ai/* 按运行时实际版本
  （0.1.1-rc.1 族）钉死进 stage 树的 package.json——registry 自动解析会漂到
  0.1.0/0.1.2-rc.1 等与内核不同代的版本（同 service 双版本同进程即冲突）。
- 安装体积控制：客户端产物是 rolldown 单文件 bundle（服务端 import 闭包仅
  schemastery/ws/@deepseek-ai/*），stage 树裁剪后 410MB → 62MB。
- 构建集成：build.ps1 / build-macos.sh 调 scripts/prepare-builtin-plugins.mjs，
  extraResources 增加 dist/builtin-plugins。
- 包含 mac 构建管线修复（见日志〔100〕）：runtime.tar.gz/runtime.json 补齐、
  latest-mac.yml 生成，v0.1.30 起 mac dmg 已随 tag 自动构建发布。
- 署名：ox-alpha（2026-09-07）

## [0.1.30] - 2026-08-31

### 修复：审阅侧栏 Markdown 链接 XSS + 窗口导航守卫收口 + 未跟踪文件还原失效

- 审阅侧栏的 Markdown 渲染器把链接直接赋给 a.href——工作区内被审阅的
  README 若含 `[x](javascript:...)` 链接，点击即在带 dshShell IPC 的内核
  页面上下文执行脚本（可读任意工作区文件、改插件开关、提交/推送）。
  改：链接只放行 http/https/mailto，其余协议降级为纯文本展示。
- 导航守卫收口为统一的 hardenWindow()：主窗口 will-navigate 原对 file://
  无条件放行（preload 随导航重新注入 dshShell，等于把 IPC 交给本地文件页
  的脚本）；额外窗口（Ctrl+Shift+N）此前完全没有导航守卫；设置/预览窗口
  同样缺失。现一律"内核页同源才放行、外链转系统浏览器"，本地页额外只放行
  应用目录内的 file://。
- 修复未跟踪文件「还原」静默失效：shell:revert 传的是绝对路径
  （workspacePath 已解析），git-review 的 revertFile 又对它
  path.join(cwd, abs)——path.join 遇绝对路径不重置，拼成 cwd\<abs> 畸形
  路径，删除永远失败且无提示。改按"绝对就用绝对、相对才拼 cwd"，并补回归
  单测。
- 署名：ox-alpha（2026-08-31）

## [0.1.29] - 2026-08-26

### 修复：审阅桥 revert 路径穿越

- review-bridge 插件的 revert 端点对会话事件的 file_path 直接
  path.resolve 后写盘/删文件——若 file_path 穿越 cwd（../ 或绝对路径），
  会绕过工作区沙盒写/删任意文件。
- 修：新增 withinCwd() 包含闸，cwd 外路径一律拒绝回退。
- 署名：ox-alpha（2026-08-26）

## [0.1.28] - 2026-08-25

### 修复：主窗口导航守卫改 origin 比较

- will-navigate 此前用 startsWith(state.url) 前缀匹配——
  http://127.0.0.1:3690.evil.com/ 类域名可绕过，在受信外壳窗口内打开钓鱼页。
  改为 URL origin 级比较，非同源导航一律转交系统浏览器。
- 署名：ox-alpha（2026-08-25）

## [0.1.27] - 2026-08-25

### 修复：插件管理 toggle 的 key 白名单（路径穿越收口）

- shell:plugins-manage-toggle 的 key 来自渲染侧（内核页面/插件 JS 可达），
  原实现直接 path.join(nodeModulesDir, key)——../ 类穿越可读任意目录的
  package.json/dsh.bundle.patch 并把解析 id 写进 cordis.patch.yml。
  现要求 key 必须命中 profile manifest dependencies 白名单，未命中一律拒绝。
- 署名：ox-alpha（2026-08-25）

## [0.1.26] - 2026-08-25

### 修复：外壳 IPC 路径安全闸（插件越权面收口）

- preload（window.dshShell）暴露在内核页面主世界，第三方内核插件 JS 与外壳同权；
  shell:read-file / open-file 此前放行任意绝对路径 = 全盘任意文件读取、
  openPath 可打开任意文件。新增 workspacePath() 包含闸：read-file / open-file /
  revert / git-stage / git-unstage / git-revert-hunk 六个带路径入口统一收口到
  内核工作区（审阅功能的正当域），工作区外一律拒绝。
- 配套插件侧修复见 dsh-palis-theme-panel v0.2.0（CRT 层生命周期 + host 变更
  轮询同步）。
- 署名：ox-alpha（2026-08-25）

# 变更历史（Changelog）

> 按版本号记录用户可见的变更。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，每条带署名。

## [0.1.25] - 2026-08-24

### 新增：插件管理开关（设置面板内一键禁用/启用插件）

- 设置 → 插件表格的「启用」列升级为**开关**：点击即禁用/启用该插件，经 profile 的
  `cordis.patch.yml` 下发禁用补丁，内核运行中改动**即时热重载、免重启**（未运行则下次
  启动生效）。此前内核 web UI 对插件只有只读清单、无任何启停手段。
- 开关状态实时合并显示：被隔离 / 不在加载列表 / 缺 bundle patch 声明的插件不给开关并
  说明原因；`cordis.patch.yml` 含无法解析的手工内容时开关整体停用以保护手工编辑。
- 内核核心组件与外壳自带组件（审阅桥/对话优化等）不在管理范围。
- 署名：ox-alpha（2026-08-24）

### 修复：插件管理开关在三套皮肤下的令牌适配

- 开关选中态背景色从硬编码深海绿改为从各皮肤语义色 `--ok` 派生（color-mix）：
  深海=绿、海景=银白、PALIS=白；
- 开关滑轨/滑块圆角改走新增 `--pill` 令牌：深海/海景保持胶囊形，PALIS 直角皮肤
  自动变方形，与其全直角设计语言一致。

### 修复：内置 palis-theme 与 PALIS 主题面板插件冲突导致内核启动崩溃

- 未发布提交引入的内置 `palis-theme`（内核侧皮肤联动）与用户自装的
  `@dsh-local/palis-theme-panel` 插件都注册 `/api/palis-theme` 契约路由，两者同时
  挂载时内核报 `duplicate exact route` 启动即崩，且安全网会误隔离主题面板插件。
  现将内置行从注入名单移除（皮肤联动的内核侧归属 = palis-theme-panel 插件），
  误隔离的插件恢复默认可用。
- 署名：ox-alpha（2026-08-24）

### 新增：设置面板跟随外壳皮肤（deep / seascape / palis）

- 托盘切换皮肤时，设置面板（插件体检 / 软件更新）与启动画面同步换装——
  seascape 为单色银盐、palis 为等宽直角档案终端风（含 CRT 扫描线）；
  打开面板首帧即是当前皮肤，无闪烁。

### 署名
- kimi（2026-08-22）

## [0.1.24] - 2026-08-22

### 架构：统一原子化持久层（防止"写坏文件"类事故复发）

- **新增共享持久化基元** `lib/atomic-file.js`：所有关键文件写入改为**原子替换**
  （先写临时文件再 rename，读方永远见完整文件，进程崩溃/被杀不会产生半截文件）；
  读取统一剥 BOM、解析失败返回 null 而非抛。settings.json、profile 的 package.json
  （插件隔离/恢复）、内核补丁 kernel.patch.yml 全部走它——此前这些是直接
  `writeFileSync` 覆盖，写一半崩溃会整文件作废（历史：重写 manifest 丢插件条目、
  BOM 崩内核、settings 半截回落默认丢设置）。
- **新增设置存储模块** `lib/settings-store.js`：设置读写单点——默认值合并（新版本
  加默认项自动补全旧磁盘文件，不整文件作废）、BOM/损坏容错、原子写、migrate 钩子。
- 新增 `lib/atomic-file.test.js`：14 项单测（原子覆盖/无残留/BOM/半截容错/默认值
  合并/migrate 等）；`npm run atomic-file-test`。

### 修复（把"崩溃后刮日志猜插件"换成确定性前置体检）

- **坏插件隔离改前置**：此前是"内核启动失败后从日志正则猜坏 bundle"——每种新报错都要
  加一条正则（已累计 3 条），仍是打补丁。现在启动/重启内核前对启用列表里的每个插件做
  确定性可加载性校验（node_modules 可解析 + `dsh.bundle.patch` 声明 + link 目标存在），
  会炸内核的插件**不启动内核就直接隔离**，并给出精确原因（缺声明/链接悬空/缺条目）。
  日志刮取仅保留为运行期安全网（插件代码 import 时报错，静态体检看不见的场景）。
- **一键恢复不再盲目**：恢复被隔离插件前逐个校验当前是否可安全加载；仍坏的保持隔离
  （并说明原因），避免"恢复→启动又崩→再隔离"循环。恢复需重启内核时仅在有实际恢复时触发。
- 新增 `lib/profile-inspect.test.js`：`bundleBootable` 单测 7 项，覆盖缺声明/链接悬空/
  缺条目/package.json 不可读/link 目标缺失等全部事故形态。

### 修复（启动体验两条）

- **启动后焦点被系统浏览器抢走**：内核 `dsh web` 默认会用默认浏览器打开 Web UI
  （kernel.log 里的 "opening the default browser"），与桌面窗口重复且抢焦点；
  现在拉起内核一律带 `--no-open`，页面只由原生窗口承载。
- **PALIS 启动画面进度条竖排**：`.ln-prog` 容器 `font-size:0` 使 `width:20ch` 计算为
  0px，20 个进度格被迫逐一换行叠成竖条；改为容器不定宽（由 20 个格子自然撑开）+
  禁止换行，并在注释中钉死「不得给容器用 ch 定宽」。

### 清理

- `package.json` extraResources 去除 `plugin/dialog-optimize` 重复条目（打包产物不变，
  配置不再误导）；删除 0.1.21 时代遗留的临时构建配置 `dist-alt-config.json` 与
  `dist-alt/` 构建残留（369MB）——临时构建配置用完即弃，避免再次复制旧配置漏打
  新条目（0.1.23 构建已踩过一次）。

### 署名
- deepseek-v4-flash（2026-08-22）
- kimi（2026-08-22）

## [0.1.23] - 2026-08-22

### 新增：设置入口进内核自带设置面板（内核侧插件）

- 新增内置插件 `shell-settings`：在内核左下角「设置 → 插件」分区贡献「桌面外壳」标签页
  （官方 `settings.plugins.tab` 插槽契约，零 DOM 硬编码）——外壳版本、更新状态与进度、
  检查更新 / 重启并安装、打开桌面设置，全部可用
- 浏览器直连内核时（未开桌面应用）标签页优雅降级为提示文案
- 插件注册全程防御：插槽契约随内核版本变化时静默降级，不拖垮设置面板

### 调整

- 移除主界面左下角外壳悬浮「⚙ 设置」按钮（与内核自带设置入口重复）
- palis 启动动画大标题改为终端开机风：`DSH TERMINAL v{版本}`（打字机效果，版本号自动跟随）

## [0.1.22] - 2026-08-22

### 新增：设置面板（主界面左下角「⚙ 设置」/ 托盘「设置…」）

- **插件页——一键体检**（纯只读，不改任何文件）：逐项检查 profile 插件的安装完整性、
  bundles 启用一致性、链接是否悬空、`dsh.bundle` 声明、隔离名单——覆盖
  「侧边栏静默消失」「pnpm 跨盘链接悬空」「缺声明内核即崩」三类真实事故。
- **插件页——更新检测**：npm 来源插件比对 registry 最新版（只查不装）；本地链接插件显示
  「本地开发版」。插件一键更新暂缓（等链接自修复就位，避免 pnpm 打断本地链接）。
- **软件更新页（借鉴 lumen）**：检查更新移入设置面板，卡片式状态机——发现新版本 →
  自动后台下载（进度条）→ 已下载（一键「重启并安装」）。更新说明按
  「✨ 新功能 / 🐛 修复 / ⚙️ 优化」分类渲染。模态弹窗改为系统通知 + 面板角标，
  不再打断使用；不点安装也没关系，退出应用时自动装上。
- **更新可靠性（借鉴 lumen）**：差分下载关闭（进度不再 100% 后归零重跑）；下载网络
  错误自动重试 2 次；启动静默检查失败按 8s/30s/2min 递增重试；检查请求 60s 超时保护。
- **入口与提醒**：左下角「⚙ 设置」红点在「插件体检异常」或「更新已就绪」时亮起；
  托盘保留「检查更新…」直达更新页；应用启动自动静默体检一次。

## [0.1.21] - 2026-08-22

### 架构加固：把「更新出 bug」从灾难降级为可恢复

对着实战踩过的五类 bug 逐一加防护：

- **坏插件自动隔离（内容更新防砖）**：内核对 profile bundle 是"任一失败即整体退出"
  （历史上 PALIS 缺 `dsh.bundle`、工作区插件依赖解析失败都把应用整个搞挂）。现在
  启动/重启内核失败时自动识别报错点名的坏 bundle，从 profile 摘除并重试（最多 4 轮），
  把"插件更新搞崩内核"降级为"禁用一个插件 + 系统通知"；托盘菜单「重新启用被隔离的插件」
  一键恢复。核心 bundle（dsh-base/dsh-web-app）与内核内部条目（cordis:*）不会被隔离。
  启动失败原恢复链（补丁降级 full→bridge→none）保留；「重启内核」只做隔离不做补丁降级
  （内核偶发慢启动不该悄悄丢掉审阅桥）。
- **运行时安全交换 + 上一版回滚**：解压先校验完整性（node.exe + dsh 入口 + runtime.json），
  不完整绝不碰现有运行时；切换走「旧版改名 .prev 备份 → 新版就位」，中途失败自动回滚；
  主运行时意外损坏时 `runtimeRoot` 自动回退 `.prev`——更新中途断电也不会无内核可用。
- **日志编码修复**：内核输出是 GBK、应用日志是 UTF-8，此前直接写入产生乱码、排查全靠猜；
  现在按"含替换符即非合法 UTF-8"判定后用 GBK 解码，内核报错可读。
- **更新器残留清理**：启动时与安装更新前，自动清掉卡在 `dsh-desktop-updater` 目录里的
  残留安装器进程（实战遇到过 `setup.exe --updated /S` 僵尸挡住更新安装的情况）。
- **检查更新网络重试**：GitHub 直连被重置（`ERR_CONNECTION_RESET`）时按 0s/3s/8s 自动重试，
  手动检查最终失败才弹窗。

### 署名

- deepseek-v4-flash（2026-08-22）

## [0.1.20] - 2026-08-21

### 修复

- **「检查更新」无反馈**：`checkForUpdates()` 在"已是最新"时返回非空 result（`isUpdateAvailable=false`），
  原条件 `manual && !result` 让"当前已是最新版本"提示永远不弹 —— 已改为
  `manual && result && !result.isUpdateAvailable`。手动检查现在有明确反馈。
- （环境侧）更新检查偶发 `ERR_CONNECTION_RESET`：api.github.com 的 DNS 轮换会落到被重置节点，
  已通过 hosts 固定可用 IP（系统级，随本版一并说明）。

署名：deepseek-v4-flash-vision-exp

## [0.1.19] - 2026-08-21

### 新增

- **PALIS 主题全界面覆盖**：新增内置内核侧插件 `@dsh-local/palis-theme`（host + client，
  经既有 `--patch` 机制注入）。皮肤切到「PALIS」时，**内核 Web UI 整体换肤**：
  - 覆盖内核自己的 `--dsw-alias-*` 设计令牌（与内核明暗主题同一套机制）——气泡、输入框、
    列表、按钮全部自动换色，不碰 DOM 结构
  - 直角归一、全站等宽、直角滚动条、输入框终端化、用户消息标签 `[USER]`
    （用语义 data 属性，不依赖编译 hash 类名）、全屏 CRT 扫描线 + 暗角 overlay
  - 切回其它皮肤时全部还原（可逆）；外壳切皮肤自动联动（就绪后同步、2.5s 超时静默）
- **selector-check 门禁扩展**：同时监控 palis-theme 依赖的内核语义属性，内核升级改掉时打包会失败而不是静默

### 修复

- `--ui-smoke` 的挤压/拖拽断言改为**共存感知**：用户 web profile 装有 `dsh-better-sidebar` 时，
  外壳侧边栏本就该让位（不挤压页面、隐藏自己的 rail），旧断言与新特性冲突

## [0.1.18] - 2026-08-21

### 新增

- **第三套皮肤「复古科幻档案终端 · PALIS」**（托盘 →「皮肤」切换，模拟恐怖 × 磁带未来主义 ×
  SCP 档案局美学）：
  - 黑白单色高反差（`#0a0a0a` 系）+ 仅两种强调色：系统蓝（进度/选中）、警示红（警告/ABORT）
  - 全站等宽（JetBrains Mono 系）+ 英文大写大字距 + 直角（radius=0）+ 无投影
  - CRT 质感：`repeating-linear-gradient` 扫描线 + `feTurbulence` 细噪点（feColorMatrix 压成真灰）+ 轻微暗角
  - **进度 = 档案窗框里的引导日志**：逐行 `[ SYS INIT ] → [ MOUNT /dev/kernel ] → … → [ LINK OK ]`，
    外加 20 格行式进度 `[ ▓▓░░… ] 42%`；失败最后一行变红 `[ ABORT ]` 且进度停在 100% 以下
  - 字标用 **JS 打字机**逐字打出 `DEEPSEEK HARNESS ARCHIVE`（尾随闪烁方块光标）；
    动效一律 `linear` / `steps()`，退场是"CRT 关机"（屏幕收成一条亮线熄灭）
  - 审阅侧边栏同步换肤：仿 Win95 标题栏、列表 hover 扫描线高亮、选中项左侧白竖条、
    按钮 hover 反色；断连浮层同套
  - 完整设计文档与内核侧参考 CSS（[USER] / [PALIS CLERK] 气泡）见
    [`docs/palis-theme.md`](docs/palis-theme.md)
- **回归扩到 231 项**：新增 PALIS 概念断言（直角/等宽/引导日志随相位推进/错误态 ABORT、
  进度冻结/状态条不与版心重叠）与侧边栏 palis 皮肤断言（近黑底/直角/等宽/不外泄内核页面）

## [0.1.17] - 2026-08-21

### 修复（根因）：内核运行时不再装入安装目录，更新可直接覆盖

之前把整个内核运行时树（~450 个包）装进安装目录，导致：
- 更新时 electron-builder 要卸载旧版，`--updated` 卸载用 `Rename` 逐文件搬移整个安装目录，
  一旦出现超长路径（历史 `@deepseek-ai/dsh-scope` 病态嵌套 819 层、单路径 8300+ 字符，
  超 Windows MAX_PATH）必然失败，报 `Failed to uninstall old application files: 2`
- 这类超长路径残留还删不掉，会跨重装累积，让更新永远失败

本次改为正确架构：**安装目录只装外壳**，内核运行时打包为单个归档
`resources/runtime.tar.gz`，首次启动时由应用解压到
`%LOCALAPPDATA%\DeepSeek Harness Desktop\runtime`（版本标记一致则跳过）：
- 安装目录浅、小 → 更新时安装器直接覆盖外壳，不再触碰巨型运行时树，也不再有长路径问题
- 内核仍从用户目录执行，外壳更新后首次启动自动解压新版运行时

### 署名

- deepseek-v4-flash（2026-08-21）

## [0.1.15] - 2026-08-21

### 改进

- **内置内核升级 `@deepseek-ai/dsh` 0.1.0-rc.7 → 0.1.1-rc.1（next 预览线）**：
  `prepare-runtime.ps1` / `prepare-runtime-macos.sh` 版本锁定同步，自包含运行时重新生成（452 包）；
  打包版冒烟 `SMOKE_OK` 验证新内核带审阅桥与内置对话插件（dialog-optimize）补丁完整拉起。
  注：`0.1.1-rc.1` 属 npm `next` 预览线，`latest` 仍为 `0.1.0-rc.7`。

### 署名

- deepseek-v4-pro（2026-08-21）

## [0.1.16] - 2026-08-21

### 工具改进（不改应用本体，`install-update.ps1` 已同步更新到 v0.1.14 的 Release 附件）

实战验证结果：从 **0.1.10 升级到任何新版都会失败**（安装器退出码 2），根因是**旧版自带的卸载器
在升级过程中中止** —— 这是旧包里的代码，新安装器改不了它。**先卸载旧版、再全新安装**可以一次通过
（已在真机验证：卸载退出码 0，安装退出码 0，版本变为 0.1.14）。于是把这条经验做进脚本：

- **自动回退**：先尝试原地升级；一旦返回非零（典型就是 2），**自动改走"先卸载再装"**并复验版本，
  不必再由人去发现这条路径。也可以用 `-UninstallFirst` 直接强制这条路
- **先清掉卡住的更新器安装包**：应用内更新会把安装包下到
  `%LOCALAPPDATA%\dsh-desktop-updater`，实战中见过一个卡住的 `setup.exe --updated /S` 赖在那里，
  NSIS 认为"同款安装器已在运行"而中止。脚本现在开工前就按路径精确清掉它
- **装完清理更新器缓存**（可用 `-KeepCache` 关闭）：避免残留下载包让应用反复提示更新，
  实测顺手回收了 163.7 MB
- 明确写死：用户数据在 `%APPDATA%\DeepSeek Harness Desktop`，**连"先卸载"这条路也不会碰它**

> 已知问题（写给还在 0.1.10 的人）：直接双击安装包升级会失败，请用 `install-update.cmd`，
> 或手动"先卸载 0.1.10 再装新版"。0.1.11 及以后的版本之间升级不受此问题影响。

### 更新架构：内核运行时迁出安装目录（让应用内更新回归"正常软件"体验）

根因：内核从安装目录内的 `resources/runtime` 直接启动，更新时安装器必须覆盖正在执行的
文件（历史 0.1.11~0.1.14 的安装失败都源于此）。本次改动把运行时搬到
`%LOCALAPPDATA%\DeepSeek Harness Desktop\runtime`：

- **首次启动（或内置运行时版本变化时）自动同步**：从 `resources/runtime` 复制到用户目录，
  先写临时目录再原子替换，避免中断留下半成品；标记（`runtime.json`）一致则跳过，纯外壳更新不重拷
- **内核永远从安装目录之外执行** → 更新时安装器只需覆盖外壳，不再需要"杀内核/等文件锁/先卸载"
  那套强杀逻辑

### 移除

- **删除 `build/installer.nsh` 的强杀逻辑**（`nsis.include` 一并去掉）：内核已不锁安装目录文件，
  手动装包时由安装器默认的「请先关闭应用」提示兜底，恢复正常软件的安装体验
- **`installUpdateNow` 去掉固定 600ms 竞态**：改为等内核进程真正退出（`exit` 事件 + 短暂缓冲）
  再静默安装

### 发布自动化

- **`release.ps1` 支持自动发版**：检测到已登录的 `gh`（`GH_TOKEN` 或 `gh auth login`）时，
  构建后直接 `gh release create/upload`（安装包 + latest.yml + blockmap）；未登录则照旧打印手动命令

### 署名

- deepseek-v4-flash（2026-08-21）

## [0.1.14] - 2026-08-21

### 修复

- **应用内更新时，安装器会把自己杀掉**（0.1.13 的错）：点「重启并安装更新」时**安装器是应用的
  子进程**，而我在清理里写了 `taskkill /F /T /IM`，`/T` 连子进程一起杀 —— 等于安装器自杀，
  安装当场中断。**去掉 `/T`**：改为只按映像名杀所有同名进程（主进程 + helper 都覆盖），
  内核 node.exe 仍由后续按可执行路径专门清理，不依赖 `/T`

### 新增

- **`install-update.cmd` / `install-update.ps1`：一键安装脚本（推荐给"怎么都装不上"的情况）**。
  它从安装器**外面**做清理，所以不存在"安装器把自己当成运行中的应用"这类悖论：
  1. 从注册表定位当前安装（`Software\<GUID>` 的 `InstallLocation`，回退到卸载串所在目录）
  2. 关闭应用（关窗口只是最小化到托盘，所以强制关）并**循环确认真的全没了**
  3. **只杀安装目录内的** node.exe（内核），不碰机器上其它 node 进程
  4. 用「能否独占打开 `resources\runtime\node.exe`」确认文件锁真的解除（最多等 40s）
  5. 静默运行安装器（`/S`）并检查退出码
  6. 从注册表回读版本号验证，然后把应用重新拉起来
  - `-DryRun` 只报告不动手（先看清现状）；`-Download` 直接从 GitHub Releases 抓最新安装包；
    `-Interactive` 显示安装器界面（想看详情日志时用）；`-Installer <路径>` 指定安装包
  - 双击 `install-update.cmd` 会先跑一次 dry run 给你看，按任意键才真正开始装

### 说明

- 本脚本为纯 ASCII（PS 5.1 读无 BOM 的 .ps1 会按 GBK 解码而炸；见 0.1.13 的教训）

## [0.1.13] - 2026-08-21

### 修复

- **修掉 0.1.12 自己引入的回归：安装时报 `Failed to uninstall old application files … : 2`**。
  0.1.12 的进程清理有两处不到位（都是写错了，不是 electron-builder 的问题）：
  1. **只杀了一次**。Electron 是多进程，主进程 + GPU/渲染 helper 共 4~5 个同名进程，
     单次 `nsProcess::KillProcess` 杀不干净 → 旧版本自带的老卸载器（不含本修复）自我中断、
     退出码 2 → 就是那句提示（`: 2` 正是老卸载器的退出码）。
     现在改为 `taskkill /F /T /IM` 一次干掉所有同名进程，并**循环校验直到一个都不剩**（最多 10 轮）
  2. **内核 node.exe 只按 `$INSTDIR` 过滤**。但 `uninstallOldVersion` 用的是注册表里的
     `InstallLocation`（`installUtil.nsh:169`），两者可能不是同一个目录 → 过滤可能整个空转。
     现在同时清理 `$INSTDIR` 与 HKCU/HKLM `InstallLocation` 三个候选目录
- **安装器现在会自证清理结果**：每步写进安装日志（`DSH: taskkill app -> …`、
  `DSH: app closed after N attempt(s)`、`DSH: kernel cleanup under … -> …`），
  并用「能否重命名 node.exe」探测文件锁，输出 `kernel node.exe is free` 或 `still locked`。
  以后再出问题，把安装器详情日志贴出来就能直接定位。

### 修复（构建脚本，也是被自己坑到才发现）

- **`build.ps1` 以前会"假成功"**：PowerShell 不会因原生命令返回非零而停止，NSIS 步骤失败后脚本
  照样跑到底并打印 `BUILD_DONE`，而 `dist/` 里留着**上一次的旧安装包** —— 看起来像构建成功。
  现在每步检查 `$LASTEXITCODE`、构建前先删同版本旧产物、结束打印 `BUILD_OK version=… installer=…`
- **`build.ps1` 改为纯 ASCII**：PS 5.1 读无 BOM 的 .ps1 会按 ANSI/GBK 解码，中文注释可能吞掉行尾
  导致 `Unexpected token`；而编辑器/agent 保存时又常把 BOM 去掉 —— 唯一稳的办法是此文件不含非 ASCII
- 版本号一律用 `node -p` 读：PS 5.1 的 `ConvertFrom-Json` 解析不了带中文 description 的 package.json
- `release.ps1` / `prepare-runtime.ps1` 补上 UTF-8 BOM（它们同样含中文）

## [0.1.12] - 2026-08-21

### 修复

- **更新时不再提示"应用没有完全关闭"**。根因两条，都修了：
  1. **安装器侧（最关键，手动双击安装包也生效）**：electron-builder 默认检查一旦发现应用在跑就弹窗
     （`$(appRunning)` / `$(appCannotBeClosed)`）要求用户先关闭。而本应用「关闭窗口 = 最小化到托盘」，
     用户以为退出了、进程其实还活着；更要命的是**内核 node.exe 是从安装目录内运行的**，
     它不退出就一直锁着安装目录里的文件。现在用官方覆盖点 `customCheckAppRunning`
     （`build/installer.nsh`）改成**不问、直接收干净再装**：先温和关闭主进程 → 还在就强杀 →
     再**只杀可执行路径位于本次安装目录内的 node.exe**（按路径精确过滤，绝不碰机器上其它 node 进程）
  2. **应用侧**：原来调的是 `quitAndInstall()`，默认参数是 `isSilent=false, isForceRunAfter=false`，
     等于主动让安装器**带 UI 跑、且装完不重启**。现在改成 `quitAndInstall(true, true)` ——
     静默安装 + 装完自动重新打开，也就是「下载完点一下重启就好」

### 改进

- **更新提示不再依赖那个可能看不见的模态框**：下载完成改为发**系统通知**（点通知即安装）；
  只有窗口可见时才额外弹一次选择框
- **选「稍后」不再等于要重新下载**：托盘顶部与「内核」菜单常驻 **「⬆ 重启并安装更新 vX」**，随时可点
- 开启 `autoInstallOnAppQuit`：即便从不点"立即重启"，下次正常退出也会顺手装上
- 安装前先收掉内核子进程、销毁托盘与附加窗口，再留 600ms 让文件句柄真正释放，才交给安装器

## [0.1.11] - 2026-08-21

### 改进

- **打包新增"内置插件选择器自检"门禁**：`npm run dist` 现在会先跑 `npm run selector-check` ——
  内置插件 `dialog-optimize` 依赖内核前端的私有选择器（4 个编译 hash 类名 + 7 个 data 属性），
  内核升级把它们改掉时功能会**静默失效**；现在会直接打不出包并点名是哪个选择器、影响哪个功能。
  （已核对 rc.6 与 rc.7：目前全部仍在，属于潜在风险而非当前故障。）
- **新增 `docs/dsh-ecosystem.md`**：DSH 生态调研（本体/同类桌面壳/成熟插件/官方 UI 约定 Slots/插件与外壳的分工判据），star 与版本均为直查并标注可信度
- **改动审阅的信任闭环（完成）**：Git 视图现在把每个文件的改动**按 hunk 分档**展示与操作
  - 「已暂存 · N 块（提交时会带上）」/「未暂存 · N 块」两档；每块单独 **暂存这块 / 丢弃这块 / 取消暂存这块**
  - 文件级 **暂存 / 取消暂存 / 还原**；底部**提交条**（写信息 → 提交已暂存内容 → 推送）
  - 可逆操作直接执行，**丢弃**与**推送**弹原生确认；空暂存区/空提交信息会被拒绝
  - 逐块补丁**现读现切**（渲染侧只报"哪个文件第几块"），文件变脏时干净失败而不是打错补丁
  - **与内核侧右侧栏共存**：检测到 `dsh-better-sidebar` / `dsh-workbench` / `dsh-web-shell` 时自动进入共存模式 ——
    隐藏自己的竖条、不再挤压页面（改浮层），不抢屏幕右缘；判据用插件 bundle 的请求 id，不刮 DOM
  - git 逻辑抽成纯 Node 模块 `lib/git-review.js`：`npm run git-review-test`（33 项）+ `npm run review-ui-check`（17 项）
- **内置插件的脆弱选择器改为集中声明 + 失效会告警**：`dialog-optimize` 依赖的 4 个内核编译 hash 类名
  收进一处 `HASH_SEL`，统一走 `pick()`：**从未命中且连续错过 30 次**才告警一次（不能"一没找到就报"，
  例如「加载更早」在没有分页历史时本来就不存在）。四处调用点原本就都有降级路径（文本兜底 / 正则兜底 /
  直接跳过），功能不会崩 —— 这次修的是"静默降级导致查不出问题"
- **清理本机生态副本里的路径炸弹**：`dsh-better-sidebar` 的 npm pack 目录里有一棵 **400 层自嵌套的真实
  副本**（非软链；4096 文件 / 13.7 MB；最深路径 4082 字符），会让 glob / 备份 / 杀毒扫描卡死；已清成
  7 文件 / 32 KB 且顶层包完好（仓库外的本机清理，不影响本项目产物）

- **注入 UI 跟随外壳皮肤**：「修改审阅」侧边栏与内核断连浮层现在会随皮肤切换（海景皮肤下变单色银盐，diff 用冷/暖调区分增删）。
  实现只在 `<html>` 打一个 `data-dsh-skin`，把设计令牌**重定义在外壳自己的根元素上** —— `deep` 皮肤下一个字都不覆盖（继续跟随内核主题），
  且**绝不外泄到内核页面**（新增回归 `npm run sidebar-skin-check` 专门守这条线，15 项）
- **原生菜单 + 快捷键（对标 Codex 的键盘优先）**：菜单栏默认隐藏（按 Alt 唤出），但快捷键始终生效
  - `Ctrl+Shift+B` 切换审阅侧边栏 · `Ctrl+Shift+N` 新窗口 · `Ctrl+Shift+K` 重启内核 · `Ctrl+Shift+O` 设置工作目录 · `Ctrl+/` 快捷键一览
  - 重载/强制重载/缩放/全屏走系统标准项；命令进菜单，设置留托盘
- **多窗口并行**：`Ctrl+Shift+N` 用同一个内核开新窗口，长任务不再互相挡路
- **回合完成通知**：读审阅事件流判定回合结束，**仅在主窗口失焦时**弹系统通知，点击直接回到工作区并打开审阅面板（托盘可关）
- **全局唤起热键**：默认 `Ctrl+Alt+D`，按一次唤起、再按一次收起，任何应用里都能按（托盘可关）
- **深链接**：`dsh://open` / `dsh://review` / `dsh://restart`，可从浏览器或外部工具直接唤起（仅打包版注册协议）
- **修掉两个"会骗人"的测试**：旧的侧边栏测试先 `win.destroy()` 再延时 `app.exit(code)`，会被 Electron 默认的
  `window-all-closed`（code 0）抢跑 —— **失败也报成功**；`sidebar-layout-test` 还硬编码依赖某个端口上有真内核。现已改为同步退出 + 自带页面桩
- **新增 `docs/codex-benchmark.md`**：Codex 全表面 UX 基准表（22 行 · P0/P1/P2 · 标出哪些"不改内核做不到"），排后续需求时先读它
- **新增外壳皮肤系统 + 第二套皮肤「海景 · Seascape」（致敬杉本博司《海景》1980– ）**：托盘菜单 →「皮肤」里切换，选完即持久化
  - **海景**：单色银盐、**天与海各占一半、地平线永远在画面正中**、除那条线外画面里什么都不发生（长曝光的静止）
  - **进度就是那条地平线**：从正中向两侧铺开，铺满 = 就绪；失败就地停住不再延伸 —— 和深海皮肤共用同一个"永不回退"的进度数值
  - 版心落在下半幅（海里）：银灰鲸鱼 + 衬线宽字距字标 + 展签式状态caption；上半幅（天）永远空着
  - 银盐颗粒是真灰的（`feTurbulence` 默认出彩色噪点，用 `feColorMatrix` 压成灰度并固定 alpha）
  - 失败态是"贴在照片上的一枚封条"：印相退到后面、地平线暗下去，面板只有一道暗红竖线
  - 淡出退场：版心先走，**地平线最后消失**（多留 .12s）
  - 页脚署名 `海景 · after Hiroshi Sugimoto`（致敬标注，回归测试会守住它）
- **托盘「皮肤」子菜单**：两套皮肤单选 + **「预览启动画面…」/「预览启动失败画面…」**（独立窗口自驱动播一遍完整启动节奏，不拉内核、不影响主窗口；换皮肤时已打开的预览会即时跟着变）
  - 皮肤只作用于外壳自己拥有的界面（启动画面 / 窗口底色 / 预览窗口）；内核页面与注入的审阅侧边栏继续跟随**内核自己的设计令牌**，外壳不去染色
- **启动画面回归工具扩到两套皮肤 · 163 项断言**：新增海景的"概念约束"断言（地平线必须在画面中线 ±1px、天与海必须等高、印相满幅、鲸鱼在海面之下、天比海亮、地平线是全画面最亮的一条带、画面近乎单色 ≤14 色偏、致敬署名在位），以及两套皮肤各自的进度单调性、错误冻结、恢复归零、淡出握手
- **修掉一个会在打包版里翻车的隐患**：`loadFile(path, { query })` 在含空格的路径上会拼出非法 URL（实测 `ERR_FAILED`），改为 `pathToFileURL` 生成合法 `file://` URL 再挂查询串（托盘预览窗口就走这条路）
- **启动画面二次重做（极简克制 · 单光环）**：把"很多小东西同时在动"改成"一个焦点讲清一件事"
  - **一个主视觉**：删掉粒子星尘、细网格、底部光束、多层极光与暗角层，只留舞台底色渐变 + 徽标背后一团极缓呼吸的柔光
  - **真实进度光环**：细环 + 渐变弧 + 弧尖光点，弧长按真实相位推进（内核 → 等待 → 就绪），里程碑之间渐近爬升；**单调递增、永不回退**，迟到的旧状态也拉不回去；失败时就地冻结，不假装跑完 —— 取代原来来回横冲的假进度条
  - **白鲸直接落在深色场上**：去掉白色圆角光面底衬（塑料光泽），改用白鲸素材 + 一层柔光，±2.5px 极轻浮动
  - **去掉重复三遍的进度提示**：状态胶囊、进度条、内核/服务/就绪步骤点合并为**一行状态文案**（交叉淡入）；日志尾巴只在出错时出现，正常启动零打扰
  - **进工作区不再硬切**：就绪后整幕淡出（卡片轻微前推 + 柔光外扩）再交接页面，衔接处是与窗口同色的无缝黑场；并保证启动画面最短展示 1.25s、就绪后停顿 0.42s 让光环可见地合环 —— 内核秒起也不会把开场动画剪断
  - 字标入场改为淡入上浮 + 字距收紧；`prefers-reduced-motion` 下依旧全部静止
- **启动画面回归工具升级**：`npm run splash-check` 扩到 **84 项断言**（后续又扩到 163 项，见上），新增"进度单调不回退""错误态冻结不假完成""点重新启动后光环合法归零""淡出交接握手""白鲸够亮/进度弧真的画出来"等行为断言，并加看门狗兜底（脚本不会再无声挂住）；`npm run splash-shot --states` 同步适配
- **新增 `npm run splash-preview`**：在真实窗口里循环播放整段启动动画（`-- --error` 演示错误态、`-- --check` 离屏自检一轮）；不拉内核、不申请单实例锁、不碰开机自启，可与已安装的桌面版同时运行 —— 改启动画面不用再打包安装才能看效果
- **冒烟测试不再动用户环境**：`--smoke` / `--ui-smoke` 跳过开机自启写入（原先测试实例的默认设置会抹掉用户真实的自启注册表项）；冒烟输出新增 `SMOKE_HANDOFF`
- ~~**启动画面全面重做（深海极光 · 轨道光环）**~~（已由上面的「极简克制 · 单光环」取代，仅留档）：
  - 全新视觉：多层极光漂移背景、中心聚焦细网格、底部引擎光束、Canvas 粒子星尘、暗角收拢
  - 鲸鱼徽标：光面玻璃底衬 + 呼吸光晕 + 双轨道光环（流光 12s 绕行 + 刻度环 26s 反向慢旋）
  - 入场编排：徽标弹入、标题逐字上浮、副标题发丝线、状态胶囊扩散波纹、流光进度条与三相步骤条（内核→服务→就绪）依次登场；窗口真正可见后才从第 0 帧放行，任何机器都看得到完整开场
  - 状态表现：就绪态整场转青绿、错误态转红色警戒并弹出错误面板（轻微震动入场），复制日志 / 重新启动 / 退出按钮保持可用
  - 页脚版本号改为动态读取应用版本，不再写死；`prefers-reduced-motion` 下自动关闭全部装饰动画
- **新增启动画面回归工具**：`npm run splash-check`（4 种窗口尺寸布局 + 错误态 + 像素结构，59 项断言）、`npm run splash-shot`（`--states` 输出初始/就绪/错误三张截图）
- **内置内核升级 `@deepseek-ai/dsh` 0.1.0-rc.6 → 0.1.0-rc.7（latest）**：`prepare-runtime.ps1` / `prepare-runtime-macos.sh` 版本锁定同步，自包含运行时重新生成；冒烟 `SMOKE_OK` 验证新内核带审阅桥 + 内置插件补丁完整拉起

### 署名

- deepseek-v4-pro（2026-08-16）
- deepseek-v4-pro（2026-08-20）
- deepseek-v4-pro（2026-08-21）

## [0.1.10] - 2026-08-14

### 改进

- **右侧栏统一为一个控件（Codex/VSCode 式分隔条）**：去掉原来分离的「修改审阅」竖排标签 + 隐形拖拽把手，改为**一条始终在窗口右边缘的竖条（rail）**：
  - 面板关闭时：竖条就贴在窗口**右边缘**，顶部一个「❮ 审阅」开关按钮，点它开/关面板
  - **按住竖条向左拖**：面板直接跟着鼠标拉出并定宽（分隔条=鼠标位置），不用先开面板再找把手
  - 面板打开时：同一条竖条变成**页面与面板之间的分界条**，中间有 ⋮ 握点，悬停高亮，继续拖动调宽（320~800px）
  - **双击竖条**恢复默认 360px；宽度照旧持久化，重启恢复
  - 开关按钮随面板状态切换「❮ 审阅 / 审阅 ❯」，悬停有明确提示

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.9] - 2026-08-14

### 修复

- **侧边栏「修改审阅」点击无反应（0.1.8 引入的严重回归）**：preload 隔离世界里 `window.dshShell` 并不存在（`contextBridge.exposeInMainWorld` 只暴露给页面主世界），0.1.8 在侧边栏注入流程中途调用 `window.dshShell.getPanelWidth()` 抛异常，导致「修改审阅」标签的点击监听没挂上、面板完全打不开；0.1.7 起「打开/撤销/查看」按钮也有同样隐患 → 全部改回 preload 直连 `ipcRenderer.invoke`
- **新增 `--ui-smoke` 真实 UI 回归测试**：真实内核 + 真实窗口 + 真实 preload，自动验证侧边栏注入、标签开关、拖拽调宽与持久化、Git 视图、面板内查看器（Markdown h1/粗体渲染）、返回列表——13 项检查全过；`npm run ui-smoke` 可随时重跑，此类回归从此有测试兜底

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.8] - 2026-08-14

### 新增

- **侧边栏自由拖拽调宽（Codex 式）**：面板左缘新增拖拽把手，向左拖=加宽（320px ~ 800px，自动避让主窗口最小可用宽度），宽度持久化到 settings.json，重启后恢复
- **面板内文件查看器**：改动列表（会话改动 / Git 工作区两视图）每个文件行新增「查看」按钮——在面板内直接读取文件内容：
  - `.md`/`.markdown` 文件**渲染为 Markdown**（标题/列表/引用/代码块/行内代码/加粗斜体/链接，纯 DOM 构建无注入风险），类似 VSCode Markdown 预览
  - 其他文本文件以等宽纯文本展示
  - 上限 512KB（超限截断提示）、二进制文件拒绝并提示；顶部「⟵ 返回」回列表、「打开」跳系统编辑器
  - 查看器打开期间后台数据照常刷新、返回时看到最新列表

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.7] - 2026-08-14

### 改进

- **「会话改动」视图对齐 Codex（完整重做）**：
  - 按轮次分组，组头显示**你的提问文字**（审阅桥新增采集 `user/message`）+ 轮次 + 时间
  - 轮次内**按文件分组**（同一文件的多次改动收进一张文件卡，显示处数、可折叠）
  - 每条改动显示**完整 old→new 着色 diff**（超 12 行折叠、可展开全部），str_replace_editor 正确显示 old_str/new_str
  - **逐条撤销（Codex 式 Undo）**：每条改动一个「撤销」按钮，通过审阅桥新增的 `/api/review-bridge/revert` 端点做精确逆序回退——edit 按 new→old 反向替换（含 replace_all）、str_replace 反向替换、write 恢复写入前状态（从会话日志的完整 read/write 记录重建；Created file 则直接删除文件）；会话运行中拒绝撤销；失败给出明确原因
  - 撤销成功后该条从列表移除（写入 revert 事件流，刷新后保持一致）；操作反馈用 Toast
  - 两个视图的文件行都加「打开」按钮（顺带修复绝对路径被错误拼进工作目录的问题）
- 审阅桥同步采集 `tool/result`（识别 Created file / 失败调用）

### 修复

- `shell:open-file` 用 `path.join` 拼接导致绝对路径（`E:\…`）被拼进工作目录下 → 改 `path.resolve`

### 署名

- deepseek-v4-pro（2026-08-14）

## [0.1.6] - 2026-08-14

### 新增

- **内置「对话框人性化优化」插件（dialog-optimize）**：随应用分发，启动时自动同步到内核可解析位置并注入补丁（内核零修改），无需任何手动安装：
  - **对话折叠**：Think/工具/命令等展开行吸顶；每条 AI 回复可「收起流程/展开流程」，折叠为最终输出并随滚动吸顶；运行中的块自动展开跟读、完成后自动收起
  - **对话导航**：对话左上角固定导航栏（序号+内容+时间，悬停看全文，滚动高亮跟随，可缩放/最小化）
  - **消息撤回**：悬停用户消息出现「↩ 撤回」——原地移除该消息及之后的对话（不新建会话、不污染模型上下文），自动逆序回退 AI 改过的文件（AI 新建的文件删除），输入框预填原文本供重发
- **启动降级三级保险**：内置插件或审阅桥任一导致内核启动失败时，自动逐级降级重试（全量 → 仅审阅桥 → 无补丁），应用本体永不因插件而启动失败；若用户自己的补丁层已挂载同名插件，则自动跳过内置行避免重复加载

### 修复

- **Windows 自动更新缺 `latest.yml`（检查更新报 404）**：build.ps1 用 `--publish never` 构建，导致更新清单 `latest.yml` 从不生成、未上传到 Release → electron-updater 检查更新报 `Cannot find latest.yml ... 404`。新增 `gen-update-manifest.js`（按 electron-builder 官方格式生成 base64 sha512 清单），build.ps1 构建时自动生成，release.ps1 上传命令补上该文件；v0.1.6 的 `latest.yml` 已补传

### 署名

- deepseek-v4-pro（2026-08-14）

## [Unreleased]

- 独立复核：世界观实现退回整改；新增包导入、真实空面板及数据保护反例共 12 个探针结果，详见 `docs/audits/writing-world-settings/2026-09-20/review/review.md`。仅审查，未修复或发布。— 署名：Codex

- 文档：新增世界观引导与整理执行方案 v1（P0–P5、W00–W25），策划案 v0.8 明确权威数据、投影恢复与迁移；仅方案，功能尚未实现。— 署名：Codex

- 文档：策划案补齐 v0.1.40 功能说明，将旧架构状态标为历史快照，区分已发布功能、工作树修复与 §18 世界观待实现设计；同步本地副本和工作日志。— 署名：Codex

参考对象：OpenAI Codex 桌面版（后台驻留/托盘、极简、跨平台）。

### 新增

- 外壳设置持久化（`%APPDATA%\DeepSeek Harness Desktop\settings.json`）
- 关闭窗口 → 最小化到托盘（可开关，默认开启；退出走托盘「退出」）
- 开机自启（托盘勾选，`app.setLoginItemSettings`）
- 记住窗口位置/大小（跨屏校验、防抖落盘、最大化状态记忆）
- 工作目录记忆：托盘「设置工作目录…」选目录并持久化，重启内核生效
- 托盘菜单扩充：工作目录、打开日志、开机自启/关闭到托盘开关
- 启动画面：四版鲸鱼按固定节奏循环轮换（与真实启动阶段解耦，快启动也能看清）；就绪显示内核启动耗时；失败界面加「复制日志」按钮
- 右侧「修改审阅」侧边栏（外壳级覆盖层，默认折叠，点右缘标签展开）：
  - 读工作目录的 `git status` / `git diff` 列出改动文件（改/增/删/重命名/未跟踪）
  - 点文件展开 diff（增/删行着色）；「还原」= `git restore`（未跟踪文件则删除），带确认
  - 需工作目录为 git 仓库（与 Codex 同假设）；非仓库给出提示
- 自包含打包（方案 B）：`prepare-runtime.ps1` 把全局 dsh 内核树（含嵌套依赖）+ node.exe 拷入 `runtime/`，经 electron-builder `extraResources` 打进安装包——装完即用，无需目标机装 Node/dsh
- 自动更新：electron-updater；托盘「检查更新…」、启动后 8s 静默检查、下载完弹窗重启安装；更新源默认 GitHub Releases（`yuanzhoucanxiang/dsh-desktop`，可用 `updateRepo`/`updateUrl`/环境变量覆盖），未配置时静默禁用；`release.ps1` 打印发版上传命令
- 平台中立化 + macOS 构建准备：`main.js` 按平台分支（node 二进制路径、`which`/`where`、进程组收尾、AppUserModelID 守卫）；新增 `prepare-runtime-macos.sh`、`build/icon-512.png`、`package.json` 的 `mac`(dmg) 配置
- 修改审阅侧边栏：非 git 仓库时提供「在此目录初始化 git 仓库」按钮（`git init`），点击即可开始审阅
- **审阅桥（会话级改动，Codex 式）**：新增 `plugin/review-bridge.js` 内核监听插件，经 `--patch` 注入桌面内核实例（内核源码零修改），订阅 `session/event` 实时采集 `edit`/`write`/`str_replace_editor` 工具调用（文件路径、old/new、轮次），写入 NDJSON 流；侧边栏新增「会话改动」视图（按轮次分组、写/改徽章、old→new 片段），与「Git 工作区」视图可切换

### 修复

- **打包版启动即崩（无窗口）**：`autoUpdater` 误从 Electron 内置模块导入，却按 `electron-updater` 的 `{provider:'github'|'generic'}` 格式调用，`setFeedURL` 抛 TypeError 打断启动链 → 改用 `require('electron-updater')`，并对 `setupAutoUpdater`/`checkForUpdates` 加 try/catch 兜底（v0.1.1，双平台）

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.5] - 2026-08-13

### 修复

- **长路径问题根治**：0.1.4 剪枝后安装目录仍有 7 个文件超 260（`@mistralai`/`@opentelemetry` 的深层 .js）→ 运行时改用 **hoisted npm 安装**（依赖平铺在 `node_modules/@deepseek-ai/*`，不再嵌套在 dsh/node_modules 下），路径 198–226（安装目录预计 ~232）、彻底低于 260；同时确认 `dsh-base`/`dsh-web-app` 传递依赖已覆盖全部运行时组件（CLI 的 devDeps 是冗余的），hoisted 安装完整可用；剪枝扩展 `.ts`；内核 + 审阅桥启动验证通过；安装包 159.5MB（更小）

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.4] - 2026-08-13

### 修复

- **升级卸载失败（`Failed to uninstall old application files: 2`）**：运行时树里有 36 个文件路径超 Windows 260 字符上限（最深的在 `@mistralai/mistralai` 的 `.d.ts.map`），NSIS 卸载器用经典 API 删除时报"找不到文件" → `prepare-runtime` 脚本剪掉 `.d.ts`/`.d.ts.map`/`.map`（开发期产物，运行时不需要），路径 269→228、超限 0 个、体积 339→280MB；剪枝后内核 + 审阅桥启动验证通过

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.3] - 2026-08-13

### 改进

- **侧边栏改为分割式布局**：打开时把内核页面向左挤开 360px（而非覆盖浮层），页面真实重排——与 Codex 分栏一致
- **侧边栏样式改用内核主题变量**（`--dsw-alias-*`）：背景/边框/文字/徽章/按钮全部跟随 DeepSeek Harness 自身明暗主题，不再是自定义深蓝
- 新增 `sidebar-layout-test.js` 布局回归测试

### 修复

- 分割挤压曾被 `transition` 干扰（computed 取到动画中间值）→ 去掉 body 过渡，改为直接内联 margin
- **自动更新下载失败**：两步构建法（`--dir`+`--prepackaged`）不生成 `app-update.yml`，electron-updater 检测到新版但下载阶段 ENOENT → 构建脚本显式生成 app-update.yml（Win `build.ps1` + mac `build-macos.sh`）

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.2] - 2026-08-13

### 新增

- **审阅桥（会话级改动）**：内核监听插件经 `--patch` 注入桌面实例（内核源码零修改），订阅 `session/event` 实时采集 `edit`/`write`/`str_replace_editor`（文件、old/new、轮次）→ NDJSON 流；侧边栏新增「会话改动」视图（按轮次分组、写/改徽章、old→new 片段），与「Git 工作区」可切换
- 审阅桥失败自动降级：内核升级若致插件加载失败，外壳自动去掉补丁重试一次，应用始终可用（审阅降级为仅 git 视图）

### 修复

- 打包构建失败：package.json 被 PowerShell 编码往返写坏（UTF-8 BOM + 中文乱码）→ 恢复并改用 node 改版本号

### 署名

- deepseek-v4-pro（2026-08-13）

## [0.1.0] - 2026-08-13

首个可运行版本：内核零修改的 Electron 桌面外壳。

### 新增

- Electron 桌面外壳：自动拉起 `dsh web` 内核（随机空闲端口）、HTTP 就绪探测、退出 `taskkill /T` 收尾
- 深色启动画面：状态胶囊、流光进度条、内核日志尾巴、错误/重试界面
- 启动画面随启动阶段轮换四版官方鲸鱼图标（初始化→拉起内核→等待就绪→就绪）
- 单实例锁、托盘（显示/重启内核/退出）、内核崩溃恢复浮层、外链接管
- 托盘鲸鱼随系统深浅色主题自动切换黑白（`nativeTheme`）
- 桌面快捷方式「DeepSeek Harness」+ 双击启动入口 `启动桌面版.cmd`
- 官方鲸鱼图标四版（取自 harness 前端 `favicon.svg`，sharp 矢量渲染）
- 冒烟测试 `npm run smoke`、调试工具 `splash-shot.js`、图标生成器 `make-ico.js` / `render-whale.js`

### 修复

- 内核改用真实 `node.exe` 拉起（`ELECTRON_RUN_AS_NODE` 下 HMR 插件崩、内核静默退出）
- 批处理改 GBK 编码 + CRLF（原 UTF-8 在中文 cmd 下乱码）
- 批处理应用路径改 `"%~dp0."`（原 `"%~dp0"` 尾反斜杠导致引号转义、Electron 找不到应用）
- `icon.ico` 改为 DIB 多尺寸格式（原 `GetHicon()` 生成的文件损坏，Explorer 显示默认图标）

### 署名

- deepseek-v4-pro（2026-08-13）

### 2026-09-21 · 资料接入试用（非发布变更）
- 以《赫尔帝国》13 份 Markdown 做隔离真实模型试用，保留工具与对话证据；明确原目录自动接入仍缺失，未更改作品原文件。见 docs/audits/writing-world-settings/2026-09-21/hel-trial/report.md。— Codex


### 2026-09-22 · 交回定向复核（未发布）
- 独立复核发现锁清扫竞态与同名稿件误判项目关联；已有基线通过，仍需整改。已有项目接入在独立副本验证，不覆盖并行工作树。见 docs/audits/writing-world-settings/2026-09-22/handoff-review.md。— Codex


- 2026-09-22：已有项目接入已从独立副本整合，支持自定义 Markdown 文件夹、完整路径分组与统一项目身份；修正列表排序回归。延迟恢复增加重复点击与卸载保护。补充真实目录移动/无关联确认/第五份副本延迟/网络失败重试 UI 探针。24 步最终门禁结果见 integration.md；本轮未提交、未发布。— Codex

2026-09-22：用户授权提交并发布 v0.1.42；已有项目接入与审计整改进入本次发布候选。按同一 Release ID 合并 Windows/macOS 资产，最终结果另记。— Codex

2026-09-22：v0.1.42 已公开为 Latest，Release ID 393502728，代码 ac00c15。Windows 安装器/blockmap/latest.yml 与 macOS DMG/latest-mac.yml 五项资产全部 uploaded，size/SHA256 与两份清单 SHA512 一致；macOS CI 35695937072 成功。Windows 真包 9/9，NSIS 实际载荷冷启动 SMOKE_OK。未替换本机正式安装，预览保持运行。证据 docs/audits/release-0.1.42/。— Codex

2026-09-22 新建项目热修复：复现真实 POST create-project 返回 template-path-unsafe，因模板路径检查发生在父目录建立前。调整为预检模板相对路径、逐级创建并核验目录、wx 排他写入；失败保留创建表单。新增 create-project-http.mjs 覆盖三模板完整文件、重复与已有内容拒绝，并接入 test:writing-world；21 项 host 和 Electron UI 回归通过。本机 resources 插件 index/client 已备份后修补，需应用重启自动同步 profile。版本号仍 0.1.42，本地补丁未发布。— Codex

2026-09-22 作品导航：模板文件使用中文显示名；正文/作品概览优先，人物、世界与设定、故事规划、创作跟踪折叠；文件视图保留原路径命名，自定义目录不改名；搜索匹配中文并展开结果。仅改变展示，不迁移或删改现有文件。新增 verify-writing-navigation.cjs，真实 Electron 验证标签/折叠/搜索/切换及原编辑回归通过。按需创建模板尚待下一步。本轮未发布。— Codex

2026-09-22 轻量新项目：create-project 默认只创建作品概览和首篇正文，小说为 Markdown、剧本为 Fountain；旧完整模板可由 fullTemplate:true 显式请求。每个项目提供按需添加资料选项，固定白名单、逐级实路径校验、排他写入，拒绝已有文件和越界 junction。创建成功打开概览；新增实际 HTTP 与 Electron 新建→添加一份资料的端到端断言通过。既有作品不删减，不改原始资料。本轮未发布。— Codex
