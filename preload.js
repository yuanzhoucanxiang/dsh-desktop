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
  restartKernel: () => ipcRenderer.send('shell:restart-kernel'),
  copyLog: () => ipcRenderer.send('shell:copy-log'),
  quit: () => ipcRenderer.send('shell:quit'),
  splashReady: () => ipcRenderer.send('shell:splash-ready'),
  changes: () => ipcRenderer.invoke('shell:changes'),
  sessionChanges: () => ipcRenderer.invoke('shell:session-changes'),
  gitInit: () => ipcRenderer.invoke('shell:git-init'),
  revert: (p, untracked) => ipcRenderer.invoke('shell:revert', p, untracked),
  revertChange: (sessionId, callId) => ipcRenderer.invoke('shell:revert-change', sessionId, callId),
  openFile: (p) => ipcRenderer.invoke('shell:open-file', p),
})

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
    `#${OVERLAY_ID}{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:12px;`,
    'padding:12px 16px;border-radius:12px;background:rgba(20,16,28,.92);border:1px solid rgba(255,107,107,.45);',
    'box-shadow:0 8px 32px rgba(0,0,0,.5);color:#e8e6f2;font:13px/1.5 "Segoe UI",system-ui,sans-serif;max-width:420px;}',
    `#${OVERLAY_ID} .dsh-dot{width:9px;height:9px;border-radius:50%;background:#ff5d5d;box-shadow:0 0 10px #ff5d5d;flex:none;animation:dshPulse 1.4s infinite;}`,
    `#${OVERLAY_ID} .dsh-msg{flex:1;color:#cfc9dd;}`,
    `#${OVERLAY_ID} button{flex:none;padding:6px 12px;border-radius:8px;border:1px solid #5d6dff;background:#2b2f4d;color:#e6e9ff;cursor:pointer;font:inherit;}`,
    `#${OVERLAY_ID} button:hover{background:#383d63;}`,
    `#${OVERLAY_ID}.dsh-busy button{opacity:.55;pointer-events:none;}`,
    '@keyframes dshPulse{0%,100%{opacity:1}50%{opacity:.35}}',
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
  // 主题：直接复用内核页面的 --dsw-alias-* 设计变量，自动跟随明暗主题
  style.textContent = `
    #${S}-root,#${S}-root *{box-sizing:border-box;margin:0;padding:0;}
    #${S}-root{font:13px/1.5 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
      color:var(--dsw-alias-label-primary,#e8e6f2);}
    /* 分割式布局：挤压用内联 margin 实现（不加 transition，避免 computed 取到动画中间值） */
    #${S}-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482800;
      writing-mode:vertical-rl;padding:14px 6px;background:var(--dsw-alias-bg-layer-1,transparent);
      color:var(--dsw-alias-label-secondary,#aeb8d8);border:1px solid var(--dsw-alias-border-l2,transparent);
      border-right:none;border-radius:10px 0 0 10px;cursor:pointer;font-size:12px;letter-spacing:.2em;user-select:none;}
    #${S}-tab:hover{background:var(--dsw-alias-interactive-bg-hover,transparent);
      color:var(--dsw-alias-label-primary,#e6e9ff);}
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
  `
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = `${S}-root`

  const tab = document.createElement('div')
  tab.id = `${S}-tab`
  tab.textContent = '修改审阅'
  tab.title = '展开修改审阅侧边栏'

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

  const toast = document.createElement('div')
  toast.id = `${S}-toast`

  panel.append(head, body, foot)
  root.append(tab, panel, toast)
  document.body.appendChild(root)

  let mode = 'session' // 'session' | 'git'
  let data = { isGit: false, workspace: '', files: [] }
  let sessionData = { ok: false, entries: [] }
  let expanded = {}
  let lastSig = ''
  let timer = null
  let toastTimer = null

  function showToast(msg, isErr) {
    toast.textContent = msg
    toast.className = isErr ? 'dsh-err' : 'dsh-ok'
    toast.style.display = ''
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.style.display = 'none' }, 4200)
  }

  function setOpen(open) {
    panel.classList.toggle('dsh-hidden', !open)
    tab.style.display = open ? 'none' : ''
    // 分割式布局：内联 margin 把内核页面向左挤开 360px（样式表规则会被应用覆盖，必须内联）
    document.body.style.marginRight = open ? '360px' : ''
    if (open) {
      refresh()
      timer = setInterval(refresh, 5000)
    } else if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  tab.addEventListener('click', () => setOpen(true))
  closeBtn.addEventListener('click', () => setOpen(false))
  refreshBtn.addEventListener('click', refresh)
  modeSession.addEventListener('click', () => { mode = 'session'; lastSig = ''; syncMode(); refresh() })
  modeGit.addEventListener('click', () => { mode = 'git'; lastSig = ''; syncMode(); refresh() })

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
      await window.dshShell.openFile(file)
    })
    return b
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

      const act = document.createElement('button')
      act.id = `${S}-act`
      act.textContent = f.untracked ? '删除' : '还原'
      act.title = f.untracked ? '删除未跟踪的新文件' : 'git restore（恢复到最后一次提交）'
      act.addEventListener('click', async (e) => {
        e.stopPropagation()
        act.textContent = '…'
        await ipcRenderer.invoke('shell:revert', f.path, f.untracked)
        refresh()
      })

      row.append(badge, pathEl, openFileBtn(f.path), act)
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
          note.textContent = '（未跟踪的新文件，无 diff）'
          diffBox.appendChild(note)
        } else if (f.diff) {
          diffBox.appendChild(diffLines(f.diff))
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
        fh.append(chev, pathEl, count, openFileBtn(g.file))
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
            const r = await window.dshShell.revertChange(ch.session, ch.callId)
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

  function render() {
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
      render()
    } catch (err) {
      body.textContent = ''
      const empty = document.createElement('div')
      empty.id = `${S}-empty`
      empty.textContent = '读取改动失败：' + (err && err.message ? err.message : String(err))
      body.appendChild(empty)
    }
  }

  // 打开侧边栏时顺便取一次工作目录（用于展示）
  ipcRenderer.invoke('shell:get-state').then((s) => {
    if (s && s.workspace) ws.textContent = s.workspace
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectReviewSidebar)
} else {
  injectReviewSidebar()
}
