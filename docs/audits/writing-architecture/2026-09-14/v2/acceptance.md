# 写作模式 v2 验收矩阵（30 项，复核返工后）

- 被审基线：`95b138d`（复核退回）→ 本次返工：B01–B08 修复 + C02 + B07 门禁
- 状态口径：**只允许 PASS / FAIL / NOT_RUN / PARTIAL**（下表不含第三种口径）
- 一键入口：`npm run verify:writing-all`（18 步，**严格交付门禁**：缺真包直接非零退出）与
  `npm run verify:writing-quick`（17 步，开发态快速回归，不含真包项）
- 证据身份：真包门禁会打印/写入**被测源码 SHA + dirty 状态 + app.asar sha256**，不拿当前 git HEAD 冒充旧包身份
- 一键入口范围：架构 → 构建 → host 回归 → 适配 → 备忘 → 上下文 → 包/冷启动/升级（含 asar 逐字节）→
  复核负向探针 → 原 33 条正向基线 → 主题 UI 冒烟 → 单测 → 三套 Electron E2E → 真包验收
- 复核探针：`docs/audits/writing-architecture/2026-09-14/v2-review/probes.mjs`（Node 7 项）+
  `ui-probes.cjs`（UI 4 项）+ `baseline-ui.cjs`（原 review9 32 条正向）

## 命令与证据

| 入口 | 覆盖 | 证据 |
| --- | --- | --- |
| `verify:writing-architecture` | R1–R8 + R7 漏 import + R7 自检 | 控制台 `WRITING_ARCHITECTURE_OK` / `WRITING_IMPORTS_OK` |
| `verify:writing-build` | 构建确定性与一致性（A01） | `PASS client.js matches src` |
| `verify:writing` | 真实 HTTP host 回归 16 项 | `%TEMP%\dsh-writing-regression-*\results.json` |
| `verify:writing-adapter` | 协调记录 18 + 适配器时序 13 | 控制台计数 |
| `verify:writing-memory-ui` / `-context` | 备忘 7 · 上下文 6 · 引用 4 | 控制台计数 |
| `verify:writing-package` | 清单↔filter↔包/profile + 空环境冷启动 6 + 升级 5 + **主进程依赖闭包** + **app.asar 实检** | 控制台逐项 |
| `verify:writing-review-probes` | 复核的 7 条 Node 负向 + 4 条 UI 负向 | `v2-review/probes-results.json` / `ui-results.json` |
| `verify:writing-baseline-ui` | 原 review9 32 条正向时序 | `v2-review/baseline-ui-results.json` |
| `verify:ui-smoke` | 主题开启 × 恢复（隔离四路径，palis 由生产种子模块装入） | `UI_SMOKE_OK` ×2 |
| `verify:writing-ui/-chat/-native` | 编辑器/聊天/真实内核三套 E2E | `%TEMP%\dsh-writing-*` |
| `verify:writing-packaged` | **真包**冷启动 + 首启种子 + 主题开启/恢复 + **N01 安全清理**（9 项） | 严格门禁：缺包**非零退出**；开发态用 `verify:writing-packaged-dev`（显式 `--allow-missing` 才待跑） |
| `verify:writing-quick` | 同上但**不含真包项**（开发态快速回归，17 步） | 缺包不影响退出码 |
| `pid-cleanup-test` | 清理只按本轮 PID（同名进程不在清理集合） | 隔离双进程实验，不碰用户进程 |

## 矩阵

