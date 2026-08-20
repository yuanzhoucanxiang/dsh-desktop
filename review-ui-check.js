'use strict'
// 测试：审阅面板的「信任闭环」UI —— 逐 hunk 暂存/取消暂存、分档展示、提交条、共存让位
// 运行：electron review-ui-check.js，exit 0 = 通过
// 用真临时 git 仓库 + 真 preload + 内核页面桩；主进程侧直接复用 lib/git-review.js。
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { execFileSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createGitReview } = require('./lib/git-review')

app.disableHardwareAcceleration()
const watchdog = setTimeout(() => { console.log('FAIL watchdog'); app.exit(1) }, 120000)
watchdog.unref && watchdog.unref()

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--dsw-alias-bg-base:#161a2e;--dsw-alias-bg-layer-1:#1e2236;--dsw-alias-label-primary:#e6e9ff;
    --dsw-alias-label-secondary:#aeb8d8;--dsw-alias-label-tertiary:#6f7a99;--dsw-alias-border-l1:#242a44;
    --dsw-alias-border-l2:#2e3554;--dsw-alias-brand-primary:#5d6dff;--dsw-alias-interactive-bg-hover:#20263c;
    --dsw-alias-button-primary-fill:#4f63d8;--dsw-alias-state-success-primary:#7fe0a8;--dsw-alias-state-error-primary:#ff9a9a;}
  html,body{margin:0;height:100%;background:var(--dsw-alias-bg-base);}
  #app{width:100%;height:100%;}
