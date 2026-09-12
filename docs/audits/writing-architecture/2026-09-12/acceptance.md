# Acceptance (engineering subset)

| ID | 结果 | 证据 |
|---|---|---|
| E01 保存竞态 | PASS | `p1-regression.mjs` 竞态后磁盘为 B |
| E02 版本独占 | PASS | createVersion → v3，不覆盖 v2；历史稿拒写 |
| H（session） | PARTIAL | 已有 ensureCompanionSession；未完成全部 H01–H07 fixture |
| D01 草稿 | PASS | `architecture-cde.mjs` draft roundtrip/clear |
| D02/D04 刷新/多窗 | PARTIAL | windowId 分桶已实现；UI 未 E2E |
| M01–M02 备忘状态机 | PASS | architecture-cde 内存用例 |
| M04 并发 | PARTIAL | etag 冲突；跨进程锁未做 |
| C01 预算 | PASS | context-builder budget omit |
| P01–P03 打包/预览 | NOT RUN | 需隔离 dist 与可见实例 |

命令：

```
node plugin/writing-mode/test/p1-regression.mjs
node plugin/writing-mode/test/architecture-cde.mjs
```

— ox-alpha