| ID | 场景 | 状态 | 证据与方法 | 限制 |
| --- | --- | --- | --- | --- |
| A01 | 清洁构建与再次构建 | PASS | `verify:writing-build`：两次构建字节一致；`client.js` 与源码一致；react / jsx-runtime 由 factory 的 require 提供（构建期 external），不重复实现 | "React 不重复"以构建期 external 断言为准，未做运行时双份检测 |
| A02 | 打包后离线加载 | PARTIAL | **已通过**：9 个主进程模块在 app.asar 内**逐字节一致**、全模块无仓库绝对路径、extraResources 完整、真包四路径隔离 `SMOKE_OK` 且 profile 由应用自行同步（15 文件哈希一致） | **未做**：受限网络下的加载验证（本项按子场景归 PARTIAL，不用「资源完整」充当离线结论） |
| A03 | 模式开关、重进、卸载/重载 | PASS | `verify:writing-ui`「退出/重进无 Hooks 异常且文字已保存」；`verify:writing-baseline-ui` 32 条含重载/恢复时序；E2E 断言 `errors.length===0` | — |
| E01 | 保存竞态、快速 A→B→C | PASS | `test:writing-p1`（竞态后磁盘为 B、dirty 已清） | — |
| E02 | 外部修改 / 历史稿 / 另存版本 | PASS | `test:writing-p1` + UI E2E「冲突提示、保全外部稿、另存恢复」 | — |
| H01 | 连点发送/设置；两窗口首次关联 | PARTIAL | **已通过**：连点（进程内共用 Promise 只建 1 个会话）、两 adapter 实例 + 真 host 协调协议下后到窗口采用先到者绑定 | **未做**：两个真实 Electron 窗口并发（不是用 fixture 冒充） |
| H02 | A 建会话中切 B；A 返回迟到 | PASS | 同入口 H03：A/B 各自会话、消息各归各的会话；`send` 返回后先核对 handle 身份再交付 | 同上 |
| H03 | 已有角色/模型/自定义预设 | PASS | `verify:writing`「原生伙伴：项目隔离、重进复用、预设持久化且不覆盖自定义」 | — |
| H04 | 历史、分块流式、结束 footer | PASS | `verify:writing-chat`「历史/流式更新/工具折叠/授权与问题入口/排队/停止」 | — |
| H05 | 未知节点、授权、问题、附件/指令 | PASS | chat E2E 断言授权/问题入口可见且不自动批准；投影保留未知节点可见摘要（`hasUnknown`） | 未知节点无单独视觉区分 |
| H06 | 拒绝 / 超时 / 受理不确定 | PASS | 适配器 H07 三态 + **复核 B02 探针**：明确拒绝→`rejected`（旧消息里的同备忘前缀不再算证据，靠发送前基线）；有原生新证据→`accepted`；无证据→`uncertain` 且保留正文不自动重发 | — |
| H07 | 会话删除 / 接口缺失 / 断线恢复 | PASS | 适配器 H06（会话被删→`missing` + 恢复条）+ **复核 B03 探针**：恢复先按原 token 补确认（`creates` 保持 1），只有会话确实不在了才做条件受保护的 forget + 重建 | 双真实窗口并发仍未做（见未验证项） |
| D01 | 无会话草稿→创建会话→切完整会话 | PASS | `verify:writing-native`：草稿进原生输入框、切完整会话共享同一份输入、只创建一次会话 | — |
| D02 | 刷新恢复文本与引用 | PASS | `verify:writing-baseline-ui` 32 条（含 reload 恢复、迟到恢复不覆盖新输入）；`test:writing-p3 --group=D` 旧 `{label,text}` 引用原样兼容 | — |
| D03 | 发送期间继续编辑/移除引用 | PASS | chat E2E「发送成功不擦除等待期间新输入」；引用清理改用 `sameReference` 结构相等（B08） | — |
| D04 | 两窗口各自编辑/恢复 | PARTIAL | **已通过**：候选条带窗口与时间；采用前先落可恢复副本（`-before-adopt-*` 桶实测可取回）、引用按候选显式置空、失败不切换；**N03 竞态**：迟到采用若有新编辑则取消并保留新稿 | **未做**：两个真实窗口并发 |
| D05 | 中文 IME / Enter / Shift+Enter / 停止 | PASS | chat E2E 的 IME、键盘与「停止」断言 | — |
| M01 | AI 候选→作者确认→编辑→撤回 | PASS | `verify:writing-memory-ui` M01–M04（含 `actor=author` 审计、原始来源保留、编辑候选仍 proposed） | — |
| M02 | 问题已解决 / 偏好撤回 / 恢复旧记录 | PASS | 同入口 M06：撤回/已解决保留条目与历史且不再注入；恢复产生**新 revision**、版本号不回退 | — |
| M03 | 项目 A/B、同名目录、大小写与移动 | PARTIAL | **已通过**：项目身份分桶（大小写/分隔符/尾斜杠归一，`bucketOf` 单测）、项目 A/B 隔离（`verify:writing`） | **未做**：作品目录移动后的备忘/协调记录迁移（现状安全但需作者重新确认一次） |
| M04 | 旧 revision 双写 / 跨进程同时写 | PASS | 同入口 M07（etag/revision 冲突拒绝）；`test:writing-adapter` 跨进程锁：活锁不抢、超时 `lock-timeout`、死锁 `lock-stale`（子进程真实写入对照） | — |
| M05 | 坏 JSON / 未知 schema / 磁盘失败 / 残留锁 | PASS | `verify:writing-package` 升级组：坏 JSON 启动后**字节一致**；未知 schema 保留原件只诊断；死锁给 `lock-stale` 诊断路径（不运行中盲删） | — |
| M06 | 备忘目录 junction / 越界 / 非同源写 | PASS | **复核 B05 探针**：profile 下的 junction 被 realpath 校验拦住（外部文件保持 `USER DATA`）；受管记录里的 `../` 条目被丢弃（外部文件不再被删）；`removedFailed` 已初始化 | — |
| C01 | 备忘超预算 / 来源被修改 / 已撤回 | PASS | `verify:writing-context` C03 + **复核 C02 探针**：预算按 **Unicode 码点**计（3500 emoji 不再被当 7000 而误省略）；超出计入 omissions 并写明；撤回条目不进；作者正文与显式引用不受限 | — |
| C02 | 发送中备忘 revision 改变 | PASS | C04：preparedTurn 全嵌套冻结（含 `source`），改备忘不影响已冻结请求；`memoryRevision/memoryEtag` 随请求带上 | — |
| C03 | 关闭自动参考 / 切项目 / 压缩后续聊 | PARTIAL | **已通过**：关闭参考后正文照发且不含备忘（E2E 实测）、切项目隔离、面板用同一选择函数显示实际采用/省略与来源并支持逐条排除/优先，待定问题勾选才带入（C02 面板细节已修） | **未做**：压缩后续聊的跨轮去重（方案要求先验证 compaction API） |
| C04 | 引用含"忽略规则"等指令文本 | PASS | 引用块有明确数据边界与来源标注；`reference.js` 身份结构断言（path/revision/选区/指纹）+ 缺身份时**保守比较完整快照** | — |
| P01 | 空白 home / 已有 v0.1.38 home | PASS | `verify:writing-package`：空环境冷启动 6/6；升级路径 **6/6** —— 旧配置库根指向**真实存在的 fixture 作品**、旧 schema 备忘与旧草稿写在**生产路径**上，并用**生产模块**验证"可发现（库根可达）/ 可读（条目、草稿与引用原样）/ 可继续保存（revision 4→5）"；坏 JSON 走生产读取得到 `corrupt-memory` 诊断且字节不变 | fixture 为脱敏构造（非真实用户数据副本）；UI 层的打开/继续保存由三套 E2E 覆盖 |
| P02 | 窄窗口 / 长消息 / 长引用 / 大量历史 | PARTIAL | 既有样式约束（输入区可滚动、引用块 max-height、消息区独立滚动）+ chat E2E 长文本场景 | 未做专门的窄窗口尺寸矩阵与超长历史视觉回归 |
| P03 | 打包版启动及资源比对 | PASS | **本轮真实构建到 %TEMP%**（`scripts/rebuild-package-tmp.mjs`：electron-builder API + 本地 electron dist 离线构建）；`verify:writing-package --package` 全绿；`verify:writing-packaged` 7/7（真包冷启动、首启种子 stamp + palis 就位、主题开启 × 恢复）；复核者 `package-probe.cjs` 在本包上得 `SMOKE_OK` + `pluginSyncPresent: true` | NSIS 安装未在隔离用户环境执行（见下） |

