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
  gitInit: () => ipcRenderer.invoke('shell:git-init'),
  revert: (p, untracked) => ipcRenderer.invoke('shell:revert', p, untracked),
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

/* ── 右侧"修改审阅"侧边栏（外壳级覆盖层） ─────────────────────────────────── */

function injectReviewSidebar() {
  if (location.protocol === 'file:') return // splash 不注入
  if (document.getElementById('dsh-review-root')) return

  const S = 'dsh-review'
  const style = document.createElement('style')
  style.textContent = `
    #${S}-root,#${S}-root *{box-sizing:border-box;margin:0;padding:0;}
    #${S}-root{font:13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#e8e6f2;}
    #${S}-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482800;
      writing-mode:vertical-rl;padding:14px 6px;background:#141b2e;color:#aeb8d8;border:1px solid rgba(120,140,210,.25);
      border-right:none;border-radius:10px 0 0 10px;cursor:pointer;font-size:12px;letter-spacing:.2em;user-select:none;}
    #${S}-tab:hover{background:#1b2440;color:#e6e9ff;}
    #${S}-panel{position:fixed;top:0;right:0;bottom:0;width:360px;z-index:2147482900;background:#0b0f1c;
      border-left:1px solid rgba(120,140,210,.18);display:flex;flex-direction:column;
      box-shadow:-12px 0 32px rgba(0,0,0,.45);}
    #${S}-panel.dsh-hidden{display:none;}
    #${S}-head{padding:14px 16px;border-bottom:1px solid rgba(120,140,210,.14);flex:none;}
    #${S}-title{font-size:15px;font-weight:650;letter-spacing:.02em;display:flex;align-items:center;justify-content:space-between;}
    #${S}-ws{font-size:11px;color:#6f7a99;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #${S}-head button{background:none;border:none;color:#8b93ad;cursor:pointer;font-size:13px;padding:2px 6px;}
    #${S}-head button:hover{color:#e6e9ff;}
    #${S}-body{flex:1;overflow-y:auto;padding:8px 0;}
    #${S}-empty{padding:24px 18px;color:#6f7a99;}
    #${S}-item{border-bottom:1px solid rgba(120,140,210,.08);}
    #${S}-item-row{display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;}
    #${S}-item-row:hover{background:rgba(120,140,210,.06);}
    #${S}-badge{flex:none;font-size:11px;padding:1px 7px;border-radius:6px;font-weight:600;min-width:20px;text-align:center;}
    #${S}-badge.st-M,#${S}-badge.st- M{background:#5a4a1a;color:#ffd97a;}
    #${S}-badge.st-A,#${S}-badge.st-A {background:#153f2b;color:#7fe0a8;}
    #${S}-badge.st-D,#${S}-badge.st- D{background:#4a1b1b;color:#ff9a9a;}
    #${S}-badge.st-R{background:#31285a;color:#c3b4ff;}
    #${S}-badge.st-??{background:#1c3350;color:#8ecbff;}
    #${S}-path{flex:1;font:12px/1.4 Consolas,"Cascadia Mono",monospace;color:#cfd6ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #${S}-act{flex:none;opacity:0;transition:opacity .12s;font-size:11px;color:#8b93ad;background:none;border:1px solid rgba(120,140,210,.25);border-radius:6px;padding:2px 8px;cursor:pointer;}
    #${S}-act:hover{color:#e6e9ff;border-color:#5d6dff;}
    #${S}-item-row:hover #${S}-act{opacity:1;}
    #${S}-diff{font:12px/1.55 Consolas,"Cascadia Mono",monospace;background:#070a12;border-top:1px solid rgba(120,140,210,.08);
      padding:8px 0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-all;}
    #${S}-diff .ln-add{color:#8ee6b0;background:rgba(46,160,90,.10);}
    #${S}-diff .ln-del{color:#ff9a9a;background:rgba(220,80,80,.10);}
    #${S}-diff .ln-hunk{color:#8ecbff;}
    #${S}-diff .ln-meta{color:#6f7a99;}
    #${S}-diff .ln-ctx{color:#7a8398;}
    #${S}-foot{flex:none;padding:10px 16px;border-top:1px solid rgba(120,140,210,.14);font-size:12px;color:#6f7a99;display:flex;justify-content:space-between;}
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
  const ws = document.createElement('div')
  ws.id = `${S}-ws`
  ws.textContent = '…'
  head.append(titleRow, ws)

  const body = document.createElement('div')
  body.id = `${S}-body`

  const foot = document.createElement('div')
  foot.id = `${S}-foot`
  const footCount = document.createElement('span')
  footCount.id = `${S}-count`
  const footHint = document.createElement('span')
  footHint.textContent = '还原 = git restore'

  foot.append(footCount, footHint)

  panel.append(head, body, foot)
  root.append(tab, panel)
  document.body.appendChild(root)

  let data = { isGit: false, workspace: '', files: [] }
  let expanded = {}
  let timer = null

  function setOpen(open) {
    panel.classList.toggle('dsh-hidden', !open)
    tab.style.display = open ? 'none' : ''
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

  function render() {
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

      row.append(badge, pathEl, act)
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

  async function refresh() {
    try {
      data = await ipcRenderer.invoke('shell:changes')
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
