# 工作日志 · 索引与协作规范

复核裁决中影响面小的两条已落地（裁决 4 / 裁决 6）。**裁决 4**：`shell:get-state` 改为 sender-aware，只有设置窗口能拿到 `notifyCommand` 真值，其余给空串 + 不含内容的 `hasNotifyCommand`（动手前先查清消费面：本仓库唯一消费者走已授权的专用 getter、palis 面板的 `ShellState` 根本不声明这个字段，所以零回归风险）。**裁决 6**：`install-update.ps1 -Download` 现在从**同一个 Release** 取 `latest.yml`，缺清单直接拒绝自动安装，交叉校验 tag 与版本、下载到按 tag 命名的独立子目录、下完立即校 sha512+size。验收：`shell-hardening-test` 39→42、`verify-ipc-authz` 扩至 11 项且 **dev 与装机版各跑一次均 IPC_AUTHZ_OK**（预置带秘密的钩子命令，从真实内核页面证实秘密一字不泄露）、外壳侧 Electron 4 项全绿、`main.js` 变动已重打真包重验（asar `d74ca818…`→`d2c94c55…`，8+12+9 全过）。**本轮刻意避开在飞的“项目模板创建 + 库分组导航”那一轮的文件，也没跑 `build:writing`（会覆写对方在改的 `client.js`）**；writing-mode 那几套门禁本轮未跑。未提交、未发布。— ox-alpha，2026-09-22

CXR01 / CXR02 整改完成（按 Codex 2026-09-22 定向复核）：**两项 P1 均已修，并落实裁决 3 第三条**。CXR01：残留锁清扫能把别人刚取得的活锁移走（check-then-rename 无法原子化，把窗口缩到微秒不是互斥保证；revision/etag 是临界区内部的读后比较，兜不了这个底）——现改为**在线一律不移动他人的锁**：`quarantineStaleLock` 需显式 `{offline:true}`、会移动的 `sweepStale*Locks()` 删除改只读、启动只诊断、维护接口 409 拒绝并给出可操作指引；代价是残留锁会卡着那个桶直到手动删除。CXR02：同名稿件（`draft/第一章.md`）被当成同一作品证据——现降级为 `unrelated-filename-hint`、importable 永远 false，证据只剩备忘/可读稿里记过的旧路径；确认框同时显示来源与目的。裁决3：未知持有者不再白等 8s，新增可重试错误码 `lock-owner-unknown`（800ms）。验收：hardening 77→**92 项全过**、新增 `fix-verification.mjs` **CXR_FIX_OK 25 项**、复核探针现停在 `assert.ok(quarantined)`（=修复生效）、Node 19 步 + Electron/根级 9 项全绿、`test:writing-world` 5/5、真包 8+12+9 全过（asar 仍 `d74ca818…`）。**未做**：D04 fixture 未按裁决 1 拆两组（属复核方文件，未动）、裁决 2/4/5/6、原子所有权锁与作品稳定 ID（长期）。未提交、未发布。— ox-alpha，2026-09-22

打包/更新供应链 U1–U5 hunt 与逐一修复完成：**5 项全部实锤复现并全部修复**。最实际的两项：`install-update.ps1` 按 mtime 挑安装包（实测会挑中 0.1.37 而当前是 0.1.41）且**先强杀正在运行的桌面与内核再静默安装**、降级不报；以及发布前零一致性闸门（本机 `dist/latest.yml` 落后 4 个版本，而 `release.ps1` 未认证分支会把上传命令打印给人手工执行）。另：GitHub 更新源 5 处硬编码零校验（现让 `build.ps1` 从 `package.json` 派生）、`killStaleUpdaterInstallers` 裸拼路径进 PowerShell（紧邻 `Stop-Process -Force`）、`build.ps1`/`prepare-runtime.ps1` 里的中文注释违反其自身 ASCII-only 规则（v0.1.31 引入的哑弹）。新增闸门 `npm run verify:release-artifacts`（已接进 build/release）；探针重跑 0/4。**过程中自己引入的 W23 回归被门禁抓到并已修复**（V4 的锁快速失败把“锁刚释放”与“对方正在写入的空锁”误当陈旧锁；新增 `ownerIsProvablyDead()`，清扫/隔离只认 `dead`），`test:writing-hardening` 66 → **77 项全过**，`test:writing-world` 连跑 3/3。未提交、未发布；`dist/` 里任何文件都未删。报告：`docs/audits/release-chain-hardening/2026-09-21/`。— ox-alpha，2026-09-21

