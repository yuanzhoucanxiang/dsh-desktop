'use strict'
// 测试：注入 UI（审阅侧边栏 + 断连浮层）是否正确跟随外壳皮肤，且绝不污染内核页面
// 运行：electron sidebar-skin-check.js  （或 npm run sidebar-skin-check），exit 0 = 通过
// 检查项：
//   1. deep（默认）皮肤下，侧边栏颜色 = 内核页面自己的 --dsw-alias-* 令牌值（原行为不回归）
//   2. seascape 皮肤下，侧边栏换成单色银盐，且**内核页面自己的元素分毫不变**（无外泄）
//   3. 断连浮层同样跟随皮肤
//   4. 皮肤可来回切换（seascape → deep 能恢复成跟随内核）
//   5. 侧边栏基本交互仍在（点开关 → 面板显示 + 页面被挤压）
const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const path = require('node:path')

app.disableHardwareAcceleration()

const WATCHDOG_MS = 90000
const watchdog = setTimeout(() => { console.log('FAIL watchdog'); app.exit(1) }, WATCHDOG_MS)
watchdog.unref && watchdog.unref()

// 内核页面桩：带一套自己的设计令牌 + 一个"内核自有元素"用来验证无外泄
const KERNEL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{
    --dsw-alias-bg-base:#161a2e; --dsw-alias-bg-layer-1:#1e2236;
    --dsw-alias-label-primary:#e6e9ff; --dsw-alias-label-secondary:#aeb8d8;
    --dsw-alias-label-tertiary:#6f7a99; --dsw-alias-border-l2:#2e3554;
    --dsw-alias-brand-primary:#5d6dff; --dsw-alias-interactive-bg-hover:#20263c;
  }
  body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
  #kernel-probe{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);padding:8px;}
