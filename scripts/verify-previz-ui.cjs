// 2026-11-21：门禁崩溃不弹到作者屏幕上——Electron 默认会给主进程未捕获异常弹**系统模态框**。
// 必须在任何 require 之前注册：加载期崩溃（如模板重编译后相对路径找不到模块）也要兜住。
process.on('uncaughtException', (e) => { console.error('[gate] uncaught: ' + ((e && e.stack) || e)); process.exit(1) })
// previz 客户端真实渲染验收：隔离、隐藏的 Electron 窗口 + 假内核页。
// 验两件事：① 没工作台时独立入口/overlay 可用；② 工作台出现后让出入口并注册完整模式描述。
require(require('node:path').join(process.cwd(), 'scripts/lib/electron-gate.cjs')).assertElectronGate()
// ↑ 2026-11-21：不依赖模块位置——被当模板重编译时 __dirname 会指向使用者目录，相对 require 会落空。
//   所有门禁的 spawnSync 都以仓库根为 cwd（npm scripts 亦然），失败也会明确报找不到。
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
      projects: [
        { id: 'boutique', title: '小店', valid: true },
        { id: 'shop2', title: '第二家店', valid: true },
      ],
      out: 'C:/temp/dsh-previz-runs/boutique',
      job: { id: 'job-ui', state: 'running', progress: 0.42, logTail: ['[previz] render S03-01'] },
      artifacts: [
        { mode: 'previz', kind: 'image', id: 'plan.png', path: 'plan.png', title: '俯视平面图', at: '2026-10-21T00:00:00.000Z' },
        { mode: 'previz', kind: 'image', id: 'contact_sheet.png', path: 'contact_sheet.png', title: '3×3 接触表', at: '2026-10-21T00:00:00.000Z' }
      ]
    };
    window.__fetchCalls = [];
    window.__state = state;
    window.__fetch = async (url) => {
      window.__fetchCalls.push(String(url));
      const u = String(url);
      if (u.includes('route=project-create')) {
        state.projects = [...state.projects, { id: 'new-film', title: '新片', valid: true }];
        return { ok: true, json: async () => ({ ok: true, project: { id: 'new-film', title: '新片', valid: true }, projects: state.projects }) };
      }
      return { ok: true, json: async () => window.__state };
    };
    window.fetch = (url) => window.__fetch(url);
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
  async function waitFor(code, label, timeoutMs = 10000) {
    const until = Date.now() + timeoutMs
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
    await waitFor(`document.querySelector('[data-previz-panel] img')!==null`, '默认应预览平面图')
    assert.ok((await text('[data-previz-panel]')).includes('最近产物'), '应有产物列表')
    assert.equal(await evaluate(`document.querySelector('[data-previz-project]')?.value`), 'boutique', '项目下拉应显示当前项目')
    assert.equal(await count('[data-previz-project] option'), 2, '应有 2 个项目选项')
    assert.equal(await count('[data-previz-new-project]'), 1, '应有新建项目按钮')

    // 新建项目：点按钮 -> 内联表单（不用 window.prompt，Electron 里 prompt 不可用）
    // 换一个新对象，store 才会把它当变更通知给面板（同一引用改了字段不会触发）。
    await evaluate(`(() => {
      window.__state = { ...window.__state, job: { id: 'job-ui', state: 'done', progress: 1, logTail: [] } };
      return 0;
    })()`)
    await sleep(2800)
    await waitFor(`document.querySelector('[data-previz-new-project]') && !document.querySelector('[data-previz-new-project]').disabled`, '等任务结束后新建按钮可用', 8000)
    await click('[data-previz-new-project]')
    await waitFor(`document.querySelector('[data-previz-create-row]')!==null`, '点新建应出现内联表单')
    await evaluate(`(() => {
      const el = document.querySelector('[data-previz-new-id]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'new-film');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const t = document.querySelector('[data-previz-new-title]');
      setter.call(t, '新片');
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 0;
    })()`)
    await click('[data-previz-create-row] button')
    await waitFor(`window.__fetchCalls.some((u) => u.includes('route=project-create'))`, '应调用 project-create')
    await waitFor(`document.querySelector('[data-previz-create-row]')===null`, '创建成功后表单应收起')

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
