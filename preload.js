'use strict'

/**
 * 渲染侧预加载：为 splash 与内核页面提供最小 IPC 桥。
 * 对外壳而言的"注入"只有两处，且都是异常/按需出现的覆盖层，正常运行时零侵入：
 *   1. 内核断连浮层（异常时出现，提供"重启内核"）
 *   2. 右侧"修改审阅"侧边栏（外壳级 UI，默认折叠，点右侧标签展开）
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshShell', {
  status: () => ipcRenderer.invoke('shell:get-state'),
  onStatus: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('shell:status', h)
    return () => ipcRenderer.removeListener('shell:status', h)
  },
  onKernel: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('shell:kernel-status', h)
    return () => ipcRenderer.removeListener('shell:kernel-status', h)
  },
  onBootError: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('shell:boot-error', h)
    return () => ipcRenderer.removeListener('shell:boot-error', h)
  },
  // 启动画面淡出交接：主进程在 loadURL 之前发 shell:splash-exit，
  // 渲染侧播完淡出回 shell:splash-exit-done，避免"硬切"进工作区。
  onSplashExit: (cb) => {
    const h = () => cb()
    ipcRenderer.on('shell:splash-exit', h)
    return () => ipcRenderer.removeListener('shell:splash-exit', h)
  },
  splashExitDone: () => ipcRenderer.send('shell:splash-exit-done'),
  // 皮肤：托盘里切换主题时即时推给启动画面/预览窗口
  onTheme: (cb) => {
    const h = (_e, id) => cb(id)
    ipcRenderer.on('shell:theme', h)
    return () => ipcRenderer.removeListener('shell:theme', h)
  },
  restartKernel: () => ipcRenderer.send('shell:restart-kernel'),
  copyLog: () => ipcRenderer.send('shell:copy-log'),
  quit: () => ipcRenderer.send('shell:quit'),
  splashReady: () => ipcRenderer.send('shell:splash-ready'),
  changes: () => ipcRenderer.invoke('shell:changes'),
  sessionChanges: () => ipcRenderer.invoke('shell:session-changes'),
  gitInit: () => ipcRenderer.invoke('shell:git-init'),
  revert: (p, untracked) => ipcRenderer.invoke('shell:revert', p, untracked),
  revertChange: (sessionId, callId) => ipcRenderer.invoke('shell:revert-change', sessionId, callId),
  // 改动审阅信任闭环（逐文件/逐块）：hunk 传 null = 整个文件
  gitStage: (p, hunk) => ipcRenderer.invoke('shell:git-stage', p, hunk),
  gitUnstage: (p, hunk) => ipcRenderer.invoke('shell:git-unstage', p, hunk),
  gitRevertHunk: (p, hunk) => ipcRenderer.invoke('shell:git-revert-hunk', p, hunk),
  gitCommit: (message) => ipcRenderer.invoke('shell:git-commit', message),
  gitPush: () => ipcRenderer.invoke('shell:git-push'),
  openFile: (p) => ipcRenderer.invoke('shell:open-file', p),
  readFile: (p) => ipcRenderer.invoke('shell:read-file', p),
  getPanelWidth: () => ipcRenderer.invoke('shell:get-panel-width'),
  setPanelWidth: (w) => ipcRenderer.invoke('shell:set-panel-width', w),
  // 插件体检：入口打开设置面板 / 只读报告 / registry 更新比对 / 恢复被隔离插件
  openSettings: () => ipcRenderer.send('shell:open-settings'),
  pluginsReport: () => ipcRenderer.invoke('shell:plugins-report'),
  pluginsCheckUpdates: () => ipcRenderer.invoke('shell:plugins-check-updates'),
  pluginsRestore: () => ipcRenderer.invoke('shell:plugins-restore'),
  // 插件管理：按钮式禁用/启用（写 profile cordis.patch.yml，内核热重载）
  pluginsManageList: () => ipcRenderer.invoke('shell:plugins-manage-list'),
  pluginsManageToggle: (key, disable) => ipcRenderer.invoke('shell:plugins-manage-toggle', key, disable),
  // 软件更新：状态查询 / 手动检查 / 下载 / 安装；状态推进经 onUpdateStatus 推送
  updateGet: () => ipcRenderer.invoke('shell:update-get'),
  updateCheck: () => ipcRenderer.invoke('shell:update-check'),
  updateDownload: () => ipcRenderer.invoke('shell:update-download'),
  updateInstall: () => ipcRenderer.invoke('shell:update-install'),
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('shell:update-status', h)
    return () => ipcRenderer.removeListener('shell:update-status', h)
  },
  onSettingsTab: (cb) => {
    const h = (_e, tab) => cb(tab)
    ipcRenderer.on('shell:settings-tab', h)
    return () => ipcRenderer.removeListener('shell:settings-tab', h)
  },
})

/* ── 外壳皮肤（跟随托盘「皮肤」设置） ─────────────────────────────────────────
 * 做法：只在 <html> 上打一个 data-dsh-skin 标记，再把注入 UI 用到的
 * --dsw-alias-* 设计令牌**重定义在外壳自己的根元素上**（自定义属性只向下继承，
 * 绝不外泄到内核页面）。因此：
 *   deep（默认）    = 一个字都不覆盖，侧边栏继续跟随内核主题（原行为）
 *   seascape        = 覆盖成单色银盐，和海景启动画面同一套调子
 *   palis           = 复古科幻档案终端：黑白高反差 + 蓝/红双强调色 + 全等宽 + 直角
 */
const SKINS = ['deep', 'seascape', 'palis']
const SKIN_ATTR = 'dshSkin'
let pendingSkin = null

function applySkin(id) {
  const skin = SKINS.includes(id) ? id : 'deep'
  pendingSkin = skin
  const el = document.documentElement
  if (el) {
    el.dataset[SKIN_ATTR] = skin
    return
  }
  // preload 可能早于 <html> 存在：等 DOM 就绪再补上
  document.addEventListener('DOMContentLoaded', () => {
    if (document.documentElement && pendingSkin) document.documentElement.dataset[SKIN_ATTR] = pendingSkin
  }, { once: true })
}

/** 海景皮肤下注入 UI 的令牌覆盖（作用域限定在外壳自己的根元素内）。 */
const SKIN_TOKENS = `
  html[data-dsh-skin="seascape"] #dsh-review-root,
  html[data-dsh-skin="seascape"] #dsh-shell-kernel-overlay {
    --dsw-alias-bg-base: #0e1012;
    --dsw-alias-bg-layer-1: #14171a;
    --dsw-alias-label-primary: #e7ecee;
    --dsw-alias-label-secondary: #aeb5b9;
    --dsw-alias-label-tertiary: #6d7478;
    --dsw-alias-label-dimmed: #5a6165;
    --dsw-alias-label-primary-foreground: #e7ecee;
    --dsw-alias-border-l1: rgba(230, 236, 238, .07);
    --dsw-alias-border-l2: rgba(230, 236, 238, .14);
    --dsw-alias-interactive-bg-hover: rgba(230, 236, 238, .05);
    --dsw-alias-interactive-bg-hover-accent: rgba(230, 236, 238, .12);
    --dsw-alias-brand-primary: #cdd5d8;
    --dsw-alias-button-primary-fill: #2b3134;
    /* 调色像"调过色的银盐"：加为冷调、删为暖调，够分辨但不跳出单色 */
    --dsw-alias-state-success-primary: #a9c2b6;
    --dsw-alias-state-success-secondary: rgba(169, 194, 182, .13);
    --dsw-alias-state-success-tertiary: rgba(169, 194, 182, .09);
    --dsw-alias-state-error-primary: #c9adad;
    --dsw-alias-state-error-secondary: rgba(201, 173, 173, .15);
    --dsw-alias-state-warn-primary: #c6bda6;
    --dsw-alias-state-warn-secondary: rgba(198, 189, 166, .13);
    --dsw-alias-state-business-primary: #b0bcc3;
    --dsw-alias-state-business-tertiary: rgba(176, 188, 195, .13);
  }
  /* PALIS：复古科幻档案终端 —— 黑白高反差 + 蓝/红双强调色。
     这里只覆盖令牌，字体/直角/扫描线等结构性样式在下方 PALIS_CHROME。 */
  html[data-dsh-skin="palis"] #dsh-review-root,
  html[data-dsh-skin="palis"] #dsh-shell-kernel-overlay {
    --dsw-alias-bg-base: #0a0a0a;
    --dsw-alias-bg-layer-1: #141414;
    --dsw-alias-label-primary: #e8e8e8;
    --dsw-alias-label-secondary: #8a8a8a;
    --dsw-alias-label-tertiary: #6e6e6e;
    --dsw-alias-label-dimmed: #555555;
    --dsw-alias-label-primary-foreground: #0a0a0a;
    --dsw-alias-border-l1: rgba(232, 232, 232, .14);
    --dsw-alias-border-l2: rgba(232, 232, 232, .30);
    --dsw-alias-interactive-bg-hover: rgba(232, 232, 232, .07);
    --dsw-alias-interactive-bg-hover-accent: rgba(43, 95, 217, .22);
    --dsw-alias-brand-primary: #2b5fd9;
    --dsw-alias-button-primary-fill: #e8e8e8;
    --dsw-alias-state-success-primary: #e8e8e8;
    --dsw-alias-state-success-secondary: rgba(232, 232, 232, .10);
    --dsw-alias-state-success-tertiary: rgba(232, 232, 232, .06);
    --dsw-alias-state-error-primary: #c8322b;
    --dsw-alias-state-error-secondary: rgba(200, 50, 43, .14);
    --dsw-alias-state-warn-primary: #c8322b;
    --dsw-alias-state-warn-secondary: rgba(200, 50, 43, .10);
    --dsw-alias-state-business-primary: #2b5fd9;
    --dsw-alias-state-business-tertiary: rgba(43, 95, 217, .14);
  }
`

