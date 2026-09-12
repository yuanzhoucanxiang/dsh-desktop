# Handoff — writing-mode architecture (A–F)

日期：2026-09-12  
分支：`feat/writing-mode-architecture`  
基线：`d78d989`（v0.1.38）→ Stage A `2c97591` → 本轮 C/D/E 与集成

## 完成范围

| 阶段 | 状态 | 说明 |
|---|---|---|
| A 模块/构建 | 部分完成 | src/client/entry.js + src/shared/editor-session.js；`npm run build:writing` / `verify:writing-build`；feature 级 UI 仍集中在 entry（约 3k 行） |
| B 会话适配 | 已有实现 | `ensureCompanionSession` + host `route=companion`；待审查是否满足 H01–H07 全场景 |
| C 草稿恢复 | 已实现 | `lib/draft-checkpoints.js` + host `route=draft`；client 读写 checkpoint，发送后清理已提交稿 |
| D 项目备忘 | 已实现 | `lib/project-memory.js` + host `route=memory`；UI「项目备忘」；etag/revision 冲突 409 |
| E 上下文 | 已实现 | `src/shared/context-builder.js`；仅注入 confirmed fact/preference |
| F 集成 | 部分 | 单测 + 确定性构建；**未**做完整 30 项 UI E2E / 打包隔离预览 / 真实模型 |

## 未完成 / 明确边界

1. entry.js 未拆成 library/companion/editor 多文件（构建可再进一步）  
2. 方案 30 项验收矩阵未逐项跑通  
3. 跨进程备忘互斥仅单进程文件写；多 Desktop 实例边界见 known-issues  
4. 未发 tag、未替换正式安装包  
5. 真实 LLM 体验测试未做  

## 回退

- git 回退到 `2c97591` 或 `d78d989`  
- 用户备忘在 `<project>/state/writing-memory.json`，草稿在 `$DSH_HOME/writing-mode/drafts/`  
- 不自动删除上述用户数据  

## 关键命令

```powershell
node plugin/writing-mode/test/p1-regression.mjs
node plugin/writing-mode/test/architecture-cde.mjs
npm run build:writing
npm run verify:writing-build
```

— 执行：ox-alpha
