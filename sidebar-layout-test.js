'use strict'
// 测试：分割式侧边栏 + 主题变量 —— 加载真实内核页面验证
// 运行：electron sidebar-layout-test.js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

app.disableHardwareAcceleration()

function finish(code, msg) {
  console.log(msg)
  setTimeout(() => app.exit(code), 100)
}

const MOCK = {
  isGit: true, workspace: 'C:/fake/repo',
  files: [{ path: 'src/a.js', status: ' M', untracked: false, diff: 'diff --git a/a b/a\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n' }],
}

app.whenReady().then(async () => {
  try {
    ipcMain.handle('shell:get-state', () => ({ workspace: 'C:/fake/repo', phase: 'ready' }))
    ipcMain.handle('shell:changes', () => MOCK)
    ipcMain.handle('shell:session-changes', () => ({ ok: true, entries: [] }))
    ipcMain.handle('shell:git-init', () => ({ ok: true }))
    ipcMain.handle('shell:revert', () => ({ ok: true, canceled: false }))
    ipcMain.handle('shell:open-file', () => '')

    const win = new BrowserWindow({
      width: 1360, height: 900, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      },
    })
    // 加载真实内核页面（本机桌面应用当前内核端口 8760）
    await win.loadURL('http://127.0.0.1:8760/').catch((e) => {
      console.log('KERNEL_LOAD_WARN ' + e.message)
    })
    await new Promise((r) => setTimeout(r, 4000))

    const result = await win.webContents.executeJavaScript(`(async () => {
      try {
        const tab = document.getElementById('dsh-review-tab')
        const panel = document.getElementById('dsh-review-panel')
        if (!tab || !panel) return { ok: false, why: 'sidebar not injected' }
        const before = document.body.getBoundingClientRect().width
        const rootBefore = (document.querySelector('#app, #root, .app, .main') || document.body).getBoundingClientRect().width
        tab.click()
        await new Promise(r => setTimeout(r, 500))
        const after = document.body.getBoundingClientRect().width
        const margin = getComputedStyle(document.body).marginRight
        const openClass = document.body.classList.contains('dsh-review-open')
        const panelBg = getComputedStyle(panel).backgroundColor
        const panelBorder = getComputedStyle(panel).borderLeftColor
        const panelVisible = !panel.classList.contains('dsh-hidden')
        // 主题变量是否可解析（非透明/非初始值）
        const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
        const varBg = cssVar('--dsw-alias-bg-base')
        const varLabel = cssVar('--dsw-alias-label-primary')
        const rootAfter = (document.querySelector('#app, #root, .app, .main') || document.body).getBoundingClientRect().width
        return {
          ok: true, before, after, margin, openClass, panelVisible,
          rootShrunk: rootAfter < rootBefore - 100,
          panelBg, panelBorder,
          varBg, varLabel,
        }
      } catch (e) { return { ok: false, why: 'eval threw: ' + e.message } }
    })()`)

    win.destroy()
    const pass = result.ok && result.margin === '360px' && result.panelVisible && result.rootShrunk
    finish(pass ? 0 : 1, 'LAYOUT_TEST ' + JSON.stringify(result))
  } catch (err) {
    finish(1, 'LAYOUT_TEST_ERR ' + (err && err.stack ? err.stack : String(err)))
  }
})
