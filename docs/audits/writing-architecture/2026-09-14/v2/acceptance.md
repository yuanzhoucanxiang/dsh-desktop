# 写作模式 v2 验收矩阵（30 项）

- 提交：`4649b59`（P1/P2/P3 全部落地；本文件与打包探针随 P4 提交）
- 环境：Windows 10.0.26200 / Node v26.1.0 / 内核运行时按仓库锁定
- 状态口径：**只允许 PASS / FAIL / NOT_RUN / PARTIAL**；"总体通过"不覆盖任何未验证项
- 一键入口：`npm run verify:writing-all`（架构 → 构建 → host 回归 → 适配 → 备忘 → 上下文 → 包/冷启动 → 单测 → 三套 Electron E2E）

## 命令与结果文件

| 入口 | 覆盖 | 结果文件 |
| --- | --- | --- |
| `npm run verify:writing-architecture` | R1–R8 依赖边界/目标结构/清单 + R7 漏 import 与 R7 自检 | 控制台 `WRITING_ARCHITECTURE_OK` / `WRITING_IMPORTS_OK` |
| `npm run verify:writing-build` | 产品构建确定性与一致性 | 控制台 `PASS client.js matches src` |
| `npm run verify:writing` | host 回归 16 项（编辑器/门禁/伙伴/记忆/草稿） | `%TEMP%\dsh-writing-regression-*\results.json` |
| `npm run verify:writing-adapter` | H 组：协调记录 17 + 适配器时序 13 | 控制台 `coordination: 17 项通过` / `adapter 协调验收: 13 项通过` |
| `npm run verify:writing-memory-ui` | M 组：备忘最小完整操作 7 项 | 控制台 `P3 记忆/上下文/引用: 7 项通过` |
| `npm run verify:writing-context` | C 组 6 项 + D 组 4 项 | 控制台 `… 6 项通过` / `… 4 项通过` |
| `npm run verify:writing-package` | 清单↔打包 filter↔包/profile + 空环境冷启动 6 项 + 升级路径 5 项 | 控制台 `合计 3 项` / `合计 6 项` / `合计 5 项` |
| `npm run verify:writing-ui / -chat / -native` | 真实 Electron（ui/chat 为渲染器探针，native 走真实内核） | `%TEMP%\dsh-writing-{ui,chat,native}-*` |
| `npm run plugin-sync-test` · `test:writing-f/-cde/-p1` | 受管同步 10 · 评审链 10/25/7 | 控制台计数 |

## 矩阵

