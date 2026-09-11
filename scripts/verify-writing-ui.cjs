// Isolated, hidden Electron renderer. Never connects to or closes a user app.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-ui-'))
app.setPath('userData', path.join(temp, 'user-data'))
process.env.DSH_HOME = path.join(temp, 'home')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let win, server
const errors = []
app.whenReady().then(async () => {
  const root = path.join(temp, 'library')
  const project = path.join(root, '演示项目')
  fs.mkdirSync(path.join(project, 'draft/novel'), { recursive: true })
  const a = path.join(project, 'draft/novel/第1章-v1.md')
  const b = path.join(project, 'draft/novel/第2章-v1.md')
  fs.writeFileSync(path.join(project, 'project.md'), '作品名：隔离测试')
  fs.writeFileSync(a, '第一章原文'); fs.writeFileSync(b, '第二章原文')
  const store = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/store.js')))
  const host = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/index.js')))
  store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: { ...store.DEFAULT_PREFS, autoSaveMs: 5000 } })
  let handler
  host.apply({ effect: f => f(), webServer: { register: route => { handler = route.handler; return () => {} } } })
  const modules = path.join(repo, 'runtime/node_modules/@deepseek-ai/dsh-client-ui-trajectory/node_modules')
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
  const clickFile = name => evaluate(`Array.from(document.querySelectorAll('.dshWmItem')).find(e=>e.title.endsWith(${JSON.stringify(name)})).click()`)
  const button = text => evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent===${JSON.stringify(text)}).click()`)
  const input = (selector, text) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  await waitFor(`document.querySelectorAll('.dshWmItem').length===3`)
  await clickFile('第1章-v1.md')
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='第一章原文'`)
  await input('.dshWmEditor', '第一章修改后')
  await waitFor(`document.querySelector('.dshWmStatus').innerText.includes('未保存')`)
  await clickFile('第2章-v1.md')
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='第二章原文'`)
  assert.equal(fs.readFileSync(a, 'utf8'), '第一章修改后')
  assert.equal(fs.readFileSync(b, 'utf8'), '第二章原文')
  console.log('PASS UI 文件切换先保存原文，不串稿')
  await button('v+1')
  await waitFor(`document.querySelector('.dshWmDocName')?.textContent.includes('v2')`)
  assert.equal(fs.readFileSync(path.join(project, 'draft/novel/第2章-v2.md'), 'utf8'), '第二章原文')
  await clickFile('第2章-v1.md')
  await waitFor(`document.querySelector('.dshWmEditor')?.readOnly===true`)
  console.log('PASS UI 服务端升版本与历史只读')
  await clickFile('第1章-v1.md')
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='第一章修改后'`)
  await input('.dshWmEditor', '退出时保存的文字')
  await button('退出写作')
  await waitFor(`!document.querySelector('.dshWmRoot')`)
  assert.equal(fs.readFileSync(a, 'utf8'), '退出时保存的文字')
  await evaluate(`document.getElementById('dsh-writing-mode-float').click()`)
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='退出时保存的文字'`)
  console.log('PASS UI 退出/重进无 Hooks 异常且文字已保存')
  await input('.dshWmEditor', '发生冲突的编辑器稿')
  fs.writeFileSync(a, '外部稿不可覆盖')
  await button('保存')
  await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('别处修改')`)
  assert.equal(fs.readFileSync(a, 'utf8'), '外部稿不可覆盖')
  await button('v+1')
  await waitFor(`document.querySelector('.dshWmDocName')?.textContent.includes('v2')`)
  assert.equal(fs.readFileSync(path.join(project, 'draft/novel/第1章-v2.md'), 'utf8'), '发生冲突的编辑器稿')
  console.log('PASS UI 冲突提示、保全外部稿、另存恢复')
  await sleep(250)
  fs.writeFileSync(path.join(temp, 'writing-ui.png'), (await win.webContents.capturePage()).toPNG())
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('WRITING_UI_OK', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
