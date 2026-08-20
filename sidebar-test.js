'use strict'
// 测试：验证"修改审阅"侧边栏 —— 会话改动视图（默认）+ Git 视图切换
// 运行：electron sidebar-test.js
const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const path = require('node:path')

const SESSION = {
  ok: true,
  entries: [
    { kind: 'tool-call', ts: 1, session: 's1', turn: 1, step: 1, callId: 'c1', name: 'write', file: 'src/new.js', old: null, new: 'console.log("hi")' },
    { kind: 'tool-call', ts: 2, session: 's1', turn: 1, step: 3, callId: 'c2', name: 'edit', file: 'src/a.js', old: 'old line', new: 'new line' },
    { kind: 'turn-end', ts: 3, session: 's1', turn: 1 },
  ],
}
const GIT = {
  isGit: true, workspace: 'C:/fake/repo',
  files: [{ path: 'src/gitfile.js', status: ' M', untracked: false, diff: 'diff --git a/gitfile b/gitfile\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n' }],
}

app.disableHardwareAcceleration()

function finish(code, msg) {
  console.log(msg)
  try { server.close() } catch {}
  // 同步退出：先 destroy 窗口再延时 exit 会被 Electron 默认的 window-all-closed（code 0）抢跑，
  // 失败也会"通过"—— 这个坑真实发生过。
  app.exit(code)
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
    ipcMain.handle('shell:changes', () => GIT)
    ipcMain.handle('shell:session-changes', () => SESSION)
    ipcMain.handle('shell:git-init', () => ({ ok: true }))
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
        // 0.1.10 起右侧标签改成了 rail 上的开关按钮（#dsh-review-toggle），旧 id dsh-review-tab 已不存在
        const tab = document.getElementById('dsh-review-toggle')
        if (!tab) return { ok: false, why: 'missing toggle' }
        tab.click()
        await new Promise(r => setTimeout(r, 600))
        const body = document.getElementById('dsh-review-body')
        const sessionBody = body.textContent
        const hasNewJs = sessionBody.includes('src/new.js')
        const hasAJs = sessionBody.includes('src/a.js')
        const hasTurn = sessionBody.includes('第 1 轮')
        const hasOldNew = sessionBody.includes('old line') && sessionBody.includes('new line')
        // 切到 Git 视图
        const modeBtns = document.querySelectorAll('#dsh-review-mode button')
        if (modeBtns.length !== 2) return { ok: false, why: 'mode buttons missing: ' + modeBtns.length }
        modeBtns[1].click()
        await new Promise(r => setTimeout(r, 600))
        const gitBody = document.getElementById('dsh-review-body').textContent
        const hasGitFile = gitBody.includes('src/gitfile.js')
        return { ok: true, hasNewJs, hasAJs, hasTurn, hasOldNew, hasGitFile }
      } catch (e) { return { ok: false, why: 'eval threw: ' + e.message } }
    })()`)

    win.destroy()
    server.close()
    const pass = result.ok && result.hasNewJs && result.hasAJs && result.hasTurn && result.hasOldNew && result.hasGitFile
    finish(pass ? 0 : 1, 'SIDEBAR_SESSION_TEST ' + JSON.stringify(result))  } catch (err) {
    try { server.close() } catch {}
    finish(1, 'SIDEBAR_TEST_ERR ' + (err && err.stack ? err.stack : String(err)))
  }
})