前一轮收尾（发版条件）：真包字节核对 **9/9**、隔离冷启动与升级 **12/12**、真包验收 **9/9**（`app.isPackaged` 分支 `SMOKE_OK`），并新增 `verify-ipc-authz.mjs` 在**装机版 exe** 上连 CDP、在真实内核页面里证明 S1 授权闸生效（**IPC_AUTHZ_OK 0 项失败**，带两条防假通过的前置断言）。两个原生确认框仍需人工目检。— ox-alpha，2026-09-21

外壳本体 S1–S6 hunt 与逐一修复完成：**6 项全部实锤复现并全部修复**。最严重一项（P1）：`dshShell` 桥无条件暴露给所有窗口，而 `shell:notify-command` 零确认、零发送方校验就能让主进程 `spawn(任意命令串, {shell:true})` 并每回合重放——内核页面里的第三方插件 client JS 由此穿透 sandbox 拿到本机命令执行（外壳 09-10〔115〕那次 IPC 收口漏掉的口子）。另：plugins-restore 绕过重启确认、钩子占位符未加引号（实测能执行额外命令）、YAML entry id 未校验、revert 端点无体积上限、会话事件流无界搬运。新增 `shell-hardening-test`（39 项）+ `lib/{shell-quote,ndjson-tail}.js`；探针重跑 0/6；隔离 userData 冒烟 `SMOKE_OK`。未提交、未发布；**未在打包版实测**两个新原生确认框。报告：`docs/audits/shell-hardening/2026-09-21/`。— ox-alpha，2026-09-21

V1–V9 / G1–G4 hunt 与逐一修复完成：**13 项缺陷全部实锤复现并全部修复**（含一项 P0：大体积中文正文保存时因逐 chunk UTF-8 解码而静默出现 U+FFFD 乱码，已在 v0.1.36–v0.1.41 发布版里）。新增 `test:writing-hardening`（66 项）与 `git-review.test.js` 的 G1–G4（+14 项）；归档探针重跑 V 0/9、G 0/4；Node 层 17 步门禁 exit 0，Electron 层（含并行修改方 D01–D04 四项）全过。未提交、未发布；真包/冷启动/macOS/离线/真实模型仍未验收。报告与探针：`docs/audits/writing-hardening/2026-09-21/`。— ox-alpha，2026-09-21

世界观整改完成（工程）：A01–A12，完整 21 步门禁及真包 9/9 通过；见 docs/audits/writing-world-settings/2026-09-20/repair/report.md。真实模型五场景等待验收，未发布。— Codex，2026-09-20

> 项目：`dsh-desktop` —— DeepSeek Harness 桌面快捷启动外壳
> 原则：**内核零修改**

本目录的日志体系分三层：

| 文件/目录 | 作用 |
|---|---|
| `logs/YYYY-MM-DD.md` | **每日日志**：一天一个文件，记录当天所有工作细节、坑、产出 |
| `CHANGELOG.md` | **变更历史**：按版本号记录用户可见的增/改/修，带署名 |
| 本文件 | **索引 + 协作规范**（给后续协作者看的入口） |

---

发布完成：**v0.1.40**（2026-09-20），Windows/macOS 五项资产齐全；19 步门禁、真包 9/9 及远端哈希核对通过。详见 `docs/audits/writing-architecture/2026-09-20/release-0.1.40/`。— Codex

世界观下一阶段：执行方案 `docs/plans/writing-world-settings-v1.md`（P0–P5 / W00–W25），策划案 v0.8；仅文档交付，待实施与审查。— Codex，2026-09-20

世界观实施首轮独立复核：**退回整改**；包缺依赖、面板空白、整理未发送及数据保护反例。报告：`docs/audits/writing-world-settings/2026-09-20/review/review.md`。— Codex，2026-09-20

当前最新发布：**v0.1.41**，世界观讨论整理及A01–A12修复已发布；真实模型五类场景、两真实窗口、21步门禁与真包9/9通过。见 `logs/2026-09-21.md` 与世界观 release-0.1.41 验收目录。— Codex

## 现有日志

