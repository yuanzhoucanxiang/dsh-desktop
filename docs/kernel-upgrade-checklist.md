# 内核升级运行手册（dsh-desktop × palis-theme-panel）

面向「官方内核出新版本，我们要不要跟、怎么跟」。每条命令都可直接照跑；
红项先问「是产品坏了还是断言写错了」（见 logs/2026-09-10.md 〔105〕〔106〕）。

## 0. 什么时候跟

- 官方把 `rc` 当 `latest` 发（连我们现钉的 0.1.1-rc.1 也是 rc），所以判断依据不是
  「有没有 rc 后缀」，而是**版本变动频率 + 代价**。
- 建议：新内核发布后先跑下面第 1–3 步（都是只读/隔离的，不动现有安装）；
  只有当「契约全绿 + 渲染全绿 + 插件就位」时，才进第 4 步的采纳动作。
- 刚发布几小时内的版本不必抢（0.1.5-rc.1 是发布当天就被我们实测的）。

## 1. 装候选运行时（不动已安装实例）

```bash
node scripts/prepare-candidate-runtime.mjs --version <ver> --registry https://registry.npmjs.org
# → 输出候选树路径（默认 %TEMP%/dsh-candidate-<ver>），后续用 --runtime 指它
```

注意：`@deepseek-ai/*` 子包在 npm 上只到 0.0.1-rc.1（0.1.x 只随内核 `@deepseek-ai/dsh` 分发），
所以候选树必须装 `@deepseek-ai/dsh` 而不是逐个装子包；npmmirror 镜像缺子包，装插件树时用官方源。

## 2. 跑契约验收（协议/文件/schema 面）

```bash
node scripts/verify-kernel-contract.mjs --runtime <候选> --render
```

期望：`KERNEL_CONTRACT_OK`。要点说明：

- 就绪判定只认 `200/401/303`（0.1.2+ 开鉴权后 `/` 是 401；0.1.5 实测端口会先答 404、约 1s 后才转 401）。
- 启动行 `dsh web: <url?token=…>` 必须出现在 **stdout**（外壳只读 stdout；跑到 stderr 即红）。
- 若 `shell.profile-kernel-packages` 报红：那是「profile 的运行时链接 ≠ 本轮被测内核」，
  说明你在用另一个目录的运行时做验证（见 〔108〕），**不是升级风险**；候选验证请用独立 DSH_HOME。

## 3. 跑渲染不变量 + 插件实测

```bash
node scripts/verify-render-invariants.mjs --runtime <候选> --shot out.png   # 四项不变量（含 DPR 2.73、40 帧）
node scripts/verify-plugin-compat.mjs   --runtime <候选>                    # 内置/已装插件 × 内核
```

`verify-plugin-compat` 会给出逐插件结论（宿主加载 / 客户端产物 / UI 挂载）。
它要求先有 stage 树：`node scripts/prepare-builtin-plugins.mjs`（`DSH_BUILTIN_OUT` 可指工作区外）。

## 4. 采纳动作（只在上面全绿后做）

1. `prepare-runtime.ps1`（或 `prepare-runtime-macos.sh`）里的内核版本钉到新版本；
2. 按需提 `builtin-plugins.json` 的插件 pin（见下方矩阵）；
3. 重建发行版（`npm run dist`，产物落工作区外）→ 独立实例目检 → 走预发布通道再进 latest。
4. 回滚：`resources/runtime.tar.gz` + `runtime-marker.json` 置换回上一对（保留 `.bak-<ver>`），
   换之前**先杀干净从该 runtime 目录起的 node 进程**（否则 EPERM，见 〔103〕）。

## 5. 已知版本矩阵（实测，非推测）

| 插件 | 0.1.1-rc.1（现钉） | 0.1.5-rc.1 | 说明 |
| --- | --- | --- | --- |
| @dsh-local/palis-theme-panel | ✓ 0.5.8（双写，0.4.3 亦可） | ✓ **0.5.8** | 0.4.3 及更早撞 `settingsNamespace` 缺失 |
| dsh-better-sidebar | ✓ 0.15.2（含本仓 fork 的动效修复） | 需 **0.18.0** | 0.15.2 同样撞 `settingsNamespace`；换 0.18.0 = 丢 fork 修复，需先移植 |
| dsh-pet | ✓ 0.1.4 | ✓ 0.1.4 | — |
| @nanmicoder/dsh-auto-mode | ✓ 0.1.2 | ✗（0.1.2 缺 `effectivePermissionPreset`；**0.1.7 自带版本守卫拒绝 0.1.5 并拖垮内核**） | 采纳 0.1.5 时须先移除或等上游 |

插件与内核的兼容性只能实测（peer 范围是声明，不是事实）。

## 6. 安全网

坏插件不会把应用变砖：内核启动失败时外壳按日志摘出报错 bundle
（`main.js` 的 `detectBrokenBundles`，正则 `failed to (import|apply) loader entry <…>(<pkg>)`）
→ 从 profile bundles 移除 → 重试（≤4 轮）+ 通知；托盘可「重新启用被隔离的插件」。
auto-mode 在 0.1.5 上的报错行已用该正则验证可捕获（2026-09-10）。

## 7. 工具索引

| 命令 | 作用 |
| --- | --- |
| `npm run verify:kernel [-- --render]` | 契约验收（协议/文件/schema/静态锚点，可选渲染） |
| `npm run verify:render` | 渲染不变量（Hermetic 内核+主题，headless Chrome，DPR 可 `--dpr`） |
| `npm run verify:plugins -- --runtime <dir>` | 插件 × 内核实测 |
| `node scripts/prepare-candidate-runtime.mjs --version <ver>` | 装候选内核到工作区外 |
| `node scripts/prepare-builtin-plugins.mjs` | 装内置插件 stage 树（`DSH_BUILTIN_OUT` 指工作区外） |

契约本身（依赖了什么 / 期望什么 / 坏了怎么降级）在 `contracts/kernel-surface.json`；
基线快照在 `contracts/baselines/`，升级时 diff 就知道「变了什么」。
