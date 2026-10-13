# 给协作 Agent 的约定（AGENTS.md）

进入本仓库工作的 agent / AI 助手 / 协作者，请先读本文件，并遵守以下约定。

## 1. 运行与测试（最重要）

- **不要擅自杀掉正在运行的进程**：桌面应用「DeepSeek Harness Desktop」可能正被用户使用。
  测试/冒烟前，**禁止**直接 `Stop-Process` / `taskkill` / `kill` 掉 `DeepSeek Harness Desktop`、`electron` 等进程——
  否则用户正在看的窗口会瞬间消失，被误认为「闪退」，造成困扰。
  - 确实需要清理残留进程才能测试时，**先向用户说明并征得同意**，或改用不打扰的方式（新端口起独立实例、窗口隐藏）。
- 冒烟测试统一用 `npm run smoke`（窗口隐藏、不弹窗、测完自动退出，exit 0 = 通过）。
- **涉及打包分支（`app.isPackaged` 为 true 的路径）的改动，必须实测打包版**，不能只测 dev 模式。
  历史教训：`autoUpdater` 导入错误导致打包版启动即崩、窗口永不显示，而 dev 模式根本不走那条分支，未暴露。

## 2. 记录与署名

- 每次改动：在 `logs/YYYY-MM-DD.md` 追加当日日志（做了什么 / 改了哪些文件 / 结果 / 坑），并同步 `CHANGELOG.md`。
- 每条记录末尾署名（agent 用 id/模型名，人类用姓名）。只增不改他人历史条目。
- 详见 `WORKLOG.md`。

## 2.1 文档维护清单（**与改动同批**，不许事后再补）

> 项目所有者 2026-10-13 明确要求："项目文档和工作日志要时刻保持维护"。
> 判据很简单：**下一位协作者只看文档，能不能复原你今天做的事与踩过的坑**。

| 文件 | 什么时候必须动 | 写什么 |
|---|---|---|
| `logs/YYYY-MM-DD.md` | 每次 | 做了什么 / 改了哪些文件 / 结果 / 坑（末尾署名） |
| `WORKLOG.md` 的「现有日志」索引 | 每次新增日志条目 | 一行摘要 + **提交号**；索引漏了 = 这段工作不存在 |
| `WORKLOG.md` 的「踩坑速查」 | 坑会重复咬人时 | 症状 → 原因 → 对策（先记当日 logs，确认重复再进表） |
| `CHANGELOG.md` 的 `[Unreleased]` | 有**用户可见**的增/改/修时 | 用用户能读懂的话写，带署名 |
| `AGENTS.md`（本文件） | 出现新的**可执行规则**时 | 规则 + 为什么 + 指向详细文档的路径 |
| 专业文档：`plugin/workbench/README.md`、`docs/plans/workbench-layer-v1.md` §0.1、`docs/workbench-mode-guide.md` | 契约 / 机制 / 现状变化时 | 细节、字段名、门禁名、**仍未做项** |
| **`docs/workbench-mode-constitution.md`（模式接入宪法）** | 新增/改造一个模式、或工具台契约变化时 | 十五条条文（每条：必须/应当/禁止 + 为什么 + 指针）+ 新模式的 12 步适配清单 + 现状对照表 |
| `prototypes/*/README.md` 的落差表 | 原型里的东西落地或推翻时 | 已落地 / 未做——**落差表不许说谎** |

三条纪律（都是踩过坑换来的）：

1. **源码与构建产物同一笔提交**（踩坑速查 #36）：只提交产物会让新克隆构建不一致，而本地门禁照样绿。
2. **索引优先**：新增日志条目的**同一笔**提交里加索引行——"日志写了但索引没有"与没写等价。
3. **反例实证后再写"已验证"**：门禁红了要能解释为什么红，绿了要能解释为什么绿（guide §6）；弱断言（`≤`、非空、`>0`）抓不到"全都一样"（踩坑 #37）。

### 2.1.1 「时刻维护」的具体做法（2026-10-13 项目所有者再次要求）

> 原话："完善项目文档和工作日志并补充说明，**之后要时刻记得维护这些文档**，然后再继续。"
> 那次是**补记**：中途有 11 笔提交只在对话里交代、没落文档。所以把"时刻"落成可执行的动作：

- **一轮收尾的三件事，缺一不算完**：① 当日 `logs/` 记过程（含**自己犯的错**）；② `WORKLOG.md`
  索引行（带提交号）；③ 有用户可见变化就写 `CHANGELOG.md`。**同一笔提交**里做完，不许"下次一起补"。