| 日期 | 文件 | 摘要 | 署名 |
|---|---|---|---|
| 2026-09-22 | [`logs/2026-09-22.md`](logs/2026-09-22.md) | Codex：定向复核交回，新增确定性探针复现 CXR01（锁清扫移走活锁）/ CXR02（同名稿件误判作品关联），旧桶兼容怀疑已排除，并对七项取舍给出裁决；“已有项目接入”在独立副本完成 6 组协议 + 5 组界面测试，未合并。ox-alpha：CXR01/CXR02 整改 + 裁决 3 第三条（`lock-owner-unknown` 可重试快失败），hardening 77→92、新增 `fix-verification.mjs` 25 项，全量门禁与真包重验全绿 | Codex / ox-alpha |
| 2026-09-21 | [`logs/2026-09-21.md`](logs/2026-09-21.md) | ox-alpha：三轮 hunt 与逐一修复共 **24 项**——插件 V1–V9（含 P0：大体积中文正文逐 chunk 解码静默产生 U+FFFD）、Git 审阅层 G1–G4、外壳本体 S1–S6（含 P1：内核页插件 JS 零确认拿到本机命令执行）、发布/更新链 U1–U5；自引入的 W23 回归被门禁抓到并修复。新增三套永久门禁（hardening / shell-hardening / verify-release-artifacts）与装机版 IPC 授权探针；真包字节核对/冷启动/真包验收全过；交接文档 `docs/audits/review-handoff-ox-alpha.md` | ox-alpha |
| 2026-09-20 | [`logs/2026-09-20.md`](logs/2026-09-20.md) | Codex：Markdown 阅读、v0.1.40 发布、世界观方案 v1/策划案 v0.8。ox-alpha：H3/H4 hunt 加固；**世界观 P0–P5 工程实现**（schema2/投影/上下文/客户端整理流）；隔离真包与可见预览；交回 `docs/audits/writing-world-settings/2026-09-20/`（总体 PARTIAL） | Codex / ox-alpha |
| 2026-09-19 | [`logs/2026-09-19.md`](logs/2026-09-19.md) | 独立复核、真实模型三场景及两真实窗口；修复候选来源丢失与 Windows 换行门禁；隔离真包与可见预览，未发布 | Codex |
| 2026-08-13 | [`logs/2026-08-13.md`](logs/2026-08-13.md) | 项目立项→外壳完成→官方鲸鱼图标→快捷方式全链路 | deepseek-v4-pro |
| 2026-08-14 | [`logs/2026-08-14.md`](logs/2026-08-14.md) | 内置 dialog-optimize 插件（折叠/导航/撤回）；补丁三级降级 | deepseek-v4-pro |
| 2026-08-16 | [`logs/2026-08-16.md`](logs/2026-08-16.md) | 启动画面全面重做（深海极光/轨道光环/入场编排）+ 布局回归工具 | deepseek-v4-pro |
| 2026-08-20 | [`logs/2026-08-20.md`](logs/2026-08-20.md) | 内置内核升级 dsh 0.1.0-rc.6 → rc.7（latest），运行时重建 + 冒烟 OK；启动画面二次重做（极简克制 · 单光环：真实进度光环 / 去塑料底板 / 淡出交接）+ `splash-preview` 工具；外壳皮肤系统 + 第二套皮肤「海景 · Seascape」（致敬杉本博司，地平线即进度）+ 托盘皮肤/预览入口 | deepseek-v4-pro |
| 2026-08-21 | [`logs/2026-08-21.md`](logs/2026-08-21.md) | 注入 UI（审阅侧栏/断连浮层）随皮肤统一且不外泄内核页面；修掉两个"失败也报成功"的历史测试；Codex 基准调研落盘 `docs/codex-benchmark.md`；第一批对标迭代（原生菜单+快捷键、多窗口、全局唤起、回合完成通知、深链接）；发现 `dsh-better-sidebar` 与注入侧栏重复，给出后续路线 | deepseek-v4-pro |
| 2026-08-21 | [`logs/2026-08-21.md`](logs/2026-08-21.md)（⑭ 补充） | 内置内核升级 dsh 0.1.0-rc.7 → 0.1.1-rc.1（npm next 预览线）：锁定脚本同步、运行时重建、冒烟 `SMOKE_OK`；已安装版需 dist+安装才生效 | deepseek-v4-pro |
| 2026-08-22 | [`logs/2026-08-22.md`](logs/2026-08-22.md) | v0.1.21–0.1.23 三连发：更新架构加固、坏插件隔离改前置体检、统一原子持久层、插件体检/设置面板、shell-settings 进内核设置面板；extraResources 去重 + 陈旧构建残留清理；PALIS 启动进度条竖排修复、内核拉起固定 --no-open（不再抢开系统浏览器）；发布 v0.1.24（%TEMP% 外置构建 + 配置现场派生）；设置面板接入三皮肤体系（deep/seascape/palis，E2E 截图×4 目检）；dsh-better-sidebar 找回上游（omdsh-dev）切 v0.15.2 主干 + 动效修复移植分支（fork 管理） | deepseek-v4-flash、kimi |
| 2026-08-24 | [`logs/2026-08-24.md`](logs/2026-08-24.md)（〔70〕） | 插件管理开关：设置面板「启用」列升级为按钮式禁用/启用——写 profile cordis.patch.yml 禁用补丁，内核 watchUserPatches 热重载免重启；新增零依赖 lib/plugin-manager（YAML 子集解析 + entryId 提取 + 行级手术，19 项单测）。关键实测：热重载不回退「删补丁」，启用必须显式翻 disabled:false。隔离实例双通道 E2E 全过 | ox-alpha |
| 2026-09-08 | [`logs/2026-09-08.md`](logs/2026-09-08.md)（〔102〕） | 内核 0.1.1→0.1.2-rc.1：Web 一次性 token 鉴权适配（probeReady 认 401 / stdout 捕获 dsh web 行 / kernelApiFetch cookie 舞会 / 重启路径弃 reload）；runtime.tar.gz+marker 置换法（手换 runtime 会被重解包覆盖）；主题插件 settingsNamespace 适配 | kimi |
| 2026-09-09 | [`logs/2026-09-09.md`](logs/2026-09-09.md)（〔103〕） | 内核 0.1.2-rc.1 撤回（A/B 实锤致 palis 球体/月面渲染变形，同主题同外壳换内核即现）；换 runtime 三连 EPERM 事故（测试内核进程占目录）；外壳 0.1.33：ensureExternalRuntime EPERM/EBUSY 降级韧性 + 重启路径 loadURL 修复，内核钉回 0.1.1-rc.1 | kimi |
| 2026-09-10 | [`logs/2026-09-10.md`](logs/2026-09-10.md)（〔104〕） | 内核接触面契约 + 可执行验收套件：contracts/kernel-surface.json（17 条 what/expect/probe/fallback）+ npm run verify:kernel（Hermetic 独立 DSH_HOME，PASS/WARN/FAIL 报告，critical 失败即退出码 1）；首跑 13 通过 0 critical 失败，基线存 contracts/baselines/0.1.1-rc.1.json；CORE_BUNDLES 收成单一来源 ；〔105〕渲染不变量探针：verify-render-invariants.mjs（Hermetic 内核+主题、headless Chrome DPR 2.73 仿真、40 帧几何采样 + LayerTree），四项不变量全绿，verify:kernel --render 一条命令 14 项通过 ；〔106〕官方新内核 0.1.5-rc.1 契约验收：加 --runtime/prepare-candidate-runtime 候选入口，实测外壳 token 链直接兼容（无需改码）、主题需改 2 条输入区选择器、渲染变形回归已修；发现「profile 内核包副本陈旧致升级启动崩」并做成 critical 契约行；修检测器三处缺陷 ；〔107〕主题输入区双写（palis 0.5.8，0.1.5 的 textarea→contenteditable 重构适配，实时 DOM 实测映射）+ 契约锚点 either/or 语义 + 渲染探针新增 composer-theme/--shot；0.1.5 升级只剩插件树刷新一处拦路 ；〔108〕纠正：profile 内核包是指向运行时的符号链接（非陈旧副本），实测「同路径原地 0.1.1→0.1.5」照常启动 → 刷新插件树不需要，契约行降为 warn，候选预览应用独立 DSH_HOME ；〔109〕新增 verify:plugins 插件×内核实测：0.1.5 上 palis(0.4.3)/better-sidebar(0.15.2)/auto-mode(0.1.7) 三处不兼容，去 auto-mode 后三插件干净启动；裁剪白名单改为按实测 import 推导、内置树不带 @deepseek-ai ；〔110〕交付 docs/kernel-upgrade-checklist.md 升级运行手册（何时跟版/四条命令/插件版本矩阵/回滚/安全网）；验证隔离正则可捕获 auto-mode 失败签名；定案：暂不采纳 0.1.5-rc.1、better-sidebar 延后 fork 移植、auto-mode 采纳时移除 ；〔111〕卸载 auto-mode（清单依赖/链接/守卫补丁三处，保守外科式；lockfile 未动）；教训：profile 补丁是否生效要用内核 dump-config 验合成树，写盘成功≠条目存在、已装≠已加载 ；〔112〕auto-mode 移出内置集（builtin-plugins.json 4→3，重建 stage 树验证 manifest 与树内均无它；种子一次性封嘴故既装不受影响） ；〔113〕发布 v0.1.34（内核升级工程化 + 内置集 4→3）；按正确姿势打 tag（v0.1.34 → b3bc0dd）修掉上次 tag 指错的缺陷；Windows 三件套已上传且 sha512 与本地一致；坑：bash 把 node -e 里的反引号当命令替换执行，CHANGELOG 片段被吞（已修正） ；〔114〕三方版本对账与视觉打磨（0.1.35：shell:get-state 补 kernelVersion、palis pin 0.5.13、渲染探针 --eval-file/--shot-sel/--shot-scale/--settle）；〔115〕外壳 IPC 攻击面收口：默认工作区 home→~/dsh-workspace、open-file 改 showItemInFolder、quit/重启/装更新加确认、workspacePath 加 realpath、review-bridge 补回环校验（源码+纯 Node 单测，未 dist——用户在用正式版） ；〔116〕三件套：审阅面板分支徽章+全部暂存/全部丢弃、窗口标题/托盘运行中状态（turn 流驱动）、回合完成外部命令钩子（设置页「通知」+试跑） ；〔117〕内置写作模式插件 writing-mode：shell.overlay 全屏三栏工作台（文档库/专注编辑/AI 助手），~/dsh-writing 文档库 + assist API（llm 缺席 501 降级发送到会话），BUILTIN_PLUGINS 与 extraResources 接线 | ox-alpha |
| 2026-09-10 | [`logs/2026-09-10.md`](logs/2026-09-10.md)（〔118–122〕） | 写作模式 M1b–M4：多库根/门禁/台账/UI/版本/diff/评审；正式版 0.1.36；修 inject 崩内核与扫描去重 | ox-alpha |
| 2026-09-11 | [`logs/2026-09-11.md`](logs/2026-09-11.md)（〔123–135〕） | 写作模式：Hooks/设置/llm/v0.1.37/host 分层/v0.3 文档；接手审计；项目模板、知识与联网资料、P1 回归 | ox-alpha / Codex |
| 2026-09-12 | [`logs/2026-09-12.md`](logs/2026-09-12.md)（〔136–146〕） | 写作伙伴原生会话、v0.1.38 发布；架构分支 Stage A/E（2c97591–cb99ae7）；F/N/T/W 四轮复核返工至 53223df（锁不抢、双 token、墓碑清除、恢复门闩）；cde 25/25 · review-f 10/10 · p1 7/7 | Codex / ox-alpha |
| 2026-09-13 | [`logs/2026-09-13.md`](logs/2026-09-13.md)（〔147–152〕） | 五至九轮复核；1664467 的 X01 通过，UI 32/32、存储 8/8，故障返工收口；原架构与完整验收继续 | Codex / ox-alpha |
| 2026-09-14 | [`logs/2026-09-14.md`](logs/2026-09-14.md)（〔153–155〕及 P1–P4 实施记录） | 整体复评与 v2 方案；P1–P4 实施交回；〔155〕独立复核 95b138d：旧 UI 32/32，通过边界外复现 B01–B08，真实新包缺依赖无法启动，退回修改 | Codex / GPT-6 / ox-alpha |
| 2026-09-15 | [`logs/2026-09-15.md`](logs/2026-09-15.md)（〔156〕） | 整改复核 dcc2c88：旧 11 探针/33 基线/真实包启动通过；新增 N01–N06，安全测试清理、未知创建与迟到采用等仍需返工 | Codex / GPT-6 |

