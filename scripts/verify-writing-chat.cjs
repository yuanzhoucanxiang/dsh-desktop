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
  const evaluate = (code) =>
    win.webContents.executeJavaScript(code, true).catch((err) => {
      throw new Error('EVAL FAILED :: ' + String(code).slice(0, 140) + ' :: ' + err.message)
    })
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
  await waitFor(`document.querySelector('.dshWmConversation')?.innerText.includes('也许她已经猜到了')`)
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
  await waitFor(`document.querySelector('.dshWmChatInput')?.value===''`)
  console.log('PASS CHAT 中文输入法不误发送；普通 Enter 发送后清空已提交草稿')

  // ── P3 完整作者流程（方案 §4.4）：作者新增 → 带入 → 撤回 → 下轮变更 → 助手建议转候选 → 确认 ──
  // 全程走真实 host 记忆路由（/api/writing-mode?route=memory）+ 真实 preparedTurn；只有原生会话是假的。
  await button('项目备忘')
  await waitFor(`!!document.querySelector('.dshWmMemory .dshWmSearch')`)
  await input('.dshWmMemory .dshWmSearch', '主角叫林晚')
  // 备忘还在加载时保存按钮是 disabled：必须等到可用再点（否则点了空）
  await waitFor(`!Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='保存为项目备忘')?.disabled`)
  await button('保存为项目备忘')
  await waitFor(`!!document.querySelector('.dshWmMemoryStatus[data-status="confirmed"]')`)
  assert.ok(await evaluate(`document.querySelector('.dshWmMemoryStatus').dataset.status==='confirmed'`))
  // 当轮参考入口如实显示"可参考 1 条"
  await waitFor(`document.querySelector('[data-wm-context-toggle]')?.textContent==='参考项目备忘 · 1 条'`)
  await button('收起备忘') // 收起面板，回到输入区
  await input('.dshWmChatInput', '这一章怎么开头？')
  await evaluate(`document.querySelector('.dshWmSend').click()`)
  await waitFor('testChat.calls.length===4')
  const withMemory = await evaluate('testChat.calls[3].content[0].text')
  assert.ok(withMemory.includes('【项目备忘 · 作者已确认'), '确认过的设定要真的进请求：' + withMemory.slice(0, 120))
  assert.ok(withMemory.includes('主角叫林晚'))
  assert.ok(withMemory.trim().endsWith('这一章怎么开头？'), '作者正文要在末尾完整保留')
  await evaluate(`testChat.resolve({ok:true,value:{accepted:true}})`)
  await waitFor(`document.querySelector('.dshWmChatInput')?.value===''`)
  // 展开面板能看到逐条勾选与省略说明
  await evaluate(`document.querySelector('[data-wm-context-toggle]').click()`)
  await waitFor(`!!document.querySelector('[data-wm-memory-pin]')`)
  assert.ok(await evaluate(`document.querySelectorAll('[data-wm-memory-pin]').length===1`))
  assert.ok(await evaluate(`document.querySelector('.dshWmContextPanel').innerText.includes('Unicode 字符数')`))
  await evaluate(`document.querySelector('[data-wm-context-toggle]').click()`)
  // 撤回后：不再自动带入（下轮变更生效，而不是复用上一轮的缓存）
  await button('项目备忘')
  await waitFor(`!!document.querySelector('.dshWmMemoryStatus[data-status="confirmed"]')`)
  await waitFor(`!Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='撤回')?.disabled`)
  await button('撤回')
  await waitFor(`!document.querySelector('[data-wm-context-toggle]')?.textContent.includes('1 条')`)
  await button('收起备忘')
  await input('.dshWmChatInput', '撤回之后还带吗')
  await evaluate(`document.querySelector('.dshWmSend').click()`)
  await waitFor('testChat.calls.length===5')
  const afterRetract = await evaluate('testChat.calls[4].content[0].text')
  assert.ok(!afterRetract.includes('主角叫林晚'), '撤回的条目不得再出现：' + afterRetract.slice(0, 120))
  await evaluate(`testChat.resolve({ok:true,value:{accepted:true}})`)
  // 助手建议 → 记为候选：不注入，确认后才注入
  await evaluate(`testChat.set({chat:{order:['a'],nodes:new Map([['a',{kind:'assistant-step',data:{blocks:[{kind:'text',text:'也许她已经猜到信里的内容。'}]}}]])},running:false,pending:[],queue:[]})`)
  await waitFor(`!!document.querySelector('[data-wm-candidate]')`)
  await evaluate(`document.querySelector('[data-wm-candidate]').click()`)
  await waitFor(`document.querySelector('.dshWmMemory [data-wm-memory-save]')?.textContent==='存为候选'`)
  // Consume the one-shot parent candidate, then edit and persist it through UI.
  // Provenance must survive the intervening renders and author edits.
  await input('.dshWmMemoryCompose .dshWmSearch', '她可能已经猜到信里写了什么。')
  await waitFor(`!document.querySelector('.dshWmMemory [data-wm-memory-save]')?.disabled`)
  await button('存为候选')
  await waitFor(`!!document.querySelector('.dshWmMemoryStatus[data-status="proposed"]')`)
  const candidateOnDisk = JSON.parse(fs.readFileSync(path.join(project, 'state/writing-memory.json'), 'utf8')).items.find(it => it.status === 'proposed')
  assert.equal(candidateOnDisk.text, '她可能已经猜到信里写了什么。')
  assert.equal(candidateOnDisk.source.kind, 'assistant')
  assert.equal(candidateOnDisk.source.messageId, 'a')
  assert.equal(candidateOnDisk.source.sessionId, 'fixture')
  assert.ok(
    await evaluate(`document.querySelector('[data-wm-context-toggle]').textContent==='本次没有可参考的已确认条目'`),
    '候选不算"可参考"，提示条不能把它算进去'
  )
  await button('确认')
  await waitFor(`!!document.querySelector('.dshWmMemoryStatus[data-status="confirmed"]')`)
  const confirmedOnDisk = JSON.parse(fs.readFileSync(path.join(project, 'state/writing-memory.json'), 'utf8')).items.find(it => it.id === candidateOnDisk.id)
  assert.deepEqual(confirmedOnDisk.source, candidateOnDisk.source, 'Author confirmation must not relabel assistant provenance')
  await waitFor(`document.querySelector('[data-wm-context-toggle]')?.textContent==='参考项目备忘 · 1 条'`)
  // 关掉本次参考：请求里就不再自动带备忘（正文照发）
  await evaluate(`document.querySelector('[data-wm-context-enabled]').click()`)
  await button('收起备忘')
  await input('.dshWmChatInput', '这次不参考备忘')
  await evaluate(`document.querySelector('.dshWmSend').click()`)
  await waitFor('testChat.calls.length===6')
  const noMemory = await evaluate('testChat.calls[5].content[0].text')
  assert.ok(!noMemory.includes('项目备忘'), '关掉参考后不得再注入：' + noMemory.slice(0, 120))
  assert.ok(noMemory.includes('这次不参考备忘'))
  await evaluate(`testChat.resolve({ok:true,value:{accepted:true}})`)
  console.log('PASS CHAT 作者新增→带入→撤回→下轮变更；助手建议转候选→确认后带入；关掉参考即不带')

  assert.equal(errors.length, 0, errors.join('\n'))
  fs.writeFileSync(path.join(temp, 'chat-ui.png'), (await win.webContents.capturePage()).toPNG())
  console.log('WRITING_CHAT_OK', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
