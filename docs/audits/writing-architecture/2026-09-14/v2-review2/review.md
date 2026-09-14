# 写作模式 v2 整改复核（二）：旧探针通过，仍有六项缺口

收口日期：2026-09-15（跨日复核，证据目录沿用开工日期 2026-09-14）。被审代码 `b44c1c9`，交回 HEAD `dcc2c88075fabe5bdf9a0f46d5863112ad2a0c36`。

**结论：确认本次修复有效，上一轮 11 个探针全部通过，新包启动故障已消除；仍需修复 N01–N06，暂不通过完整工程验收。** C01 的 app 拆分按实施者本次明确声明保留 PARTIAL，不要求把它伪装成完成，也不把外部条件未具备的真实模型/macOS 验收算作本轮代码错误。

本轮没有修改生产代码，没有合并、提交、推送或发布。开工时 `v2-review/probes-results.json` 已有未提交改动，保留未覆盖；所有重跑输出另存本目录。新旧探针中相同的 B/N 编号只在各自审查目录内有效。

## 1. 已确认通过的部分

| 项目 | 独立复跑结果 | 范围 |
| --- | --- | --- |
| 上轮 Node 7 条 | **7/7 PASS** | 旧历史前缀、已知 sessionId 恢复、子目录 junction、`..` 清理、引用指纹/旧引用、Unicode 预算 |
| 上轮 UI 4 条 | **4/4 PASS** | 正常采用保留副本/清空引用、备忘失败不发送、旧历史前缀不再导致拒绝清稿 |
| 旧正向基线及 v2 业务预期 | **33/33 PASS** | 原 32 条中的备忘失败预期调整，再增加显式不参考发送。实际输出是 33 条，不是 32 条 |
| `verify:writing-build` | PASS | 当前 client.js 与源构建一致，未覆盖构建产物 |
| `verify:writing-architecture` | PASS | 包括 R7 敏感性自检；不等于 app 职责已完全拆开 |
| `verify:writing-adapter` | **18 + 13 PASS** | 实施者已有 host/adapter 场景 |
| `test:writing-p3` | **17 PASS** | 既有记忆、引用和上下文用例 |
| 实际包启动 | **SMOKE_OK，exit 0** | TEMP 新包，四路径隔离；`pluginSyncPresent:true` |
| 包资源 | **9 个外壳模块逐字节一致；15 个插件文件一致** | 独立读取 app.asar 并做 SHA256 比对；见 verification.json |
| 实际包主题冒烟 | **exit 0，UI_SMOKE_OK × 2** | 使用安全的 `verify-ui-smoke.mjs` 与 WM_UI_EXE；人工调用生产种子模块后验证开启/关闭；不把它说成首启自动种子验证 |

新包位置：`%TEMP%/wm-v2-rebuild-0.1.38/win-unpacked/`。app.asar SHA256 为 `67dd0e90a6c2a92abf635c5f8e94a026614bdfe5a8ed14661452053058349e74`。

B01（漏模块导致启动失败）、B04（备忘失败等待作者选择）、B08 的旧两个探针及 C02 的 Unicode 码点预算可以关闭**已覆盖的故障路径**。B02/B03/B05/B06 的原探针通过，但相邻生命周期仍有问题，见下面 N02–N05。

## 2. N01 · P1：新门禁会结束用户正在使用的正式桌面

位置：`scripts/verify-writing-packaged.mjs:70–72`，已被 `package.json` 的 `verify:writing-all` 串入。

```javascript
for (const killArgs of [['/IM', 'DeepSeek Harness Desktop.exe', '/F']]) {
  spawnSync('taskkill', killArgs, { stdio: 'ignore' })
}
```

这按镜像名称强制结束所有同名进程，与本次测试的 PID、路径、userData 无关。即使前面 `app.kill()` 已关闭测试父进程，后面仍会关闭用户正式桌面；它也不能按注释所说精确清理本测试的内核子进程。这直接违反工作区和仓库 AGENTS.md 的“不擅自关闭用户桌面”规则。

**本轮仅静态确认，没有执行这条命令，也没有执行包含它的完整 `verify:writing-all`。** 验包改用只控制本轮子进程的探针及安全主题入口。

修复：删除按名称清理，给自动种子验收提供受控退出钩子/握手；仅处理本轮创建的进程和可证明归属的子进程。预览窗口不应成为自动清理对象。增加隔离的清理选择测试，证明另一个同名应用不属于清理集合，不用用户正式进程做破坏性试验。

## 3. N02 · P1：未知 sessionId 的 uncertain 仍被当成“没有会话”重建

位置：`plugin/writing-mode/src/client/adapters/harness/adapter.js:471–515`。

上轮探针验证的是“会话已知，只是确认失败”。新 recover 修好了这个分支，但 `knownSession === null` 不能证明会话未创建。当前逻辑在不满足已知存活会话、也不是其他 token 的 creating 时，直接 forget + connect；uncertain 的创建回包丢失正好落入这里。

