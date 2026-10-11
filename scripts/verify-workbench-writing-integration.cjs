// P1 验收：写作模式接入工具台之后，两个 client 在**同一个页面**里的真实行为。
// 隔离、隐藏的 Electron 窗口；不连也不碰用户正在用的应用。
//
// 验的四条（对应 docs/plans/workbench-layer-v1.md §9）：
//   W1 入口唯一：装了工具台后，写作模式自己的侧栏入口让位，只剩一个工具台入口
//   W2 互斥：工具台切到写作 → 写作台出现；切到另一个模式 → 写作台退场（overlay 不卸载）
//   W3 关闭守卫：守卫拒绝时**不切换**，且工具台不自造提示文案
//   W5 降级：不加载工具台时，写作模式自己的入口照旧可用（官方壳路径）
//
// 说明：W3 用入口导出的 `__setCloseGuard` 装一个"拒绝"守卫来验**接线**
// （工具台 → canDeactivate → 守卫）；真实守卫（未保存内容 → editor.close）的语义由
// 写作模式自己的门禁（verify:writing-ui / native）覆盖，不在本探针重复。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wb-writing-'))
app.setPath('userData', path.join(temp, 'user-data'))
process.env.DSH_HOME = path.join(temp, 'home')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let win
let server
const errors = []