---

## 协作规范（重要，后续协作者必读）

策划案 v0.7（2026-09-20）：世界观能力定稿为 **AI 引导 + 讨论结果整理**（设定条目：标题/结论/说明/边界/来源/状态；说明一小段且默认不注入）；见 [`docs/writing-mode-plan.md`](docs/writing-mode-plan.md) §18 与 `E:\剧本\写作模式-策划案.md`。**未实现**，勿当成已交付功能。同日 hunt 加固亦在工作树未提交。— ox-alpha

v2 整改复核（二）：[`review.md`](docs/audits/writing-architecture/2026-09-14/v2-review2/review.md)，2026-09-15〔156〕。确认 dcc2c88 的旧探针和真包启动通过；N01–N06 仍开放，尤其禁止执行真包测试中按镜像名称关闭所有正式桌面的命令。完整定位、证据和返工顺序见报告。— Codex / GPT-6

v2 交回复核：[`review.md`](docs/audits/writing-architecture/2026-09-14/v2-review/review.md)，2026-09-14〔155〕。95b138d 旧正向 UI 32/32 通过，但新包启动及发送/恢复等路径有实证故障；按 B01–B08 与报告 §4 返工，不能沿用“P1–P4 全部完成”结论。— Codex / GPT-6

下一阶段方案：[`writing-mode-next-execution-v2.md`](docs/plans/writing-mode-next-execution-v2.md)，2026-09-14〔154〕。按 P1→P4 实施，保留既有通过行为，完整工程/预览后交回复核，不自动合并或发布。— Codex / GPT-6