## 未验证项（不得被"总体通过"覆盖）

| 项 | 状态 | 原因与后续 |
| --- | --- | --- |
| NSIS 隔离安装 | NOT_RUN | 本轮完成 dir 目标真包构建与真包冷启动；安装器要写注册表/程序目录，未在隔离用户环境执行。构建命令与复测入口见 `known-issues.md` |
| macOS 产物 | NOT_RUN | 本机无 macOS 环境（脚本接线与静态检查已覆盖） |
| 离线加载（受限网络） | NOT_RUN | 未构造受限网络；A02 已验证"不依赖源码目录、资源完整、真包可启动" |
| 真实模型体验（§6 三场景） | NOT_RUN | 不索取密钥明文、不复制正式凭据；场景脚本与判据在 `preview.md` |
| 两真实窗口并发（H01/D04 强口径） | PARTIAL | fixture + 真 host 协调协议覆盖时序；跨两个真实 Electron 窗口的并发未做 |
| 作品目录移动后的备忘/协调迁移 | NOT_RUN | 现状安全（不会串到别的作品），移动后需作者重新确认一次 |
| C01 app 拆分完整性 | PARTIAL | `entry.js` 3526→165 行；`app/` 只留装配；features/{editor,library,companion,memory,tools,settings} 与 adapters/services/state/styles 就位；会话/草稿/备忘/引用/会话投影均已走 adapter。但 `WritingModeApp.js` 仍有约 1.5k 行（新建项目与文稿、库切换、文字工具执行、保存定时与多块界面），继续拆分需配套 E2E |

— ox-alpha
