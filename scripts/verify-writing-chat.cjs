// Isolated, hidden Electron renderer. Never connects to or closes a user app.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-chat-'))
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
  store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, companions: { [project.toLowerCase()]: 'fixture' }, prefs: { ...store.DEFAULT_PREFS, autoSaveMs: 5000 } })
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
    function store(value){const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of listeners)fn()}}}
    const chatStore=store({chat:{order:[],nodes:new Map()},pending:[],queue:[],running:false});
    const draftStore=store({draft:''});
    const list=store({current:'fixture',byId:{fixture:{}},ids:['fixture']});
    const session={...chatStore,prompt:(content,mode)=>new Promise(resolve=>{window.testChat.calls.push({content,mode});window.testChat.resolve=resolve}),cancel:async()=>{window.testChat.stopped=true;return {ok:true}}};
    const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>({hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}})};
    window.testChat={calls:[],set:chatStore.set};
    window.__ModuleLoader__={load(entry){
      const plugin=entry.factory(name=>name==='react'?React:jsx);
      plugin.apply({sessions,effect:fn=>fn(),slots:{inject:(name,fn)=>fn(),register:(opts,Component)=>{if(opts.name==='shell.overlay')root.render(React.createElement(Component));return ()=>{}}}});
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
  await waitFor(`!!document.querySelector('.dshWmChatInput')`)
  await input('.dshWmChatInput', '她为什么不拆信？')
  await evaluate(`document.querySelector('.dshWmEditor').setSelectionRange(0,3)`)
  await button('＋ 引用稿件 / 选区')
  await evaluate(`document.querySelector('.dshWmSend').click()`)
  await waitFor(`testChat.calls.length===1`)
  assert.equal(await evaluate(`testChat.calls[0].mode`), 'queue')
  assert.ok(await evaluate(`testChat.calls[0].content[0].text.includes('第一章')`))
  await evaluate(`testChat.resolve({ok:false,error:{message:'网络不可用'}})`)
  await waitFor(`document.querySelector('.dshWmCompanionError')?.textContent==='网络不可用'`)
  assert.equal(await evaluate(`document.querySelector('.dshWmChatInput').value`), '她为什么不拆信？')
  assert.ok(await evaluate(`!!document.querySelector('.dshWmReference')`))
  console.log('PASS CHAT 失败保留输入与引用；仅发送选区；原生 queue 协议')
  await evaluate(`document.querySelector('.dshWmSend').click()`)
  await waitFor(`testChat.calls.length===2`)
  await input('.dshWmChatInput', '我又想到一个细节')
  await evaluate(`testChat.resolve({ok:true,value:{accepted:true}})`)
  await waitFor(`!document.querySelector('.dshWmSend').disabled`)
  assert.equal(await evaluate(`document.querySelector('.dshWmChatInput').value`), '我又想到一个细节')
  assert.equal(await evaluate(`!!document.querySelector('.dshWmReference')`), false)
  console.log('PASS CHAT 发送成功不擦除等待期间新输入')
  await evaluate(`testChat.set({chat:{order:['u','a','t','tail'],nodes:new Map([
    ['u',{kind:'user',data:{content:[{type:'text',text:'她为什么不拆信？'}]}}],
    ['a',{kind:'assistant-step',data:{blocks:[{kind:'text',text:'也许她已经猜到了'}]}}],
    ['t',{kind:'tool-call',data:{root:{name:'read_file',status:'running'}}}],
    ['tail',{kind:'turn-tail',data:{closing:{blocks:[{kind:'text',text:'不要重复结尾'}]}}}]
  ])},running:true,pending:[{key:'approval:1',kind:'approval'},{key:'question:2',kind:'question'}],queue:[{id:'q1',text:'下一条想法'}]})`)
  await waitFor(`document.querySelector('.dshWmConversation').innerText.includes('也许她已经猜到了')`)
  assert.equal(await evaluate(`document.querySelectorAll('.dshWmMessage').length`),2)
  assert.equal(await evaluate(`document.querySelectorAll('.dshWmRequest').length`),2)
  assert.ok(await evaluate(`document.querySelector('.dshWmConversation').innerText.includes('下一条想法')`))
  await evaluate(`testChat.set({chat:{order:['a'],nodes:new Map([['a',{kind:'assistant-step',data:{blocks:[{kind:'text',text:'也许她已经猜到了信里的内容。'}]}}]])},running:true,pending:[],queue:[]})`)
  await waitFor(`document.querySelector('.dshWmMessageText')?.textContent==='也许她已经猜到了信里的内容。'`)
  await evaluate(`document.querySelector('[aria-label="停止回复"]').click()`)
  await waitFor(`testChat.stopped===true`)
  console.log('PASS CHAT 历史/流式更新/工具折叠/授权与问题入口/排队/停止')
  await input('.dshWmChatInput', '继续说说')
  await evaluate(`document.querySelector('.dshWmChatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`)
  assert.equal(await evaluate(`testChat.calls.length`),2)
  await evaluate(`document.querySelector('.dshWmChatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await waitFor(`testChat.calls.length===3`)
  await evaluate(`testChat.resolve({ok:true,value:{accepted:true}})`)
  await waitFor(`document.querySelector('.dshWmChatInput').value===''`)
  console.log('PASS CHAT 中文输入法不误发送；普通 Enter 发送后清空已提交草稿')
  assert.equal(errors.length, 0, errors.join('\n'))
  fs.writeFileSync(path.join(temp, 'chat-ui.png'), (await win.webContents.capturePage()).toPNG())
  console.log('WRITING_CHAT_OK', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