整体复评索引：[`logs/2026-09-14.md`](logs/2026-09-14.md)〔153〕，5a152dc 的已覆盖稳定性与包字节验证通过；原架构完善方案未完成。阶段差距及后续顺序见 [`overall-assessment.md`](docs/audits/writing-architecture/2026-09-14/overall-assessment.md)。— Codex / GPT-6

第九轮审查索引：[`logs/2026-09-13.md`](logs/2026-09-13.md)〔152〕，1664467 的 X01 正向通过；UI 32/32、存储/并发 8/8，当前故障返工收口。通过边界及原方案剩余工作见 [`review9.md`](docs/audits/writing-architecture/2026-09-13/review9.md)。— Codex / GPT-6

第八轮审查索引：[`logs/2026-09-13.md`](logs/2026-09-13.md)〔151〕，c88705f 的 V01 故障提示与重试通过；最终 UI 仍有旧错误残留 X01。见 [`review8.md`](docs/audits/writing-architecture/2026-09-13/review8.md)。— Codex / GPT-6

第七轮审查索引：[`logs/2026-09-13.md`](logs/2026-09-13.md)〔150〕，a58b3c7 的 S01/S03 和恢复 409 通过；S02 保存错误状态仍有 V01 残留。证据及下轮清单见 [`review7.md`](docs/audits/writing-architecture/2026-09-13/review7.md)。— Codex / GPT-6