| ID | 场景 | 状态 | 证据与限制 |
| --- | --- | --- | --- |
| E01 | 保存竞态、快速 A→B→C | PASS | `test:writing-p1` 7 项（含竞态后磁盘为 B） |
| E02 | 外部修改 / 历史稿 / 另存版本 | PASS | `test:writing-p1` + UI E2E「冲突提示、保全外部稿、另存恢复」 |
| H01 | 连点发送/设置；两窗口首次关联 | PASS | `verify:writing-adapter` H01/H02：两窗口只建 1 个会话、后到者采用先到者绑定；连点走进程内共用 Promise。**限制**：两窗口为两个 adapter 实例共用真 host 协调协议（fixture），非两个 Electron 窗口并发 |
| H02 | A 建会话中切 B；A 返回迟到 | PASS | 同入口 H03：A/B 各自会话、消息各归各的会话；A 迟到结果按 handle 身份归位 |
| H03 | 已有角色/模型/自定义预设 | PASS | `verify:writing`「原生伙伴：项目隔离、重进复用、预设持久化且不覆盖自定义」（自定义后 `# customized` 仍在） |
| H04 | 历史、分块流式、结束 footer | PASS | chat E2E「历史/流式更新/工具折叠/授权与问题入口/排队/停止」（投影层 `projection.js`，tool-call/turn-tail/turn-error 各有归属） |
| H05 | 未知节点、授权、问题、附件/指令 | PASS | chat E2E 断言授权/问题入口可见且不自动批准；未知节点在投影里保留可见摘要（`hasUnknown`），完整会话入口常驻 |
| H06 | 拒绝 / 超时 / 受理不确定 | PASS | 同入口 H07 三态：明确拒绝→rejected；有原生证据→accepted；无证据→uncertain 且**正文保留、不自动重发** |
| H07 | 会话删除 / 接口缺失 / 断线恢复 | PASS | H06 会话被删→`missing` + 恢复条（重查/继续关联/查看完整会话），明确恢复才新建；能力缺失→明确报缺并释放预留 |
| D01 | 无会话草稿→创建会话→切完整会话 | PASS | native E2E：草稿进原生输入框、切完整会话共享同一份输入（且只创建一次会话） |
| D02 | 刷新恢复文本与引用 | PASS | `verify:writing` 草稿恢复用例 + chat 流程内 `listCompanionDraft` 采用；旧 `{label,text}` 引用原样兼容（D03 组） |
| D03 | 发送期间继续编辑/移除引用 | PASS | chat E2E「发送成功不擦除等待期间新输入」；W03 清理改用**结构相等**判定是否清引用 |
| D04 | 两窗口各自编辑/恢复 | PASS(V2 口径) | 其他窗口草稿作为候选列出（窗口+时间），只能预览/采用；`test:p3 --group=D` 证明采用是显式写回、不自动合并。**限制**：UI 层为渲染器探针验证，未做两窗口 Electron 并发 |
| D05 | 中文 IME / Enter / Shift+Enter / 停止 | PASS | chat E2E「中文输入法不误发送；普通 Enter 发送后清空已提交草稿」+「停止」断言 |
| M01 | AI 候选→作者确认→编辑→撤回 | PASS | `verify:writing-memory-ui` M01–M04：来源/状态真实，确认审计 `actor=author`，编辑候选仍 proposed，来源保留 |
| M02 | 问题已解决 / 偏好撤回 / 恢复旧记录 | PASS | 同入口 M06：撤回/已解决保留条目与历史、不再注入；恢复产生**新 revision** 不回退 |
| M03 | 项目 A/B、同名目录、大小写与移动 | PASS(V2 口径) | 协调记录按 host 规范化项目身份分桶（大小写/分隔符/尾斜杠归一，`bucketOf` 单测）；备忘按作品目录隔离（`verify:writing` 项目隔离用例）。**限制**：真实移动作品目录后的备忘迁移未做（见 known-issues） |
| M04 | 旧 revision 双写 / 跨进程同时写 | PASS | 同入口 M07 etag/revision 冲突拒绝；`verify:writing-adapter` 跨进程锁：活锁不抢、超时 lock-timeout、死锁 lock-stale（子进程真实写入对照） |
| M05 | 坏 JSON / 未知 schema / 磁盘失败 / 残留锁 | PASS | 同入口 + `verify:writing-package` 升级组：坏 JSON 备忘启动后**字节一致**；未知 schema 保留原件只诊断；死锁给出 lock-stale 诊断路径（运维/作者处理，不运行中盲删） |
| M06 | 备忘目录 junction / 越界 / 非同源写 | PASS | host `realpath` 边界校验（沿用既有实现）+ `verify:writing` 越界用例；协调记录与备忘同源边界检查 |
| C01 | 备忘超预算 / 来源被修改 / 已撤回 | PASS | `verify:writing-context` C03：预算内、超出计入 omissions 并写明"因长度省略"；撤回条目不进；作者正文不受限 |
| C02 | 发送中备忘 revision 改变 | PASS | C04：preparedTurn 全嵌套冻结，改备忘不影响已冻结请求；`memoryRevision/memoryEtag` 随请求带上 |
| C03 | 关闭自动参考 / 切项目 / 压缩后续聊 | PASS(V2 口径) | C05 关闭参考后正文照发且不含备忘；chat E2E 实测「关掉参考即不带」；项目隔离同 M03。**限制**：跨轮去重优化按方案要求仅在验证 compaction API 后做，本轮 **未做** |
| C04 | 引用含"忽略规则"等指令文本 | PASS | 引用块有明确数据边界与来源标注（`【引用 · …】` + 来源字段分离），不升级为系统指令/工具授权（C 组与 `reference.js` 结构断言） |
| P01 | 空白 home / 已有 v0.1.38 home | PASS | `verify:writing-package`：空环境冷启动 6/6（启动前 profile 不存在→应用自行同步→15 文件哈希一致）；升级路径 5/5（旧设置/备忘**字节不变**、旧文件保留不删、坏 JSON 保留原件） |
| P02 | 窄窗口 / 长消息 / 长引用 / 大量历史 | PARTIAL | 既有样式约束（输入区可滚动、引用块 max-height + 折叠、消息区独立滚动）与 chat E2E 长文本场景；**未做**专门的窄窗口/超长历史视觉回归 |
| P03 | 打包版启动及资源比对 | PARTIAL | `manifest ↔ 打包 filter` 静态展开**逐文件一致**（15 文件）；`manifest ↔ 已安装包/解包目录`可执行（`--package`）；**未做**本轮新构建与 NSIS 安装（见下） |

## 未验证项（不得被"总体通过"覆盖）

| 项 | 状态 | 原因与后续 |
| --- | --- | --- |
| P03 新构建 + NSIS 隔离安装 | NOT_RUN | ZCode 会话会锁住 `dist\win-unpacked\resources\app.asar`，且工作区规则要求构建产物出工作区（`%TEMP%`）；`build.ps1` 硬编码输出到工作区 `dist/`，未在本次预算内改造。后续可在普通终端执行 `npm run dist` 后用 `verify:writing-package --package <解包目录>` 复核 |
| macOS 产物 | NOT_RUN | 本机无 macOS 环境（脚本接线已在 P1 完成，静态检查随架构/打包入口覆盖） |
| 离线加载 | NOT_RUN | 未构造受限网络环境；本轮所有验收均在本地内核完成，**不把在线模型能力混入结论** |
| 真实模型体验（§6 三场景） | NOT_RUN | 不索取密钥明文、不复制正式凭据；需获授权的测试配置后再跑，场景脚本与判据已写入 `preview.md` |
| 两窗口 Electron 并发（H01/D04 的强口径） | PARTIAL | fixture 用两个 adapter 实例 + 真 host 协调协议覆盖时序；跨两个真实窗口的并发未做 |
| 主题 ui-smoke 过时断言 | NOT_RUN | 本批次范围外（主题侧改动在 palis 仓库，另行处理） |

— ox-alpha