- **改动落点对号入座**（比"记得维护"更管用）：
  - 契约/字段/门禁名变了 → `plugin/workbench/README.md` + `docs/plans/workbench-layer-v1.md` §0.1；
  - 新增/改造一个模式 → `docs/workbench-mode-constitution.md`（**含现状对照表与已知边界**）；
  - 出现新的可执行规则 → 本文件（规则 + 为什么 + 指针）；
  - 原型里的东西落地或被推翻 → `prototypes/*/README.md` 的落差表（**落差表不许说谎**）。
- **"已知边界"要跟着变**：能力做完就把那条边界**删掉或改写**（例：助手窗口做完后，宪法里
  "工具台尚未主动开 assistant 窗口"那条必须消失）——否则下一位协作者会照着过期边界重复劳动。
- **一轮里我犯的错也要写**：2026-10-13 那轮记了两条（提交了只有调用没有定义的 preload；注入挂在
  异步路径上导致拖拽带根本没注入）。**只写成绩的日志没有维护价值**。
- **改插件源码后记得重建桌面那份产物**：直接跑 `electron.exe .` 会绕过 `prestart`（踩坑 #45）。
- **每轮收尾跑一次"文档覆盖审计"**（比记性可靠；2026-10-13 首次跑就发现最近 10 笔有 7 笔没进索引）：

  ```powershell
  # 在 dsh-desktop 下：逐笔查"提交号有没有落进 WORKLOG 索引 / 当日日志"
  $hashes = git log --format="%h" -10
  foreach ($h in $hashes) {
    $idx = Select-String -Path WORKLOG.md -Pattern $h -SimpleMatch -Quiet
    $log = Select-String -Path "logs/$(Get-Date -Format yyyy-MM-dd).md" -Pattern $h -SimpleMatch -Quiet
    "{0} 索引:{1} 日志:{2}  {3}" -f $h, $(if($idx){"✓"}else{"✗"}), $(if($log){"✓"}else{"✗"}), (git log -1 --format="%s" $h)
  }
  ```

  出现 `✗` 就**同一轮补齐**（索引行 + 日志里带上提交号）——"内容写了但没落提交号"也算缺口。
  **注意自指**：执行审计的那笔"补文档"提交**必然**显示 `✗`（它不可能引用自己的哈希），
  这是正常的；判据看的是**它之前**那些提交。

## 2.2 测试/预览实例一律放**非主屏**（2026-10-13 项目所有者要求）

> 原话："你在拉实例测试时去放在我的屏幕二上测试，不然会影响我"。探针与预览弹的都是**真窗口**，
> 落在作者正在干活的屏幕上就是打断他。

- 拉实例时带 `DSH_DESKTOP_DISPLAY=secondary`（壳侧认这个变量：**非主屏那块**，没有则回落主屏；
  也支持 `primary` 与数字索引）。
- **本机两块屏的实况**（少了这条最容易踩错）：主屏是 Windows 里的"屏幕 **2**"= **3840×2160 物理 / 273%**
  ⇒ Electron 报 `1407×792` DIP 工作区；另一块是设置里的"**1**"= `1093×698` DIP（312%）——**测试实例去这块**。
- **跨屏缩放会改尺寸**：两块屏缩放不同时，`setBounds` 跨屏搬窗会被系统按目标屏再缩放一次
  （实测请求 420×601 得到 481×688，正好 312/273）⇒ **窗口要在目标屏上直接创建**，别先建在主屏再搬。
- 门禁守着这条：hardening S9「每个弹出窗口都带目标屏」，少一处就红（`main.js` 里 6 个窗口全部覆盖）。
- **验证方式**：起实例后读 `<userData>/settings.json` 的 `windowBounds`，看 x/y 是否落在目标屏工作区内。

## 3. 构建 / 发布

- Windows：`npm run dist`（= `build.ps1`，自包含 + NSIS 安装包）
- macOS：推送 `v*` tag 或手动触发 GitHub Actions `build-macos`（在 mac runner 上构建 dmg 并自动发布）
- 发布：`npm run release`（打印 `gh release upload` 命令）；Windows 与 macOS 资产进**同一个**版本 Release

## 4. 项目原则

- **内核零修改**：外壳只负责拉起 `dsh web`、读 git（审阅）、承载页面；不改 DeepSeek Harness 内核代码。
- 文档分工：`README.md`（用户向使用说明）、`WORKLOG.md`（日志索引 + 协作规范）、`AGENTS.md`（本文件，协作约定）。
- 关键坑速查见 `WORKLOG.md` 的「踩坑速查」与 `logs/` 里的历史条目。