第六轮审查索引：[`logs/2026-09-13.md`](logs/2026-09-13.md)〔149〕，985851e 的 R01–R03 原场景通过；新增冲突解决分支 S01–S03 仍退回。证据及下轮任务见 [`review6.md`](docs/audits/writing-architecture/2026-09-13/review6.md)。— Codex / GPT-6

第五轮审查索引：[`logs/2026-09-13.md`](logs/2026-09-13.md)〔147〕，53223df 复核；W01/W03 及 W02 常规时序通过，恢复与冲突分支 R01–R03 仍退回。报告与修订任务见 [`review5.md`](docs/audits/writing-architecture/2026-09-13/review5.md)。— Codex / GPT-6

第四轮审查索引：[`logs/2026-09-12.md`](logs/2026-09-12.md)〔145〕，606f21f 复核仍退回；锁空档与草稿版本协议 W01–W03 见 [`review4.md`](docs/audits/writing-architecture/2026-09-12/review4.md)。修复提交至 `53223df`（不抢锁 / 执行时 baseRev / 墓碑清除 / 恢复门闩），待第五轮复核。— ox-alpha

第三轮审查索引：[`logs/2026-09-12.md`](logs/2026-09-12.md)〔144〕，b66d194 复核；N01–N03 原场景通过，T01–T03 仍丢数据，报告见 [`review3.md`](docs/audits/writing-architecture/2026-09-12/review3.md)。— Codex / GPT-6

