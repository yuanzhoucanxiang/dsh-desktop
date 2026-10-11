// P2 验收：GIR 生图模式接入工具台之后，三个 client 在**同一个页面**里的真实行为。
// 隔离、隐藏的 Electron 窗口；不连也不碰用户正在用的应用。
//
// 验的四条（对应 docs/plans/workbench-layer-v1.md §9）：
//   W1 入口唯一：装了工具台后，写作与 GIR 各自的侧栏入口都让位，只剩一个工具台入口
//   W2 互斥：切到 GIR → GIR 工作台在场且写作台退场；切回写作 → 反过来
//   W4' 状态：工具台记住当前模式（host 状态文件）
//   W5 降级：不加载工具台时，GIR 自己的入口照旧可用（官方壳路径）
//
// GIR 的 client.js 在**另一个仓库**（默认 E:\GIR\gir-dsh），可用 GIR_UI_CLIENT 覆盖；
// 找不到时本探针打印 SKIP 并以 0 退出（跨仓依赖不该让 dsh-desktop 的门禁红）。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

const repo = path.resolve(__dirname, '..')
const GIR_CLIENT = process.env.GIR_UI_CLIENT || path.join('E:', 'GIR', 'gir-dsh', 'dsh-plugins', 'gir-ui', 'client.js')
if (!fs.existsSync(GIR_CLIENT)) {
  console.log(`WORKBENCH_GIR_SKIP 找不到 GIR 插件客户端：${GIR_CLIENT}（用 GIR_UI_CLIENT 指定）`)
  process.exit(0)
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wb-gir-'))
app.setPath('userData', path.join(temp, 'user-data'))
process.env.DSH_HOME = path.join(temp, 'home')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let win
let server
const errors = []

app.whenReady().then(async () => {
  const store = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/store.js')))
  const writingHost = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/index.js')))
  const workbenchHost = await import(pathToFileURL(path.join(repo, 'plugin/workbench/index.js')))
  const girHost = await import(pathToFileURL(path.join(path.dirname(GIR_CLIENT), 'index.js')))

  const root = path.join(temp, 'library')
  fs.mkdirSync(path.join(root, '演示作品', 'draft/novel'), { recursive: true })
  fs.writeFileSync(path.join(root, '演示作品', 'project.md'), '作品名：P2 验收')
  // L1 交接要有一篇能打开的稿（写作侧「去生图」在开稿后才可用）
  fs.writeFileSync(path.join(root, '演示作品', 'draft/novel/第1章-v1.md'), '第一章原文')
  store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: { ...store.DEFAULT_PREFS, autoSaveMs: 5000 } })

  const handlers = { writing: null, workbench: null, gir: [] }
  const effect = (fn) => { fn(); return () => {} }
  writingHost.apply({
    effect,
    webServer: { register: (route) => { handlers.writing = route.handler; return () => {} } },
    llm: { stream: async function* () { yield { type: 'text-delta', index: 0, text: '' }; yield { type: 'finish', reason: { kind: 'stop' } } } },
  })
  workbenchHost.apply({ effect, webServer: { register: (route) => { handlers.workbench = route.handler; return () => {} } } })
  const fakeSettings = { register: () => ({ get: () => ({ apiBase: 'http://127.0.0.1:8787/api' }), update: async () => {} }) }
  girHost.apply({
    effect,
    webServer: { register: (route) => { handlers.gir.push(route); return () => {} } },
    settings: fakeSettings,
    // gir-ui host 用 c.inject(['settings'], …) 取设置服务（可选服务写法），假 ctx 也要给 inject。
    inject: (deps, cb) => { cb({ settings: fakeSettings }) },
  })

  const modules = path.join(repo, 'node_modules')
  const page = () => `<!doctype html><meta charset="utf-8"><style>
    :root{--dsw-alias-bg-base:#12130f;--dsw-alias-bg-layer-1:#181a15;--dsw-alias-bg-layer-2:#1f211b;--dsw-alias-label-primary:#eceae2;--dsw-alias-label-secondary:#b3b1a6;--dsw-alias-label-tertiary:#807e74;--dsw-alias-border-l1:rgba(236,234,226,.08);--dsw-alias-border-l2:rgba(236,234,226,.18);--dsw-alias-brand-primary:#8fb37a;--dsw-alias-state-error-primary:#c96a5a;--dsw-alias-interactive-bg-hover:rgba(236,234,226,.06)}
    body{margin:0;font:14px system-ui;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
    #footer{display:flex;gap:6px;padding:10px;width:300px}#overlay{padding:10px}
    [data-slot]{outline:1px dashed rgba(255,255,255,.12)}
  </style>
  <div id="footer"></div><div id="overlay"></div>
  <script>
    process.env.NODE_ENV = 'production';
    const React = require(${JSON.stringify(path.join(modules, 'react'))});
    const jsx = require(${JSON.stringify(path.join(modules, 'react/jsx-runtime'))});
    const ReactDOM = require(${JSON.stringify(path.join(modules, 'react-dom/client'))});
    const provided = {}; const pending = [];
    function flush() {
      for (const item of pending.slice()) {
        if (item.deps.every((d) => provided[d] !== undefined)) { pending.splice(pending.indexOf(item), 1); item.run(); }
      }
    }
    // 只真渲染"入口 + 帧级浮层"两类槽；tool.call.toolview / settings.section 只记录注册
    // （内核只在有对应工具调用/设置页时才渲染它们，harness 无 props 渲染会假崩）。
    const RENDER_SLOTS = ['sidebar.footer.action', 'shell.overlay'];
    const hostOf = (name) => name === 'sidebar.footer.action' ? 'footer' : 'overlay';
    const slots = {
      inject: (name, fn) => fn(),
      register: (opts, Component) => {
        window.__slots = (window.__slots || []).concat([{ slot: opts.name, id: opts.id || opts.key || '' }]);
        if (!RENDER_SLOTS.includes(opts.name)) return () => {};
        const box = document.createElement('div');
        box.setAttribute('data-slot', opts.name);
        box.setAttribute('data-entry', String(opts.id || opts.key || ''));
        document.getElementById(hostOf(opts.name)).appendChild(box);
        ReactDOM.createRoot(box).render(React.createElement(Component));
        return () => { box.remove(); };
      },
    };
    function makeCtx() {
      return {
        effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
        reflect: { provide: (name, value) => { provided[name] = value; flush(); return () => { delete provided[name]; }; } },
        inject: (deps, cb) => {
          const run = () => { const scope = {}; for (const d of deps) scope[d] = provided[d]; cb(scope); };
          if (deps.every((d) => provided[d] !== undefined)) run(); else pending.push({ deps, run });
          return () => {};
        },
        slots,
        sessions: null,
      };
    }
    window.__plugins = {};
    window.__ModuleLoader__ = { load(entry) {
      const plugin = entry.factory((spec) => spec === 'react' ? React : jsx);
      window.__plugins[entry.id] = plugin;
      plugin.apply(makeCtx());
    }};
  </script>
  <script src="/workbench-client.js"></script>
  <script src="/writing-client.js"></script>
  <script src="/gir-client.js"></script>`

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const json = (obj, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)) }
    if (url.pathname.startsWith('/api/writing-mode')) {
      return void handlers.writing(req, res).catch((err) => json({ ok: false, error: String(err?.message || err) }, 500))
    }
    if (url.pathname.startsWith('/api/workbench')) {
      return void handlers.workbench(req, res).catch((err) => json({ ok: false, error: String(err?.message || err) }, 500))
    }
    if (url.pathname === '/gir-ui/config') return json({ ok: true, apiBase: 'http://127.0.0.1:8787/api' })
    if (url.pathname === '/gir-ui/update/check') return json({ ok: true, mode: 'nogit', currentVersion: '0.38.0' })
    // 假 GIR 后端：够工作台把项目列表 → 详情 → 分步成像工作台渲染出来（L1 交接的落点在那里）。
    // 注意响应形状要真实：jget 只按 HTTP 状态判成败，非 2xx 会被插件当"服务未连接"。
    if (url.pathname.startsWith('/gir-api')) {
      const p = url.pathname.slice('/gir-api'.length)
      if (p === '/health') return json({ status: 'ok', service: 'gir-backend' })
      if (p === '/backends') return json([{ name: 'harness-stub', status: 'ok' }])
      if (p === '/projects') return json([{ id: 'p1', name: '演示项目' }])
      if (p === '/projects/p1') {
        return json({
          project: { id: 'p1', name: '演示项目', current_version_id: null, imaging_selections: {} },
          versions: [],
          tasks: [],
        })
      }
      if (p === '/projects/p1/layers') return json({})
      if (p === '/projects/p1/imaging/contract') return json({ steps: [] })
      if (p === '/canvas-presets') return json([])
      if (p === '/layer-deps') return json([])
      if (p === '/experiences') return json([])
      if (p === '/settings') return json({})
      if (p === '/workflow-templates') return json([])
      if (p === '/workflows/runninghub/config') return json({ modes: [] })
      return json({ ok: false, error: 'harness-no-endpoint', path: p }, 502)
    }
    const file = url.pathname === '/writing-client.js'
      ? path.join(repo, 'plugin/writing-mode/client.js')
      : url.pathname === '/workbench-client.js'
        ? path.join(repo, 'plugin/workbench/client.js')
        : url.pathname === '/gir-client.js' ? GIR_CLIENT : null
    if (file) {
      res.setHeader('content-type', 'application/javascript')
      res.end(fs.readFileSync(file))
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(page().replace('<script src="/workbench-client.js"></script>', url.searchParams.has('noworkbench') ? '' : '<script src="/workbench-client.js"></script>'))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (event, level, message) => {
    const d = event.message ? event : typeof level === 'object' ? level : { level, message }
    if (d.level === 'error' || d.level === 3) { errors.push(d.message); console.log('RENDER ERROR', d.message) }
  })
  const evaluate = (code) => win.webContents.executeJavaScript(code, true)
  async function waitFor(code, label) {
    const until = Date.now() + 15000
    while (Date.now() < until) {
      if (await evaluate(code)) return
      await sleep(70)
    }
    throw new Error(`Timed out: ${label || code}\n${await evaluate('document.body.innerText').catch(() => '')}\n${errors.join('\n')}`)
  }
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)

  await win.loadURL(base)
  await waitFor(`!!(window.__plugins['@dsh-local/workbench'] && window.__plugins['@dsh-local/writing-mode'] && window.__plugins['@gir/dsh-gir-ui'])`, '三个 client 未加载')

  // W1：三个模式各注册了自己的东西，但侧栏底部只有一个工具台入口
  await waitFor(`document.querySelector('[data-entry="workbench"] [data-wb-entry]')!==null`, '工具台入口未出现')
  assert.equal(await count('[data-wb-entry]'), 1, 'W1：应只有一个工具台入口')
  assert.equal(await count('[data-slot="sidebar.footer.action"] button'), 1, 'W1：侧栏底部只应有一个按钮')
  assert.equal(await count('[data-slot="sidebar.footer.action"][data-entry="writing-mode"] button'), 0, 'W1：写作自己的入口应让位')
  assert.equal(await count('[data-slot="sidebar.footer.action"][data-entry="gir-workbench"] button'), 0, 'W1：GIR 自己的入口应让位')
  assert.equal(await count('.gir-ol'), 0, 'W1：未激活时不应渲染 GIR 工作台')
  assert.equal(await count('.dshWmRoot'), 0, 'W1：未激活时不应渲染写作台')

  // W2：切到 GIR → GIR 在场、写作退场
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, 'W2：应打开切换器')
  assert.equal(await count('[data-wb-mode]'), 2, 'W2：切换器应列出两个模式（写作 / GIR）')
  await click('[data-wb-mode="gir"]')
  await waitFor(`window.__plugins['@dsh-local/workbench'].__workbenchRegistry().getActive()==='gir'`, 'W2：应切到 GIR')
  await waitFor(`document.querySelector('.gir-ol')!==null`, 'W2：GIR 工作台应在场')
  assert.equal(await count('.dshWmRoot'), 0, 'W2：切到 GIR 后写作台应退场')
  assert.equal(await evaluate(`document.documentElement.getAttribute('data-writing-mode')`), null, 'W2：写作模式的 body 标记应撤掉')

  // W2b：切回写作 → 反过来
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, 'W2b：应打开切换器')
  await click('[data-wb-mode="writing"]')
  await waitFor(`document.documentElement.getAttribute('data-writing-mode')==='on'`, 'W2b：应切回写作')
  await waitFor(`document.querySelector('.dshWmRoot')!==null`, 'W2b：写作台应在场')
  assert.equal(await count('.gir-ol'), 0, 'W2b：写作在场时 GIR 应退场')

  // 互斥不变量：任何时刻至多一个模式浮层在场
  const visible = await evaluate(`document.querySelectorAll('.dshWmRoot, .gir-ol').length`)
  assert.equal(visible, 1, '互斥：同时只应有一个模式浮层')

  // W4'：host 状态文件记的是当前模式
  await sleep(400)
  const stateFile = path.join(process.env.DSH_HOME, 'workbench.json')
  assert.ok(fs.existsSync(stateFile), 'host 应写下状态文件')
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).activeModeId, 'writing', 'W4：状态文件应记当前模式')

  // ── L1 端到端：写作点「去生图」→ 工具台 → GIR 真接收端 ─────────────────
  // 现在是写作在场：开一篇稿（空页 → 文库 → 第一篇），然后交接。
  await waitFor(`document.querySelector('[data-wm-empty]')!==null`, 'L1：写作台空页未出现')
  await evaluate(`Array.from(document.querySelectorAll('button')).find((b)=>b.textContent==='从库里打开').click()`)
  await waitFor(`document.body.getAttribute('data-writing-lib')==='1'`, 'L1：文库未展开')
  await waitFor(`document.querySelectorAll('.dshWmItem').length>0`, 'L1：文库未列出稿件')
  await evaluate(`Array.from(document.querySelectorAll('.dshWmItem')).find((e)=>String(e.title||'').endsWith('第1章-v1.md')).click()`)
  await waitFor(`document.querySelector('[data-wm-handoff="gir"]')?.disabled===false`, 'L1：交接按钮应在开稿后可用')
  // 按钮可用只代表 filePath 就位；正文可能还在加载——交接取的是正文/选区，必须等它到位。
  await waitFor(`Array.from(document.querySelectorAll('textarea')).some((t)=>String(t.value||'').includes('第一章原文'))`, 'L1：稿件正文未加载')
  await click('[data-wm-handoff="gir"]')
  await waitFor(`window.__plugins['@dsh-local/workbench'].__workbenchRegistry().getActive()==='gir'`, 'L1：交接应先切到 GIR')
  await waitFor(`document.querySelector('.gir-ol')!==null`, 'L1：GIR 工作台应打开')
  await waitFor(`document.querySelector('[data-gir-handoff]')!==null`, 'L1：GIR 应显示交接提示条')
  const sketchText = await evaluate(`(document.querySelector('textarea[aria-label="画面怎么安排"]')||{}).value||''`)
  assert.ok(sketchText.includes('第一章原文'), `L1：构图框应含交接过来的文字，实际 ${sketchText}`)
  const handoffBanner = await evaluate(`document.querySelector('[data-gir-handoff]').textContent`)
  assert.ok(handoffBanner.includes('写作模式'), `L1：提示条应说明来自写作模式，实际 ${handoffBanner}`)
  assert.ok(handoffBanner.includes('填入'), `L1：提示条应说明是填入还是追加，实际 ${handoffBanner}`)
  // GIR 的上下文上报（选中项目后）
  await sleep(600)
  const girCtx = JSON.parse(await evaluate(`JSON.stringify(window.__plugins['@gir/dsh-gir-ui'].__workbenchHandoff.context())`))
  assert.equal(girCtx && girCtx.kind, 'image', `L1：GIR 应上报上下文，实际 ${JSON.stringify(girCtx)}`)
  assert.equal(girCtx.title, '演示项目', `L1：GIR 上下文应是当前项目，实际 ${JSON.stringify(girCtx)}`)

  assert.equal(errors.length, 0, `主场景控制台不应有 error：${errors.join(' | ')}`)

  // W5：不加载工具台 → GIR 自己的入口照旧可用
  await evaluate(`localStorage.removeItem('dsh-writing-mode-active')`)
  await win.loadURL(`${base}/?noworkbench=1`)
  await waitFor(`!!(window.__plugins['@gir/dsh-gir-ui'] && window.__plugins['@dsh-local/writing-mode'])`, 'W5：降级页 client 未加载')
  assert.equal(await evaluate(`!!window.__plugins['@dsh-local/workbench']`), false, 'W5：降级页不应加载工具台')
  await waitFor(`document.querySelector('[data-slot="sidebar.footer.action"][data-entry="gir-workbench"] button')!==null`, 'W5：GIR 自己的入口应照旧出现')
  assert.equal(await count('[data-slot="sidebar.footer.action"] button'), 2, 'W5：降级时写作与 GIR 各有一个入口')
  await click('[data-slot="sidebar.footer.action"][data-entry="gir-workbench"] button')
  await waitFor(`document.querySelector('.gir-ol')!==null`, 'W5：GIR 自己的入口应能开工作台')
  assert.equal(errors.length, 0, `降级场景控制台不应有 error：${errors.join(' | ')}`)

  console.log('WORKBENCH_GIR_OK W1/W2/W4/W5 + L1 通过（入口唯一 / 双模式互斥 / 状态落盘 / 降级 / 写作→GIR 交接端到端）')
  await new Promise((resolve) => server.close(resolve))
  app.exit(0)
}).catch(async (err) => {
  console.error('WORKBENCH_GIR_FAIL', err?.stack || err)
  try {
    if (server) await new Promise((resolve) => server.close(resolve))
  } catch {}
  app.exit(1)
})
