# 复古科幻档案终端 · PALIS 主题（皮肤三）

> 设计定位：模拟恐怖 × 磁带未来主义 × SCP 档案局美学。
> 黑白单色高反差 + 蓝/红双强调色 + 全等宽 + 直角 + CRT 扫描线/噪点/暗角。
>
> **这份文件是什么**：PALIS 皮肤的设计文档与接入说明 —— ①完整 CSS 令牌与组件规范；
> ②需要覆盖的类名清单；③接入步骤（含"哪部分归外壳、哪部分归内核"的边界）；
> ④给内核侧主题插件的参考 CSS（对话气泡 [USER] / [PALIS CLERK]）。
>
> **什么时候重读**：想加第四套皮肤（抄这里的结构最快）；想改色（改令牌即可）；
> 内核升级后想给对话区做同款（用第 4 节的参考 CSS 写内核侧主题插件）。

---

## 1. 设计令牌（一键换色的那组变量）

启动画面（`renderer/splash.css`）与注入 UI（`preload.js` 的 `SKIN_TOKENS`）**各有一份**，
键名相同、值一致。改色时两处一起改。

```css
body[data-theme="palis"] {
  --bg-0: #0a0a0a;   /* 主底：近黑 */
  --bg-1: #141414;   /* 面板/窗框底 */
  --bg-2: #1e1e1e;   /* 徽标底衬 / 进度空格 */
  --fg-0: #e8e8e8;   /* 主文字：浅灰白 */
  --fg-1: #8a8a8a;   /* 次要文字 */
  --blue: #2b5fd9;   /* 系统蓝：进度 / 选中 / 已连接 */
  --red:  #c8322b;   /* 警示红：警告 / 危险操作 / ABORT */
  --border: #3a3a3a; /* 细边框 */
  --font-mono: "JetBrains Mono", "IBM Plex Mono", "Cascadia Mono", Consolas, "Courier New", monospace;
  --radius: 0px;     /* 直角世界：任何地方都不得出现圆角 */
}
```

纪律：

- 画面里**只允许出现** `--blue` 与 `--red` 两种彩色，其余一律灰阶；
- 全部等宽字体；英文全大写 + 大字距（`.12em`~`.34em` 视层级）；
- `border-radius` 一律 `0`，`box-shadow` 一律 `none`；
- 动效只有 `linear` / `steps()`，禁止任何平滑缓动。

---

## 2. 组件规范（已实现的部分）

### 2.1 启动画面（外壳自有的主舞台）

| 组件 | 规格 | 实现位置 |
|---|---|---|
| 底 | `--bg-0` 近黑 + 轻微暗角 | `.stage` |
| CRT 覆盖 | `repeating-linear-gradient` 横向扫描线（3px 周期）+ 内联 SVG `feTurbulence` 细噪点（feColorMatrix 压灰，避免彩色噪点）| `.crt` |
| 档案窗框 | 直角细边框；标题栏低饱和蓝白渐变，写 `PALIS ARCHIVE` / `NODE 09A // 已隔离文档` | `.frame` / `.frame-head` |
| 引导日志 | 窗框内逐行出现 `[ SYS INIT ]`→`[ MOUNT /dev/kernel ]`→`[ LOAD AGENT RUNTIME ]`→`[ AWAIT SERVICE LINK ]`→`[ LINK OK ]`；失败最后一行变红 `[ ABORT ]` | `#bootLog`（`renderer/splash.js` 的 `renderBootLog`）|
| 行式进度 | `[ ▓▓▓░░░░… ] 42%`：20 格空格用 `steps()` 般逐格点亮，与全局进度同源、单调不回退 | `.boot-log .ln-prog` |
| 光标 | 闪烁方块 `█`（`steps(1, end)`）| `.boot-log .cursor` |
| 字标 | JS 逐字打字机输出 `DEEPSEEK HARNESS ARCHIVE`（48ms/字，尾随方块光标）| `renderer/splash.js` 的 `typePalisTitle` |
| 徽标 | 鲸鱼落在 88×88 直角细边框底衬上，无光晕 | `.mark` |
| 状态行 | 等宽、字距 `.1em`，就绪变白、失败变红 | `.status` |
| 页脚状态条 | 贴底细条，顶边 1px，写版本 + `PALIS // NODE 09A` | `.footer` |
| 就绪/失败 | 窗框边线换蓝/红，标题栏渐变同步换色；一次 `steps()` 扫描线闪烁 | `.stage.ready/.failed`、`.crt` flash |
| 退场 | CRT 关机：全屏线性收成一条亮线再熄灭（`clip-path` + `steps(6)`）| `.stage.is-leaving .archive` |

### 2.2 审阅侧边栏（注入 UI，外壳自有的覆盖层）

| 组件 | 规格 | 实现位置 |
|---|---|---|
| 整体 | 黑白令牌覆盖（`SKIN_TOKENS` 的 `data-dsh-skin="palis"` 段）+ 全等宽 + 直角 | `preload.js` |
| 面板 | 直角细边框 + 面板内细扫描线（`repeating-linear-gradient`）| `PALIS_CHROME` |
| 标题栏 | 仿 Win95：低饱和蓝白渐变，大写 + `.22em` 字距 | `#dsh-review-head` / `#dsh-review-title` |
| 列表项 hover | 蓝色扫描线高亮 | `#dsh-review-item-row:hover` |
| 列表项选中 | 左侧 2px 白竖条 | `#dsh-review-item-row.dsh-selected` |
| 按钮 | 直角、细边、黑底白字；hover 反色（白底黑字）| `#dsh-review-commit button.primary` |
| 底部状态条 | 等宽小字大写 | `#dsh-review-foot` |

