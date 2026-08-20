'use strict'
// 测试：分割式侧边栏的布局与主题变量（自带内核页面桩，不依赖真实内核端口）
// 运行：electron sidebar-layout-test.js，exit 0 = 通过
// 历史坑：旧版先 win.destroy() 再延时 app.exit(code) —— 窗口数归零会触发 Electron
//         默认的 window-all-closed 退出（code 0），失败也会"通过"。现在直接同步 exit。
const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const path = require('node:path')

app.disableHardwareAcceleration()

const MOCK = {
  isGit: true,
  workspace: 'C:/fake/repo',
  files: [{ path: 'src/a.js', status: ' M', untracked: false, diff: 'diff --git a/a b/a\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n' }],
}

// 内核页面桩：带一套设计令牌 + 一个 #app 容器（验证页面被真正挤压）
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--dsw-alias-bg-base:#161a2e;--dsw-alias-bg-layer-1:#1e2236;--dsw-alias-label-primary:#e6e9ff;
    --dsw-alias-label-secondary:#aeb8d8;--dsw-alias-label-tertiary:#6f7a99;--dsw-alias-border-l2:#2e3554;
    --dsw-alias-brand-primary:#5d6dff;--dsw-alias-interactive-bg-hover:#20263c;}
  html,body{margin:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
  #app{width:100%;height:100%;}
</style></head><body><div id="app">kernel page stub</div></body></html>`

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})

function finish(code, msg) {
  console.log(msg)
  try { server.close() } catch {}
  app.exit(code) // 同步退出：不要先 destroy 窗口，也不要延时
}

app.whenReady().then(async () => {
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port

    ipcMain.handle('shell:get-state', () => ({ workspace: 'C:/fake/repo', phase: 'ready', theme: 'deep' }))
    ipcMain.handle('shell:changes', () => MOCK)
    ipcMain.handle('shell:session-changes', () => ({ ok: true, entries: [] }))
    ipcMain.handle('shell:get-panel-width', () => 360)
    ipcMain.handle('shell:set-panel-width', () => true)
    ipcMain.handle('shell:git-init', () => ({ ok: true }))
    ipcMain.handle('shell:revert', () => ({ ok: true, canceled: false }))
    ipcMain.handle('shell:open-file', () => '')

    const win = new BrowserWindow({
      width: 1360,
      height: 900,
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
    await new Promise((r) => setTimeout(r, 1200))

    const result = await win.webContents.executeJavaScript(`(async () => {
      try {
        const tab = document.getElementById('dsh-review-toggle')
        const panel = document.getElementById('dsh-review-panel')
        if (!tab || !panel) return { ok: false, why: 'sidebar not injected' }
        const appEl = document.querySelector('#app, #root, .app, .main') || document.body
        const rootBefore = appEl.getBoundingClientRect().width
        tab.click()
        await new Promise(r => setTimeout(r, 600))
        const margin = getComputedStyle(document.body).marginRight
        const panelVisible = !panel.classList.contains('dsh-hidden')
        const panelBg = getComputedStyle(panel).backgroundColor
        const panelBorder = getComputedStyle(panel).borderLeftColor
        const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
        const rootAfter = appEl.getBoundingClientRect().width
        return {
          ok: true, margin, panelVisible, panelBg, panelBorder,
          rootBefore, rootAfter, rootShrunk: rootAfter < rootBefore - 100,
          varBg: cssVar('--dsw-alias-bg-base'), varLabel: cssVar('--dsw-alias-label-primary'),
          skin: document.documentElement.dataset.dshSkin || null,
        }
      } catch (e) { return { ok: false, why: 'eval threw: ' + e.message } }
    })()`)

    const pass = result.ok && result.margin === '360px' && result.panelVisible && result.rootShrunk
      && result.panelBg === 'rgb(22, 26, 46)' // deep 皮肤下必须解析成内核令牌值
    finish(pass ? 0 : 1, 'LAYOUT_TEST ' + JSON.stringify(result))
  } catch (err) {
    finish(1, 'LAYOUT_TEST_ERR ' + (err && err.stack ? err.stack : String(err)))
  }
})