本轮用真实 host 协调模块复现：sessions.create 在模拟原生端真实增加 s1 后抛“回包丢失”；adapter 保留 workspace w1、状态 uncertain、sessionId null。作者点继续关联，结果又创建 w2/s2，状态 ready；原生对象数为 **2 个 workspace、2 个 session**，s1 仍存在。

修复：把“已证实删除”和“结果未知”分开。根据已知 workspace/原生列表恢复查找，不能可靠确认时继续保留 uncertain，给查看/选择关联入口；普通“继续关联”不得遗忘可能成功的创建。reserved、creating、uncertain 的判断也要覆盖当前 token、旧 token 和窗口重开，不只等对端的一个 creating 分支。

验收：保留已有 sessionId 的原探针；增加已创建但回包丢失、窗口重开、同 token 重试、对端仍创建四类场景。不能靠“作者点过继续”替代判断外部操作是否发生。

证据：`edge-results.json` 的 N02；实际 `creates=2`、`liveIds=[s1,s2]`。

## 4. N03 · P1：采用等待期间的新编辑被迟到操作覆盖，备份里也没有

位置：`plugin/writing-mode/src/client/features/companion/index.js:521–531`。

采用现在会先 await stash，这是正确方向；但等待期间输入仍可编辑。成功回调没有检查编辑代数、组件存活或项目操作 token，随后直接 updateDraft(c.text)。stash 保存的是点击时的旧快照，不能保护 await 期间的新输入。

真实 React + 当前 client.js + HTTP host 复现顺序：

1. 当前稿为 `ORIGINAL_BEFORE_ADOPT`，点击采用另一窗口候选。
2. 真备份 POST 已落盘，暂扣它的响应。
3. 作者继续输入 `NEW_AUTHOR_EDIT_DURING_ADOPT`，并确认这份新稿已保存到当前 checkpoint。
4. 放回旧备份响应：界面及当前 checkpoint 被替换成候选；备份只有 ORIGINAL，所有候选中都没有 NEW。

修复：采用操作绑定项目/代数，异步返回时核对当前完整快照。若有新编辑，应取消这次迟到采用并保留新稿，或先保存新的完整恢复副本后再由作者决定；不要让旧操作悄悄替换新稿。text/reference 的采用应作为一个 store 操作完成，并覆盖组件卸载/切项目、连续点击、仅引用变化、备份失败。

证据：`adopt-race-results.json`，测试 exit 1。静态正常路径的 B06 两条 PASS 保留，不推翻它们。

## 5. N04 · P1：新的别处消息仍能替本轮拒绝“证明已受理”

位置：`plugin/writing-mode/src/client/adapters/harness/projection.js:103`、`adapter.js:426`。

发送前基线解决了旧节点问题，但匹配仍是 `t === want || t.startsWith(want) || t.includes(want)`，并仍允许 evidence 把明确 `ok:false` 改为 accepted。作者发短句时，其他窗口的新消息、已排队回合转入历史等并发变化可能满足包含关系，而非本轮请求。

本轮最小复现：本轮发送“继续”；等待期间原生新增另一条“不要继续旧方案，我们重新讨论人物动机。”；本轮返回 busy/ok:false。adapter 仍返回 **accepted/new-user-node**。UI 对 accepted 的清稿逻辑未变，因而这一误判仍可能触发清除。

修复：明确拒绝不凭文本包含关系翻案。对受理不确定路径，使用内核可证明关联的 request/turn/queue 标识和发送前状态，识别队列转历史；没有可靠关联就保留 uncertain 和正文。改成完整文本相等可消除本探针，但仍不能证明两个窗口同时发相同正文时是哪一轮，不能仅以换匹配运算符收口。

证据：`edge-results.json` N04（adapter 级；本轮未再次重复 UI 清稿探针）。

## 6. N05 · P1：目标插件根本身是 junction 时仍会改写目录外数据

位置：`lib/plugin-sync.js:209`、`:230`。

子目录 junction 已被拒绝，但代码先把 destDir 的 realpath 直接作为可信根。如果 **destDir 本身** 指向外部目录，那么所有落在外部目录里的写入反而都被判定为“在根内”。这也与本模块新增注释“目标本身是 reparse point 一律拒绝”不符。

TEMP 复现：profile-plugin 是到 outside 的 junction；outside/note.js 初始 `AUTHOR ORIGINAL`，同步后变成 `PLUGIN CONTENT`，返回 ok:true。未对真实 profile 做试验。

修复：建立不由目标链接自定义的可信 profile 边界；在进入同步前核对插件根及必要祖先的归属/reparse 状态。继续保留子目录 realpath 检查；不能只检查 rootReal 之下的后代。缺失目标根也应使用可信父级锚点，不能因 realRoot 返回 null 跳过校验。源/目标根和受管记录的处理策略应一致。

证据：`edge-results.json` N05。上轮 `lib/` 子目录 junction 与 `../` 记录两条 PASS 均保留。

## 7. N06 · P2：正式门禁仍可跳过必做项并成功，矩阵状态仍偏高

