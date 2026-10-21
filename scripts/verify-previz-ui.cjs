// previz 客户端真实渲染验收：隔离、隐藏的 Electron 窗口 + 假内核页。
// 验两件事：① 没工作台时独立入口/overlay 可用；② 工作台出现后让出入口并注册完整模式描述。
const { app, BrowserWindow, screen } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-previz-ui-'))
app.setPath('userData', path.join(temp, 'user-data'))
process.env.DSH_HOME = path.join(temp, 'home')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let win
let server
const errors = []

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')

function closeServer(srv) {
  if (!srv) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500)
    srv.close(() => {
      clearTimeout(timer)
      resolve()
    })
    try {
      srv.closeAllConnections?.()
      srv.closeIdleConnections?.()
    } catch {}
  })
}

app.whenReady().then(async () => {
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root{--dsw-alias-bg-base:#12130f;--dsw-alias-bg-layer-1:#181a15;--dsw-alias-bg-layer-2:#1f211b;--dsw-alias-label-primary:#eceae2;--dsw-alias-label-secondary:#b3b1a6;--dsw-alias-label-tertiary:#807e74;--dsw-alias-border-l1:rgba(236,234,226,.08);--dsw-alias-border-l2:rgba(236,234,226,.18);--dsw-alias-brand-primary:#8fb37a;--dsw-alias-interactive-bg-hover:rgba(236,234,226,.06)}
    body{margin:0;font:14px system-ui;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
    #entry{padding:10px;width:240px}#overlay{padding:0}
  </style>
  <div id="entry"></div><div id="overlay"></div>
  <script>
    const React = require(${JSON.stringify(path.join(repo, 'node_modules/react'))});
    const ReactDOM = require(${JSON.stringify(path.join(repo, 'node_modules/react-dom/client'))});
    window.React = React;
    const state = {
      ok: true,
      runtime: { state: 'ready', detail: 'Blender 5.2 · ffmpeg 8.1', version: '5.2.0' },
      project: { id: 'boutique', title: '小店' },
      out: 'C:/temp/dsh-previz-runs/boutique',
      job: { id: 'job-ui', state: 'running', progress: 0.42, logTail: ['[previz] render S03-01'] },
      artifacts: [
        { mode: 'previz', kind: 'image', id: 'plan.png', path: 'plan.png', title: '俯视平面图', at: '2026-10-21T00:00:00.000Z' },
        { mode: 'previz', kind: 'image', id: 'contact_sheet.png', path: 'contact_sheet.png', title: '3×3 接触表', at: '2026-10-21T00:00:00.000Z' }
      ]
    };
    window.__fetchCalls = [];
    window.fetch = async (url) => { window.__fetchCalls.push(String(url)); return { ok: true, json: async () => state } };
    const mounted = {};
    const slots = {
      inject: (name, fn) => fn(),
      register: (opts, Component) => {
        const host = document.getElementById(opts.name === 'sidebar.footer.action' ? 'entry' : 'overlay');
        const el = document.createElement('div');
        el.setAttribute('data-slot', opts.name);
        host.appendChild(el);
        ReactDOM.createRoot(el).render(React.createElement(Component));
        return () => el.remove();
      },
    };
    const provided = {};
    const pending = [];
    function flush() {
      for (const item of pending.slice()) {
        if (item.deps.every((d) => provided[d] !== undefined)) {
          pending.splice(pending.indexOf(item), 1);
          item.run();
        }
      }
    }
    const ctx = {
      effect: (fn) => { fn(); return () => {} },
      reflect: { provide: (name, value) => { provided[name] = value; flush(); return () => {} } },
      inject: (deps, cb) => {
        const run = () => { cb({ workbench: provided.workbench }) };
        if (deps.every((d) => provided[d] !== undefined)) run();
        else pending.push({ deps, run });
        return () => {};
      },
      slots,
    };
    window.__ctx = ctx;
    window.__provideWorkbench = (wb) => { provided.workbench = wb; flush() };
    window.__ModuleLoader__ = { load: ({ id, factory }) => { window.__plugins = window.__plugins || {}; window.__plugins[id] = factory((name) => name === 'react' ? React : require(name)) } };
  </script>
  <script src="/previz-client.js"></script>
  <script>
    // 触发 entry 的注册（真实内核里由 ModuleLoader 调用 apply）
    const mod = window.__plugins && window.__plugins['@dsh-local/previz'];
    if (!mod || typeof mod.apply !== 'function') { console.error('PREVIZ_CLIENT_NOT_LOADED'); }
    else { mod.apply(window.__ctx); }
  </script>`

  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/previz-client.js') {
      res.statusCode = 200
      res.setHeader('content-type', 'text/javascript; charset=utf-8')
      fs.createReadStream(path.join(repo, 'plugin/previz/client.js')).pipe(res)
      return
    }
    if (url.pathname === '/api/previz' && url.searchParams.get('route') === 'artifact') {
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.end(PNG)
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(html)
  })
  async function listenHigh() {
    for (let p = 47820; p < 47920; p++) {
      const ok = await new Promise((resolve) => {
        const onError = () => {
          server.removeListener('listening', onOk)
          resolve(false)
        }
        const onOk = () => {
          server.removeListener('error', onError)
          resolve(true)
        }
        server.once('error', onError)
        server.once('listening', onOk)
        server.listen(p, '127.0.0.1')
      })
      if (ok) return p
    }
    throw new Error('no free high port in 47820-47919')
  }
  const port = await listenHigh()
  const base = `http://127.0.0.1:${port}`

  win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    ...(() => {
      const all = screen.getAllDisplays()
      const d = all.length > 1 ? all[1] : all[0]
      return d ? { x: d.workArea.x + 20, y: d.workArea.y + 20 } : {}
    })(),
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (event, level, message) => {
    const d = event.message ? event : typeof level === 'object' ? level : { level, message }
    const text = String(d.message || '')
    if ((d.level === 'error' || d.level === 3) && !text.includes('Each child in a list should have a unique "key" prop')) {
      errors.push(text)
      console.log('RENDER ERROR', text)
    }
  })
  const evaluate = (code) => win.webContents.executeJavaScript(code, true)
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})||{}).textContent||''`)
  const click = (selector) => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('missing ${selector}'); el.click(); return 0 })()`)
  async function waitFor(code, label) {
    const until = Date.now() + 10000
    while (Date.now() < until) {
      if (await evaluate(code)) return
      await sleep(60)
    }
    throw new Error(`Timed out: ${label || code}`)
  }

  try {
    await win.loadURL(base)
    await waitFor(`document.querySelector('[data-previz-entry]')!==null`, '独立入口应出现')
    await click('[data-previz-entry]')
    await waitFor(`document.querySelector('[data-previz-overlay]')!==null`, '点入口应开 overlay')
    await waitFor(`document.querySelector('[data-previz-panel]')!==null`, 'overlay 里应有面板')
    await waitFor(`document.body.textContent.includes('Blender 就绪')`, '应显示后端就绪')
    await waitFor(`document.body.textContent.includes('渲染中 42%')`, '应显示任务进度')
    assert.equal(await count('[data-previz-panel] img'), 1, '默认应预览平面图')
    assert.ok((await text('[data-previz-panel]')).includes('最近产物'), '应有产物列表')

    // 工作台出现：让出入口、注册完整模式描述；点「进入」时模式自己要有全屏 overlay
    await evaluate(`(() => {
      window.__wbState = { active: null, subs: new Set() };
      window.__provideWorkbench({
        registerMode: (d) => { window.__previzDesc = d; return () => {} },
        getActive: () => window.__wbState.active,
        subscribe: (fn) => { window.__wbState.subs.add(fn); return () => window.__wbState.subs.delete(fn) },
        setActive: async (id) => { window.__wbState.active = id; for (const fn of window.__wbState.subs) fn(); return { ok: true } },
      });
      window.__wbSetActive = async (id) => { window.__wbState.active = id; for (const fn of window.__wbState.subs) fn(); return { ok: true } };
      return 0
    })()`)
    await waitFor(`!!window.__previzDesc`, '工作台出现后应注册模式')
    const info = await evaluate(`JSON.stringify({
      id: window.__previzDesc.id,
      order: window.__previzDesc.order,
      runtime: typeof window.__previzDesc.runtime.probe,
      start: typeof window.__previzDesc.runtime.start,
      jobs: typeof window.__previzDesc.jobs.list,
      cancel: typeof window.__previzDesc.jobs.cancel,
      artifacts: typeof window.__previzDesc.artifacts.list,
      splice: !!window.__previzDesc.splice.view,
      tile: !!window.__previzDesc.tile.view
    })`)
    assert.deepEqual(JSON.parse(info), {
      id: 'previz', order: 40, runtime: 'function', start: 'function', jobs: 'function', cancel: 'function', artifacts: 'function', splice: true, tile: true,
    })
    await waitFor(`document.querySelector('[data-previz-entry]')===null`, '工作台在场时应让出独立入口')
    await waitFor(`document.querySelector('[data-previz-overlay]')===null`, '工作台在场但未进入时应隐藏独立 overlay')

    await evaluate(`window.__wbSetActive('previz')`)
    await waitFor(`document.querySelector('[data-previz-overlay]')!==null`, '工作台进入 previz 时应渲染全屏 overlay')
    await waitFor(`document.body.textContent.includes('退出预演')`, 'overlay 应提供退出工作台模式的路径')
    await click('[data-previz-overlay] button')
    await waitFor(`document.querySelector('[data-previz-overlay]')===null`, '退出后 overlay 应消失')
    assert.equal(await evaluate(`window.__wbState.active`), null, '退出应把工作台 active 清空')

    assert.equal(errors.length, 0, `控制台不应有 error：${errors.join(' | ')}`)
    console.log('PREVIZ_UI_OK 独立入口 / overlay / 状态 / 进度 / 产物预览 / 工作台注册与让位')
    await closeServer(server)
    app.exit(0)
  } catch (err) {
    console.error('PREVIZ_UI_FAIL', err?.stack || err)
    try {
      await closeServer(server)
    } catch {}
    app.exit(1)
  }
}).catch(async (err) => {
  console.error('PREVIZ_UI_FAIL', err?.stack || err)
  try {
    await closeServer(server)
  } catch {}
  app.exit(1)
})
