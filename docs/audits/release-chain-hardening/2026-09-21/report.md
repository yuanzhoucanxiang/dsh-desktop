# 打包 / 更新供应链审查报告（2026-09-21）

署名：ox-alpha ｜ 范围：`build.ps1` / `release.ps1` / `prepare-runtime.ps1` / `install-update.ps1` /
`gen-update-manifest.js` / `main.js` 的更新源与更新器缓存逻辑。
不含插件层（见 [`../../writing-hardening/2026-09-21/report.md`](../../writing-hardening/2026-09-21/report.md)）
与外壳 IPC 面（见 [`../../shell-hardening/2026-09-21/report.md`](../../shell-hardening/2026-09-21/report.md)）。

结论：**5 项缺陷全部实锤复现，5 项全部修复**。其中 U1–U4 由可复跑探针取证（重跑 **0/4 复现**）；
U5（.ps1 非 ASCII 哑弹）由字节级检查取证（修复后四个文件均 0 非 ASCII 字节、解析器 0 错误）。
新增永久闸门 `scripts/verify-release-artifacts.mjs`（`npm run verify:release-artifacts`），已接进 `build.ps1` 与 `release.ps1`。
过程中**自己引入过一次回归（W23）并被门禁抓到、已修复并加 11 条断言钉住**。
未提交、未推送、未发布、未删除 `dist/` 里任何文件。

- 复现取证：[`hunt-release.mjs`](hunt-release.mjs)（覆盖 U1–U4，**全程只读**，不构建/不安装/不上传/不改 dist）
- 永久闸门：`scripts/verify-release-artifacts.mjs`

## 一、威胁模型

这条链上没有远程攻击者：更新源不可由渲染侧改写（见 §三"查过判定干净的"）。真正的风险来自
**发布/维护流程自己**——脚本会在无人复核的情况下做出错误选择，而它的动作是"强杀正在运行的应用
然后静默安装"或"把清单推给全量自动更新客户端"。所以判据是：**脚本会不会在陈旧/不一致的输入上
做出不可逆动作，且事后不报警**。

## 二、缺陷与修复

