// Isolated, hidden Electron renderer. Never connects to or closes a user app.
// 作品档案（只读投影）UI 端到端：项目行「档案」入口 → 设定/进度/时间与伏笔/资料四区 →
// 已确认设定成卡、候选不入卡 → 资料展开渲染 markdown → 点章节跳回编辑器 → 单区读失败自己说话。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-archive-'))
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
  fs.mkdirSync(path.join(project, 'outline'), { recursive: true })
  fs.mkdirSync(path.join(project, 'state'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.md'), '作品名：隔离测试\n\n一句话前提：雾港的夜航禁令下，一封信决定所有人的去向。')
  fs.writeFileSync(path.join(project, 'draft/novel/第1章-v1.md'), '第一章旧稿')
  fs.writeFileSync(path.join(project, 'draft/novel/第1章-v2.md'), '第一章新稿，雾从海面压过来。')
  fs.writeFileSync(path.join(project, 'draft/novel/第2章-v1.md'), '第二章正文')
  fs.writeFileSync(path.join(project, 'bible/characters.md'), '# 人物\n\n**林晚**：送信人，细节见 [[world.md]]。\n\n<script>window.__pwned=1</script>\n<img src=x onerror="window.__pwned=2">\n\n| 人物 | 立场 |\n| --- | --- |\n| 关渡 | 拦信 |\n')
  fs.writeFileSync(path.join(project, 'bible/world.md'), '# 世界设定\n\n手写世界设定，不该被档案改写。\n\n## 港口与禁令\n\n雾季入夜封港。\n\n## 势力\n\n港务所自行执法。\n')
  fs.writeFileSync(path.join(project, 'bible/timeline.md'), '# 时间线\n\n- 雾季第一夜：禁令生效\n- 第二夜：信被拆开')
  fs.writeFileSync(path.join(project, 'outline/foreshadow.md'), '# 伏笔\n\n- 铜钥匙：未回收\n- 电报局：未回收\n- 旧照片：已兑现')
  const store = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/store.js')))
  const host = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/index.js')))
  store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: { ...store.DEFAULT_PREFS, autoSaveMs: 5000, dailyGoal: 500 } })
  // 设定种子走**真实协议**（lib/project-memory 的 candidate → confirm），不造假数据结构：
  // 一条已确认世界观设定（带边界/说明/出处）、一条候选（不该入卡）、一条普通已确认备忘。
  const pm = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/project-memory.js')))
  const setting = {
    type: 'world',
    title: '夜行禁令',
    conclusion: '雾季入夜后港口停止民船出航。',
    explanation: '能见度差，民船没有强制导航设备；这条禁令是港务所自行执行的，不是府衙律条。',
    boundaries: '救援船获得许可后可以出航。',
    tags: ['港口', '雾季'],
    sources: [{ sessionId: 's1', messageId: 'm1', role: 'author', excerpt: '我们让禁令只在雾季生效', snapshotHash: 'h1' }],
  }
  const first = pm.readMemory(project)
  const saved = pm.applyMemoryOp(project, {
    op: 'save-setting-candidate', baseRevision: first.memory.revision, baseEtag: first.etag,
    item: { setting }, operationId: 'arc-candidate', clientSchemaVersion: 2,
  })
  const candidateId = saved.memory.items.find((it) => it.setting?.title === '夜行禁令').id
  pm.applyMemoryOp(project, {
    op: 'confirm-setting', baseRevision: saved.memory.revision, baseEtag: saved.etag,
    id: candidateId, item: { setting }, operationId: 'arc-confirm', clientSchemaVersion: 2,
  })
  const afterConfirm = pm.readMemory(project)
  pm.applyMemoryOp(project, {
    op: 'save-setting-candidate', baseRevision: afterConfirm.memory.revision, baseEtag: afterConfirm.etag,
    item: { setting: { ...setting, title: '铜钥匙', conclusion: '钥匙能开旧电报室。', boundaries: '', sources: [] } },
    operationId: 'arc-candidate-2', clientSchemaVersion: 2,
  })
  const afterSecond = pm.readMemory(project)
  pm.applyMemoryOp(project, {
    op: 'add', baseRevision: afterSecond.memory.revision, baseEtag: afterSecond.etag,
    item: { kind: 'preference', text: '叙述始终贴着林晚的所见。', status: 'confirmed' },
    operationId: 'arc-preference', clientSchemaVersion: 2,
  })
  const memoryFile = path.join(project, 'state', 'writing-memory.json')
  const memoryGood = fs.readFileSync(memoryFile)

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
  const input = (selector, text) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  const clickByAttr = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`)

  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  // 8 篇可列文稿：project + bible 三篇 + outline/foreshadow + draft 三篇（state 下的 json 不进文档库）
  await waitFor(`document.querySelectorAll('.dshWmItem').length===8`)

  // 1) 入口与四区
  await button('档案')
  await waitFor(`!!document.querySelector('.dshWmWiki')`)
  await waitFor(`Array.from(document.querySelectorAll('[data-wm-wiki-section]')).map(e=>e.getAttribute('data-wm-wiki-section')).join('|')==='设定|进度|时间与伏笔|资料'`)
  assert.equal(await evaluate(`document.querySelector('.dshWmWikiTitle').textContent`), '演示项目')
  console.log('PASS 档案入口与四区齐备（设定/进度/时间与伏笔/资料）')
  /** 隐藏窗口不会主动重绘：先 invalidate，否则 capturePage 拿到的可能是旧帧。 */
  async function shoot(name) {
    win.webContents.invalidate()
    await sleep(180)
    fs.writeFileSync(path.join(temp, name), (await win.webContents.capturePage()).toPNG())
  }
  await shoot('writing-archive-open.png')

  // 2) 已确认设定成卡；候选不入卡、只计数；普通备忘另列
  await waitFor(`document.querySelectorAll('[data-wm-wiki-card-id]').length===1`)
  const cardText = await evaluate(`document.querySelector('[data-wm-wiki-card-id]').textContent`)
  assert.ok(cardText.includes('夜行禁令') && cardText.includes('雾季入夜后港口停止民船出航'), '卡上要有标题与结论')
  assert.ok(cardText.includes('救援船获得许可后可以出航'), '边界必须与结论同现，否则伙伴会当绝对规则用')
  // 折叠区的内容仍在 DOM 里，所以断言看结构不看 textContent：说明与出处必须待在 details 内
  assert.ok(await evaluate(`!!document.querySelector('[data-wm-wiki-card-id] details .dshWmWikiPlain')`), '说明段应在折叠区里，不挤占档案首屏')
  assert.equal(await evaluate(`document.querySelector('[data-wm-wiki-proposed]').getAttribute('data-wm-wiki-proposed')`), '1')
  assert.ok(!(await evaluate(`document.body.innerText`)).includes('钥匙能开旧电报室'), '候选设定的正文不得出现在档案里')
  assert.ok((await evaluate(`document.querySelector('[data-wm-wiki-plain]').textContent`)).includes('叙述始终贴着林晚'), '普通已确认备忘另列一区')
  await clickByAttr('[data-wm-wiki-card-id] .dshWmWikiMore summary')
  await waitFor(`document.querySelector('[data-wm-wiki-card-id]').textContent.includes('能见度差')`)
  assert.ok((await evaluate(`document.querySelector('[data-wm-wiki-card-id]').textContent`)).includes('我们让禁令只在雾季生效'), '出处摘录要能核对（档案不是无源之言）')
  console.log('PASS 设定卡：结论+边界同现、说明与出处折叠、候选不入卡')

  // 3) 进度：每章当前版一行 + 14 天柱 + 统计块
  await waitFor(`document.querySelectorAll('[data-wm-wiki-chapters] li').length===2`)
  const chapters = await evaluate(`Array.from(document.querySelectorAll('[data-wm-wiki-chapters] .dshWmWikiChapterName')).map(e=>e.textContent).join('|')`)
  assert.equal(chapters, '第1章|第2章', '同一章只列当前版（v1 不进档案）')
  assert.equal(await evaluate(`document.querySelectorAll('[data-wm-wiki-bars] .dshWmWikiDayBar').length`), 14)
  // 类名撞车会让顶栏标题被日柱样式压成竖排（本轮实测踩过）：标题必须横向铺开
  assert.ok(Number(await evaluate(`document.querySelector('.dshWmWikiTitle').getBoundingClientRect().width`)) > 60, '档案标题被压窄：CSS 类名冲突')
  assert.ok((await evaluate(`document.querySelector('[data-wm-wiki-stats]').textContent`)).includes('日目标 500'), '日更目标进档案')
  console.log('PASS 进度区：当前版章节、14 天柱、日目标')

  // 4) 时间与伏笔：ledger 口径
  await waitFor(`!!document.querySelector('[data-wm-wiki-ledger]')`)
  const ledgerText = await evaluate(`document.querySelector('[data-wm-wiki-ledger]').textContent`)
  assert.ok(ledgerText.includes('第二夜：信被拆开'), '时间线尾条进档案')
  assert.ok(ledgerText.includes('未回收伏笔 2'), '伏笔按「未回收」计数')
  console.log('PASS 时间与伏笔区')

  // 5) 资料：展开才读正文，markdown 渲染（表格/粗体），且原稿一字不动
  await waitFor(`!!document.querySelector('[data-wm-wiki-doc="bible/characters.md"]')`)
  await clickByAttr('[data-wm-wiki-doc="bible/characters.md"] .dshWmWikiDocToggle')
  await waitFor(`!!document.querySelector('[data-wm-wiki-doc="bible/characters.md"] .dshWmWikiDocBody')`)
  assert.ok(await evaluate(`!!document.querySelector('[data-wm-wiki-doc="bible/characters.md"] .dshWmWikiDocBody strong')`), '粗体渲染')
  assert.ok(await evaluate(`!!document.querySelector('[data-wm-wiki-doc="bible/characters.md"] .dshWmMarkdownTable table')`), '表格渲染')
  assert.equal(fs.readFileSync(path.join(project, 'bible/characters.md'), 'utf8').startsWith('# 人物'), true, '档案只读，资料原样')
  console.log('PASS 资料区：展开渲染 markdown，原稿不动')

  // 6) 跳回写作现场：点章节名 → 档案收、编辑器开该章
  await clickByAttr('[data-wm-wiki-chapters] li:first-child .dshWmWikiChapterName')
  await waitFor(`!document.querySelector('.dshWmWiki')`)
  await waitFor(`document.querySelector('.dshWmEditor')?.value.includes('雾从海面压过来')`)
  assert.equal(await evaluate(`!!document.querySelector('.dshWmRoot')`), true, '跳回后仍在写作台')
  console.log('PASS 从档案点章节跳回编辑器，档案层自动收起')

  // 7) Esc 只关档案，不退写作台
  await button('档案')
  await waitFor(`!!document.querySelector('.dshWmWiki')`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await waitFor(`!document.querySelector('.dshWmWiki')`)
  assert.equal(await evaluate(`!!document.querySelector('.dshWmRoot')`), true, 'Esc 关档案后写作台还在')
  console.log('PASS Esc 只关档案层，不退出写作台')

  // 8) 真实增量：改稿保存后，档案的「今天」跟着动（统计不是写死的）
  await input('.dshWmEditor', '第一章新稿，雾从海面压过来。灯塔的光扫过一次，又暗下去。')
  await button('保存')
  await waitFor(`document.querySelector('[data-wm-save-label]').textContent==='已保存'`)
  await button('档案')
  await waitFor(`!!document.querySelector('.dshWmWiki')`)
  // 读数据属性而非 textContent：卡片文案是「12 字 · 今天」，Number(全文) 是 NaN
  await waitFor(`Number(document.querySelector('[data-wm-wiki-today]')?.getAttribute('data-wm-wiki-today')||0)>0`)
  console.log('PASS 保存后档案今日字数随之更新')

  // 9) 单区读失败：只那一区说话并给重试，其余区照常
  fs.writeFileSync(memoryFile, '{ this is not json')
  await button('刷新')
  await waitFor(`!!document.querySelector('[data-wm-wiki-error]')`)
  const errText = await evaluate(`document.querySelector('[data-wm-wiki-error]').textContent`)
  assert.ok(/设定读不到/.test(errText), '失败区要说出自己是谁：' + errText)
  assert.ok(/重试/.test(errText), '失败区必须给重试入口')
  assert.equal(await evaluate(`document.querySelectorAll('[data-wm-wiki-chapters] li').length`), 2, '一区失败不拖累其余区')
  fs.writeFileSync(memoryFile, memoryGood)
  await clickByAttr('[data-wm-wiki-error] button')
  await waitFor(`document.querySelectorAll('[data-wm-wiki-card-id]').length===1`)
  console.log('PASS 设定区读失败：报原因 + 重试可恢复，其余区不受影响')

  await shoot('writing-archive.png')
  // 10) 导出 HTML：独占命名、内容口径与面板一致、原稿不动、.html 不混进文档库
  const itemsBefore = await evaluate(`document.querySelectorAll('.dshWmItem').length`)
  await button('导出 HTML')
  await waitFor(`!!document.querySelector('[data-wm-wiki-export]')`)
  const exported = await evaluate(`document.querySelector('[data-wm-wiki-export]').getAttribute('data-wm-wiki-export')`)
  assert.ok(exported.endsWith('演示项目-档案-v1.html'), '导出落在项目根并带 v1 编号：' + exported)
  const page = fs.readFileSync(exported, 'utf8')
  assert.ok(page.includes('夜行禁令') && page.includes('雾季入夜后港口停止民船出航'), '已确认设定进导出页')
  assert.ok(page.includes('救援船获得许可后可以出航'), '边界随结论一并导出')
  assert.ok(page.includes('我们让禁令只在雾季生效'), '出处摘录进导出页')
  // 候选不入档：断言它的**结论句**（'铜钥匙'三个字同时也是伏笔台账里的条目名，拿它断会假阳性）
  assert.ok(!page.includes('钥匙能开旧电报室'), '候选设定不得进导出页')
  assert.ok(page.includes('<th>人物</th>') && page.includes('<strong>林晚</strong>'), '资料按 Markdown 渲染')
  assert.ok(page.includes('&lt;script&gt;') && !/<script\s*>/i.test(page.replace(/<script><\/script>/g, '')), '稿件里的 script 只能以文字出现')
  assert.ok(!/<img\s/i.test(page), '稿件里的 img 标签不得成为真标签')
  assert.ok(page.includes('一句话前提：雾港的夜航禁令'), '作品概览的一句话进页头')
  assert.equal(await evaluate(`document.querySelectorAll('.dshWmItem').length`), itemsBefore, '导出的 .html 不进文档库')
  await button('导出 HTML')
  await waitFor(`(()=>{const e=document.querySelector('[data-wm-wiki-export]');return !!e && e.getAttribute('data-wm-wiki-export').endsWith('-v2.html')})()`)
  assert.equal(fs.readFileSync(exported, 'utf8'), page, '再导出不得覆盖上一份')
  console.log('PASS 导出 HTML：独占命名、候选不入、转义守住、原稿与文档库不动')

  // 11) wiki 多页站点：与导出同一份口径，但它是「一个站点」——禁脚本、不缓存、越界要拒，
  //     首页是入口（前提 + 导航 + 入口卡），内容断言落到各子页上
  //     （必须在切到 file:// 之前跑：那时相对 fetch 会打到 file:///api/…）
  // 库根下的散稿让 scanTree 把库根自己也列成一条"作品"（独立文稿）：它渲染不出档案，
  // 既不该凑成"两部作品"，也不该作为切换链接出现（曾指到进程 cwd 去）。
  fs.writeFileSync(path.join(root, '一张便签.md'), '随手记：雾港的方言里"禁令"叫"夜锁"。\n')
  const wiki = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)}));return {status:r.status,type:r.headers.get('content-type'),csp:r.headers.get('content-security-policy')||'',cache:r.headers.get('cache-control'),text:await r.text()}})()`)
  assert.equal(wiki.status, 200)
  assert.match(wiki.type, /text\/html/, 'wiki 应返回 HTML：' + wiki.type)
  assert.ok(wiki.csp.includes("script-src 'none'"), 'wiki 页必须禁脚本：' + wiki.csp)
  assert.equal(wiki.cache, 'no-store', '档案是此刻的投影，不许缓存')
  // 首页形态：导航 + 前提 + 入口卡；不再堆全部内容（章节正文/设定结论只在子页）
  assert.ok(wiki.text.includes('class="sitebar"'), '首页要有站点导航')
  assert.ok(wiki.text.includes('class="premise"'), '首页要有作品前提块（premiseOf 口径）')
  assert.ok(/&amp;page=settings/.test(wiki.text) && /&amp;page=docs/.test(wiki.text), '首页要有通往子页的导航链接')
  assert.ok(!wiki.text.includes('雾从海面压过来'), '首页不该堆章节正文')
  assert.ok(!wiki.text.includes('钥匙能开旧电报室'), '候选不入 wiki 站任何页')
  // 设定子页：已确认设定与边界同现
  const wikiSettings = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)})+'&page=settings');return await r.text()})()`)
  assert.ok(wikiSettings.includes('夜行禁令') && wikiSettings.includes('救援船获得许可后可以出航'), '设定页要有已确认设定与边界')
  assert.ok(!wikiSettings.includes('钥匙能开旧电报室'), '候选不入设定页')
  // 资料索引 → 篇目页 → 节页：「每个内容都有对应的页面」
  const wikiDocs = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)})+'&page=docs');return await r.text()})()`)
  const worldDoc = /data-rel="bible\/world\.md" href="\?route=wiki&amp;path=[^"]*?&amp;page=(doc-\d+)"/.exec(wikiDocs)
  assert.ok(worldDoc, '资料索引里要能找到 world.md 的篇目页：' + wikiDocs.slice(0, 300))
  const wikiDoc = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)})+'&page=${worldDoc[1]}');return await r.text()})()`)
  const worldSec = /data-section="\d+" href="\?route=wiki&amp;path=[^"]*?&amp;page=(doc-\d+-s\d+)"><h3>港口与禁令<\/h3>/.exec(wikiDoc)
  assert.ok(worldSec, 'world.md 应按小节拆出节卡（港口与禁令）：' + wikiDoc.slice(0, 400))
  const wikiSec = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)})+'&page=${worldSec[1]}');return await r.text()})()`)
  assert.ok(wikiSec.includes('雾季入夜封港'), '节页要有该节正文')
  assert.ok(!wikiSec.includes('港务所自行执法'), '节页只装自己这一节')
  // 章页：当前版正文 + 下一章链接；历史版不出现
  const wikiCh = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)})+'&page=ch-1');return await r.text()})()`)
  assert.ok(wikiCh.includes('雾从海面压过来'), '章页要有当前版正文')
  assert.ok(!wikiCh.includes('第一章旧稿'), '章页只放当前版')
  assert.ok(/&amp;page=ch-2/.test(wikiCh), '章页要有下一章链接')
  // 非法 page 回首页，且作者文字不成为标签
  const wikiBad = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)})+'&page='+encodeURIComponent('";<script>alert(1)</script>'));return await r.text()})()`)
  assert.ok(wikiBad.includes('class="sitebar"') && !wikiBad.includes('<script>alert'), '非法 page 回首页且文字不成为标签')
  assert.ok(!wikiBad.includes('undefined'), '回落页不该漏 undefined')
  const outside = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(temp)}));return {s:r.status,b:(await r.text()).slice(0,120)}})()`)
  assert.equal(outside.s, 400, '库外路径应被拒，实得 ' + outside.s)
  assert.match(outside.b, /path-outside-roots|no-project/, outside.b)
  assert.ok(!wiki.text.includes('class="switcher"'), '库根散稿不算第二部作品，只有一部时不该给切换器')
  console.log('PASS wiki 路由：多页站点（首页/设定/资料/篇目/节/章）+ CSP 禁脚本 + 不缓存 + 库外拒绝')

  // 11b) 作品切换器：文库里出现第二部作品后给下拉，提交能换到另一部的档案
  const second = path.join(root, '第二部')
  fs.mkdirSync(path.join(second, 'bible'), { recursive: true })
  fs.writeFileSync(path.join(second, 'project.md'), '# 第二部\n\n## 一句话故事\n\n另一部作品的开头。\n')
  const wiki2 = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(project)}));return await r.text()})()`)
  assert.ok(wiki2.includes('class="switcher"'), '两部作品时应给切换器')
  assert.ok(/<span class="is-current">演示项目/.test(wiki2), '当前这部不该是链接')
  assert.ok(/<a href="\?route=wiki&amp;path=[^"]*">第二部/.test(wiki2), '另一部应是同源相对链接：' + (/class="switcher"[\s\S]{0,320}/.exec(wiki2)?.[0] || ''))
  assert.ok(wiki2.includes('第二部'), '切换器里要列出另一部作品')
  assert.ok(!wiki2.includes('独立文稿'), '库根散稿不是作品，不该进切换器：' + (/class="switcher"[\s\S]{0,320}/.exec(wiki2)?.[0] || ''))
  const switched = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(second)}));return await r.text()})()`)
  assert.ok(switched.includes('另一部作品的开头'), '切过去应是另一部的前提')
  assert.ok(!switched.includes('夜行禁令'), '切过去不该还带着上一部的设定')
  // 切换器里不许有死链：每个链接的目标都必须真能渲染（库根这类"不是作品"的条目不该出现）
  // （站内翻页链接一律 class 在 href 前，这里 `<a href="?route=wiki` 只匹配切换条自己的链接；
  //   path 抓到 & 或引号为止，免得将来切换条带别的参数时把整串当路径）
  const links = [...wiki2.matchAll(/<a href="\?route=wiki&amp;path=([^&"]+)"/g)].map((m) => decodeURIComponent(m[1]))
  assert.ok(links.length >= 1, '应有至少一条切换链接')
  for (const target of links) {
    const status = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(target)}));return r.status})()`)
    assert.equal(status, 200, '切换链接指向了渲染不出来的地址：' + target)
  }
  const rootAsWiki = await evaluate(`(async()=>{const r=await fetch('/api/writing-mode?route=wiki&path='+encodeURIComponent(${JSON.stringify(root)}));return {s:r.status,b:(await r.text()).slice(0,80)}})()`)
  assert.equal(rootAsWiki.s, 400, '库根本身不是作品，不该渲染成档案')
  assert.match(rootAsWiki.b, /no-project/, rootAsWiki.b)
  console.log('PASS 作品切换器：出现第二部才给，切换后是另一部的档案，且没有死链')

  // 12) 导出页自包含：直接当文件打开就能看，且脚本不执行
  await win.loadURL(pathToFileURL(exported).href)
  await waitFor(`document.title.includes('演示项目')`)
  assert.equal(await evaluate(`window.__pwned===undefined`), true, '导出页不得执行稿件里的脚本')
  assert.ok((await evaluate(`document.body.innerText`)).includes('夜行禁令'), '导出页独立打开可读')
  // 页内导航真的能用：目录链接 → hash 变 → 目标滚进视口；稿件里的 [[名]] 也是可点跳转
  assert.ok((await evaluate(`document.body.innerHTML`)).includes('<a class="ref" href="#doc-'), '稿件里的 [[world.md]] 应解析成页内链接')
  const tocHref = await evaluate(`(document.querySelector('.toc a[href^="#doc-"]')||{getAttribute:()=>''}).getAttribute('href')`)
  assert.ok(/^#doc-\d+$/.test(tocHref), '目录里应有资料锚点：' + tocHref)
  await evaluate(`document.querySelector('.toc a[href="${tocHref}"]').click()`)
  await waitFor(`location.hash===${JSON.stringify(tocHref)}`)
  assert.ok(await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(tocHref)}).getBoundingClientRect();return r.top>-4&&r.top<innerHeight})()`), '点目录应滚到目标')
  // 篇内小目录：多标题的那篇给目录，点它应跳到该篇内的小节
  const docTocHref = await evaluate(`(document.querySelector('.docToc a[href^="#doc-"]')||{getAttribute:()=>''}).getAttribute('href')`)
  assert.ok(/^#doc-\d+-h-\d+$/.test(docTocHref), '多标题资料应有篇内小目录锚点：' + docTocHref)
  assert.equal(await evaluate(`document.querySelectorAll('.docToc').length`), 1, '只有一个标题的篇不该给小目录')
  await evaluate(`document.querySelector('.docToc a[href="${docTocHref}"]').click()`)
  await waitFor(`location.hash===${JSON.stringify(docTocHref)}`)
  assert.ok(await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(docTocHref)}).getBoundingClientRect();return r.top>-4&&r.top<innerHeight})()`), '点篇内小目录应滚到该小节')
  await shoot('archive-export.png')
  console.log('PASS 导出页自包含：单文件打开即渲染，脚本不执行')

  // 13) 当独立站点打开：导航可点、子页渲染、稿件脚本不执行
  const wikiBase = `http://127.0.0.1:${server.address().port}/api/writing-mode?route=wiki&path=${encodeURIComponent(project)}`
  await win.loadURL(wikiBase)
  await waitFor(`document.title.includes('演示项目')`)
  assert.equal(await evaluate(`window.__pwned===undefined`), true, 'wiki 页里稿件脚本不得执行')
  // 点导航进设定页（真点链接真导航，不只是 fetch 200）
  assert.ok(await evaluate(`!!document.querySelector('.sitebar a[href*="page=settings"]')`), '站点导航应有设定页入口')
  await evaluate(`document.querySelector('.sitebar a[href*="page=settings"]').click()`)
  await waitFor(`document.body.innerText.includes('夜行禁令') && location.search.includes('page=settings')`)
  // 资料索引 → 篇目页 → 节页（每个人物/小节一页）
  await evaluate(`document.querySelector('.sitebar a[href*="page=docs"]').click()`)
  await waitFor(`!!document.querySelector('[data-rel="bible/world.md"]')`)
  await evaluate(`document.querySelector('[data-rel="bible/world.md"]').click()`)
  await waitFor(`document.body.innerText.includes('港口与禁令') && location.search.includes('page=doc-')`)
  await evaluate(`Array.from(document.querySelectorAll('a.pgcard')).find(e=>e.textContent.includes('港口与禁令')).click()`)
  await waitFor(`document.body.innerText.includes('雾季入夜封港') && /page=doc-\\d+-s\\d+/.test(location.search)`)
  assert.ok(!(await evaluate(`document.body.innerText`)).includes('港务所自行执法'), '节页只装自己这一节')
  await shoot('archive-wiki-section.png')
  // 章页：与切换条同为 GET 链接，直接按页 id 打开也该能到
  await win.loadURL(wikiBase + '&page=ch-1')
  await waitFor(`document.body.innerText.includes('雾从海面压过来')`)
  assert.ok(await evaluate(`!!document.querySelector('.pager a[href*="page=ch-2"]')`), '章页应有下一章')
  // 切换条在**真页面**里点了要能换页（fetch 200 只证明服务端渲染得出，不证明浏览器会导航）
  await win.loadURL(wikiBase)
  await waitFor(`!!document.querySelector('.switcher a')`)
  assert.ok(await evaluate(`!!document.querySelector('.switcher .is-current')`), '当前这部应显示为不可点')
  await evaluate(`document.querySelector('.switcher a').click()`)
  await waitFor(`document.title.includes('第二部')`)
  const switchedBody = await evaluate(`document.body.innerText`)
  assert.ok(switchedBody.includes('另一部作品的开头'), '点切换条后页面应是另一部作品的档案')
  assert.ok(!switchedBody.includes('夜行禁令'), '换到另一部后不该还带着上一部的已确认设定')
  await shoot('archive-wiki-switched.png')
  console.log('PASS wiki 站真点导航：顶条换区 / 篇目 / 节页 / 章页 / 切换条全链可用')

  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('WRITING_ARCHIVE_UI_OK', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