### 2.3 断连浮层 / 窗口底色 / 预览窗口

- 浮层走同一套 `SKIN_TOKENS` + 直角 + 等宽（`#dsh-shell-kernel-overlay`）；
- 窗口 `backgroundColor` = `#0a0a0a`（`main.js` 的 `THEMES.palis.bg`）；
- 托盘「预览启动画面…」直接能看到本皮肤（`splash.html?theme=palis&preview=1`）。

---

## 3. 需要覆盖的类名清单

**启动画面**（`renderer/splash.html` 的现有 DOM，全部复用，无新增必需节点）：

```
body[data-theme="palis"] .stage .glow .print .archive .crt .frame .frame-head .fh-id .fh-no
.boot-log .ln-ok .ln-dim .ln-blue .ln-red .ln-prog i .cursor
.card .mark .mark-whale .plate .title .type-cursor .subtitle .status .status-text
.error .error-kicker .error-text .log .actions .btn .btn.ghost .footer
.stage.ready .stage.failed .stage.flash .stage.is-leaving
```

**注入 UI**（`preload.js` 注入的右侧审阅侧栏与浮层）：

```
html[data-dsh-skin="palis"] #dsh-review-root #dsh-review-panel #dsh-review-head #dsh-review-title
#dsh-review-ws #dsh-review-mode button(.dsh-active) #dsh-review-item-row(.dsh-selected)
#dsh-review-fhead #dsh-review-badge #dsh-review-path #dsh-review-act #dsh-review-diff
#dsh-review-hunkbar(button) #dsh-review-sect #dsh-review-commit(textarea,button.primary,.c-meta)
#dsh-review-foot #dsh-review-toast #dsh-shell-kernel-overlay
```

---

## 4. 接入步骤（如何让用户在"设置"里切换）

皮肤系统已内置在托盘 →「皮肤」子菜单（三项单选）：

1. `main.js` 的 `THEMES` 注册表加一项（本次已加 `palis`）——这是唯一的"开关"；
2. `renderer/splash.css` 加 `body[data-theme="palis"]` 段（启动画面）；
3. `preload.js` 的 `SKIN_TOKENS` 加 `html[data-dsh-skin="palis"]` 段（注入 UI）+ `PALIS_CHROME` 结构性样式；
4. `splash.js` 的 `THEMES` 与 `applyTheme`（本次含打字机与引导日志）同步；
5. 回归：`npm run splash-check`（布局/概念断言，palis 有专属段）、`npm run sidebar-skin-check`（含"不外泄到内核页面"断言）；
6. 打包门禁照旧：`npm run dist` 会先跑 `selector-check`。

**边界（重要）**：以上全部只作用于**外壳自有的界面**。内核对话区（消息气泡、输入框、
会话列表）是内核页面的 DOM，外壳不注入样式——这是本项目"内核零修改"与生态调研
（`docs/dsh-ecosystem.md` §4：官方扩展点是 Slots，禁止硬编码私有选择器）的双重要求。
要把 [USER]/[PALIS CLERK] 做进对话区，正确路径是**内核侧主题插件走 Slots**，
参考 CSS 见下一节。

---

## 5. 内核侧参考 CSS（给主题插件的对话区部分，非外壳产物）

> 仅供内核侧主题插件（Slots）参考使用；外壳的皮肤**不包含**这段，也不会注入它。
> 类名 `palis-chat-*` 只是示例，实际应以 DSH 官方 Slots 协议为准。

```css
/* 主题插件经 Slots 注入后，宿主根节点挂 .palis-chat 作用域 */
.palis-chat {
  --bg-0:#0a0a0a; --bg-1:#141414; --bg-2:#1e1e1e;
  --fg-0:#e8e8e8; --fg-1:#8a8a8a; --blue:#2b5fd9; --red:#c8322b; --border:#3a3a3a;
  font-family:"JetBrains Mono","IBM Plex Mono","Cascadia Mono",Consolas,monospace;
}
/* 1. 对话区：消息气泡直角边框 */
.palis-chat .msg { border-radius:0; border:1px solid var(--border); background:var(--bg-1); }
/* 用户消息右对齐 + 蓝边框 */
.palis-chat .msg.user { border-color:var(--blue); }
/* AI 消息左对齐 + 白色细边框 */
.palis-chat .msg.assistant { border-color:var(--border); }
/* 2. 消息头部小标签 */
.palis-chat .msg.user::before   { content:"[USER]";        color:var(--blue); }
.palis-chat .msg.assistant::before { content:"[PALIS CLERK]"; color:var(--fg-1); }
/* 3. 输入框：终端风格 + 方块光标 */
.palis-chat textarea { font-family:inherit; background:var(--bg-0); color:var(--fg-0);
  border:1px solid var(--border); border-radius:0; caret-color:var(--fg-0); }
.palis-chat textarea::placeholder { content:"> AWAITING INPUT..."; color:var(--fg-1); }
/* 4. 状态栏：底部细条 */
.palis-chat .statusbar { border-top:1px solid var(--border); color:var(--fg-1);
  font-size:10px; letter-spacing:.14em; text-transform:uppercase; }
/* 5. 按钮：直角、细边、黑底白字，hover 反色 */
.palis-chat button { border-radius:0; border:1px solid var(--fg-0); background:var(--bg-0);
  color:var(--fg-0); }
.palis-chat button:hover { background:var(--fg-0); color:var(--bg-0); }
/* 6. 动效纪律：linear/steps 一律，无平滑缓动 */
```

---

— 设计文档：deepseek-v4-pro（2026-08-21）