## 写作模式插件的仓库边界（2026-10-11 起）

写作模式已拆到独立仓库 `yuanzhoucanxiang/dsh-writing-mode`，本仓库以 **git submodule** 挂在 `plugin/writing-mode`。

- **不要在 `plugin/writing-mode/` 里改代码**：那是 submodule 的检出，提交只会留在本机；插件改动一律去新仓库提交，再在这里更新指针：
  ```powershell
  cd plugin/writing-mode ; git fetch ; git checkout <新提交>
  cd ../.. ; git add plugin/writing-mode ; git commit -m "chore: 更新写作模式插件到 <提交>"
  ```
- **`client.js` 不随插件仓库走**（构建产物）：新克隆先 `npm run build:writing`（`prestart`/`predev`/`build.ps1` 也会自动跑），否则 `plugin/writing-mode/client.js` 不存在，加载它的 Electron 门禁会失败。
- **克隆/CI 必须取子模块**：`git submodule update --init --recursive`；`.github/workflows/build-macos.yml` 的 checkout 已带 `submodules: recursive`。
- **门禁归属**：node 层（构建一致性、架构、`test/**`）在插件仓库；**需要外壳运行时的 Electron 端到端门禁留在本仓库**（`scripts/verify-writing-*.cjs`），路径不变、照旧跑。

## 工具台长条线：五条下次直接能用的规则（2026-10-13）

> **加/改模式先读 `docs/workbench-mode-constitution.md`（模式接入宪法，十五条 + 12 步清单）**。
> 细节在 `plugin/workbench/README.md` §六、`docs/plans/workbench-layer-v1.md` §0.1/§6.4.x、
> `docs/workbench-mode-guide.md`；原型与落差表在 `prototypes/workbench-home/README.md`。
> 下面只放"下次动手前必须先知道"的部分。

1. **形态分工**：壳在位 → 主屏收成 `strip`（**对话优先，不摆瓷砖格**），模式入口是**右缘接缝**；
   桥缺席（官方壳/老包/探针假宿主）→ 宽窗主屏 + 瓷砖格。改主屏布局前先问"这是给哪种形态写的"。
   **接缝点一下 = 拼接**（用户拍板 A，2026-10-13）；**进模式全屏走宽窗主屏的瓷砖「进入」**
   （`←` 回宽窗 → 点「进入」），探针里对应 `enterModeViaWide` 助手。
   *为什么*：瓷砖格是为宽窗设计的 v1 布局，塞进 420px 长条必然破版（用户实报过"长条内容不对"）。
2. **窗外画不了**：窗口边界是硬的，扇形/拼接只能**收在窗口内贴右缘**（plan §12-9 的 A）。
   要真出窗只能新增壳能力（透明置顶辅助窗 B / 原生菜单 C），而 B 的最小切片已被项目所有者否掉
   （"这个浮标没有用就去掉"）。*为什么*：别再把"窗外的桌面"当画布。
3. **置顶是 OS 位、不是自报值**：`setAlwaysOnTop` 只有 `screen-saver`/`pop-up-menu` 会真正置位，
   且**同一窗口只允许最新一次意图的补刀阶梯存活**（旧阶梯会把新位清掉——连续切形态时必现）；
   更狠的一条：**`isAlwaysOnTop()` 自己会撒谎**（报 true 而 OS 位没置上）⇒ 阶梯要**盲走全表**、
   复核要**无条件重申请**、后几刀用"先关再开"踢一脚。门禁读 Win32 `GWL_EXSTYLE`。
   *为什么*：自报值一路绿而实机全被盖住，这个坑踩过三次（踩坑速查 #29/#33/#38）。
4. **探针的 `click()` 点之前先断言元素在**（`scripts/verify-workbench-ui.cjs` 已改）：
   否则报错只有一句 `null.click`，定位成本极高。*为什么*：这一轮为此多花了两轮排查。
5. **改完 `main.js` / `preload.js` 必须再跑一次 `npm run shell-hardening-test`**：
   它**不在 `verify:writing-quick` 全链里**，而它钉的正是壳侧不变量——曾出现"改完置顶实现后没再跑，
   一条断言红了一整轮没人发现"（踩坑 #39）。*为什么*：独立门禁不会因为"别的都绿"而自动跑。

## 图片素材归档（用户级纪律）

agent 生成/下载的图片素材一律归档 LUMEN（文件夹/标签体系见项目 `AGENTS.md`；本仓库暂无固定文件夹约定）。
