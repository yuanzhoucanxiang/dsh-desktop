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
  // 假 llm：让「文字工具」在 fixture 里确定性地产出改稿建议，从而端到端测改稿 diff 回路；
  // lastPrompt 记录最近一次 prompt，用来断言输入框里的补充要求（hint）确实拼进了指令
  let lastPrompt = ''
  const fakeLlm = {
    stream: async function* (options) {
      lastPrompt = String(options?.messages?.[0]?.content?.[0]?.text || '')
      yield { type: 'text-delta', index: 0, text: '改写后的句子' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  host.apply({ effect: f => f(), webServer: { register: route => { handler = route.handler; return () => {} } }, llm: fakeLlm })
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
  const clickFile = name => evaluate(`Array.from(document.querySelectorAll('.dshWmItem')).find(e=>e.title.endsWith(${JSON.stringify(name)})).click()`)
  const button = text => evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent===${JSON.stringify(text)}).click()`)
  const input = (selector, text) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  // 纯写作第一屏契约：右栏不渲染、文库收起、空页在场；走完空页动作再进正题
  await waitFor(`document.querySelector('.dshWmRoot')!==null`)
  assert.equal(await evaluate(`document.querySelector('.dshWmSide.is-ai')`), null, '第一屏不应渲染右栏')
  assert.equal(await evaluate(`document.body.getAttribute('data-writing-lib')`), '0', '第一屏文库应收起')
  await waitFor(`document.querySelector('[data-wm-empty]')!==null`)
  // 2026-10-10 契约变更：定位不到「当前文稿所属作品」时档案钮**不再禁用**（灰按钮会被读成"档案打不开"）。
  // 行为改为：① 有稿 → 用稿所属作品；② 没开稿但库里只有一个作品 → 直接用那个作品；
  // ③ 多个作品且没开稿 → 可点，点击时提示"先打开一篇稿件"。
  // 本 fixture 只有一个作品，所以空态点击应当**直接打开**档案层（唯一作品回退）。
  assert.equal(await evaluate(`document.querySelector('[data-wm-archive]')?.disabled`), false, '空态档案钮不应禁用（改为点击时定位/说明）')
  await evaluate(`document.querySelector('[data-wm-archive]').click()`)
  await waitFor(`document.querySelector('.dshWmWiki')!==null`)
  assert.equal(await evaluate(`!!document.querySelector('.dshWmWikiTitle')`), true, '空态点档案应打开档案层（唯一作品回退）')
  await button('关闭档案')
  await button('从库里打开')
  await waitFor(`document.body.getAttribute('data-writing-lib')==='1'`)
  await waitFor(`document.querySelectorAll('.dshWmItem').length===2`)
  await clickFile('第1章-v1.md')
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='第一章原文'`)
  assert.equal(await evaluate(`document.querySelector('[data-wm-empty]')`), null, '打开文稿后空页应让位')
  await waitFor(`document.body.getAttribute('data-writing-lib')==='0'`)
  console.log('PASS UI 纯写作第一屏：面板默认收起、空页借库、开稿自动归还')
  await button('AI')
  await waitFor(`document.querySelector('.dshWmSide.is-ai')!==null`)
  // 顶栏 v+1 已归拢进版本条（唯一「存新版」入口）
  assert.ok(!(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='v+1')`)), '顶栏不应再有 v+1 按钮')
  // 版本条：单版本文档也渲染，条尾有「另存为新版」
  await waitFor(`document.querySelector('.dshWmVerBar')!==null`)
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.dshWmVerBar button')).some(e=>e.textContent==='另存为新版')`), '版本条缺「另存为新版」')
  // 右栏两区：写作伙伴 / 检查；文字工具收进伙伴输入框旁的 ✦ 图标菜单（2026-10-09 第二轮整合）
  await waitFor(`Array.from(document.querySelectorAll('.dshWmTab')).map(e=>e.textContent).join('|')==='写作伙伴|检查'`)
  await button('检查')
  await waitFor(`Array.from(document.querySelectorAll('.dshWmSecToggle')).some(e=>e.textContent.includes('成稿检查'))&&Array.from(document.querySelectorAll('.dshWmSecToggle')).some(e=>e.textContent.includes('伏笔与线索'))`)
  console.log('PASS UI 右栏两区：检查 tab 承载成稿检查与伏笔线索，版本入口归拢')
  await button('写作伙伴')
  await waitFor(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='✦')`)
  await button('✦')
  await waitFor(`document.querySelector('.dshWmToolsMenu').className.includes('is-open')`)
  await button('润色')
  await waitFor(`document.querySelector('[data-wm-tool-armed]')?.getAttribute('data-wm-tool-armed')==='polish'`)
  await waitFor(`!Array.from(document.querySelectorAll('.dshWmSecToggle')).some(e=>e.textContent.includes('成稿检查'))`)
  // armed 是单次状态：× 解除后输入框还原，不残留工具
  await evaluate(`document.querySelector('[data-wm-tool-disarm]').click()`)
  await waitFor(`!document.querySelector('[data-wm-tool-armed]')`)
  console.log('PASS UI 文字工具收进输入框旁 ✦ 菜单：选中即待运行，可取消，不混入检查区块')
  // 能力缺口必须说话：本 fixture 没注入内核 sessions，伙伴面板要讲清「缺什么、还能不能写、会不会丢」，
  // 而不是让作者对着一只灰掉的按钮猜（0.1.7 适配遗留的 UX 空档）。
  await button('写作伙伴')
  await waitFor(`document.querySelector('[data-wm-capability="blocked"]')!==null`)
  const capabilityText = await evaluate(`document.querySelector('[data-wm-capability="blocked"]').textContent`)
  assert.match(capabilityText, /内核会话服务未挂载/, '能力条应说明缺的是会话服务')
  assert.match(capabilityText, /本地草稿/, '能力条应说明想法不会丢')
  assert.ok(!/sessions\.binding|remote\.session|provideInfo/.test(capabilityText), '不该把内核能力名直接甩给作者')
  assert.equal(await evaluate(`document.querySelector('.dshWmChatInput').disabled`), false, '连不上内核时仍应能记下想法')
  assert.equal(await evaluate(`document.querySelector('.dshWmSend').disabled`), true, '发不出去时发送键必须禁用')
  assert.match(await evaluate(`document.querySelector('.dshWmSend').title`), /连不上内核/, '禁用原因要能在按钮上看到')
  assert.ok(await evaluate(`document.querySelector('[data-wm-session-list="unavailable"]')!==null`), '会话列表不可用时要留一行原因')
  console.log('PASS UI 内核能力缺口可见：原因、出路、输入仍可用')
  await input('.dshWmEditor', '第一章修改后')
  await waitFor(`document.querySelector('.dshWmStatus').innerText.includes('未保存')`)
  await clickFile('第2章-v1.md')
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='第二章原文'`)
  assert.equal(fs.readFileSync(a, 'utf8'), '第一章修改后')
  assert.equal(fs.readFileSync(b, 'utf8'), '第二章原文')
  console.log('PASS UI 文件切换先保存原文，不串稿')
  // 码字统计：保存一次后状态条出现「今日净增」；检查页可设日更目标并回显到状态条
  await waitFor(`document.querySelector('[data-wm-stats-today]')!==null`)
  assert.equal(await evaluate(`document.querySelector('[data-wm-stats-today]').getAttribute('data-wm-stats-today')`), '1', '今日净增应为 1（打开播种 5 字 → 改后 6 字）')
  await button('检查')
  await evaluate(`Array.from(document.querySelectorAll('.dshWmSecToggle')).find(e=>e.textContent.includes('码字')).click()`)
  await waitFor(`document.querySelector('[data-wm-goal-input]')!==null`)
  await input('[data-wm-goal-input]', '2000')
  await button('保存目标')
  await waitFor(`document.querySelector('[data-wm-stats-today]').textContent.includes('2000字')`)
  console.log('PASS UI 码字统计：今日净增上状态条，日更目标可设并回显')
  // 目标流程把右栏切到了「检查」；切回伙伴页，保住后续能力条/专注断言的前置状态
  await button('写作伙伴')
  await waitFor(`document.querySelector('[data-wm-capability="blocked"]')!==null`)
  await button('另存为新版')
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
  // 保存失败必须常驻可见并给出路：状态条不再是含糊的「未保存」，失败行带着重试与另存
  await waitFor(`document.querySelector('[data-wm-doc-alert]')?.textContent.includes('别处修改')`)
  assert.equal(await evaluate(`document.querySelector('[data-wm-save-label]').textContent`), '保存失败')
  assert.equal(await evaluate(`document.querySelector('[data-wm-save-dot]').getAttribute('data-wm-save-dot')`), 'error')
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-wm-doc-alert] button')).some(e=>e.textContent==='重试保存')`), '失败行缺「重试保存」')
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.dshWmBar button')).some(e=>e.textContent==='重试保存')`), '顶栏保存键应转为「重试保存」')
  await button('重试保存')
  await sleep(400)
  assert.equal(fs.readFileSync(a, 'utf8'), '外部稿不可覆盖', '重试不得覆盖外部稿')
  assert.equal(await evaluate(`document.querySelector('.dshWmEditor').value`), '发生冲突的编辑器稿', '重试失败仍要留着作者的字')
  assert.equal(await evaluate(`document.querySelector('[data-wm-save-label]').textContent`), '保存失败')
  await button('另存为新版')
  await waitFor(`document.querySelector('.dshWmDocName')?.textContent.includes('v2')`)
  assert.equal(fs.readFileSync(path.join(project, 'draft/novel/第1章-v2.md'), 'utf8'), '发生冲突的编辑器稿')
  console.log('PASS UI 冲突提示、保全外部稿、另存恢复')
  // 专注模式把右栏整体收起（顶栏已无库/AI 开关，收展全走边缘 rail；专注中 rail 也隐藏），
  // 退出专注就再点一次「专注」，右栏与伙伴面板必须原样回来
  await button('专注')
  await waitFor(`document.body.getAttribute('data-writing-focus')==='1'`)
  await waitFor(`getComputedStyle(document.querySelector('.dshWmSide.is-ai')).display==='none'`)
  await button('专注')
  await waitFor(`document.body.getAttribute('data-writing-focus')===null`)
  await waitFor(`getComputedStyle(document.querySelector('.dshWmSide.is-ai')).display!=='none'`)
  await waitFor(`document.querySelector('[data-wm-capability="blocked"]')!==null`, '退出专注后伙伴面板应回来')
  console.log('PASS UI 专注收起右栏，再点「专注」退出并唤回')
  // 查找/替换：Ctrl+F 开栏、计数、替换、全部替换；Esc 只关栏、不退写作台
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true}))`)
  await waitFor(`document.querySelector('[data-wm-findbar]')!==null`)
  await input('[data-wm-find-input]', '编辑器')
  await waitFor(`document.querySelector('[data-wm-find-count]')?.textContent==='1/1'`)
  await input('[data-wm-find-replace]', '主编')
  await button('替换')
  assert.equal(await evaluate(`document.querySelector('.dshWmEditor').value`), '发生冲突的主编稿', '替换应改写稿面')
  await input('[data-wm-find-input]', '冲突')
  await waitFor(`document.querySelector('[data-wm-find-count]')?.textContent==='1/1'`)
  await input('[data-wm-find-replace]', '')
  await button('全部替换')
  assert.equal(await evaluate(`document.querySelector('.dshWmEditor').value`), '发生的主编稿', '全部替换应清掉所有匹配')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await waitFor(`document.querySelector('[data-wm-findbar]')===null`)
  assert.ok(await evaluate(`document.querySelector('.dshWmRoot')!==null`), 'Esc 关查找栏不得顺带退写作台')
  console.log('PASS UI 查找/替换：计数、替换、全部替换，Esc 先关栏')
  // 顶栏专注增强开关：海明威（禁退格）与打字机滚动，随 prefs 持久化
  await button('海明威')
  await button('打字机')
  await waitFor(`document.querySelector('[data-wm-hemingway]').className.includes('is-on') && document.querySelector('[data-wm-typewriter]').className.includes('is-on')`)
  const cfgNow = await evaluate(`(async()=>(await (await fetch('/api/writing-mode?route=config')).json()).prefs)()`)
  assert.equal(cfgNow.hemingway, true, '海明威开关应写进 prefs')
  assert.equal(cfgNow.typewriter, true, '打字机开关应写进 prefs')
  console.log('PASS UI 海明威/打字机开关持久化到 prefs')
  // 选区改稿 diff 回路：替换选区先出预览（原文 vs 建议稿），采纳才落稿（fixture 假 llm 输出确定）
  await input('.dshWmEditor', '挑选出来的句子要改稿')
  await evaluate(`(()=>{const ta=document.querySelector('.dshWmEditor');ta.focus();ta.setSelectionRange(5,7)})()`)
  await button('✦')
  await button('润色')
  // armed 后在输入框补提示词，Enter 运行；提示词要一路拼进 host 的 assist 指令
  await input('.dshWmChatInput', '语气再轻一点')
  await evaluate(`document.querySelector('.dshWmChatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await waitFor(`document.querySelector('.dshWmAiOut')?.textContent.includes('改写后的句子')`)
  assert.ok(lastPrompt.includes('语气再轻一点'), '输入框里的补充要求应拼进 assist 指令：' + lastPrompt.slice(0, 120))
  await waitFor(`!document.querySelector('[data-wm-tool-armed]')`)
  assert.equal(await evaluate(`document.querySelector('.dshWmChatInput').value`), '', '运行后输入框应清空')
  await button('替换选区')
  await waitFor(`document.querySelector('[data-wm-rewrite]')!==null`)
  assert.match(await evaluate(`document.querySelector('[data-wm-rewrite]').textContent`), /改稿预览 · 润色/, '预览头应带动作名')
  assert.match(await evaluate(`document.querySelector('[data-wm-rewrite]').textContent`), /\+ 改写后的句子/, '预览应有建议稿行')
  assert.equal(await evaluate(`document.querySelector('.dshWmEditor').value`), '挑选出来的句子要改稿', '预览期间不得改稿')
  await button('采纳改稿')
  await waitFor(`document.querySelector('.dshWmEditor').value==='挑选出来的改写后的句子要改稿'`)
  assert.equal(await evaluate(`document.querySelector('[data-wm-rewrite]')`), null, '采纳后预览应收起')
  // 丢弃路径：再生成一次（这次不补提示词，arm 后直接 Enter），丢弃后稿面原样
  await evaluate(`(()=>{const ta=document.querySelector('.dshWmEditor');ta.focus();ta.setSelectionRange(0,2)})()`)
  await button('✦')
  await button('润色')
  await evaluate(`document.querySelector('.dshWmChatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await waitFor(`document.querySelector('.dshWmAiOut')?.textContent.includes('改写后的句子')`)
  await button('替换选区')
  await waitFor(`document.querySelector('[data-wm-rewrite]')!==null`)
  await button('丢弃')
  assert.equal(await evaluate(`document.querySelector('[data-wm-rewrite]')`), null, '丢弃后预览应收起')
  assert.equal(await evaluate(`document.querySelector('.dshWmEditor').value`), '挑选出来的改写后的句子要改稿', '丢弃不得改稿')
  console.log('PASS UI 选区改稿 diff 回路：预览、采纳、丢弃')
  // 大纲视图（第三态）：卡片网格，每章当前版一张卡（字数/检查角标/拖拽重排），点击卡名打开当前版
  await button('大纲')
  await waitFor(`document.querySelector('[data-wm-outline]')!==null`)
  await waitFor(`document.querySelector('[data-wm-cards]')!==null`)
  await waitFor(`document.querySelectorAll('[data-wm-outline-row]').length===2`)
  const outlineRows = await evaluate(`Array.from(document.querySelectorAll('[data-wm-outline-row]')).map(e=>e.getAttribute('data-wm-outline-row')).join('|')`)
  assert.ok(/第2章-v2\.md/.test(outlineRows), '卡片应是各系列当前版文件名', outlineRows)
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-wm-outline-gate]')).some(e=>e.textContent.includes('检查'))`), 'novel 章卡应有检查角标')
  await evaluate(`Array.from(document.querySelectorAll('[data-wm-outline-row]')).find(e=>e.getAttribute('data-wm-outline-row')==='第2章-v2.md').querySelector('.dshWmOutlineName').click()`)
  await waitFor(`document.querySelector('.dshWmEditor')?.value==='第二章原文'`)
  await button('作品导航')
  console.log('PASS UI 大纲视图：卡片网格、检查角标、点击打开')
  await sleep(250)
  fs.writeFileSync(path.join(temp, 'writing-ui.png'), (await win.webContents.capturePage()).toPNG())
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('WRITING_UI_OK', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