</style></head><body><h1>kernel page stub</h1>
<div id="kernel-probe">kernel owned element</div></body></html>`

const SESSION = { ok: true, entries: [] }
const GIT = { isGit: true, workspace: 'C:/fake/repo', files: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`)
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(KERNEL_PAGE)
})

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  let theme = 'deep'
  ipcMain.handle('shell:get-state', () => ({ workspace: 'C:/fake/repo', phase: 'ready', theme }))
  ipcMain.handle('shell:changes', () => GIT)
  ipcMain.handle('shell:session-changes', () => SESSION)
  ipcMain.handle('shell:get-panel-width', () => 360)
  ipcMain.handle('shell:set-panel-width', () => true)
  ipcMain.handle('shell:git-init', () => ({ ok: true }))
  ipcMain.handle('shell:revert', () => ({ ok: true, canceled: false }))
  ipcMain.handle('shell:open-file', () => '')
  ipcMain.on('shell:restart-kernel', () => {})

  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  await win.loadURL(`http://127.0.0.1:${port}/`)
  await sleep(900)

  const exec = (js) => win.webContents.executeJavaScript(js, true)
  const probe = () => exec(`(function () {
    const cs = (id) => {
      const el = document.getElementById(id)
      if (!el) return null
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, color: s.color, border: s.borderColor }
    }
    return {
      skin: document.documentElement.dataset.dshSkin || null,
      hasRoot: !!document.getElementById('dsh-review-root'),
      hasRail: !!document.getElementById('dsh-review-rail'),
      hasToggle: !!document.getElementById('dsh-review-toggle'),
      panel: cs('dsh-review-panel'),
      ws: cs('dsh-review-ws'),
      kernel: cs('kernel-probe'),
      body: getComputedStyle(document.body).backgroundColor,
      overlay: cs('dsh-shell-kernel-overlay'),
      pushed: document.body.style.marginRight,
      panelHidden: (document.getElementById('dsh-review-panel') || {}).className || '',
    }
  })()`)

  const setTheme = async (id) => {
    theme = id
    win.webContents.send('shell:theme', id)
    await sleep(260)
  }
  const rgb = (s) => (String(s).match(/\d+/g) || []).map(Number)
  const chroma = (s) => {
    const [r, g, b] = rgb(s)
    return Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))
  }

  /* ── 1. 注入到位 + deep 皮肤下跟随内核令牌 ─────────────────────────────── */
  const deep = await probe()
  check('sidebar injected (root/rail/toggle)', deep.hasRoot && deep.hasRail && deep.hasToggle,
    `root=${deep.hasRoot} rail=${deep.hasRail} toggle=${deep.hasToggle}`)
  check('deep skin marked on <html>', deep.skin === 'deep', String(deep.skin))
  check('deep: panel follows kernel token bg-base', rgb(deep.panel.bg).join(',') === '22,26,46',
    deep.panel.bg)
  check('deep: label follows kernel token label-tertiary', rgb(deep.ws.color).join(',') === '111,122,153',
    deep.ws.color)

  /* ── 2. seascape 皮肤：换成单色银盐，内核页面不受影响 ──────────────────── */
  const kernelBefore = deep.kernel
  await setTheme('seascape')
  const sea = await probe()
  check('seascape skin marked on <html>', sea.skin === 'seascape', String(sea.skin))
  check('seascape: panel bg switches to silver-gelatin', rgb(sea.panel.bg).join(',') === '14,16,18',
    sea.panel.bg)
  check('seascape: panel bg is monochrome', chroma(sea.panel.bg) <= 6, `chroma=${chroma(sea.panel.bg)}`)
  check('seascape: label switches to silver', rgb(sea.ws.color).join(',') === '109,116,120', sea.ws.color)
  check('no leak: kernel-owned element unchanged', sea.kernel.bg === kernelBefore.bg && sea.kernel.color === kernelBefore.color,
    `${kernelBefore.bg}/${kernelBefore.color} → ${sea.kernel.bg}/${sea.kernel.color}`)
  check('no leak: kernel page background unchanged', sea.body === deep.body, `${deep.body} → ${sea.body}`)

  /* ── 3. 断连浮层跟随皮肤 ────────────────────────────────────────────────── */
  win.webContents.send('shell:kernel-status', { alive: false, message: '测试用断连' })
  await sleep(400)
  const ovSea = await probe()
  check('overlay appears on kernel disconnect', !!ovSea.overlay)
  const seaOverlayBorder = ovSea.overlay && ovSea.overlay.border
  win.webContents.send('shell:kernel-status', { alive: true })
  await sleep(250)
  await setTheme('deep')
  win.webContents.send('shell:kernel-status', { alive: false, message: '测试用断连' })
  await sleep(400)
  const ovDeep = await probe()
  check('overlay re-skins with the shell', !!ovDeep.overlay && ovDeep.overlay.border !== seaOverlayBorder,
    `seascape=${seaOverlayBorder} deep=${ovDeep.overlay && ovDeep.overlay.border}`)
  win.webContents.send('shell:kernel-status', { alive: true })
  await sleep(250)

  /* ── 4. 皮肤可来回切换 ─────────────────────────────────────────────────── */
  const back = await probe()
  check('deep restores kernel-token look', rgb(back.panel.bg).join(',') === '22,26,46', back.panel.bg)

  /* ── 5. 基本交互仍在 ───────────────────────────────────────────────────── */
  await exec(`(document.getElementById('dsh-review-toggle').click(), 1)`)
  await sleep(500)
  const opened = await probe()
  check('toggle opens the panel', !/dsh-hidden/.test(opened.panelHidden), opened.panelHidden || '(no class)')
  check('opened panel pushes the page', /px$/.test(opened.pushed || ''), opened.pushed || '(none)')

  win.destroy()
  server.close()
  console.log(failures.length ? 'SIDEBAR_SKIN_FAIL ' + failures.join(' | ') : 'SIDEBAR_SKIN_OK')
  app.exit(failures.length === 0 ? 0 : 1)
}).catch((err) => {
  try { server.close() } catch {}
  console.log('FAIL main: ' + (err && err.stack ? err.stack : err))
  app.exit(1)
})
