# 写作模式架构第九轮复核

日期：2026-09-13。HEAD：`1664467`；实现：`1a67496`；测试：`6df0779`。分支：`feat/writing-mode-architecture`。

## 1. 结论

**X01 通过，当前这轮草稿恢复、冲突和错误状态返工可以收口。** 本轮覆盖范围内没有新增返工项。旧错误清理、重试落盘和业务错误隔离均已做实际 UI/HTTP 验证，不仅是状态函数单测。

此结论不代表原架构方案全部完成，也不是合并或发布验收。生产实现未改，未合并、未打包、未发布。

## 2. X01 验收

| 场景 | 结果 |
|---|---|
| 冲突 → 保留本地 → 保存 503 → 重试成功 | 磁盘保存 `LOCAL_RESOLVE`，旧冲突错误消失，无失效选择提示 |
| 普通编辑网络失败 → 重试成功 | 磁盘保存 `NORMAL_NETWORK_UNSAVED`，phase=`saved`，旧未保存错误消失 |
| 实际会话发送失败后编辑并保存草稿 | 草稿保存成功，会话错误 `BUSINESS_SEND_FAILED` 仍可见 |
| 引用保存 503 → 重试成功 | 引用落盘，只清草稿错误；独立会话错误仍保留 |
| 备忘读取失败 → 发送成功 → 清除 checkpoint 503 → 重试 | 清除墓碑落盘，草稿错误消失；备忘读取警告仍保留 |

上一轮 V01 正向检查继续通过：恢复 413/网络错误可见，重试无需篡改正文；缩短超长内容后保存成功；旧请求成功不误清新文字 dirty。R/S/W 系列在本轮脚本覆盖的恢复、引用、并发版本、选择远端、实际发送、墓碑清除等序列也继续通过。

## 3. 测试与证据

| 测试 | 结果 |
|---|---|
| review9-ui | **32/32 PASS**，无 REPRODUCED，无控制台错误 |
| review9-probes | **8/8 PASS**：路径/并发/存储及 schema 1 存储兼容回归 |
| review7-status / review5-protocol | 10/10、9/9 |
| architecture-cde / p1-regression | 25/25、7/7 |
| review-f01-f06 | 临时副本 10/10 |
| verify:writing-build | PASS，生产源码与产物一致 |
| verify:writing | 16/16 |
| verify:writing-chat / verify:writing-ui | 各 4 组 |
| verify:writing-native | 3 组，真实锁定内核，0 模型回合 |

复跑（仓库根目录）：

```powershell
node_modules/.bin/electron.cmd docs/audits/writing-architecture/2026-09-13/review9-ui.cjs
node docs/audits/writing-architecture/2026-09-13/review9-probes.mjs
```

证据：[UI](review9-ui-results.json)、[存储/进程](review9-probes-results.json)、[host](review9-host-results.json)、[原生内核](review9-native-results.json)。UI 脚本对全部结果强制 PASS；X01 已从缺陷复现改为正向断言。

UI 使用生产客户端、生产 HTTP/存储和稳定的原生形状会话 fixture；通过延迟请求、模拟一次性 503/fetch rejection 构造故障，413 来自真实生产接口。发送只捕获实际传给会话的内容，没有调用模型。存储测试使用真实独立进程和 TEMP 数据，不碰用户项目。

附带的 `Offset 95 is out of range for this file (92 lines)` 没有文件路径，无法确定原读取对象；它本身是读取范围错误，不足以证明源码修复失败。本轮独立读取提交差异、执行源产物校验与正向测试均通过，未依赖该次失败读取。

## 4. 剩余项目范围与下一步

本轮 **32 条脚本断言不是原方案的 30 项验收表**。当前通过的是这些已覆盖的故障与回归序列，尚未完成整套产品交付验证。

原方案中仍需继续：entry 的 feature 拆分、独立 Harness adapter、备忘历史/候选确认 UI、30 项逐项验收、打包字节与安装升级验证、可见隔离预览、真实模型效果。死锁拒绝策略通过了安全回归，自动恢复/运维路径仍为已知开放项。

后续执行 agent 应保留 review9 正向探针，回到原方案剩余工作；不再把 X01 标为待修，也不应把这次通过写成全部架构或发布验收通过。打包预览应按工作区约定使用独立 userData，保持可见实例供用户自行关闭。

审查新增文件及日志尚在工作树；本轮没有提交或推送这些材料，保留了开始时已有的未提交文档与 review7/8 证据。

— 署名：Codex / GPT-6
