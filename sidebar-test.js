'use strict'
// 测试：验证 preload 的"修改审阅"侧边栏能在 http 页面正确注入、展开并渲染
// 运行：electron sidebar-test.js
const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const path = require('node:path')

const MOCK = {
  isGit: true,
  workspace: 'C:/fake/repo',
  files: [
    { path: 'src/a.js', status: ' M', untracked: false, diff: 'diff --git a/a b/a\n--- a/a.js\n+++ b/a.js\n@@ -1,3 +1,3 @@\n-old line\n+new line\n context\n' },
    { path: 'new.txt', status: '??', untracked: true, diff: '' },
  ],
}

app.disableHardwareAcceleration()

function finish(code, msg) {
  console.log(msg)
  setTimeout(() => app.exit(code), 100)
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><html><body><h1>kernel page stub</h1></body></html>')
})

app.whenReady().then(async () => {
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port

    ipcMain.handle('shell:get-state', () => ({ workspace: 'C:/fake/repo', phase: 'ready' }))
    ipcMain.handle('shell:changes', () => MOCK)
    ipcMain.handle('shell:revert', () => ({ ok: true, canceled: false }))
    ipcMain.handle('shell:open-file', () => '')

    const win = new BrowserWindow({
      width: 1200, height: 800, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      },
    })
    await win.loadURL(`http://127.0.0.1:${port}/`)
    await new Promise((r) => setTimeout(r, 800))

    const result = await win.webContents.executeJavaScript(`(async () => {
      try {
        const tab = document.getElementById('dsh-review-tab')
        const panel = document.getElementById('dsh-review-panel')
        if (!tab || !panel) return { ok: false, why: 'missing tab/panel' }
        const initiallyHidden = panel.classList.contains('dsh-hidden')
        // 直接调用桥，看 changes() 返回什么
        let changesResult = null, changesErr = null
        try { changesResult = await window.dshShell.changes() } catch (e) { changesErr = e.message }
        tab.click()
        await new Promise(r => setTimeout(r, 1200))
        const visible = !panel.classList.contains('dsh-hidden')
        const body = document.getElementById('dsh-review-body')
        const bodyHtml = body ? body.innerHTML.slice(0, 300) : 'NO-BODY'
        const wsText = (document.getElementById('dsh-review-ws') || {}).textContent
        const footText = (document.getElementById('dsh-review-foot') || {}).textContent
        return {
          ok: true, initiallyHidden, visible,
          changesFiles: changesResult ? changesResult.files.length : ('ERR:' + changesErr),
          bodyHtml, wsText, footText,
        }
      } catch (e) { return { ok: false, why: 'eval threw: ' + e.message } }
    })()`)

    win.destroy()
    server.close()
    const pass = result.ok && result.visible && result.changesFiles === 2 && result.bodyHtml.includes('src/a.js')
    finish(pass ? 0 : 1, 'SIDEBAR_TEST ' + JSON.stringify(result))
  } catch (err) {
    try { server.close() } catch {}
    finish(1, 'SIDEBAR_TEST_ERR ' + (err && err.stack ? err.stack : String(err)))
  }
})