| # | 级别 | 缺陷 | 实证 | 修复 |
|---|---|---|---|---|
| U1 | P2 | `install-update.ps1` 无参数时按 **LastWriteTime** 挑安装包，不解析版本、不校验 sha512、无降级防护；而它动作前会**强杀正在运行的桌面与内核** | 本机 `dist/` + `~/Downloads` 共 20 个候选，脚本会挑中 `dsh-desktop-0.1.37-setup.exe`，而 `package.json` 是 **0.1.41**——即静默装一个落后 4 个版本的包。事后只在"版本没变"时给 WARNING，**降级不报** | ① 改为按解析出的版本降序选包，名字解析不出的候选直接跳过；② 若安装包旁有 `latest.yml`，校验 version + sha512（base64）+ size，不符即拒装；③ 比已安装版本旧时**默认拒绝**，需显式 `-Force`。三项检查全部放在**杀进程之前** |
| U2 | P3 | `killStaleUpdaterInstallers()` 把 `LOCALAPPDATA` 派生的路径**裸拼进 PowerShell 单引号串**，紧邻的就是 `Stop-Process -Force` 管道 | 路径含单引号（如 `C:\Users\o'brien\…`）时拼出的命令串单引号数为 **5（奇数=字符串未闭合）**，后续内容被当代码解析。可控性有限（需能控制启动外壳的父进程环境），但没理由留着这个形态 | 改为经 `$env:DSH_UPDATER_DIR` 传值，**完全不做字符串拼接**；并在 Where-Object 里加 `$env:DSH_UPDATER_DIR` 非空判断，避免变量缺失时 `StartsWith($null)` 匹配一切 |
| U3 | P3 | GitHub owner/repo 在 **5 处**各自硬编码（`package.json build.publish`、`main.js DEFAULT_UPDATE_REPO`、`build.ps1` 的 `app-update.yml` heredoc、`release.ps1`、`install-update.ps1`），而 `updaterCacheDirName` 同样散在 **3 处**；**无任何一致性校验** | 当前 5 处取值完全一致——但纯属巧合：改任一处都不会有任何检查报错。`build.ps1` 的 `app-update.yml` 是手写 heredoc，而 `--dir` + `--prepackaged` 两步流程不会自动生成它，所以它**不会跟着 `package.json` 走**。漂移后果：装机版去另一个仓库查更新，或漏杀僵尸安装器/清错缓存目录 | ① `build.ps1` 改为**从 `package.json build.publish` 派生** owner/repo（消除一处硬编码，其余四处保留但受检）；② 闸门比对全部来源，含 `--dir` 指定的**解包产物里真正生效的 `resources/app-update.yml`**；③ `updaterCacheDirName` 三处一并比对 |
| U4 | P2（发布路径） | 发布前**没有任何**「`latest.yml` ↔ `package.json` ↔ 安装包 ↔ blockmap」一致性校验，而 `release.ps1` 在未认证分支会把 `gh release upload` 命令**打印出来让人手工执行** | 本机 `dist/latest.yml` 是 **0.1.37**（`package.json` = 0.1.41），清单自身自洽（sha512/size 与 0.1.37 的 exe 实算一致），但整份指向 4 个版本前的构建。若被手工发上去 → 全量自动更新客户端被指向旧版本，或该资产不在 release 里时更新检查 404。另有 2 个孤儿 blockmap、遗留 `win-unpacked.tmp`、20 个历史安装包共 3.9 GB | 新增 `scripts/verify-release-artifacts.mjs`，接进 `build.ps1` 步骤 5b（`gen-update-manifest` 之后）与 `release.ps1` 步骤 1b（上传之前）。硬失败项：版本不符、path/url 不指向本轮安装包、exe 缺失、**sha512/size 与实算不符**、本轮 blockmap 缺失、owner/repo 或缓存目录名漂移、.ps1 非 ASCII/不可解析。卫生问题（孤儿 blockmap、遗留 .tmp、历史包堆积）只**警告**不失败——把它们当硬门禁会让 `npm run dist` 在无关的陈旧文件上挂掉 |
| U5 | P3（哑弹） | `build.ps1` 有 **2 行中文注释**、`prepare-runtime.ps1` 有 **1 行**，而这两个文件的头部（或同类文件的头部）都明文要求 ASCII-only，并记下过真实事故 | `build.ps1` 头部原话："Windows PowerShell 5.1 reads a .ps1 without a UTF-8 BOM as ANSI/GBK. Non-ASCII comments then decode as double-byte chars that can swallow the line ending and break the parser… **This actually bit us**: adding Chinese comments here produced 'Unexpected token' and the build died." 那两行是 **v0.1.31（commit `31f5943`）** 引入的，至今**碰巧**能解析（语法错误 0），正是头部描述的那颗哑弹 | 两行/一行全部改写为 ASCII，并给 `prepare-runtime.ps1` 补上它此前缺失的 ASCII-only 声明。闸门对 `build.ps1` / `release.ps1` / `install-update.ps1` / `prepare-runtime.ps1` 四个文件断言：① 零非 ASCII 字节；② 能被 `System.Management.Automation.Language.Parser` 解析（**只解析不执行**） |

## 三、验收

```
node docs/audits/release-chain-hardening/2026-09-21/hunt-release.mjs   →  复现 0 / 4（U1–U4）
npm run verify:release-artifacts -- --allow-stale                     →  RELEASE_ARTIFACTS_OK（exit 0）
npm run verify:release-artifacts                                      →  exit 1，如实报告 dist/latest.yml 落后 4 个版本
npm run test:writing-hardening                                        →  HARDENING_OK 77 passed, 0 failed（原 66，+11）
全量 Node 门禁 20 步                                                   →  非零 1 步（= 上面那条如实报告）
test:writing-world 连跑 3 次                                           →  3/3 exit 0（W23 回归已修）
```

四个 .ps1 均：ASCII 字节 0、PowerShell 解析器语法错误 0。

**开发态 vs 发布态的口径**：`verify:release-artifacts` 默认严格，会因本地 `dist/latest.yml` 陈旧而 exit 1——
这是**闸门在履职**，不是闸门坏了。日常回归请加 `--allow-stale`；`build.ps1` 里它是紧跟
`gen-update-manifest.js` 之后跑的，那时清单必然是本轮的，所以不会误伤真实构建。

