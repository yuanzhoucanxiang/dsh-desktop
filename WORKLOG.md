# 工作日志 · 索引与协作规范

> 项目：`dsh-desktop` —— DeepSeek Harness 桌面快捷启动外壳
> 原则：**内核零修改**

本目录的日志体系分三层：

| 文件/目录 | 作用 |
|---|---|
| `logs/YYYY-MM-DD.md` | **每日日志**：一天一个文件，记录当天所有工作细节、坑、产出 |
| `CHANGELOG.md` | **变更历史**：按版本号记录用户可见的增/改/修，带署名 |
| 本文件 | **索引 + 协作规范**（给后续协作者看的入口） |

---

## 现有日志

| 日期 | 文件 | 摘要 | 署名 |
|---|---|---|---|
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
| 2026-09-12 | [`logs/2026-09-12.md`](logs/2026-09-12.md)（〔136–138〕） | 写作伙伴原生会话、自然交流预设、项目关联、选区追加、外部改稿保护；16 项回归 + 编辑器/原生 UI 实测 + 隔离打包预览；策划案 v0.5；〔137〕独立写作对话 UI 与四组聊天行为回归、第二版隔离预览；〔138〕策划案核对并纳入仓库、提交推送，未发布应用 | Codex / GPT-6 |

---

## 协作规范（重要，后续协作者必读）

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
