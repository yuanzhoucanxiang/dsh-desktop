// 工具台 P0 的真实渲染验收：隔离、隐藏的 Electron 窗口，不连也不碰用户正在用的应用。
//
// 做法（与 verify-writing-ui.cjs 同一套路）：本地 http 起一个"假内核宿主页"，
// 它提供 React / window.__ModuleLoader__ / 一个假的 slots 服务（把三个挂载点各渲染成一个 React 根），
// 然后加载**真实的** plugin/workbench/client.js，用导出的测试钩子驱动注册表。
//
// 验的是 P0 契约：没有模式就不留死按钮；注册后入口出现；点一下进模式；多模式时切换器列出全部；
// 关闭守卫拒绝时不切换、且工具台不自造提示；切换写进 host 状态文件；设置段如实显示。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')

const repo = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workbench-ui-'))
app.setPath('userData', path.join(temp, 'user-data'))
process.env.DSH_HOME = path.join(temp, 'home')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let win
let server
const errors = []

app.whenReady().then(async () => {
  const host = await import(pathToFileURL(path.join(repo, 'plugin/workbench/index.js')))
  let handler = null
  host.apply({
    effect: (fn) => {
      fn()
      return () => {}
    },
    webServer: {
      register: (route) => {
        handler = route.handler
        return () => {}
      },
    },
  })
  assert.equal(typeof handler, 'function', 'host 半应注册 /api/workbench')

  const modules = path.join(repo, 'node_modules')
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root{--dsw-alias-bg-base:#12130f;--dsw-alias-bg-layer-1:#181a15;--dsw-alias-bg-layer-2:#1f211b;--dsw-alias-label-primary:#eceae2;--dsw-alias-label-secondary:#b3b1a6;--dsw-alias-label-tertiary:#807e74;--dsw-alias-border-l1:rgba(236,234,226,.08);--dsw-alias-border-l2:rgba(236,234,226,.18);--dsw-alias-brand-primary:#8fb37a;--dsw-alias-state-error-primary:#c96a5a;--dsw-alias-interactive-bg-hover:rgba(236,234,226,.06)}
    body{margin:0;font:14px system-ui;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
    #footer{padding:12px;width:220px}#overlay,#settings{padding:12px}
  </style>
  <div id="footer">侧栏底部（假内核）</div><div id="settings"></div><div id="overlay"></div>
  <script>
    const React = require(${JSON.stringify(path.join(modules, 'react'))});
    const jsx = require(${JSON.stringify(path.join(modules, 'react/jsx-runtime'))});
    const ReactDOM = require(${JSON.stringify(path.join(modules, 'react-dom/client'))});
    const mounted = {};
    function mount(id, Component){
      const el = document.getElementById(id);
      const root = ReactDOM.createRoot(el);
      root.render(React.createElement(Component));
      mounted[id] = root;
    }
    const provided = {};
    const ctx = {
      effect: (fn) => { fn(); return () => {}; },
      reflect: { provide: (name, value) => { provided[name] = value; window.__wbService = provided; return () => { delete provided[name]; }; } },
      slots: {
        inject: (name, fn) => fn(),
        register: (opts, Component) => {
          if (opts.name === 'sidebar.footer.action') mount('footer', Component);
          else if (opts.name === 'shell.overlay') mount('overlay', Component);
          else if (opts.name === 'settings.section') mount('settings', Component);
          window.__wbSlots = (window.__wbSlots || []).concat([opts.name]);
          return () => {};
        },
      },
    };
    window.__ModuleLoader__ = { load(entry) {
      const plugin = entry.factory((spec) => spec === 'react' ? React : jsx);
      window.__wbPlugin = plugin;
      plugin.apply(ctx);
    }};
  </script>
  <script src="/client.js"></script>`

  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/workbench')) {
      return void handler(req, res).catch((err) => {
        res.statusCode = 500
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
      })
    }
    res.setHeader('content-type', req.url === '/client.js' ? 'application/javascript' : 'text/html; charset=utf-8')
    res.end(req.url === '/client.js' ? fs.readFileSync(path.join(repo, 'plugin/workbench/client.js')) : html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (event, level, message) => {
    const d = event.message ? event : typeof level === 'object' ? level : { level, message }
    if (d.level === 'error' || d.level === 3) {
      errors.push(d.message)
      console.log('RENDER ERROR', d.message)
    }
  })

  const evaluate = (code) => win.webContents.executeJavaScript(code, true)
  async function waitFor(code, label) {
    const until = Date.now() + 12000
    while (Date.now() < until) {
      if (await evaluate(code)) return
      await sleep(60)
    }
    throw new Error(`Timed out: ${label || code}\n${await evaluate('document.body.innerText')}\n${errors.join('\n')}`)
  }
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})||{}).textContent||null`)
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)

  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  await waitFor(`!!window.__wbPlugin && !!window.__wbPlugin.__workbenchRegistry()`, 'client 未加载')

  const slots = await evaluate('JSON.stringify(window.__wbSlots)')
  assert.equal(slots, JSON.stringify(['sidebar.footer.action', 'shell.overlay', 'settings.section']), '三个挂载点都要注册')
  assert.equal(await evaluate(`typeof (window.__wbService||{}).workbench`), 'object', '应把 workbench 服务 provide 出去')

  // ① 没有模式：入口不留死按钮
  assert.equal(await count('[data-wb-entry]'), 0, '没有模式时不应渲染入口按钮')
  assert.equal(await count('[data-wb-switcher]'), 0, '没有模式时不应有切换器')
  await waitFor(`document.querySelector('[data-wb-settings-none]')!==null`, '设置段应显示"没有模式"')
  const settingsText = await text('[data-wb-settings]')
  assert.ok(settingsText.includes('还没有') || settingsText.includes('没有模式'), `设置段应说明没有模式：${settingsText}`)

  // ② 注册一个模式（走真实服务，不碰内部实现）
  await evaluate(`(() => { window.__wbPlugin.__workbenchRegistry().registerMode({
    id:'demo', label:'演示模式', order:20,
    canDeactivate: () => window.__guardDemo !== false,
    onActivate: (e) => { window.__act = (window.__act||[]).concat([e.reason]) },
  }); return 0 })()`)
  await waitFor(`document.querySelector('[data-wb-entry]')!==null`, '注册后入口应出现')
  assert.equal(await evaluate(`document.querySelector('[data-wb-entry]').getAttribute('data-wb-count')`), '1')
  assert.equal((await text('[data-wb-entry]')).includes('工具台'), true)

  // ③ 单模式：点一下直接进模式（不进只有一个选项的列表）
  await click('[data-wb-entry]')
  await waitFor(`window.__wbPlugin.__workbenchRegistry().getActive()==='demo'`, '点入口应进入模式')
  assert.equal(await count('[data-wb-switcher]'), 0, '单模式直接进，不应弹切换器')
  assert.equal(await evaluate(`JSON.stringify(window.__act)`), JSON.stringify(['switch']))
  await waitFor(`document.querySelector('[data-wb-active-label]')!==null`, '入口应显示当前模式名')
  assert.equal(await text('[data-wb-active-label]'), '演示模式')

  // ④ 多模式：切换器列出全部，当前项有标记
  await evaluate(`(() => { window.__wbPlugin.__workbenchRegistry().registerMode({ id:'demo2', label:'第二个模式', order:30 }); return 0 })()`)
  await waitFor(`document.querySelector('[data-wb-entry]').getAttribute('data-wb-count')==='2'`, '入口计数应更新')
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, '多模式时点入口应弹切换器')
  assert.equal(await count('[data-wb-mode]'), 2, '切换器应列出两个模式')
  assert.equal(await count('[data-wb-mode-active="1"]'), 1, '任何时刻只有一个当前模式')
  assert.equal(await evaluate(`document.querySelector('[data-wb-mode-active="1"]').getAttribute('data-wb-mode')`), 'demo')

  // ⑤ 关闭守卫拒绝：不切换、不自造提示、切换器留在原地
  await evaluate('window.__guardDemo = false')
  await click('[data-wb-mode="demo2"]')
  await sleep(300)
  assert.equal(await evaluate(`window.__wbPlugin.__workbenchRegistry().getActive()`), 'demo', '守卫拒绝时不得切换')
  assert.equal(await count('[data-wb-switcher]'), 1, '守卫拒绝后切换器应留在原地（由模式自己说明原因）')
  const switcherText = await text('[data-wb-switcher]')
  assert.equal(/失败|出错|错误/.test(switcherText), false, `工具台不得自造失败文案：${switcherText}`)

  // ⑥ 放行后切换成功，且写进 host 状态文件
  await evaluate('window.__guardDemo = true')
  await click('[data-wb-mode="demo2"]')
  await waitFor(`window.__wbPlugin.__workbenchRegistry().getActive()==='demo2'`, '放行后应切换')
  assert.equal(await count('[data-wb-switcher]'), 0, '切换成功后切换器应关闭')
  await sleep(400) // 等 host 写盘
  const stateFile = path.join(process.env.DSH_HOME, 'workbench.json')
  assert.ok(fs.existsSync(stateFile), `host 应写下状态文件：${stateFile}`)
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  assert.equal(saved.activeModeId, 'demo2', '状态文件应记当前模式')
  assert.ok(saved.revision >= 1, 'revision 应递增')

  // ⑦ 退出到内核界面（守卫放行）
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-exit]')!==null`, '激活时切换器应有退出项')
  await click('[data-wb-exit]')
  await waitFor(`window.__wbPlugin.__workbenchRegistry().getActive()===null`, '退出应回到没有模式')
  await sleep(400)
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).activeModeId, null, '退出也应写回 host')

  // ⑧ 设置段反映注册结果
  await waitFor(`document.querySelectorAll('[data-wb-settings-mode]').length===2`, '设置段应列出两个模式')
  assert.ok((await text('[data-wb-settings]')).includes('工具台'))

  assert.equal(errors.length, 0, `控制台不应有 error：${errors.join(' | ')}`)
  console.log('WORKBENCH_UI_OK 8 组断言通过（入口/切换/守卫/host 状态/设置段）')
  await new Promise((resolve) => server.close(resolve))
  app.exit(0)
}).catch(async (err) => {
  console.error('WORKBENCH_UI_FAIL', err?.stack || err)
  try {
    if (server) await new Promise((resolve) => server.close(resolve))
  } catch {}
  app.exit(1)
})
