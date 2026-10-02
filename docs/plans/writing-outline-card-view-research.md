# 大纲视图 / 卡片视图调研（写作模式下一批候选）

> 2026-10-02 · ZCode · 依据：对照 manuskript（index cards / Snowflake）/ novelWriter（Outline View）的评估结论，策划案 §3.1/§3.4。本文档只做调研与方案骨架，不是实施承诺。
> **进展（2026-10-02 当日）**：§2.1 大纲只读视图已实施——文档库第三态「大纲」+ 只读路由 `GET outline`（`domain.outlineSummary`），见 CHANGELOG [Unreleased] 与 CONTRACT.md；§2.2 卡片只读版与拖拽排序仍未实施。

## 1. 现状盘点（能复用什么）

| 资产 | 位置 | 对卡片/大纲视图的价值 |
|---|---|---|
| `outline/` 目录契约（structure/units/foreshadow.md） | CONTRACT.md §目录契约 | 大纲数据已有"家"，缺的是**视图**与**结构化** |
| 文档树 + 自然序分组（`grouping.js` navigationGroups） | client library | 卡片网格可直接复用同一份 `tree` 数据，零新 IO |
| 台账 hook / 字数（`domain.ledgerSummary`） | host | 卡片背面数据现成：每章当前版字数、章末钩子 |
| 版本徽标 / `draft/` 系列解析（`compile.latestOfSeries`） | host/client | 卡片点击 → 打开当前版；历史版已有入口 |
| 门禁结果（gate rows） | client | 卡片角标可显示门禁状态（已有 `gate` 数据流） |

结论：**不需要新存储**。卡片/大纲视图是对已有 tree + ledger + gate 数据的第二种投影。

## 2. 两个候选形态

### 2.1 大纲视图（novelWriter 式，先做）
- 触发：文档库顶部「作品导航 / 文件视图」切换处加第三态「大纲」。
- 内容：按 `outline/structure.md` 的标题层级（若有）对齐 `draft/` 章节；每行 = 章节 + 字数 + 门禁状态 + 钩子一句话。
- 数据：`tree`（已有）+ 每章 ledger 摘要（复用 `ledgerSummary`，host 加一个批量口径或客户端逐章懒加载）。
- 风险低：纯展示，不改任何协议。

### 2.2 卡片视图（manuskript 式，后做）
- corkboard 网格：每章一张卡（标题 / 字数 / 状态角标 / 钩子 / 一句大纲），拖拽排序 = 重命名章节序号（涉及文件改名，必须走独占命名 + 冲突协议，**这是最大的风险点**）。
- v1 不做拖拽，只做只读卡片 + 点击打开；拖拽排序单独立项（要 newDraftPath/重命名事务与双窗口协调）。

## 3. 非目标（延续 §18.5 的克制）

- 不做设定关系图 UI；
- 不引入新的数据格式（Markdown 标题 + 现有目录契约够用）；
- 不强制作者先填大纲（空态 = 提示从模板或对话生成，可跳过）。

## 4. 建议排序

1. 大纲视图（只读投影，1 个 client 模块 + host 批量 ledger 口径）；
2. 卡片视图只读版（复用大纲视图数据源）；
3. 卡片拖拽排序（独立设计：重命名事务 + 锁协议 + 回归）。
