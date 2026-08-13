'use strict'
// 测试：验证"修改审阅"侧边栏 —— 非 git 仓库时显示初始化按钮，点击后刷新出文件列表
// 运行：electron sidebar-test.js
const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const path = require('node:path')

let isGit = false
const FILES = [{ path: 'src/a.js', status: ' M', untracked: false, diff: 'diff --git a/a b/a\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n' }]

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
    ipcMain.handle('shell:changes', () => (isGit
      ? { isGit: true, workspace: 'C:/fake/repo', files: FILES }
      : { isGit: false, workspace: 'C:/fake/repo', files: [] }))
    ipcMain.handle('shell:git-init', () => { isGit = true; return { ok: true, already: false } })
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
        if (!tab) return { ok: false, why: 'missing tab' }
        tab.click()
        await new Promise(r => setTimeout(r, 600))
        const body = document.getElementById('dsh-review-body')
        const hasInitBtn = body.textContent.includes('在此目录初始化 git 仓库')
        const initBtn = document.querySelector('#dsh-review-empty button')
        if (!initBtn) return { ok: false, why: 'no init button', hasInitBtn }
        initBtn.click()
        await new Promise(r => setTimeout(r, 700))
        const bodyAfter = document.getElementById('dsh-review-body').textContent
        const hasFile = bodyAfter.includes('src/a.js')
        return { ok: true, hasInitBtn, hasFile }
      } catch (e) { return { ok: false, why: 'eval threw: ' + e.message } }
    })()`)

    win.destroy()
    server.close()
    const pass = result.ok && result.hasInitBtn && result.hasFile
    finish(pass ? 0 : 1, 'SIDEBAR_INIT_TEST ' + JSON.stringify(result))
  } catch (err) {
    try { server.close() } catch {}
    finish(1, 'SIDEBAR_TEST_ERR ' + (err && err.stack ? err.stack : String(err)))
  }
})
