// Isolated, hidden Electron renderer. Never connects to or closes a user app.
// 导出成书（compile）UI 端到端：项目头「成书」入口 → 面板候选/勾选 → 导出落盘 → 编辑器打开成片。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-compile-'))
app.setPath('userData', path.join(temp, 'user-data'))
process.env.DSH_HOME = path.join(temp, 'home')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let win, server
const errors = []
app.whenReady().then(async () => {
  const root = path.join(temp, 'library')
  const project = path.join(root, '演示项目')
  fs.mkdirSync(path.join(project, 'draft/novel'), { recursive: true })
  fs.mkdirSync(path.join(project, 'bible'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.md'), '作品名：隔离测试')
  fs.writeFileSync(path.join(project, 'draft/novel/第1章-v1.md'), '第一章旧稿')
  fs.writeFileSync(path.join(project, 'draft/novel/第1章-v2.md'), '第一章新稿')
  fs.writeFileSync(path.join(project, 'draft/novel/第2章-v1.md'), '第二章正文')
  fs.writeFileSync(path.join(project, 'bible/world.md'), '世界设定不是正文')
  const store = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/store.js')))
  const host = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/index.js')))
  store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: { ...store.DEFAULT_PREFS, autoSaveMs: 5000 } })
  let handler
  host.apply({ effect: f => f(), webServer: { register: route => { handler = route.handler; return () => {} } } })
  // React 来源：优先仓库 node_modules（devDependencies 已显式声明 react-dom）；
  // 旧内核运行时（0.1.1 时代 react 内嵌于 dsh-client-ui-trajectory）作回退。
  const runtimeModules = path.join(repo, 'runtime/node_modules/@deepseek-ai/dsh-client-ui-trajectory/node_modules')
  const modules = fs.existsSync(path.join(repo, 'node_modules/react-dom/package.json')) ? path.join(repo, 'node_modules') : runtimeModules
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root{--dsw-alias-bg-base:#f7f5ef;--dsw-alias-bg-layer-1:#efede7;--dsw-alias-bg-layer-2:#e6e4dd;--dsw-alias-bg-layer-3:#fff;--dsw-alias-label-primary:#292a26;--dsw-alias-label-secondary:#52554b;--dsw-alias-label-tertiary:#777b6c;--dsw-alias-border-l2:#cfcec4;--dsw-alias-brand-primary:#526d51;--dsw-alias-state-error-primary:#b34636;--dsw-alias-state-success-primary:#426545}
    body{margin:0;font:14px system-ui}#host{padding:20px}
    </style><div id="host">编码会话（隔离测试）</div><div id="overlay"></div><script>
    localStorage.setItem('dsh-writing-mode-active','1');
    process.env.NODE_ENV='production';
    const React=require(${JSON.stringify(path.join(modules, 'react'))});
    const jsx=require(${JSON.stringify(path.join(modules, 'react/jsx-runtime'))});
    const ReactDOM=require(${JSON.stringify(path.join(modules, 'react-dom/client'))});
    const root=ReactDOM.createRoot(document.getElementById('overlay'));
    window.__ModuleLoader__={load(entry){
      const plugin=entry.factory(name=>name==='react'?React:jsx);
      plugin.apply({effect:fn=>fn(),slots:{inject:(name,fn)=>fn(),register:(opts,Component)=>{if(opts.name==='shell.overlay')root.render(React.createElement(Component));return ()=>{}}}});
    }};
    </script><script src="/client.js"></script>`
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/writing-mode')) return void handler(req, res).catch(err => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: err.message })) })
    res.setHeader('content-type', req.url === '/client.js' ? 'application/javascript' : 'text/html; charset=utf-8')
    res.end(req.url === '/client.js' ? fs.readFileSync(path.join(repo, 'plugin/writing-mode/client.js')) : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  win = new BrowserWindow({ width: 1500, height: 980, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  win.webContents.on('console-message', (event, level, message) => {
    const d = event.message ? event : typeof level === 'object' ? level : { level, message }
    if (d.level === 'error' || d.level === 3) { errors.push(d.message); console.log('RENDER ERROR', d.message) }
  })
  const evaluate = code => win.webContents.executeJavaScript(code, true)
  async function waitFor(code) {
    const until = Date.now() + 12000
    while (Date.now() < until) { if (await evaluate(code)) return; await sleep(70) }
    throw new Error('Timed out: ' + code + '\n' + await evaluate('document.body.innerText') + '\n' + errors.join('\n'))
  }
  const button = text => evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent===${JSON.stringify(text)}).click()`)
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  // 作品导航只列章节（2026-10-10 第六轮）：5 篇可列文稿里 draft 三篇进导航，project/world 归档案与文件视图
  await waitFor(`document.querySelectorAll('.dshWmItem').length===3`)

  // 2026-10-10：项目操作行（档案/成书/添加资料）只随**当前项目**出现
  // （LibraryPane 的 isActiveProj：正在编辑的文件属于该项目），这是"每个展开的项目
  // 都重复一遍操作行"那条用户反馈的修法。所以门禁要先打开一篇稿件——这也正是
  // 真实作者的路径：先点开稿子，再从项目头导出成书。
  await evaluate(`(() => { const rows=[...document.querySelectorAll('.dshWmItem')]; const p=rows.find(b=>/project\\.md/.test(b.title||''))||rows[0]; if(p) p.click(); return !!p })()`)
  await waitFor(`!!document.querySelector('textarea.dshWmEditor') && document.querySelector('textarea.dshWmEditor').value.length > 0`)
  await waitFor(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='成书')`)

  await button('成书')
  await waitFor(`!!document.querySelector('.dshWmExport')`)
  // 候选 = 4（world、第1章 v2、第2章 v1、project；历史版 v1 被略过）；默认勾选 = 2（draft/ 下两篇）
  await waitFor(`document.querySelectorAll('.dshWmExportRow').length===4`)
  await waitFor(`document.querySelectorAll('.dshWmExportRow input:checked').length===2`)
  const rowsText = await evaluate(`Array.from(document.querySelectorAll('.dshWmExportRowName')).map(e=>e.textContent).join('|')`)
  assert(!rowsText.includes('v1') && rowsText.includes('第1章') && rowsText.includes('world') && rowsText.includes('project'), '候选为当前版+非正文资料')
  console.log('PASS UI 面板候选：最新版 4 项、默认勾选 draft/ 2 篇、历史版已略过')

  await button('导出成书')
  await waitFor(`!document.querySelector('.dshWmExport')`)
  const out = path.join(project, '演示项目-v1.md')
  assert.equal(fs.existsSync(out), true, '成片落盘 演示项目-v1.md')
  const text = fs.readFileSync(out, 'utf8')
  assert.ok(text.startsWith('# 演示项目'), '书头为书名')
  assert.ok(text.includes('共 2 篇'), '书头篇数 = 勾选数')
  const posA = text.indexOf('第一章新稿')
  const posB = text.indexOf('第二章正文')
  assert.ok(posA > -1 && posB > posA, '章节按树序拼接且只收 v2')
  assert.ok(!text.includes('第一章旧稿') && !text.includes('世界设定不是正文'), '历史版与未勾选资料不进成片')
  await waitFor(`document.querySelector('.dshWmPathText')?.textContent.includes('演示项目-v1.md')`)
  console.log('PASS UI 导出落盘、内容正确、编辑器自动打开成片')

  // 再导出一次 → -v2，v1 原样保留；候选 +1（成片 演示项目-v1.md 自身，默认不勾选）
  await button('成书')
  await waitFor(`!!document.querySelector('.dshWmExport')`)
  await waitFor(`document.querySelectorAll('.dshWmExportRow').length===5`)
  await button('导出成书')
  await waitFor(`document.querySelector('.dshWmPathText')?.textContent.includes('演示项目-v2.md')`)
  assert.equal(fs.readFileSync(out, 'utf8'), text, 'v1 成片未被覆盖')
  console.log('PASS UI 再导出递增 v2、旧成片不动、成片进候选列表')

  await sleep(250)
  fs.writeFileSync(path.join(temp, 'writing-compile.png'), (await win.webContents.capturePage()).toPNG())
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('WRITING_COMPILE_UI_OK', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
