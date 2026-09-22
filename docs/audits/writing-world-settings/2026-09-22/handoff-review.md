# ox-alpha 交回的定向独立复核

2026-09-22，Codex。**结论：不能按“全部修复完成”验收，暂缓发布。** 本次只读生产实现，新增隔离探针与报告；没有提交、替换真实 profile 或修改生产源码。不是完整外壳安全审计。

## 已复现缺陷

### CXR01 · P1 · 锁清扫仍能移走活锁

位置：`plugin/writing-mode/lib/file-lock.js:73–81`。

`inspectLock` 第二次复核与 `renameSync` 仍非原子操作。精确时序：清扫 B 完成第二次 dead 检查后暂停；清扫 A 移走旧死锁；写入 W 获取新锁进入临界区；B 恢复并把 W 的新锁改名；写入 X 又获取同路径锁，进入与 W 重叠的临界区。

`handoff-probes.mjs` 在 rename 边界注入确定性调度，实测 `movedLiveOwner: true, overlap: true`。这是模拟上述抢占时序的确定性探针，不冒充一次自然发生的多进程压力结果。未改生产源码或用户数据。

把窗口缩到微秒不是互斥保证；revision/etag 是临界区里的读后比较，也不能在互斥失效后自动变成原子的 compare-and-swap。启动清扫同样可能与另一进程写入并发。

建议：在有共享的清扫/获取互斥协议之前，不在线移动他人锁。可先停止自动清扫，保留错误诊断；离线维护须先确认没有任何写入者。长期改为能提供原子所有权的锁机制。仅增加第三次 token 检查或 rename 后再复核不能消除已出现的双持有窗口。

### CXR02 · P1 · 同名稿件被当成同一作品证据

位置：`plugin/writing-mode/lib/project-recovery.js:75`。

两部完全不同的作品 A/B 恰好都包含 `draft/第一章.md`，内容不同。移动 A 后，在 B 查找候选，A 被判 `relation=manuscript-reference, importable=true`；不提供 `confirmUnrelated` 也能导入 A 的草稿，实测 `copied=1`。

这不是指非破坏性复制必须禁止，而是界面声称“有证据属于当前作品”并跳过无证据确认，实际依据只有常见相对文件名。修正应降级为无关联证据；长期优先使用稳定作品 ID。内容指纹最多是辅助证据，不应把文件名相同当作身份相同。

## 已排除的怀疑

CXR03：旧尾分隔符哈希桶是否失联。本次构造旧版桶后，列表可见且 `readCheckpoint` 返回原文及 `legacyBucket=true`，**NOT_REPRODUCED**。原怀疑不列为缺陷。

## 实际复跑结果

| 命令 | 本次结果 |
|---|---|
| `npm run test:writing-hardening` | 77 passed, 0 failed，与基线一致 |
| `npm run git-review-test` | GIT_REVIEW_OK |
| `npm run shell-hardening-test` | SHELL_HARDENING_OK |
| `npm run plugin-manager-test` | 19 tests passed |
| `hunt-writing.mjs` | 0/9，未见 PROBE_ERROR |
| `hunt-git.mjs` | 0/4，未见 PROBE_ERROR |
| `hunt-shell.mjs` | 0/6，未见 PROBE_ERROR |
| `hunt-release.mjs` | 0/4，未见 PROBE_ERROR |
| `verify:release-artifacts -- --allow-stale` | exit 0 |
| `verify:release-artifacts` | exit 1，U4 版本与安装包路径检查拒绝陈旧 latest.yml |
| 新增 `handoff-probes.mjs` | CXR01/CXR02 REPRODUCED；CXR03 NOT_REPRODUCED |

原探针通过不能排除新增时序与同名文件反例。没有重跑完整19步、Electron全套、W23五轮、NSIS或重建真包，不复用作者包哈希作本次通过证据。

## 七项取舍裁决

1. **V5：允许显式导入副本合理，“为了让 fixture 通过”不构成理由。** 没有旧元数据的真实作品需要恢复出口；应明确显示来源、目的项目、无关联证据，保持原桶不变和可撤销。当前 CXR02 的弱证据判定必须修。D04 fixture 也应分别覆盖真迁移与无证据手动导入，不倒逼生产逻辑。
2. **V7：预取是性能优化，不能作为竞态修复证明。** 必须覆盖第5份以后、网络延迟/失败、恢复中编辑/切项目/关闭面板。代码在 await 后读取 localRef，有保留同期编辑的意图，但缺少完整生命周期验证；本次未构造其丢数据反例，不列已复现缺陷。
3. **V4/W23：未知 owner 不应当死锁处理，但也无需每次阻塞8秒。** 可快速返回“锁状态未知，可重试”，区分锁不存在与未知持有者，并进行有限重试；异步等待可后续重构。自动清扫的 CXR01 是当前阻断项，不能用同步重构成本替代修复。
4. **S1：命令执行入口收紧是有效的局部修复，不能称全桥完成授权审计。** 只读状态可兼容保留，但命令可能含敏感参数，应按字段最小化；其他写入通道仍需按操作风险检查。本次未证明另一条完整绕过链，不报新漏洞。
5. **U3：统一来源更好，一致性门禁可作过渡。** 已接构建/发布且漂移会失败，就能降低当前风险；仍须在真实发布流程核验，不能称彻底消除硬编码。
6. **U1：自动下载路径跳过校验不可算闭环。** 应从同一个选定 Release 下载安装包与对应清单，验证版本、文件名、size与sha512，缺失/格式不全拒绝自动安装。手工包若保留例外应明确走手工未验证路径。清单哈希证明一致性，不单独证明发布者身份。
7. **卫生 WARN 合理。** 与本轮产物不相关的历史文件不必阻断，也不自动删除；本轮引用的安装器、清单、blockmap 不一致则必须 FAIL，不能用 allow-stale 发布。

## 真实 profile 与交接

只读核对真实 profile 中 `coordination.js`、`draft-checkpoints.js`、`file-lock.js` 的哈希，三者均不同于当前工作树，符合作者披露的漂移。没有擅自回退、同步或关闭现有应用；这不是要求用户现在重启正式版的理由。

“已有项目接入”在独立副本完成6组协议与5组真实界面测试；没有覆盖这里的生产源码。待上述阻断问题修复并收齐后，按补丁合并，再对最终内容统一构建验收。

— Codex