/* PALIS 的结构性样式：全等宽、直角、Win95 式标题栏、扫描线高亮、选中白竖条。
   作用域仍限制在外壳自己的根元素内，不碰内核页面。 */
const PALIS_CHROME = `
  html[data-dsh-skin="palis"] #dsh-review-root {
    font-family: "JetBrains Mono", "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
  }
  html[data-dsh-skin="palis"] #dsh-review-panel {
    border-radius: 0;
    border-left: 1px solid #3a3a3a;
    border-top: 1px solid #3a3a3a;
    box-shadow: none;
    /* 细扫描线：只在面板上（repeating-linear-gradient，无图片） */
    background-image:
      repeating-linear-gradient(0deg, rgba(232,232,232,.03) 0px, rgba(232,232,232,.03) 1px, transparent 1px, transparent 3px);
    background-color: #0a0a0a;
  }
  html[data-dsh-skin="palis"] #dsh-review-head {
    border-bottom: 1px solid #3a3a3a;
    /* 仿 Win95 标题栏：低饱和蓝白，大写字距 */
    background: linear-gradient(180deg, #3a4a6b, #2a3550);
  }
  html[data-dsh-skin="palis"] #dsh-review-title {
    font-family: "JetBrains Mono", "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
    font-size: 12px;
    letter-spacing: .22em;
    text-transform: uppercase;
    color: #d7dce8;
  }
  html[data-dsh-skin="palis"] #dsh-review-head button { border-radius: 0; }
  html[data-dsh-skin="palis"] #dsh-review-mode button {
    font-family: inherit;
    border-radius: 0;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  html[data-dsh-skin="palis"] #dsh-review-mode button.dsh-active { color: #e8e8e8; }
  html[data-dsh-skin="palis"] #dsh-review-ws {
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  /* 列表项：hover 扫描线高亮；选中项左侧白色竖条（直角的世界里用条代替圆点） */
  html[data-dsh-skin="palis"] #dsh-review-item-row,
  html[data-dsh-skin="palis"] #dsh-review-fhead {
    border-radius: 0;
  }
  html[data-dsh-skin="palis"] #dsh-review-item-row:hover,
  html[data-dsh-skin="palis"] #dsh-review-fhead:hover {
    background-image: repeating-linear-gradient(0deg, rgba(43,95,217,.14) 0px, rgba(43,95,217,.14) 1px, transparent 1px, transparent 3px);
  }
  html[data-dsh-skin="palis"] #dsh-review-item-row.dsh-selected {
    border-left: 2px solid #e8e8e8;
    padding-left: 12px;
  }
  html[data-dsh-skin="palis"] #dsh-review-badge,
  html[data-dsh-skin="palis"] #dsh-review-fcount,
  html[data-dsh-skin="palis"] #dsh-review-cnote,
  html[data-dsh-skin="palis"] #dsh-review-sect,
  html[data-dsh-skin="palis"] #dsh-review-commit .c-meta,
  html[data-dsh-skin="palis"] #dsh-review-foot { border-radius: 0; }
  html[data-dsh-skin="palis"] #dsh-review-path,
  html[data-dsh-skin="palis"] #dsh-review-diff,
  html[data-dsh-skin="palis"] #dsh-review-cdiff { font-family: inherit; }
  html[data-dsh-skin="palis"] #dsh-review-hunkbar,
  html[data-dsh-skin="palis"] #dsh-review-hunkbar button,
  html[data-dsh-skin="palis"] #dsh-review-commit textarea,
  html[data-dsh-skin="palis"] #dsh-review-commit button,
  html[data-dsh-skin="palis"] #dsh-review-act,
  html[data-dsh-skin="palis"] #dsh-review-cops button,
  html[data-dsh-skin="palis"] #dsh-review-vhead button { border-radius: 0; }
  /* 底部状态条：PALIS / 09A 已连接 */
  html[data-dsh-skin="palis"] #dsh-review-foot {
    border-top: 1px solid #3a3a3a;
    font-family: inherit;
    font-size: 10px;
    letter-spacing: .14em;
    text-transform: uppercase;
  }
  /* 按钮：直角细边黑底白字，hover 反色（白底黑字） */
  html[data-dsh-skin="palis"] #dsh-review-commit button.primary {
    border: 1px solid #e8e8e8;
    background: #0a0a0a;
    color: #e8e8e8;
  }
  html[data-dsh-skin="palis"] #dsh-review-commit button.primary:hover {
    background: #e8e8e8;
    color: #0a0a0a;
  }
  /* 断连浮层：直角、细边、警示红点 */
  html[data-dsh-skin="palis"] #dsh-shell-kernel-overlay {
    border-radius: 0;
    font-family: "JetBrains Mono", "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
  }
  html[data-dsh-skin="palis"] #dsh-shell-kernel-overlay button { border-radius: 0; }
`

/* ── 内核断连浮层（仅注入到内核页面，splash 自己渲染状态） ────────────────── */

const OVERLAY_ID = 'dsh-shell-kernel-overlay'

function removeOverlay() {
  const el = document.getElementById(OVERLAY_ID)
  if (el) el.remove()
}

function showOverlay(message) {
  if (location.protocol === 'file:' || document.getElementById(OVERLAY_ID)) return
  const style = document.createElement('style')
  style.textContent = [
    SKIN_TOKENS,
    `#${OVERLAY_ID}{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:12px;`,
    'padding:12px 16px;border-radius:12px;background:var(--dsh-ov-bg,rgba(20,16,28,.92));border:1px solid var(--dsh-ov-line,rgba(255,107,107,.45));',
    'box-shadow:0 8px 32px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e8e6f2);font:13px/1.5 "Segoe UI",system-ui,sans-serif;max-width:420px;}',
    `#${OVERLAY_ID} .dsh-dot{width:9px;height:9px;border-radius:50%;background:var(--dsh-ov-dot,#ff5d5d);box-shadow:0 0 10px var(--dsh-ov-dot,#ff5d5d);flex:none;animation:dshPulse 1.4s infinite;}`,
    `#${OVERLAY_ID} .dsh-msg{flex:1;color:var(--dsw-alias-label-secondary,#cfc9dd);}`,
    `#${OVERLAY_ID} button{flex:none;padding:6px 12px;border-radius:8px;border:1px solid var(--dsh-ov-btn-line,#5d6dff);background:var(--dsh-ov-btn,#2b2f4d);color:var(--dsw-alias-label-primary,#e6e9ff);cursor:pointer;font:inherit;}`,
    `#${OVERLAY_ID} button:hover{background:var(--dsh-ov-btn-hover,#383d63);}`,
    `#${OVERLAY_ID}.dsh-busy button{opacity:.55;pointer-events:none;}`,
    '@keyframes dshPulse{0%,100%{opacity:1}50%{opacity:.35}}',
    // 海景：浮层也变成单色（暖调银盐的警戒色，不跳出画面）
    `html[data-dsh-skin="seascape"] #${OVERLAY_ID}{--dsh-ov-bg:rgba(14,16,18,.94);--dsh-ov-line:rgba(201,173,173,.4);`,
    '--dsh-ov-dot:#c9adad;--dsh-ov-btn:#2b3134;--dsh-ov-btn-line:rgba(230,236,238,.18);--dsh-ov-btn-hover:#363d41;}',
  ].join('')
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = OVERLAY_ID
  const dot = document.createElement('span')
  dot.className = 'dsh-dot'
  const msg = document.createElement('span')
  msg.className = 'dsh-msg'
  msg.textContent = `内核连接已断开：${message || '未知原因'}`
  const btn = document.createElement('button')
  btn.textContent = '重启内核'
  btn.addEventListener('click', () => {
    el.classList.add('dsh-busy')
    btn.textContent = '正在重启…'
    ipcRenderer.send('shell:restart-kernel')
  })
  el.append(dot, msg, btn)
  document.body.appendChild(el)
}

ipcRenderer.on('shell:kernel-status', (_e, s) => {
  if (s.alive) removeOverlay()
  else showOverlay(s.message)
})

/* ── 右侧"修改审阅"侧边栏（外壳级覆盖层，Codex 式） ──────────────────────── */

