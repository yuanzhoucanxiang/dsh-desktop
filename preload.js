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
  gitStageAll: () => ipcRenderer.invoke('shell:git-stage-all'),
  gitRevertAll: () => ipcRenderer.invoke('shell:git-revert-all'),
  gitUnstage: (p, hunk) => ipcRenderer.invoke('shell:git-unstage', p, hunk),
  gitRevertHunk: (p, hunk) => ipcRenderer.invoke('shell:git-revert-hunk', p, hunk),
  gitCommit: (message) => ipcRenderer.invoke('shell:git-commit', message),
  gitPush: () => ipcRenderer.invoke('shell:git-push'),
  notifyCommand: (cmd) => ipcRenderer.invoke('shell:notify-command', cmd),
  notifyCommandTest: () => ipcRenderer.invoke('shell:notify-command-test'),
  // 全局热键：状态经 status() 的 hotkey / hotkeyPresets 字段下发，改键走这个专用通道
  // （主进程会再校一次发送方是否为设置窗口，并过 accelerator 白名单校验）。
  setGlobalHotkey: (acc) => ipcRenderer.invoke('shell:set-global-hotkey', acc),
  // 应用图标：预设/状态经 status() 的 appIcon / appIconPresets 下发（仅设置窗口）；
  // 选择文件与生效走这两个专用通道（主进程校验发送方并负责复制/生成/改写快捷方式）。
  pickAppIcon: () => ipcRenderer.invoke('shell:pick-app-icon'),
  setAppIcon: (key, customPath) => ipcRenderer.invoke('shell:set-app-icon', key, customPath),
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
  html[data-dsh-skin="palis"] #dsh-review-branch { border-radius: 0; }
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
    PALIS_CHROME,
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

// 皮肤：先按当前设置落一次，之后跟随托盘切换即时变（内核页面与浮层都吃这一层）
ipcRenderer.invoke('shell:get-state').then((s) => applySkin(s && s.theme)).catch(() => {})
ipcRenderer.on('shell:theme', (_e, id) => applySkin(id))