app.whenReady().then(async () => {
  // ── 夹具：一个库根 + 一部作品 + 一章 ──────────────────────────────────
  const root = path.join(temp, 'library')
  const project = path.join(root, '演示作品')
  fs.mkdirSync(path.join(project, 'draft/novel'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.md'), '作品名：接入验收')
  fs.writeFileSync(path.join(project, 'draft/novel/第1章-v1.md'), '第一章原文')

  const store = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/store.js')))
  const writingHost = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/index.js')))
  const workbenchHost = await import(pathToFileURL(path.join(repo, 'plugin/workbench/index.js')))
  store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: { ...store.DEFAULT_PREFS, autoSaveMs: 5000 } })

  let writingHandler = null
  let workbenchHandler = null
  const effect = (fn) => {
    fn()
    return () => {}
  }
  writingHost.apply({
    effect,
    webServer: { register: (route) => { writingHandler = route.handler; return () => {} } },
    llm: { stream: async function* () { yield { type: 'text-delta', index: 0, text: '' }; yield { type: 'finish', reason: { kind: 'stop' } } } },
  })
  workbenchHost.apply({ effect, webServer: { register: (route) => { workbenchHandler = route.handler; return () => {} } } })

  const modules = path.join(repo, 'node_modules')
  const page = () => `<!doctype html><meta charset="utf-8"><style>
    :root{--dsw-alias-bg-base:#12130f;--dsw-alias-bg-layer-1:#181a15;--dsw-alias-bg-layer-2:#1f211b;--dsw-alias-bg-layer-3:#22241d;--dsw-alias-label-primary:#eceae2;--dsw-alias-label-secondary:#b3b1a6;--dsw-alias-label-tertiary:#807e74;--dsw-alias-border-l1:rgba(236,234,226,.08);--dsw-alias-border-l2:rgba(236,234,226,.18);--dsw-alias-brand-primary:#8fb37a;--dsw-alias-state-error-primary:#c96a5a;--dsw-alias-interactive-bg-hover:rgba(236,234,226,.06)}
    body{margin:0;font:14px system-ui;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
    #footer{display:flex;gap:6px;padding:10px;width:260px}#overlay,#settings{padding:10px}
    [data-slot]{outline:1px dashed rgba(255,255,255,.12)}
  </style>
  <div id="footer"></div><div id="overlay"></div><div id="settings"></div>
  <script>
    process.env.NODE_ENV = 'production'; // 按生产构建跑：React 开发版才会有的告警不该混进 error 断言
    const React = require(${JSON.stringify(path.join(modules, 'react'))});
    const jsx = require(${JSON.stringify(path.join(modules, 'react/jsx-runtime'))});
    const ReactDOM = require(${JSON.stringify(path.join(modules, 'react-dom/client'))});
    const provided = {}; const pending = [];
    function flush() {
      for (const item of pending.slice()) {
        if (item.deps.every((d) => provided[d] !== undefined)) { pending.splice(pending.indexOf(item), 1); item.run(); }
      }
    }
    const hostOf = (name) => name === 'sidebar.footer.action' ? 'footer' : name === 'shell.overlay' ? 'overlay' : 'settings';
    const slots = {
      inject: (name, fn) => fn(),
      register: (opts, Component) => {
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
  <script src="/writing-client.js"></script>`

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/writing-mode')) {
      return void writingHandler(req, res).catch((err) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(err?.message || err) })) })
    }
    if (url.pathname.startsWith('/api/workbench')) {
      return void workbenchHandler(req, res).catch((err) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(err?.message || err) })) })
    }
    const file = url.pathname === '/writing-client.js'
      ? path.join(repo, 'plugin/writing-mode/client.js')
      : url.pathname === '/workbench-client.js'
        ? path.join(repo, 'plugin/workbench/client.js')
        : null
    if (file) {
      res.setHeader('content-type', 'application/javascript')
      res.end(fs.readFileSync(file))
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    // noworkbench=1：页面里**不**加载工具台 client，写作模式走降级路径（W5）
    const html = page().replace(
      '<script src="/workbench-client.js"></script>',
      url.searchParams.has('noworkbench') ? '' : '<script src="/workbench-client.js"></script>',
    )
    res.end(html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  win = new BrowserWindow({
    width: 1200,
    height: 820,
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
    throw new Error(`Timed out: ${label || code}\n${await evaluate('document.body.innerText')}\n${errors.join('\n')}`)
  }
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)

  // ── 主场景：工具台 + 写作模式 ────────────────────────────────────────
  await win.loadURL(base)
  await waitFor(`!!(window.__plugins['@dsh-local/workbench'] && window.__plugins['@dsh-local/writing-mode'])`, '两个 client 未加载')

  // W1：写作自己的入口让位，只剩工具台入口
  await waitFor(`document.querySelector('[data-entry="workbench"] [data-wb-entry]')!==null`, '工具台入口未出现')
  assert.equal(
    await count('[data-slot="sidebar.footer.action"][data-entry="writing-mode"] button'),
    0,
    'W1：装了工具台后写作模式自己的侧栏入口应让位',
  )
  assert.equal(await count('[data-wb-entry]'), 1, 'W1：应只有一个工具台入口')
  assert.equal(await count('[data-wb-switcher]'), 0, '未激活时不应有切换器')

  // W2：进写作 → 写作台出现；再切到另一个模式 → 写作台退场
  await click('[data-wb-entry]')
  await waitFor(`document.documentElement.getAttribute('data-writing-mode')==='on'`, 'W2：进写作后应进入写作台')
  assert.equal(await count('.dshWmRoot'), 1, 'W2：写作台 overlay 应在场')
  await evaluate(`(() => { window.__plugins['@dsh-local/workbench'].__workbenchRegistry().registerMode({ id:'demo', label:'演示模式', order:30 }); return 0 })()`)
  await waitFor(`document.querySelector('[data-wb-entry]').getAttribute('data-wb-count')==='2'`, '第二个模式未注册进入口')
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, 'W2：多模式时应弹切换器')
  await click('[data-wb-mode="demo"]')
  await waitFor(`window.__plugins['@dsh-local/workbench'].__workbenchRegistry().getActive()==='demo'`, 'W2：应切到演示模式')
  await waitFor(`document.documentElement.getAttribute('data-writing-mode')===null`, 'W2：切走后写作台应退场')
  assert.equal(await count('.dshWmRoot'), 0, 'W2：退场后不应渲染写作台')

  // W3：守卫拒绝 → 不切换，且工具台不自造提示
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, 'W3：应能再次打开切换器')
  await click('[data-wb-mode="writing"]')
  await waitFor(`window.__plugins['@dsh-local/workbench'].__workbenchRegistry().getActive()==='writing'`, 'W3：应切回写作')
  await evaluate(`(() => { window.__plugins['@dsh-local/writing-mode'].__setCloseGuard(async () => false); return 0 })()`)
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, 'W3：应打开切换器')
  await click('[data-wb-mode="demo"]')
  await sleep(400)
  assert.equal(await evaluate(`window.__plugins['@dsh-local/workbench'].__workbenchRegistry().getActive()`), 'writing', 'W3：守卫拒绝时不得切换')
  assert.equal(await count('.dshWmRoot'), 1, 'W3：被拒后写作台仍在场')
  const switcherText = await evaluate(`(document.querySelector('[data-wb-switcher]')||{}).textContent||''`)
  assert.equal(/失败|出错|错误/.test(switcherText), false, `W3：工具台不得自造失败文案：${switcherText}`)
  await evaluate(`(() => { window.__plugins['@dsh-local/writing-mode'].__setCloseGuard(null); return 0 })()`)
  await evaluate(`document.querySelector('[data-wb-close]').click()`)
  await sleep(200)

  assert.equal(errors.length, 0, `主场景控制台不应有 error：${errors.join(' | ')}`)

  // ── 降级场景：不加载工具台 ───────────────────────────────────────────
  // 先清掉主场景写下的 localStorage 开关（同 origin 会带过去），否则降级页一进来就是"已在写作台"。
  await evaluate(`localStorage.removeItem('dsh-writing-mode-active')`)
  await win.loadURL(`${base}/?noworkbench=1`)
  await waitFor(`!!window.__plugins['@dsh-local/writing-mode']`, '降级页写作 client 未加载')
  assert.equal(await evaluate(`!!window.__plugins['@dsh-local/workbench']`), false, 'W5：降级页不应加载工具台')
  await waitFor(`document.querySelector('[data-slot="sidebar.footer.action"][data-entry="writing-mode"] button')!==null`, 'W5：写作模式自己的入口应照旧出现')
  await click('[data-slot="sidebar.footer.action"][data-entry="writing-mode"] button')
  await waitFor(`document.documentElement.getAttribute('data-writing-mode')==='on'`, 'W5：自己的入口应能进写作台')
  assert.equal(await count('.dshWmRoot'), 1, 'W5：降级路径下写作台应正常渲染')
  assert.equal(errors.length, 0, `降级场景控制台不应有 error：${errors.join(' | ')}`)

  console.log('WORKBENCH_WRITING_OK W1/W2/W3/W5 通过（入口唯一 / 互斥 / 守卫拒绝 / 降级）')
  await new Promise((resolve) => server.close(resolve))
  app.exit(0)
}).catch(async (err) => {
  console.error('WORKBENCH_WRITING_FAIL', err?.stack || err)
  try {
    if (server) await new Promise((resolve) => server.close(resolve))
  } catch {}
  app.exit(1)
})