## 四、我自己引入并修复的回归（W23）

值得单独记，因为它是**门禁抓到的**，而且根因是我上一轮 V4 改动的连带伤害。

- **现象**：`test:writing-world` 间歇性非零。逐段定位到 `world-settings-p3.mjs` 的
  `FAIL W23 live lock not stolen`，错误码是 `lock-stale`（断言只接受 `lock-timeout` / `lock-failed` / `null`）。
  连跑 3 次：1 红 2 绿。
- **根因**：V4 我把"陈旧锁快速失败"从等满 8s 收到 250–400ms，但沿用了 `!isOwnerAlive(owner)` 判死。
  而"读不出持有者"其实有**三种**完全不同的成因，被我压成了一种：
  ① 锁文件刚被释放（不存在）→ 正确动作是**立即重试获取**；
  ② 对方已 `openSync('wx')` 但还没 `writeSync`（文件存在但为空）→ 它是**活锁**；
  ③ 令牌可解析且 PID 已消失 → 才是陈旧锁。
  W23 的子进程持锁 2.5s 后 `unlink`，父进程若正好在 `tryAcquire()` 拿到 EEXIST 之后、
  `readLockOwner()` 之前撞上这次 unlink，就读到 `''` → 判死 → 400ms 阈值早已过 → 抛 `lock-stale`。
  **旧代码同样有这个误判，但陈旧分支要等满 8s，下一轮 `tryAcquire()` 就成功了，所以从没暴露。**
  我把 deadline 改短，等于把一颗一直存在的哑弹点了火。
- **修复**：新增 `ownerIsProvablyDead(owner)`——必须能解析出 PID **且**该 PID 确实不存在才算死；
  获取循环里先判 `!fs.existsSync(lock) → continue`（锁没了就立刻重试，绝不报 stale）；
  读不出持有者一律按**活锁预算**等（宁可等满 deadline 报 `lock-timeout`，也不把未知当死亡）。
  `inspectLock()` 增加 `dead` 字段；`quarantineStaleLock()` 与两处启动清扫
  （`sweepStaleDraftLocks` / `sweepStaleCoordinationLocks`）改为**只认 `dead`**——
  否则空锁文件（对方正在写入）会被改名隔离，那是真正会丢数据的路径。
- **钉住**：`hardening-v1-v9.mjs` 加 11 条断言，含真子进程持锁→unlink 的并发复现（6 轮，
  要求 `lock-stale` 计数为 0）。`world-settings-p3.mjs` 连跑 6 次 W23 全绿。

## 五、查过判定干净的（不报，避免噪音）

1. **更新源不可由渲染侧改写**：`settings.updateRepo` / `updateUrl` **没有任何 IPC 通道**。
   渲染侧能写的只有 `panelWidth`（夹取 320–800）与 `notifyCommand`（已按 S1 做发送方授权 + 原生确认），
   其余设置项全部走托盘/菜单的原生 UI。所以改更新源需要本机磁盘或环境变量访问权——那是已沦陷前提。
2. **`release.ps1` 的发布目标不可被配置重定向**：`$owner` / `$repo` 硬编码在脚本里，不读 settings。
3. **更新说明不构成 XSS**：`renderUpdateNotes()` 对标题与条目全部过 `esc()`，且**不生成任何 href**，
   所以"feed 可控文本 → 设置窗口 XSS → 借用 S1 信任的发送方身份"这条链不成立。
   （这条特意查过：设置窗口现在是 S1 授权闸信任的发送方，它若被 XSS 就是 RCE。）
4. **`gen-update-manifest.js` 的哈希口径正确**：`sha512` 为整个安装包的 base64、`size` 为实际字节，
   与 electron-builder 官方格式一致；日志走 stderr（该文件注释记录了 2026-08-25 那次
   "stdout 日志覆盖刚写好的 latest.yml"的实故，已修好且没回退）。
5. **`build.ps1` 的 `$LASTEXITCODE` 纪律完好**：每个 native 步骤后都显式检查（该文件注释记录过
   "NSIS 失败后继续打印 BUILD_DONE 并留下上一版安装包"的实故）；NSIS 前先删同版本安装包，
   产物不存在直接 throw。我在其后新增的 5b 也遵循同一纪律。