第二轮审查索引：[`logs/2026-09-12.md`](logs/2026-09-12.md)〔143〕，6ee2539/ca57547 修复复核，部分通过但仍退回；报告见 [`review2.md`](docs/audits/writing-architecture/2026-09-12/review2.md)，明确已通过范围及 N01–N07。— Codex / GPT-6

最新审查索引：[`logs/2026-09-12.md`](logs/2026-09-12.md)〔142〕，写作架构分支 cb99ae7 独立复核，**退回修改**；报告及执行 agent 修订任务见 [`review.md`](docs/audits/writing-architecture/2026-09-12/review.md)。— Codex / GPT-6

**任何人类或 agent 在本工作目录中推进、修改、补充本项目时，必须同时完成日志记录并署名。** 具体：

1. **记当日日志**
   - 当天还没有文件 → 新建 `logs/YYYY-MM-DD.md`（按下面的模板）
   - 已有当天文件 → 在文末**追加**条目，不要覆盖他人记录
   - 记录内容：做了什么、改了哪些文件、结果如何、踩了什么坑

2. **更新变更历史**
   - 产生了「用户可见」的变更（新功能 / 行为变化 / 修复）→ 同步更新 `CHANGELOG.md`
   - 归属到对应版本：新改动放 `## [Unreleased]`；发版时再定版本号并补日期

3. **署名**
   - 每条日志与每条 changelog 记录末尾写：`— 署名：<你的标识>`（agent 用 agent id / 模型名，人类用姓名）
   - 标识要稳定，便于追溯「这段是谁做的」

4. **尽量只增不改**：不篡改他人已写的历史条目；有不同意见用「补充」新条目说明。

5. **运行与测试安全（详见 `AGENTS.md`）**：
   - **禁止擅自杀掉正在运行的进程**（`DeepSeek Harness Desktop` / `electron`）——用户可能正在用，窗口会瞬间消失被误认为"闪退"；需清理时先征得用户同意。
   - 冒烟用 `npm run smoke`；涉及打包分支（`app.isPackaged`）的改动必须实测打包版。

---

### 每日日志条目模板

```markdown
## <时间或阶段标题>

- **做了什么**：
- **改动文件**：`path`
- **结果**：
- **坑 / 备注**：（可选）

— 署名：<标识>
```

### 变更历史条目模板

```markdown
## [<版本号>] - <YYYY-MM-DD>
### 新增
- ...
### 修复
- ...
### 署名
- <标识>（<YYYY-MM-DD>）
```

## 补充索引 · 写作模式接手评估

- 2026-09-11〔132〕：[严格评估与 12 项复现证据](docs/audits/writing-mode-2026-09-11/评估.md)；原有未提交 host 分层/打包改动与已发 v0.1.37 分开记录。— 署名：Codex / GPT-6

2026-09-22：CXR01/CXR02 独立正向复验 25 项通过；已有项目接入已整合，D04 两条分支与 V7 延迟/失败/卸载均有真实 Electron 正向测试。最新整合验收见 docs/audits/writing-world-settings/2026-09-22/integration.md，覆盖此前“尚未整合/未补探针”的时点说明；未提交、未发布。— Codex

2026-09-22：用户授权提交并发布 v0.1.42；已有项目接入与审计整改进入本次发布候选。按同一 Release ID 合并 Windows/macOS 资产，最终结果另记。— Codex

2026-09-22：v0.1.42 已公开为 Latest，Release ID 393502728，代码 ac00c15。Windows 安装器/blockmap/latest.yml 与 macOS DMG/latest-mac.yml 五项资产全部 uploaded，size/SHA256 与两份清单 SHA512 一致；macOS CI 35695937072 成功。Windows 真包 9/9，NSIS 实际载荷冷启动 SMOKE_OK。未替换本机正式安装，预览保持运行。证据 docs/audits/release-0.1.42/。— Codex

2026-09-22 轻量新项目：create-project 默认只创建作品概览和首篇正文，小说为 Markdown、剧本为 Fountain；旧完整模板可由 fullTemplate:true 显式请求。每个项目提供按需添加资料选项，固定白名单、逐级实路径校验、排他写入，拒绝已有文件和越界 junction。创建成功打开概览；新增实际 HTTP 与 Electron 新建→添加一份资料的端到端断言通过。既有作品不删减，不改原始资料。本轮未发布。— Codex