</style></head><body><div id="app">kernel stub</div></body></html>`

// 造仓库：一个文件两处相距很远的改动 → 必然切成 2 个 hunk
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-reviewui-'))
const sh = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true })
const base = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
sh(['init', '-q'])
sh(['config', 'user.email', 't@t'])
sh(['config', 'user.name', 't'])
fs.writeFileSync(path.join(repo, 'a.txt'), base)
sh(['add', 'a.txt'])
sh(['commit', '-q', '-m', 'base'])
fs.writeFileSync(path.join(repo, 'a.txt'), base.replace('line 1', 'ONE').replace('line 14', 'FOURTEEN'))

const review = createGitReview(() => repo)
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  ipcMain.handle('shell:get-state', () => ({ workspace: repo, phase: 'ready', theme: 'deep' }))
  ipcMain.handle('shell:changes', () => review.changes())
  ipcMain.handle('shell:session-changes', () => ({ ok: true, entries: [] }))
  ipcMain.handle('shell:get-panel-width', () => 360)
  ipcMain.handle('shell:set-panel-width', () => true)
  ipcMain.handle('shell:git-init', () => review.init())
  ipcMain.handle('shell:open-file', () => '')
  ipcMain.handle('shell:git-stage', (_e, p, h) => review.stage(p, h ?? null))
  ipcMain.handle('shell:git-unstage', (_e, p, h) => review.unstage(p, h ?? null))
  ipcMain.handle('shell:git-revert-hunk', (_e, p, h) => review.revertHunk(p, h))
  ipcMain.handle('shell:git-commit', (_e, m) => review.commit(m))
  ipcMain.handle('shell:git-push', () => review.push())
  ipcMain.handle('shell:revert', (_e, p, u) => ({ ok: review.revertFile(p, u).ok, canceled: false }))

  const win = new BrowserWindow({
    width: 1400,
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
  await sleep(900)
  const exec = (js) => win.webContents.executeJavaScript(js, true)

  // 打开面板 → 切到 Git 视图 → 展开文件
  await exec(`(document.getElementById('dsh-review-toggle').click(), 1)`)
  await sleep(500)
  await exec(`(document.querySelectorAll('#dsh-review-mode button')[1].click(), 1)`)
  await sleep(700)
  await exec(`(document.querySelector('#dsh-review-item-row').click(), 1)`)
  await sleep(600)

  const snap = () => exec(`(function () {
    const q = (s) => document.querySelectorAll(s)
    const bars = [...q('#dsh-review-hunkbar')]
    return {
      hunkBars: bars.length,
      barTexts: bars.map((b) => b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40)),
      sections: [...q('#dsh-review-sect')].map((s) => s.textContent),
      commitOn: document.getElementById('dsh-review-commit').classList.contains('dsh-on'),
      commitDisabled: document.querySelector('#dsh-review-commit button.primary').disabled,
      pushDisabled: [...q('#dsh-review-commit button')][1].disabled,
      meta: document.querySelector('#dsh-review-commit .c-meta').textContent,
      coexist: document.getElementById('dsh-review-root').classList.contains('dsh-coexist'),
      pushed: document.body.style.marginRight,
    }
  })()`)

  let s = await snap()
  check('未暂存的两块各有一条操作条', s.hunkBars === 2, `bars=${s.hunkBars}`)
  check('块头显示"第 N/M 块"', /第 1\/2 块/.test(s.barTexts[0] || ''), s.barTexts[0])
  check('提交条在 Git 视图出现', s.commitOn === true)
  check('暂存区为空时提交按钮禁用', s.commitDisabled === true, s.meta)
  check('无远端时推送按钮禁用', s.pushDisabled === true)
  check('非共存模式下页面被挤压', /px$/.test(s.pushed || ''), s.pushed)

  // 点第 1 块的「暂存这块」→ 应变成 已暂存1块 + 未暂存1块 两档
  await exec(`(function(){
    const bar = document.querySelectorAll('#dsh-review-hunkbar')[0]
    const btn = [...bar.querySelectorAll('button')].find(b => b.textContent === '暂存这块')
    btn.click()
  })()`)
  await sleep(1200)
  await exec(`(function(){ const r=document.querySelector('#dsh-review-item-row'); if(!document.querySelector('#dsh-review-hunkbar')) r.click(); })()`)
  await sleep(600)
  s = await snap()
  check('暂存一块后出现两个分档标题', s.sections.length === 2, JSON.stringify(s.sections))
  check('分档标题正确（已暂存 1 块 / 未暂存 1 块）',
    /已暂存 · 1 块/.test(s.sections[0] || '') && /未暂存 · 1 块/.test(s.sections[1] || ''),
    JSON.stringify(s.sections))
  check('已暂存那块提供"取消暂存这块"', s.barTexts.some((t) => /取消暂存这块/.test(t)), JSON.stringify(s.barTexts))
  check('提交按钮变为可用', s.commitDisabled === false, s.meta)
  check('提交条显示已暂存文件数与分支', /已暂存 1 个文件/.test(s.meta) && /master|main/.test(s.meta), s.meta)

  // 后端校验：只暂存了第一块
  const st = review.changes().files.find((f) => f.path === 'a.txt')
  check('后端确认：只有第一块进了暂存区',
    st.hunksStaged === 1 && st.hunksUnstaged === 1 && st.diffStaged.includes('ONE') && !st.diffStaged.includes('FOURTEEN'),
    `staged=${st.hunksStaged} unstaged=${st.hunksUnstaged}`)

  // 提交：写信息 → 点提交
  await exec(`(function(){
    const ta = document.querySelector('#dsh-review-commit textarea')
    ta.value = 'feat: 只提交第一块'
    document.querySelector('#dsh-review-commit button.primary').click()
  })()`)
  await sleep(1400)
  const head = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim()
  check('提交成功且信息正确', head === 'feat: 只提交第一块', head)
  const left = review.changes().files.find((f) => f.path === 'a.txt')
  check('提交后剩下的那块仍在工作区', !!left && left.hunksUnstaged === 1 && left.diffUnstaged.includes('FOURTEEN'),
    left ? `unstaged=${left.hunksUnstaged}` : 'missing')

  // 共存让位：模拟内核侧右侧栏出现
  await exec(`(function(){
    const el = document.createElement('div')
    el.id = 'better-sidebar-root'
    document.body.appendChild(el)
  })()`)
  await sleep(2200) // 等共存探测轮询
  const co = await snap()
  check('检测到内核侧右侧栏后进入共存模式', co.coexist === true)
  check('共存模式下不再挤压页面', !/px$/.test(co.pushed || ''), `marginRight="${co.pushed}"`)
  const railHidden = await exec(`getComputedStyle(document.getElementById('dsh-review-rail')).display`)
  check('共存模式下隐藏自己的 rail（不抢右缘）', railHidden === 'none', railHidden)

  server.close()
  try { fs.rmSync(repo, { recursive: true, force: true }) } catch {}
  console.log(failures.length ? 'REVIEW_UI_FAIL ' + failures.join(' | ') : 'REVIEW_UI_OK')
  app.exit(failures.length === 0 ? 0 : 1)
}).catch((err) => {
  try { server.close() } catch {}
  try { fs.rmSync(repo, { recursive: true, force: true }) } catch {}
  console.log('FAIL main: ' + (err && err.stack ? err.stack : err))
  app.exit(1)
})