function injectReviewSidebar() {
  if (location.protocol === 'file:') return // splash 不注入
  if (document.getElementById('dsh-review-root')) return

  const S = 'dsh-review'
  const style = document.createElement('style')
  // 主题：直接复用内核页面的 --dsw-alias-* 设计变量，自动跟随明暗主题；
  // 海景皮肤下由 SKIN_TOKENS 把这些令牌在外壳根元素上重定义成单色银盐。
  style.textContent = SKIN_TOKENS + PALIS_CHROME + `
    #${S}-root,#${S}-root *{box-sizing:border-box;margin:0;padding:0;}
    #${S}-root{font:13px/1.5 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
      color:var(--dsw-alias-label-primary,#e8e6f2);}
    /* 分割式布局：挤压用内联 margin 实现（不加 transition，避免 computed 取到动画中间值）
       右侧竖条 rail = 开关按钮 + 拖拽把手 的统一控件（Codex/VSCode 式分隔条）：
       面板关闭时贴在窗口右边缘；打开时成为页面与面板之间的分界条。 */
    #${S}-rail{position:fixed;top:0;bottom:0;right:0;width:7px;z-index:2147482950;cursor:col-resize;background:transparent;}
    #${S}-rail:hover,#${S}-rail.dsh-drag{background:var(--dsw-alias-interactive-bg-hover-accent,rgba(93,109,255,.28));}
    #${S}-grip{position:absolute;top:50%;transform:translateY(-50%);left:0;width:7px;text-align:center;
      font-size:13px;line-height:1;color:var(--dsw-alias-label-tertiary,#6f7a99);user-select:none;pointer-events:none;}
    #${S}-toggle{position:absolute;top:6px;right:0;height:24px;min-width:56px;padding:0 7px 0 9px;
      display:inline-flex;align-items:center;justify-content:center;gap:4px;
      background:var(--dsw-alias-bg-layer-1,rgba(30,34,54,.95));color:var(--dsw-alias-label-secondary,#aeb8d8);
      border:1px solid var(--dsw-alias-border-l2,transparent);border-right:none;border-radius:9px 0 0 9px;
      cursor:pointer;font:inherit;font-size:12px;white-space:nowrap;user-select:none;}
    #${S}-toggle:hover{color:var(--dsw-alias-label-primary,#e6e9ff);background:var(--dsw-alias-interactive-bg-hover,transparent);border-color:var(--dsw-alias-brand-primary,transparent);}
    #${S}-panel{position:fixed;top:0;right:0;bottom:0;width:360px;z-index:2147482900;
      background:var(--dsw-alias-bg-base,transparent);
      border-left:1px solid var(--dsw-alias-border-l2,transparent);
      display:flex;flex-direction:column;}
    #${S}-panel.dsh-hidden{display:none;}
    #${S}-head{padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);flex:none;}
    #${S}-title{font-size:15px;font-weight:650;letter-spacing:.02em;display:flex;align-items:center;justify-content:space-between;}
    #${S}-ws{font-size:11px;color:var(--dsw-alias-label-tertiary,#6f7a99);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #${S}-head button{background:none;border:none;color:var(--dsw-alias-label-tertiary,#8b93ad);cursor:pointer;font-size:13px;padding:2px 6px;}
    #${S}-head button:hover{color:var(--dsw-alias-label-primary,#e6e9ff);}
    #${S}-body{flex:1;overflow-y:auto;padding:8px 0;}
    #${S}-empty{padding:24px 18px;color:var(--dsw-alias-label-tertiary,#6f7a99);white-space:pre-wrap;}
    #${S}-item{border-bottom:1px solid var(--dsw-alias-border-l1,transparent);}
    #${S}-item-row{display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;flex-wrap:wrap;}
    #${S}-item-row:hover{background:var(--dsw-alias-interactive-bg-hover,transparent);}
    #${S}-badge{flex:none;font-size:11px;padding:1px 7px;border-radius:6px;font-weight:600;min-width:20px;text-align:center;}
    #${S}-badge.st-M{background:var(--dsw-alias-state-warn-secondary,transparent);color:var(--dsw-alias-state-warn-primary,#ffd97a);}
    #${S}-badge.st-A{background:var(--dsw-alias-state-success-secondary,transparent);color:var(--dsw-alias-state-success-primary,#7fe0a8);}
    #${S}-badge.st-D{background:var(--dsw-alias-state-error-secondary,transparent);color:var(--dsw-alias-state-error-primary,#ff9a9a);}
    #${S}-badge.st-R{background:var(--dsw-alias-interactive-bg-hover-accent,transparent);color:var(--dsw-alias-brand-primary,#c3b4ff);}
    #${S}-badge.st-??{background:var(--dsw-alias-state-business-tertiary,transparent);color:var(--dsw-alias-state-business-primary,#8ecbff);}
    #${S}-path{flex:1;font:12px/1.4 Consolas,"Cascadia Mono",monospace;color:var(--dsw-alias-label-secondary,#cfd6ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #${S}-act{flex:none;opacity:0;transition:opacity .12s;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93ad);background:none;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:6px;padding:2px 8px;cursor:pointer;}
    #${S}-act:hover{color:var(--dsw-alias-label-primary,#e6e9ff);border-color:var(--dsw-alias-brand-primary,transparent);}
    #${S}-item-row:hover #${S}-act{opacity:1;}
    #${S}-diff{font:12px/1.55 Consolas,"Cascadia Mono",monospace;background:var(--dsw-alias-bg-layer-1,transparent);border-top:1px solid var(--dsw-alias-border-l1,transparent);
      padding:8px 0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-all;}
    #${S}-diff .ln-add{color:var(--dsw-alias-state-success-primary,#8ee6b0);background:var(--dsw-alias-state-success-tertiary,transparent);}
    #${S}-diff .ln-del{color:var(--dsw-alias-state-error-primary,#ff9a9a);background:var(--dsw-alias-state-error-secondary,transparent);}
    #${S}-diff .ln-hunk{color:var(--dsw-alias-brand-primary,#8ecbff);}
    #${S}-diff .ln-meta{color:var(--dsw-alias-label-tertiary,#6f7a99);}
    #${S}-diff .ln-ctx{color:var(--dsw-alias-label-dimmed,#7a8398);}
    /* ── 逐 hunk 操作（信任闭环：每一块都能单独暂存/丢弃） ── */
    #${S}-sect{padding:7px 14px 3px;font-size:11px;letter-spacing:.1em;color:var(--dsw-alias-label-tertiary,#6f7a99);}
    #${S}-hunk{border-top:1px solid var(--dsw-alias-border-l1,transparent);}
    #${S}-hunkbar{display:flex;align-items:center;gap:6px;padding:3px 10px;background:var(--dsw-alias-interactive-bg-hover,transparent);}
    #${S}-hunkbar .h-label{flex:1;font:11px/1.5 Consolas,"Cascadia Mono",monospace;color:var(--dsw-alias-brand-primary,#8ecbff);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #${S}-hunkbar button{flex:none;font:inherit;font-size:11px;padding:1px 8px;border-radius:6px;cursor:pointer;background:none;
      border:1px solid var(--dsw-alias-border-l2,transparent);color:var(--dsw-alias-label-tertiary,#8b93ad);}
    #${S}-hunkbar button:hover{color:var(--dsw-alias-label-primary,#e6e9ff);border-color:var(--dsw-alias-brand-primary,transparent);}
    #${S}-hunkbar button:disabled{opacity:.5;cursor:default;}
    /* ── 提交条（提交只作用于已暂存内容） ── */
    #${S}-commit{flex:none;display:none;flex-direction:column;gap:7px;padding:10px 14px;
      border-top:1px solid var(--dsw-alias-border-l2,transparent);}
    #${S}-commit.dsh-on{display:flex;}
    #${S}-commit textarea{width:100%;min-height:44px;max-height:120px;resize:vertical;font:inherit;font-size:12px;padding:6px 8px;
      border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.22));color:var(--dsw-alias-label-primary,#e6e9ff);
      border:1px solid var(--dsw-alias-border-l2,transparent);}
    #${S}-commit .c-row{display:flex;gap:8px;align-items:center;}
    #${S}-commit .c-meta{flex:1;font-size:11px;color:var(--dsw-alias-label-tertiary,#6f7a99);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #${S}-commit button{flex:none;font:inherit;font-size:12px;padding:5px 14px;border-radius:8px;cursor:pointer;
      border:1px solid var(--dsw-alias-border-l2,transparent);background:transparent;color:var(--dsw-alias-label-secondary,#aeb8d8);}
    #${S}-commit button.primary{background:var(--dsw-alias-button-primary-fill,#4f63d8);
      color:var(--dsw-alias-label-primary-foreground,#f2f4ff);border-color:transparent;}
    #${S}-commit button:disabled{opacity:.5;cursor:default;}
    /* ── 共存模式：内核侧已有右侧栏（如 dsh-better-sidebar）时不抢屏幕右缘 ── */
    #${S}-root.dsh-coexist #${S}-rail{display:none;}
    #${S}-root.dsh-coexist #${S}-panel{box-shadow:0 0 0 1px var(--dsw-alias-border-l2,transparent),-18px 0 48px -12px rgba(0,0,0,.55);}
    #${S}-foot{flex:none;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l2,transparent);font-size:12px;color:var(--dsw-alias-label-tertiary,#6f7a99);display:flex;justify-content:space-between;}
    #${S}-mode{display:flex;gap:6px;margin:10px 0 2px;flex:none;}
    #${S}-mode button{flex:1;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,transparent);background:transparent;color:var(--dsw-alias-label-secondary,#8b93ad);cursor:pointer;font:inherit;font-size:12px;}
    #${S}-mode button:hover{color:var(--dsw-alias-label-primary,#e6e9ff);border-color:var(--dsw-alias-brand-primary,transparent);}
    #${S}-mode button.dsh-active{background:var(--dsw-alias-button-primary-fill,transparent);color:var(--dsw-alias-label-primary-foreground,#e6e9ff);border-color:transparent;}
    /* ── 会话改动视图（Codex 式：按轮次带提问分组 → 按文件分组 → 逐条改动）── */
    #${S}-turn{border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}
    #${S}-turn-head{padding:10px 14px 6px;background:var(--dsw-alias-interactive-bg-hover,transparent);}
    #${S}-turn-label{font-size:11px;color:var(--dsw-alias-brand-primary,#5d6dff);letter-spacing:.08em;font-weight:600;}
    #${S}-turn-prompt{margin-top:4px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#e6e9ff);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;}
    #${S}-fgroup{border-bottom:1px solid var(--dsw-alias-border-l1,transparent);}
    #${S}-fhead{display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;flex-wrap:wrap;}
    #${S}-fhead:hover{background:var(--dsw-alias-interactive-bg-hover,transparent);}
    #${S}-fcount{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#6f7a99);border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:8px;padding:0 6px;}
    #${S}-fchev{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#6f7a99);transition:transform .12s;}
    #${S}-fhead.dsh-closed #${S}-fchev{transform:rotate(-90deg);}
    #${S}-citem{padding:6px 14px 8px 26px;border-top:1px dashed var(--dsw-alias-border-l1,transparent);}
    #${S}-crow{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;}
    #${S}-crow .dsh-cbadge{flex:none;font-size:10px;padding:1px 6px;border-radius:5px;font-weight:600;}
    #${S}-crow .dsh-cbadge.w{background:var(--dsw-alias-state-success-secondary,transparent);color:var(--dsw-alias-state-success-primary,#7fe0a8);}
    #${S}-crow .dsh-cbadge.e{background:var(--dsw-alias-state-warn-secondary,transparent);color:var(--dsw-alias-state-warn-primary,#ffd97a);}
    #${S}-crow .dsh-cbadge.s{background:var(--dsw-alias-interactive-bg-hover-accent,transparent);color:var(--dsw-alias-brand-primary,#c3b4ff);}
    #${S}-cnote{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#6f7a99);}
    #${S}-cops{margin-left:auto;flex:none;display:flex;gap:6px;}
    #${S}-cops button{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93ad);background:none;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:6px;padding:1px 8px;cursor:pointer;}
    #${S}-cops button:hover{color:var(--dsw-alias-label-primary,#e6e9ff);border-color:var(--dsw-alias-brand-primary,transparent);}
    #${S}-cops button:disabled{opacity:.5;cursor:default;}
    #${S}-cdiff{margin-top:6px;font:11.5px/1.55 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;word-break:break-all;
      background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l1,transparent);border-radius:8px;overflow:hidden;}
    #${S}-cdiff .cd-old{color:var(--dsw-alias-state-error-primary,#ff9a9a);background:var(--dsw-alias-state-error-secondary,transparent);padding:6px 10px;white-space:pre-wrap;}
    #${S}-cdiff .cd-new{color:var(--dsw-alias-state-success-primary,#8ee6b0);background:var(--dsw-alias-state-success-tertiary,transparent);padding:6px 10px;white-space:pre-wrap;}
    #${S}-cdiff .cd-more{display:block;width:100%;text-align:center;font:11px/1 inherit;color:var(--dsw-alias-label-tertiary,#6f7a99);background:none;border:none;border-top:1px solid var(--dsw-alias-border-l1,transparent);padding:3px 0;cursor:pointer;}
    #${S}-cdiff .cd-more:hover{color:var(--dsw-alias-label-primary,#e6e9ff);}
    #${S}-toast{position:fixed;right:376px;bottom:24px;z-index:2147483000;max-width:300px;padding:10px 14px;border-radius:10px;
      font-size:12px;line-height:1.5;box-shadow:0 6px 24px rgba(0,0,0,.35);display:none;}
    #${S}-toast.dsh-ok{background:var(--dsw-alias-state-success-secondary,rgba(32,64,48,.95));color:var(--dsw-alias-state-success-primary,#7fe0a8);border:1px solid var(--dsw-alias-state-success-primary,transparent);}
    #${S}-toast.dsh-err{background:var(--dsw-alias-state-error-secondary,rgba(64,28,36,.95));color:var(--dsw-alias-state-error-primary,#ff9a9a);border:1px solid var(--dsw-alias-state-error-primary,transparent);}
    /* ── 文件查看器（面板内读取/渲染，Codex/VSCode 式） ── */
    #${S}-view{display:flex;flex-direction:column;flex:1;min-height:0;}
    #${S}-vhead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}
    #${S}-vhead button{font-size:12px;color:var(--dsw-alias-label-secondary,#8b93ad);background:none;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:6px;padding:3px 10px;cursor:pointer;flex:none;}
    #${S}-vhead button:hover{color:var(--dsw-alias-label-primary,#e6e9ff);border-color:var(--dsw-alias-brand-primary,transparent);}
    #${S}-vpath{flex:1;font:11px/1.4 Consolas,"Cascadia Mono",monospace;color:var(--dsw-alias-label-secondary,#cfd6ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;}
    #${S}-vmeta{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#6f7a99);}
    #${S}-vbody{flex:1;overflow-y:auto;padding:12px 14px 24px;}
    #${S}-vbody pre{background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l1,transparent);border-radius:8px;
      padding:10px 12px;margin:10px 0;overflow-x:auto;font:11.5px/1.6 Consolas,"Cascadia Mono",monospace;color:var(--dsw-alias-label-secondary,#cfd6ea);white-space:pre;}
    #${S}-vbody pre .md-lang{display:block;font-size:10px;color:var(--dsw-alias-label-tertiary,#6f7a99);margin-bottom:4px;}
    #${S}-vbody h1,#${S}-vbody h2,#${S}-vbody h3,#${S}-vbody h4{margin:14px 0 6px;line-height:1.35;color:var(--dsw-alias-label-primary,#e6e9ff);}
    #${S}-vbody h1{font-size:18px;font-weight:700;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);padding-bottom:6px;}
    #${S}-vbody h2{font-size:15px;font-weight:650;}
    #${S}-vbody h3{font-size:13.5px;font-weight:600;}
    #${S}-vbody h4{font-size:13px;font-weight:600;}
    #${S}-vbody p{margin:6px 0;line-height:1.6;}
    #${S}-vbody ul,#${S}-vbody ol{margin:6px 0;padding-left:22px;line-height:1.6;}
    #${S}-vbody blockquote{margin:8px 0;padding:4px 12px;border-left:3px solid var(--dsw-alias-brand-primary,#5d6dff);
      color:var(--dsw-alias-label-secondary,#cfd6ea);background:var(--dsw-alias-interactive-bg-hover,transparent);border-radius:0 6px 6px 0;}
    #${S}-vbody hr{border:none;border-top:1px solid var(--dsw-alias-border-l2,transparent);margin:12px 0;}
    #${S}-vbody code{font:11px/1.5 Consolas,"Cascadia Mono",monospace;background:var(--dsw-alias-interactive-bg-hover,transparent);
      padding:1px 5px;border-radius:4px;color:var(--dsw-alias-brand-primary,#c3b4ff);}
    #${S}-vbody pre code{background:none;padding:0;color:inherit;}
    #${S}-vbody a{color:var(--dsw-alias-brand-primary,#8ecbff);text-decoration:none;}
    #${S}-vbody a:hover{text-decoration:underline;}
    #${S}-vbody .v-note{font-size:11px;color:var(--dsw-alias-label-tertiary,#6f7a99);margin-bottom:8px;}
    #${S}-vbody .v-code{font:11.5px/1.6 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#cfd6ea);}
  `
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = `${S}-root`

  // 右侧竖条：开关按钮 + 拖拽把手 的统一控件
  const rail = document.createElement('div')
  rail.id = `${S}-rail`
  rail.title = '拖动调宽（双击恢复默认宽度）'
  const toggle = document.createElement('button')
  toggle.id = `${S}-toggle`
  toggle.type = 'button'
  toggle.textContent = '❮ 审阅'
  toggle.title = '展开修改审阅侧边栏'
  const grip = document.createElement('div')
  grip.id = `${S}-grip`
  grip.textContent = '⋮'
  grip.title = ''
  rail.append(toggle, grip)

  const panel = document.createElement('div')
  panel.id = `${S}-panel`
  panel.classList.add('dsh-hidden')

  const head = document.createElement('div')
  head.id = `${S}-head`
  const titleRow = document.createElement('div')
  titleRow.id = `${S}-title`
  const titleText = document.createElement('span')
  titleText.textContent = '修改审阅'
  const headBtns = document.createElement('span')
  const refreshBtn = document.createElement('button')
  refreshBtn.textContent = '⟳'
  refreshBtn.title = '刷新'
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  closeBtn.title = '收起'
  headBtns.append(refreshBtn, closeBtn)
  titleRow.append(titleText, headBtns)
  // 视图切换：会话改动（本次会话 agent 的文件修改）| Git 工作区（未提交改动）
  const modeRow = document.createElement('div')
  modeRow.id = `${S}-mode`
  const modeSession = document.createElement('button')
  modeSession.textContent = '会话改动'
  modeSession.title = '本次会话 agent 的文件修改（审阅桥实时采集，可逐条撤销）'
  const modeGit = document.createElement('button')
  modeGit.textContent = 'Git 工作区'
  modeGit.title = '工作区未提交改动'
  modeRow.append(modeSession, modeGit)
  const ws = document.createElement('div')
  ws.id = `${S}-ws`
  ws.textContent = '…'
  head.append(titleRow, modeRow, ws)

  const body = document.createElement('div')
  body.id = `${S}-body`

  const foot = document.createElement('div')
  foot.id = `${S}-foot`
  const footCount = document.createElement('span')
  footCount.id = `${S}-count`
  const footHint = document.createElement('span')
  footHint.textContent = '撤销 = 精确逆序回退该次改动'

  foot.append(footCount, footHint)

  // 提交条（Git 视图专用）：提交只作用于已暂存内容，推送前主进程会二次确认
  const commitRow = document.createElement('div')
  commitRow.id = `${S}-commit`
  const commitMsg = document.createElement('textarea')
  commitMsg.placeholder = '提交信息（只提交已暂存的改动）'
  commitMsg.spellcheck = false
  const cRow = document.createElement('div')
  cRow.className = 'c-row'
  const commitMeta = document.createElement('span')
  commitMeta.className = 'c-meta'
  const commitBtn = document.createElement('button')
  commitBtn.className = 'primary'
  commitBtn.textContent = '提交'
  const pushBtn = document.createElement('button')
  pushBtn.textContent = '推送'
  cRow.append(commitMeta, commitBtn, pushBtn)
  commitRow.append(commitMsg, cRow)

  const toast = document.createElement('div')
  toast.id = `${S}-toast`

  panel.append(head, body, commitRow, foot)
  root.append(rail, panel, toast)
  document.body.appendChild(root)

  /**
   * 共存检测：内核侧若已经有右侧栏插件（如 dsh-better-sidebar），就不去抢屏幕右缘 ——
   * 隐藏我们的 rail、面板改为浮层（不挤压页面），入口只留菜单/快捷键 Ctrl+Shift+B。
   * 判据用网络资源里的插件 id（client bundle 走 /plugins/<id>/client.js），不刮 DOM。
   */
  function detectCoexist() {
    const RIVALS = /better-sidebar|dsh-workbench|dsh-web-shell/i
    try {
      const hit = performance.getEntriesByType('resource').some((e) => RIVALS.test(e.name || ''))
      if (hit) return true
    } catch {}
    return !!document.querySelector('[id*="better-sidebar"],[class*="better-sidebar"]')
  }

  let coexist = detectCoexist()
  root.classList.toggle('dsh-coexist', coexist)
  // 插件是异步加载的，晚到也要认：再探几次（探到就定，不反复抖动）
  let coexistProbes = 0
  const coexistTimer = setInterval(() => {
    coexistProbes++
    if (!coexist && detectCoexist()) {
      coexist = true
      root.classList.add('dsh-coexist')
      if (!panel.classList.contains('dsh-hidden')) {
        document.body.style.marginRight = '' // 让位：立刻停止挤压页面
        rail.style.right = '0px'
      }
    }
    if (coexist || coexistProbes > 10) clearInterval(coexistTimer)
  }, 1500)

  let mode = 'session' // 'session' | 'git'
  let data = { isGit: false, workspace: '', files: [] }
  let sessionData = { ok: false, entries: [] }
  let expanded = {}
  let lastSig = ''
  let timer = null
  let toastTimer = null
  let view = null // 文件查看器状态：null=列表；否则 { path, content, truncated, size, error }
  let panelWidth = 360 // 侧边栏宽度（可从设置读回，拖拽调整后持久化）
  let dragging = null // 拖拽会话：null | { openAtStart }（宽度直接由鼠标 X 决定）

  function showToast(msg, isErr) {
    toast.textContent = msg
    toast.className = isErr ? 'dsh-err' : 'dsh-ok'
    toast.style.display = ''
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.style.display = 'none' }, 4200)
  }

  function applyPanelWidth() {
    panel.style.width = panelWidth + 'px'
    // 共存模式下不挤压页面（内核侧右侧栏已经占了布局），面板以浮层形式盖在上面
    document.body.style.marginRight = coexist ? '' : panelWidth + 'px'
    rail.style.right = (panelWidth - 4) + 'px'
    toast.style.right = (panelWidth + 16) + 'px'
  }

  function setOpen(open) {
    panel.classList.toggle('dsh-hidden', !open)
    toggle.textContent = open ? '审阅 ❯' : '❮ 审阅'
    toggle.title = open ? '收起修改审阅侧边栏' : '展开修改审阅侧边栏'
    if (open) {
      // 分割式布局：内联 margin 把内核页面向左挤开（样式表规则会被应用覆盖，必须内联）
      applyPanelWidth()
      refresh()
      timer = setInterval(refresh, 5000)
    } else {
      document.body.style.marginRight = ''
      rail.style.right = '0px'
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }

  // 拖拽调宽：面板左缘跟随鼠标（关闭状态下拖动 = 直接拉出面板），
  // 范围 320px ~ min(800, 窗口宽-420)；双击恢复默认 360px。
  rail.addEventListener('pointerdown', (e) => {
    if (e.target === toggle) return // 开关按钮不参与拖拽
    dragging = { openAtStart: !panel.classList.contains('dsh-hidden') }
    rail.setPointerCapture(e.pointerId)
    rail.classList.add('dsh-drag')
    e.preventDefault()
  })
  rail.addEventListener('pointermove', (e) => {
    if (!dragging) return
    if (!dragging.openAtStart && panel.classList.contains('dsh-hidden')) {
      // 关闭状态下拖动：仅当向左移动足够距离才拉出面板，避免误触
      const dx = window.innerWidth - e.clientX
      if (dx < 40) return
      setOpen(true)
    }
    const maxW = Math.min(800, window.innerWidth - 420)
    const next = Math.max(320, Math.min(maxW, window.innerWidth - e.clientX))
    if (next === panelWidth) return
    panelWidth = next
    applyPanelWidth()
  })
  const endDrag = () => {
    if (!dragging) return
    dragging = null
    rail.classList.remove('dsh-drag')
    ipcRenderer.invoke('shell:set-panel-width', panelWidth)
  }
  rail.addEventListener('pointerup', endDrag)
  rail.addEventListener('pointercancel', endDrag)
  rail.addEventListener('dblclick', (e) => {
    if (e.target === toggle) return
    panelWidth = 360
    applyPanelWidth()
    ipcRenderer.invoke('shell:set-panel-width', panelWidth)
  })

  // 启动时读回持久化宽度（preload 隔离世界里没有 window.dshShell，必须直连 ipcRenderer）
  ipcRenderer.invoke('shell:get-panel-width').then((w) => {
    if (typeof w === 'number' && w >= 320 && w <= 800) panelWidth = w
  }).catch(() => {})

  toggle.addEventListener('click', () => setOpen(panel.classList.contains('dsh-hidden')))
  // 外壳快捷键 / 菜单驱动：切换审阅面板（Ctrl+Shift+B）与手动刷新
  ipcRenderer.on('shell:toggle-review', () => setOpen(panel.classList.contains('dsh-hidden')))
  ipcRenderer.on('shell:open-review', () => {
    if (panel.classList.contains('dsh-hidden')) setOpen(true)
    else refresh()
  })
  ipcRenderer.on('shell:refresh-review', () => {
    if (!panel.classList.contains('dsh-hidden')) refresh()
  })
  closeBtn.addEventListener('click', () => setOpen(false))
  refreshBtn.addEventListener('click', refresh)
  modeSession.addEventListener('click', () => { mode = 'session'; view = null; lastSig = ''; syncMode(); refresh() })
  modeGit.addEventListener('click', () => { mode = 'git'; view = null; lastSig = ''; syncMode(); refresh() })

  function syncMode() {
    modeSession.classList.toggle('dsh-active', mode === 'session')
    modeGit.classList.toggle('dsh-active', mode === 'git')
  }
  syncMode()

  function statusLabel(st) {
    if (st === '??') return { label: '新', cls: 'st-??' }
    if (st[0] === 'M' || st[1] === 'M') return { label: '改', cls: 'st-M' }
    if (st[0] === 'A') return { label: '增', cls: 'st-A' }
    if (st[0] === 'D' || st[1] === 'D') return { label: '删', cls: 'st-D' }
    if (st[0] === 'R') return { label: '重', cls: 'st-R' }
    return { label: st.trim() || '?', cls: '' }
  }

  function diffLines(diff) {
    const wrap = document.createElement('div')
    for (const raw of diff.split('\n')) {
      const line = document.createElement('div')
      let cls = 'ln-ctx'
      if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('index ') || raw.startsWith('diff ')) cls = 'ln-meta'
      else if (raw.startsWith('@@')) cls = 'ln-hunk'
      else if (raw.startsWith('+')) cls = 'ln-add'
      else if (raw.startsWith('-')) cls = 'ln-del'
      line.className = cls
      line.textContent = raw || ' '
      wrap.appendChild(line)
    }
    return wrap
  }

  function openFileBtn(file) {
    const b = document.createElement('button')
    b.textContent = '打开'
    b.title = '在系统编辑器中打开该文件'
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      await ipcRenderer.invoke('shell:open-file', file)
    })
    return b
  }

  function viewFileBtn(file) {
    const b = document.createElement('button')
    b.textContent = '查看'
    b.title = '在面板内查看文件内容（.md 渲染为 Markdown）'
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      await viewFile(file)
    })
    return b
  }

  async function viewFile(file) {
    const r = await ipcRenderer.invoke('shell:read-file', file)
    view = { file, ...(r || {}) }
    render()
  }

  /* ── 最小 Markdown 渲染器（纯 DOM 构建，textContent 填充，无 innerHTML） ── */

  function mdInline(text) {
    const out = []
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g
    let last = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)))
      const tok = m[0]
      if (tok.startsWith('`')) {
        const el = document.createElement('code')
        el.textContent = tok.slice(1, -1)
        out.push(el)
      } else if (tok.startsWith('**')) {
        const el = document.createElement('strong')
        el.textContent = tok.slice(2, -2)
        out.push(el)
      } else if (tok.startsWith('*')) {
        const el = document.createElement('em')
        el.textContent = tok.slice(1, -1)
        out.push(el)
      } else {
        const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
        const a = document.createElement('a')
        a.textContent = lm[1]
        a.href = lm[2]
        a.target = '_blank'
        a.rel = 'noreferrer'
        out.push(a)
      }
      last = m.index + tok.length
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)))
    return out
  }

  function renderMarkdown(md) {
    const frag = document.createDocumentFragment()
    const lines = md.split('\n')
    let i = 0
    const append = (el, nodes) => {
      for (const n of nodes) el.appendChild(n)
      return el
    }
    while (i < lines.length) {
      const line = lines[i]
      if (/^```/.test(line)) {
        const lang = line.slice(3).trim()
        const buf = []
        i++
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i])
          i++
        }
        i++ // 跳过收尾围栏
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        if (lang) {
          const tag = document.createElement('span')
          tag.className = 'md-lang'
          tag.textContent = lang
          pre.appendChild(tag)
        }
        code.textContent = buf.join('\n') || ' '
        pre.appendChild(code)
        frag.appendChild(pre)
        continue
      }
      if (line.trim() === '') { i++; continue }
      let m = /^(#{1,4})\s+(.*)$/.exec(line)
      if (m) {
        frag.appendChild(append(document.createElement('h' + m[1].length), mdInline(m[2])))
        i++
        continue
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { frag.appendChild(document.createElement('hr')); i++; continue }
      m = /^>\s?(.*)$/.exec(line)
      if (m) {
        frag.appendChild(append(document.createElement('blockquote'), mdInline(m[1])))
        i++
        continue
      }
      m = /^\s*[-*+]\s+(.*)$/.exec(line)
      if (m) {
        const ul = document.createElement('ul')
        while (m) {
          ul.appendChild(append(document.createElement('li'), mdInline(m[1])))
          i++
          if (i >= lines.length) break
          m = /^\s*[-*+]\s+(.*)$/.exec(lines[i])
        }
        frag.appendChild(ul)
        continue
      }
      m = /^\s*\d+[.)]\s+(.*)$/.exec(line)
      if (m) {
        const ol = document.createElement('ol')
        while (m) {
          ol.appendChild(append(document.createElement('li'), mdInline(m[1])))
          i++
          if (i >= lines.length) break
          m = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
        }
        frag.appendChild(ol)
        continue
      }
      frag.appendChild(append(document.createElement('p'), mdInline(line)))
      i++
    }
    return frag
  }

  function renderViewer() {
    ws.textContent = ''
    body.textContent = ''
    const v = document.createElement('div')
    v.id = `${S}-view`

    const vhead = document.createElement('div')
    vhead.id = `${S}-vhead`
    const back = document.createElement('button')
    back.textContent = '⟵ 返回'
    back.title = '返回改动列表'
    back.addEventListener('click', () => { view = null; render() })
    const vpath = document.createElement('span')
    vpath.id = `${S}-vpath`
    vpath.textContent = view.file
    vpath.title = view.file
    const vmeta = document.createElement('span')
    vmeta.id = `${S}-vmeta`
    vhead.append(back, vpath, vmeta, openFileBtn(view.file))
    v.appendChild(vhead)

    const vbody = document.createElement('div')
    vbody.id = `${S}-vbody`

    if (view.ok !== true) {
      const err = document.createElement('div')
      err.id = `${S}-empty`
      err.textContent = '读取失败：' + (view.error || '未知错误')
      vbody.appendChild(err)
    } else if (/\.(md|markdown|mdown|mkd)$/i.test(view.file)) {
      vbody.appendChild(renderMarkdown(view.content))
    } else {
      const code = document.createElement('div')
      code.className = 'v-code'
      code.textContent = view.content
      vbody.appendChild(code)
    }
    v.appendChild(vbody)
    body.appendChild(v)

    const sizeTxt = view.size !== undefined
      ? (view.size >= 1024 * 1024 ? (view.size / 1024 / 1024).toFixed(2) + ' MB' : (view.size / 1024).toFixed(1) + ' KB')
      : ''
    const md = /\.(md|markdown|mdown|mkd)$/i.test(view.file) ? ' · Markdown 预览' : ' · 纯文本'
    vmeta.textContent = (sizeTxt ? sizeTxt + ' · ' : '') + (view.truncated ? '已截断（>512KB）' : '') + md
    footCount.textContent = view.truncated ? '内容已截断' : ''
  }

  /**
   * 把一段 diff 切成 hunk（**必须与主进程 lib/git-review.js 的 splitDiff 规则完全一致**，
   * 否则"第几块"的编号会错位：从第一个 @@ 开始、遇 @@ 起新块、遇 `diff --git ` 停）。
   * 这里只用于显示与编号；真正的补丁由主进程现读现切。
   */
  function splitHunks(text) {
    const lines = String(text || '').split('\n')
    const first = lines.findIndex((l) => l.startsWith('@@'))
    if (first < 0) return []
    const out = []
    let cur = null
    for (let i = first; i < lines.length; i++) {
      const l = lines[i]
      if (l.startsWith('@@')) {
        if (cur) out.push(cur)
        cur = [l]
        continue
      }
      if (!cur) continue
      if (l.startsWith('diff --git ')) break
      cur.push(l)
    }
    if (cur) out.push(cur)
    return out
  }

  /** 逐块渲染：块头一排按钮（暂存这块 / 丢弃这块 / 取消暂存这块），块体复用 diff 着色。 */
  function hunkBlocks(file, text, staged) {
    const frag = document.createDocumentFragment()
    const hunks = splitHunks(text)
    hunks.forEach((lines, idx) => {
      const box = document.createElement('div')
      box.id = `${S}-hunk`
      const bar = document.createElement('div')
      bar.id = `${S}-hunkbar`
      const label = document.createElement('span')
      label.className = 'h-label'
      label.textContent = `第 ${idx + 1}/${hunks.length} 块 · ${lines[0]}`
      label.title = lines[0]
      bar.appendChild(label)

      const act = async (btn, busyText, fn) => {
        const old = btn.textContent
        btn.disabled = true
        btn.textContent = busyText
        const r = await fn()
        btn.disabled = false
        btn.textContent = old
        if (r && r.canceled) return
        if (r && r.ok) showToast('已完成')
        else showToast((r && r.error) || '操作失败', true)
        refresh()
      }

      if (staged) {
        const un = document.createElement('button')
        un.textContent = '取消暂存这块'
        un.title = 'git apply --cached --reverse（只退这一块）'
        un.addEventListener('click', (e) => {
          e.stopPropagation()
          act(un, '…', () => ipcRenderer.invoke('shell:git-unstage', file, idx))
        })
        bar.appendChild(un)
      } else {
        const st = document.createElement('button')
        st.textContent = '暂存这块'
        st.title = 'git apply --cached（只暂存这一块）'
        st.addEventListener('click', (e) => {
          e.stopPropagation()
          act(st, '…', () => ipcRenderer.invoke('shell:git-stage', file, idx))
        })
        const rv = document.createElement('button')
        rv.textContent = '丢弃这块'
        rv.title = '丢弃这一块改动（会先弹确认；同文件其它块保留）'
        rv.addEventListener('click', (e) => {
          e.stopPropagation()
          act(rv, '…', () => ipcRenderer.invoke('shell:git-revert-hunk', file, idx))
        })
        bar.append(st, rv)
      }

      box.appendChild(bar)
      box.appendChild(diffLines(lines.join('\n')))
      frag.appendChild(box)
    })
    return frag
  }

  function sectionLabel(text) {
    const el = document.createElement('div')
    el.id = `${S}-sect`
    el.textContent = text
    return el
  }

  function renderGit() {
    ws.textContent = data.workspace || '（未知工作目录）'
    body.textContent = ''
    if (!data.isGit) {
      const empty = document.createElement('div')
      empty.id = `${S}-empty`
      const msg = document.createElement('div')
      msg.textContent = '当前工作目录不是 git 仓库，无法审阅 diff。'
      const hint = document.createElement('div')
      hint.style.marginTop = '8px'
      hint.style.color = '#6f7a99'
      hint.style.fontSize = '12px'
      hint.textContent = '可用托盘「设置工作目录…」指向一个 git 仓库，或直接：'
      const initBtn = document.createElement('button')
      initBtn.style.marginTop = '12px'
      initBtn.style.padding = '7px 16px'
      initBtn.style.borderRadius = '8px'
      initBtn.style.border = '1px solid #5d6dff'
      initBtn.style.background = '#2b2f4d'
      initBtn.style.color = '#e6e9ff'
      initBtn.style.cursor = 'pointer'
      initBtn.style.font = 'inherit'
      initBtn.textContent = '在此目录初始化 git 仓库'
      initBtn.title = `git init（${data.workspace}）`
      initBtn.addEventListener('click', async () => {
        initBtn.textContent = '初始化中…'
        initBtn.disabled = true
        await ipcRenderer.invoke('shell:git-init')
        refresh()
      })
      empty.append(msg, hint, initBtn)
      body.appendChild(empty)
      footCount.textContent = ''
      return
    }
    // 提交条：只在 Git 视图出现；有已暂存内容才能提交，有远端才能推送
    const stagedCount = data.stagedCount || 0
    commitRow.classList.add('dsh-on')
    commitMeta.textContent = (stagedCount ? `已暂存 ${stagedCount} 个文件` : '暂存区为空')
      + (data.branch ? ` · ${data.branch}` : '')
      + (data.hasRemote ? '' : ' · 无远端')
    commitBtn.disabled = stagedCount === 0
    pushBtn.disabled = !data.hasRemote

    if (data.files.length === 0) {
      const empty = document.createElement('div')
      empty.id = `${S}-empty`
      empty.textContent = '没有未提交的改动。工作区干净 ✓'
      body.appendChild(empty)
      footCount.textContent = '0 个改动文件'
      return
    }
    footCount.textContent = `${data.files.length} 个改动文件`

    for (const f of data.files) {
      const item = document.createElement('div')
      item.id = `${S}-item`
      const row = document.createElement('div')
      row.id = `${S}-item-row`

      const badge = document.createElement('span')
      const st = statusLabel(f.status)
      badge.id = `${S}-badge`
      badge.className = st.cls
      badge.textContent = st.label

      const pathEl = document.createElement('span')
      pathEl.id = `${S}-path`
      pathEl.textContent = f.path
      pathEl.title = f.path

      // 文件级：暂存 / 取消暂存（可逆，不弹确认）
      const fileBtn = (text, title, fn) => {
        const b = document.createElement('button')
        b.id = `${S}-act`
        b.style.opacity = '1' // 文件级操作常用，不做 hover 才显形
        b.textContent = text
        b.title = title
        b.addEventListener('click', async (e) => {
          e.stopPropagation()
          b.disabled = true
          b.textContent = '…'
          const r = await fn()
          if (r && !r.ok && !r.canceled) showToast(r.error || '操作失败', true)
          refresh()
        })
        return b
      }

      const ops = []
      if (f.untracked || f.diffUnstaged) {
        ops.push(fileBtn('暂存', 'git add（整个文件）',
          () => ipcRenderer.invoke('shell:git-stage', f.path, null)))
      }
      if (f.diffStaged) {
        ops.push(fileBtn('取消暂存', 'git reset HEAD（整个文件）',
          () => ipcRenderer.invoke('shell:git-unstage', f.path, null)))
      }

      const act = document.createElement('button')
      act.id = `${S}-act`
      act.textContent = f.untracked ? '删除' : '还原'
      act.title = f.untracked ? '删除未跟踪的新文件' : '还原整个文件（会先弹确认）'
      act.addEventListener('click', async (e) => {
        e.stopPropagation()
        act.textContent = '…'
        await ipcRenderer.invoke('shell:revert', f.path, f.untracked)
        refresh()
      })

      row.append(badge, pathEl, viewFileBtn(f.path), openFileBtn(f.path), ...ops, act)
      row.addEventListener('click', () => {
        expanded[f.path] = !expanded[f.path]
        render()
      })
      item.appendChild(row)

      if (expanded[f.path]) {
        const diffBox = document.createElement('div')
        diffBox.id = `${S}-diff`
        if (f.untracked) {
          const note = document.createElement('div')
          note.className = 'ln-meta'
          note.textContent = '（未跟踪的新文件，无 diff；可用上面的「暂存」把它纳入版本控制）'
          diffBox.appendChild(note)
        } else if (f.diffStaged || f.diffUnstaged) {
          // 分档展示：已暂存在上（即将被提交），未暂存在下（还没纳入）
          if (f.diffStaged) {
            diffBox.appendChild(sectionLabel(`已暂存 · ${f.hunksStaged} 块（提交时会带上）`))
            diffBox.appendChild(hunkBlocks(f.path, f.diffStaged, true))
          }
          if (f.diffUnstaged) {
            diffBox.appendChild(sectionLabel(`未暂存 · ${f.hunksUnstaged} 块`))
            diffBox.appendChild(hunkBlocks(f.path, f.diffUnstaged, false))
          }
        } else if (f.diff) {
          diffBox.appendChild(diffLines(f.diff)) // 兜底：拿不到分档数据时按老样子整块显示
        } else {
          const note = document.createElement('div')
          note.className = 'ln-meta'
          note.textContent = '（二进制或空 diff）'
          diffBox.appendChild(note)
        }
        item.appendChild(diffBox)
      }
      body.appendChild(item)
    }
  }

  // ── 会话改动视图（Codex 式：轮次带提问 → 文件分组 → 逐条改动+撤销） ────

  const LINE_CAP = 12

  function changeBadge(name) {
    const b = document.createElement('span')
    b.className = 'dsh-cbadge ' + (name === 'write' ? 'w' : name === 'edit' ? 'e' : 's')
    b.textContent = name === 'write' ? '写' : name === 'edit' ? '改' : '替'
    return b
  }

  // old→new 迷你 diff；超过 LINE_CAP 行折叠，可点开
  function changeDiff(ch, results) {
    const box = document.createElement('div')
    box.id = `${S}-cdiff`
    const res = results.get(ch.callId)

    const makeBlock = (cls, prefix, text, isOld) => {
      if (text === null || text === undefined || text === '') return
      const div = document.createElement('div')
      div.className = cls
      const lines = String(text).split('\n')
      let show = lines
      let rest = 0
      if (lines.length > LINE_CAP) {
        show = lines.slice(0, LINE_CAP)
        rest = lines.length - LINE_CAP
      }
      for (const l of show) {
        const lineEl = document.createElement('div')
        lineEl.textContent = prefix + (l === '' ? ' ' : l)
        div.appendChild(lineEl)
      }
      box.appendChild(div)
      if (rest > 0) {
        const more = document.createElement('button')
        more.className = 'cd-more'
        more.textContent = `▾ 展开全部（还有 ${rest} 行）`
        more.addEventListener('click', (e) => {
          e.stopPropagation()
          const all = document.createElement('div')
          all.className = cls
          for (const l of lines) {
            const lineEl = document.createElement('div')
            lineEl.textContent = prefix + (l === '' ? ' ' : l)
            all.appendChild(lineEl)
          }
          div.replaceWith(all)
          const less = document.createElement('button')
          less.className = 'cd-more'
          less.textContent = '▴ 收起'
          less.addEventListener('click', () => { box.replaceWith(changeDiff(ch, results)) })
          box.appendChild(less)
        })
        box.appendChild(more)
      }
    }

    makeBlock('cd-old', '− ', ch.old, true)
    makeBlock('cd-new', '+ ', ch.new, false)

    if (res && res.created) {
      const note = document.createElement('div')
      note.className = 'cd-more'
      note.textContent = '＊ 该次写入创建了此文件（撤销 = 删除文件）'
      note.style.cursor = 'default'
      box.appendChild(note)
    } else if (res && res.failed) {
      const note = document.createElement('div')
      note.className = 'cd-more'
      note.textContent = '＊ 该次调用未成功（无需撤销）'
      note.style.cursor = 'default'
      box.appendChild(note)
    }
    return box
  }

  function sessionModel(entries) {
    const prompts = new Map()   // turn -> { text, count }
    const reverted = new Map()  // callId -> { file }
    const results = new Map()   // callId -> { created, failed }
    const changes = []          // tool-call 条目（流顺序）
    for (const e of entries || []) {
      if (e.kind === 'prompt' && e.turn !== undefined && e.turn !== null) {
        const p = prompts.get(e.turn)
        if (p) p.count++
        else prompts.set(e.turn, { text: e.text, count: 1 })
      } else if (e.kind === 'tool-call') {
        changes.push(e)
      } else if (e.kind === 'tool-result') {
        results.set(e.callId, e)
      } else if (e.kind === 'revert') {
        if (e.ok) reverted.set(e.callId, e)
      }
    }
    return { prompts, reverted, results, changes }
  }

  function fmtTime(ts) {
    if (!ts) return ''
    try {
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}`
    } catch {
      return ''
    }
  }

  function renderSession() {
    body.textContent = ''
    const { prompts, reverted, results, changes } = sessionModel(sessionData.entries || [])

    if (changes.length === 0) {
      const empty = document.createElement('div')
      empty.id = `${S}-empty`
      empty.textContent = '本次会话还没有文件修改。\nagent 开始改文件后，这里会实时出现。'
      body.appendChild(empty)
      footCount.textContent = ''
      return
    }

    const active = changes.filter((c) => !reverted.has(c.callId))
    if (active.length === 0) {
      const empty = document.createElement('div')
      empty.id = `${S}-empty`
      empty.textContent = '所有改动均已撤销 ✓'
      body.appendChild(empty)
      footCount.textContent = '0 个未撤销改动'
      return
    }

    // 按 turn 分组（流已按时间序）
    const turns = []
    let cur = null
    for (const ch of changes) {
      if (!reverted.has(ch.callId)) {
        const turn = ch.turn
        if (!cur || cur.turn !== turn) {
          cur = { turn, items: [] }
          turns.push(cur)
        }
        cur.items.push(ch)
      }
    }

    const fileCount = new Set(active.map((c) => c.file || c.callId)).size
    footCount.textContent = `${active.length} 处改动 · ${fileCount} 个文件`

    const collapsed = {} // file group 展开状态（默认展开）

    for (const t of turns) {
      const turnBox = document.createElement('div')
      turnBox.id = `${S}-turn`

      const headEl = document.createElement('div')
      headEl.id = `${S}-turn-head`
      const label = document.createElement('div')
      label.id = `${S}-turn-label`
      const time = fmtTime(t.items[0] && t.items[0].ts)
      label.textContent = `第 ${t.turn} 轮${time ? ' · ' + time : ''}`
      headEl.appendChild(label)
      const prompt = prompts.get(t.turn)
      if (prompt && prompt.text) {
        const pEl = document.createElement('div')
        pEl.id = `${S}-turn-prompt`
        pEl.textContent = (prompt.count > 1 ? `（共 ${prompt.count} 条提问）` : '') + prompt.text
        pEl.title = prompt.text
        headEl.appendChild(pEl)
      }
      turnBox.appendChild(headEl)

      // 按文件分组
      const byFile = []
      let fcur = null
      for (const ch of t.items) {
        const fkey = ch.file || '(未知文件)'
        if (!fcur || fcur.file !== fkey) {
          fcur = { file: fkey, items: [] }
          byFile.push(fcur)
        }
        fcur.items.push(ch)
      }

      for (const g of byFile) {
        const fg = document.createElement('div')
        fg.id = `${S}-fgroup`
        const fh = document.createElement('div')
        fh.id = `${S}-fhead`
        const chev = document.createElement('span')
        chev.id = `${S}-fchev`
        chev.textContent = '▾'
        const pathEl = document.createElement('span')
        pathEl.id = `${S}-path`
        pathEl.textContent = g.file
        pathEl.title = g.file
        const count = document.createElement('span')
        count.id = `${S}-fcount`
        count.textContent = `${g.items.length} 处`
        fh.append(chev, pathEl, count, viewFileBtn(g.file), openFileBtn(g.file))
        fh.addEventListener('click', () => {
          collapsed[g.file + '@' + t.turn] = !collapsed[g.file + '@' + t.turn]
          fh.classList.toggle('dsh-closed', !!collapsed[g.file + '@' + t.turn])
          for (const el of fg.querySelectorAll(`#${S}-citem`)) {
            el.style.display = collapsed[g.file + '@' + t.turn] ? 'none' : ''
          }
        })
        fg.appendChild(fh)

        for (const ch of g.items) {
          const item = document.createElement('div')
          item.id = `${S}-citem`
          const row = document.createElement('div')
          row.id = `${S}-crow`
          row.append(changeBadge(ch.name))
          const note = document.createElement('span')
          note.id = `${S}-cnote`
          if (ch.name === 'write') note.textContent = '写入'
          else if (ch.name === 'str_replace_editor') note.textContent = ch.command === 'str_replace' ? '替换' : (ch.command || '操作')
          else note.textContent = ch.replaceAll ? '全局替换' : '编辑'
          row.append(note)

          const ops = document.createElement('span')
          ops.id = `${S}-cops`
          const undo = document.createElement('button')
          undo.textContent = '撤销'
          undo.title = '精确回退这一次改动（Codex 式 Undo）'
          undo.addEventListener('click', async (e) => {
            e.stopPropagation()
            undo.disabled = true
            undo.textContent = '回退中…'
            const r = await ipcRenderer.invoke('shell:revert-change', ch.session, ch.callId)
            if (r && r.ok) {
              showToast('已撤销：' + (r.file || ch.file || ''))
              refresh()
            } else {
              undo.disabled = false
              undo.textContent = '撤销'
              showToast('撤销失败：' + (r && r.error ? r.error : '未知错误'), true)
            }
          })
          ops.append(undo)
          row.append(ops)
          item.append(row, changeDiff(ch, results))
          fg.appendChild(item)
        }
        turnBox.appendChild(fg)
      }
      body.appendChild(turnBox)
    }
  }

  /* ── 提交 / 推送（都只作用于已暂存内容；推送由主进程二次确认） ────────────── */

  commitBtn.addEventListener('click', async () => {
    const msg = commitMsg.value.trim()
    if (!msg) {
      showToast('请先写提交信息', true)
      commitMsg.focus()
      return
    }
    commitBtn.disabled = true
    commitBtn.textContent = '提交中…'
    const r = await ipcRenderer.invoke('shell:git-commit', msg)
    commitBtn.textContent = '提交'
    if (r && r.ok) {
      commitMsg.value = ''
      showToast(`已提交 ${r.hash || ''}`)
    } else {
      showToast((r && r.error) || '提交失败', true)
    }
    refresh()
  })

  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true
    pushBtn.textContent = '推送中…'
    const r = await ipcRenderer.invoke('shell:git-push')
    pushBtn.textContent = '推送'
    pushBtn.disabled = false
    if (r && r.canceled) return
    if (r && r.ok) showToast(`已推送 ${r.branch || ''}`)
    else showToast((r && r.error) || '推送失败', true)
    refresh()
  })

  function render() {
    commitRow.classList.remove('dsh-on') // 只有 Git 视图会把它打开
    if (view) { renderViewer(); return }
    if (mode === 'session') renderSession()
    else renderGit()
  }

  async function refresh() {
    try {
      if (mode === 'session') {
        const res = await ipcRenderer.invoke('shell:session-changes')
        sessionData = res
        const entries = sessionData.entries || []
        const last = entries.length ? entries[entries.length - 1] : null
        const sig = entries.length + ':' + (last ? last.kind + ':' + (last.seq !== undefined ? last.seq : last.ts) : '')
        if (sig === lastSig) return // 无新事件，跳过重渲染
        lastSig = sig
      } else {
        data = await ipcRenderer.invoke('shell:changes')
      }
      if (view) return // 查看器打开时不重渲染列表（内容每 5s 重解析太浪费）
      render()
    } catch (err) {
      body.textContent = ''
      const empty = document.createElement('div')
      empty.id = `${S}-empty`
      empty.textContent = '读取改动失败：' + (err && err.message ? err.message : String(err))
      body.appendChild(empty)
    }
  }

  // 打开侧边栏时顺便取一次工作目录（用于展示）与当前皮肤
  ipcRenderer.invoke('shell:get-state').then((s) => {
    if (s && s.workspace) ws.textContent = s.workspace
    if (s && s.theme) applySkin(s.theme)
  })
}

// 皮肤：先按当前设置落一次，之后跟随托盘切换即时变（内核页面与浮层都吃这一层）
ipcRenderer.invoke('shell:get-state').then((s) => applySkin(s && s.theme)).catch(() => {})
ipcRenderer.on('shell:theme', (_e, id) => applySkin(id))

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectReviewSidebar)
} else {
  injectReviewSidebar()
}