6. **`install-update.ps1` 的进程清理范围克制**：只结束安装目录下的 `node.exe`
   （`ExecutablePath.StartsWith(installDir)`）与更新器缓存目录下的安装器，不按镜像名批量杀；
   与 `AGENTS.md`「禁止擅自杀正在运行的桌面/内核」一致。`Stop-StuckInstallers` 的范围判定与
   我在 U2 里改的 main.js 版本同源。

## 六、残留局限（如实标注，不冒充已解决）

1. **`updateFeed()` 对 generic 源不校验协议**：`settings.updateUrl` 若填 `http://`，
   则 `latest.yml` 与安装包同源、sha512 也由攻击者提供，MITM 可换成任意安装包。
   当前不可由渲染侧设置（见 §五.1），故本轮**未改**——但这是"如果将来把这个覆盖项做进设置界面，
   必须先强制 https"的明确前置条件。同理 `repo.split('/')` 对 `a/b/c` 会静默丢掉第三段。
2. **`dist/` 的 3.9 GB 陈旧产物我一个都没删**（20 个历史安装包、2 个孤儿 blockmap、
   遗留 `win-unpacked.tmp`、0.1.37 的 `latest.yml`）。删除是破坏性动作且这些文件不归我，
   闸门现在会把它们**警告**出来。要清的话建议：`dist/` 已被 `.gitignore`（git 跟踪 0 个文件），
   删掉不影响仓库；或直接跑一次 `npm run dist` 让 `latest.yml` 刷新到 0.1.41。
3. **`dist/latest.yml` 陈旧这件事本身没被"修好"**，只是被闸门挡住了。它在本地工作区，
   不随仓库分发，所以不影响已发布版本的用户。
4. **NSIS 安装向导 / 注册表 / macOS 实机 / 受控离线 / 真实模型场景仍未验收**。
   本轮所有真包验收都是 **dir 目标**（不签名、不发布），没有跑过 `build.ps1` 的 NSIS 步骤，
   因此 `app-update.yml` 的派生逻辑与 5b 闸门**只在源码与 dir 包上验过，未在 NSIS 全流程里跑过**。
5. **`install-update.ps1` 的 sha512 校验依赖"安装包旁边有 `latest.yml`"**：从 GitHub 直接
   `-Download` 下来的包落在 `%TEMP%`，那里没有清单，此时只提示"skipping hash verification"而不失败。
   要闭环就得同时下载 release 里的 `latest.yml` 再比对——本轮未做。
6. **闸门里的 PowerShell 解析检查只在 win32 上跑**（这几个脚本本就是 Windows 专用）；
   macOS 的 `build-macos.sh` / `update-macos.sh` **未纳入本轮审查范围**。

## 七、本轮改动文件

新增：
- `scripts/verify-release-artifacts.mjs`（一致性闸门，`npm run verify:release-artifacts`）
- `docs/audits/release-chain-hardening/2026-09-21/{report.md, hunt-release.mjs}`

修改：
- `install-update.ps1`（U1：`Get-PackageVersion` / `Compare-PackageVersion` / `Test-InstallerManifest` / 降级防护 + `-Force`）
- `main.js`（U2：`killStaleUpdaterInstallers` 改走 `$env:`）
- `build.ps1`（U3：`app-update.yml` 从 `package.json` 派生；U4：新增步骤 5b；U5：两行中文注释改 ASCII）
- `release.ps1`（U4：新增步骤 1b，上传前校验）
- `prepare-runtime.ps1`（U5：一行中文注释改 ASCII + 补 ASCII-only 声明）
- `package.json`（新增 `verify:release-artifacts` 脚本入口）
- `plugin/writing-mode/lib/file-lock.js`（W23 回归修复：`ownerIsProvablyDead` / `inspectLock().dead` / 锁消失即重试）
- `plugin/writing-mode/lib/{draft-checkpoints,coordination}.js`（清扫只认 `dead`）
- `plugin/writing-mode/test/hardening-v1-v9.mjs`（+11 条 V4/W23 回归断言，66 → 77）