位置：`scripts/verify-writing-packaged.mjs:11–15`、`scripts/verify-writing-package.mjs:229–240`、`v2/acceptance.md`。

- 独立令 WM_PKG 指向不存在的 TEMP 路径，真包门禁输出“待跑”并 **exit 0**。该入口已经串进 verify:writing-all，因此没有测试包也能通过这一必做步骤。这与上轮 B07 的严格工程门禁要求相反。
- 矩阵确实补齐了 30 个 ID，删除了自造状态，但 A02 离线加载、M03 移动、H01/D04 真双窗口、C03 压缩续聊等未测子项仍整行 PASS。应按覆盖范围标 PARTIAL，并在说明中保留已通过子项。完整文本/代码的事实依据测试不等于真实模型遵循数据边界的证明。
- `verify-writing-coldstart.mjs` 本轮没有修改，上轮指出的 checkpoint 仅声明未落盘、配置库根与备忘 fixture 未接通仍在。普通 E2E 的新环境保存成功不能代替旧环境升级后数据可发现/可恢复的断言，P01 不能以此收口。
- app.asar 检查补了存在性，但源码绝对路径检查仅对 main.js 匹配 `/E:\\+Deepseek/`；不是对所有模块、所有仓库路径写法的依赖闭包验证。主进程模块也只验存在，未逐字节比对；**本轮额外独立比对 9 文件确实相等**，但不能据此说正式门禁已有该保障。
- 原探针输出仍硬编码被审 SHA 95b138d。报告引用这份输出时容易误归因；正式入口应运行时记录被测源码 SHA/dirty/产物 hash，不能只把当前 git HEAD 当旧包身份。

修复：区分快速开发回归和严格工程交付门禁；严格模式缺包/必做工程项待跑必须非零退出，并聚合实际结果、覆盖范围和被测产物身份。矩阵按子场景真实归类，不要仅把限制移到另一个单元格。把升级 fixture 真正接到旧配置/草稿路径，通过生产读取和继续保存验证；不需要复制真实用户资料或密钥。

证据：`verification.json`（30 行、缺包 exit 0）；其余为上述已定位代码及矩阵静态检查。

## 8. C01/C02 和交付边界

- **C01**：保留 PARTIAL。主 app 仍约 1.5k 行的事实已经诚实披露；后续组件拆分单独推进，不和上述故障修复混成一次大重构。
- **C02**：Unicode 计量及普通事实/偏好排除已修。另有面板一致性细节尚需补：待定问题复选框默认 checked（`!excluded.includes(id)`），但未 pinned 时 selectMemory 不采用；取消再勾选只操作 excluded，也不会选择该问题。另一个小错误是面板读取 `memoryPreview.omittedCount`，而 selectMemory 返回 selected/omissions/charsUsed，不含该字段，预算省略总数提示不会出现。保留“选择”和“优先”两种独立语义，补真实请求对照 UI 的用例。
- 当前正式包 B01 的启动问题已关闭；本轮安全主题冒烟通过，但未执行带全局 taskkill 的“首启自动种子”步骤，不认可它提供了不干扰用户的测试保证。
- 没有跑 NSIS 安装、macOS、受限网络、真实模型三场景、真实双窗口或作品移动。本轮不自动发布。
- 预览 PID 32208/90764 在开工时可见，跨日继续后的最新查询已找不到，不宣称它们交回时仍在运行。本轮没有关闭任何一个用户预览。

## 9. 建议下一轮交回方式

1. 先修 N01，保证所有一键入口可安全运行，不触及别的实例。
2. 用完整生命周期修 N02/N03/N04：未知外部结果不重做、迟到操作不覆盖新编辑、只有本轮可证明受理才清稿。把本目录新增探针接入并保留原 11/33 条。
3. 补 N05 的可信根检查，验证根/祖先/子目录三层边界。
4. 收紧 N06，修 C02 面板细节。重建最终 TEMP 包，严格门禁和实际包/源码身份对齐，缺项按 PARTIAL/NOT_RUN。
5. 再交付保持运行的隔离预览、最新证据和日志；C01 继续明确 PARTIAL。无需重复修改已关闭的 B01/B04/旧引用兼容分支。

复现命令（仓库内）：

```powershell
node docs/audits/writing-architecture/2026-09-14/v2-review2/edge-probes.mjs
.\node_modules\.bin\electron.cmd docs/audits/writing-architecture/2026-09-14/v2-review2/adopt-race.cjs
```

这两项当前分别 3 FAIL / 1 FAIL，修复后应以相同不变量转为 PASS。其余重跑入口及输出也在同目录。`prepare-reruns.cjs` 只重定位旧探针/证据并更新被审 SHA，未改产品断言；真包探针另外在 SMOKE_OK 后断开 inspector，避免已完成的 Node 进程等待调试器而超时。首次重跑已到 SMOKE_OK 但等调试器超时；修正测试清理后重新运行 exit 0，未把测试挂起算成产品故障。

— 审查：Codex / GPT-6
