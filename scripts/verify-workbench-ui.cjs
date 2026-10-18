// 工具台 P0 的真实渲染验收：隔离、隐藏的 Electron 窗口，不连也不碰用户正在用的应用。
//
// 做法（与 verify-writing-ui.cjs 同一套路）：本地 http 起一个"假内核宿主页"，
// 它提供 React / window.__ModuleLoader__ / 一个假的 slots 服务（把三个挂载点各渲染成一个 React 根），
// 然后加载**真实的** plugin/workbench/client.js，用导出的测试钩子驱动注册表。
//
// 验的是 P0 契约：没有模式就不留死按钮；注册后入口出现；点一下进模式；多模式时切换器列出全部；
// 关闭守卫拒绝时不切换、且工具台不自造提示；切换写进 host 状态文件；设置段如实显示。
const { app, BrowserWindow, screen } = require('electron')
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

// 收尾**绝不能无限等**：`server.close()` 要等已有连接结束，而探针页与本地 http 之间的
// keep-alive 连接不会自己断——2026-10-12 实测 `verify:writing-quick` 链尾就是因为这个
// 打印完 OK 仍挂住 20 分钟（断言全过、退出码永远等不到）。先把连接全断开再 close，并套超时兜底。
function closeServer(srv) {
  if (!srv) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => resolve()
    const timer = setTimeout(finish, 1500)
    srv.close(() => {
      clearTimeout(timer)
      finish()
    })
    try {
      srv.closeAllConnections?.()
      srv.closeIdleConnections?.()
    } catch {}
  })
}

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
    window.React = React;
    const mounted = {};
    function mount(id, Component){
      // 同一槽位可能注册多个条目（如 shell.overlay 的切换器 + 辅助坞）：每个条目一个独立容器，
      // 否则第二次 createRoot 会报 "container has already been passed to createRoot"。
      const host = document.getElementById(id);
      const el = document.createElement('div');
      el.setAttribute('data-mount', id + ':' + (host.childElementCount));
      host.appendChild(el);
      const root = ReactDOM.createRoot(el);
      root.render(React.createElement(Component));
      mounted[id] = mounted[id] || [];
      mounted[id].push(root);
    }
    const provided = {};
    // 假的内核 sessions 服务（2026-10-12 补）。本探针以前**没有会话服务**、也没有 ctx.inject
    // （entry.js 那句 inject 抛错被 try/catch 咽掉），所以对话列只走过"服务缺席"的降级分支——
    // "有服务"那条分支从来没按真实记录形状断言过，displayTitle 口径的缺陷就是这么漏掉的。
    // 真实内核客户端侧的列表快照记录：{id, displayTitle, running, retainedBy, blank, updatedAt, title?}
    // 见 runtime/.../dsh-api-session-controller/lib/types/client/sessions/service.js:491-512。
    const sessionsStore = (() => {
      let snap = { ids: [], byId: {} };
      const subs = new Set();
      return {
        list: {
          getSnapshot: () => snap,
          subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
        },
        // 假的会话句柄（刀 5 发送面用）：prompt 的签名照内核
        // （session.prompt([{ type:'text', text }], 'queue')，见 mode-kit adapter.js:765）。
        // 注意**故意不提供 retain**：这样遥测仍走"列表行退路"，与真老内核一致。
        __promptCalls: [],
        __promptMode: 'ok',
        binding(id) {
          const self = this;
          return {
            session: {
              prompt: async (parts, mode) => {
                self.__promptCalls.push({ parts, mode });
                if (self.__promptMode === 'reject') return { ok: false, error: { code: 'busy', message: '内核正忙' } };
                if (self.__promptMode === 'throw') throw new Error('交出去了但没回音');
                return { ok: true };
              },
            },
          };
        },
        // 测试注入口子：按 updatedAt 倒序的语义由调用方（下面的断言）自己保证。
        __set(items) {
          const ids = []; const byId = {};
          for (const it of items) { ids.push(it.id); byId[it.id] = it; }
          snap = { ids, byId };
          for (const fn of subs) fn();
        },
      };
    })();
    provided.sessions = sessionsStore; // 先就位，模拟"内核已提供该服务"
    window.__wbSessions = sessionsStore;
    // 假的 0.2.0 会话图通道（真聊天瓷砖读转录用）：target 形状照内核——可快照、可订阅。
    const chatTargets = {};
    function chatTarget(id) {
      if (!chatTargets[id]) {
        const subs = new Set();
        chatTargets[id] = {
          graph: null,
          getSnapshot() { return this.graph; },
          subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
          __set(g) { this.graph = g; for (const f of subs) f(); },
        };
      }
      return chatTargets[id];
    }
    provided.uiConversation = { binding: (id) => ({ target: (kind) => (kind === 'chat' ? chatTarget(id) : null) }) };
    window.__wbChat = { set: (id, g) => chatTarget(id).__set(g) };
    // 假的壳「窗口形态」桥（2026-10-12 刀 2）：记录插件请求过的档位，返回值照主进程的包络。
    // 探针里窗口不会真变形（那是外壳的活），验的是**门面有没有正确地申请/还原**与
    // **长条几何下主屏是否竖排不破版**（后者靠真改窗宽）。
    window.__shapeLog = [];
    window.__overlayLog = [];
    window.__closeCalls = 0;
    window.__settingsCalls = 0;
    window.__spliceLog = [];
    window.__moduleLog = [];
    window.__modules = [];
    window.__shapeSubs = [];
    window.dshShell = {
      getWorkbenchShape: async () => ({ ok: true, shape: 'normal', alwaysOnTop: false, spliceWidth: 0, spliceRange: [280, 1200], modules: window.__modules }),
      setWorkbenchShape: async (s) => {
        window.__shapeLog.push(s);
        const state = { ok: true, shape: s, alwaysOnTop: s !== 'normal', spliceWidth: 0, spliceRange: [280, 1200], modules: window.__modules };
        // 形态推送：辅助坞据此决定显不显示（长条下不显示，见 Dock.js）；模块窗口记账也走这条
        (window.__shapeSubs || []).forEach((cb) => { try { cb(state) } catch (e) {} });
        return state;
      },
      onWorkbenchShape: (cb) => { window.__shapeSubs.push(cb); return () => {} },
      // 顶栏「⚙」（2026-10-13）：走壳既有的设置通道，假桥只记调用次数
      // （注意：这一段在 HTML 模板字符串里，注释**不能出现反引号**——会把模板截断，2026-10-13 踩过）
      openSettings: async () => { window.__settingsCalls += 1; return { ok: true } },
      // 拼接宽度（2026-10-13）：假桥照真壳的口径回包（0 = 收起，280..上限，越界夹住）。
      // 上限在真壳里是**按显示器工作区算**的（多模式同时拼要更宽），探针里给一个固定上限即可。
      setWorkbenchSplice: async (w) => {
        const n = Number(w);
        const next = !Number.isFinite(n) || n <= 0 ? 0 : Math.max(280, Math.min(1200, Math.round(n)));
        window.__spliceLog.push(next);
        return { ok: true, shape: 'strip', spliceWidth: next, spliceRange: [280, 1200] };
      },
      // **模块窗口**（2026-10-13 模块化）：假壳照真壳口径回包——记账列表随形态推送发出去，
      // 门面据此在接缝上标「已拼接」。⑫ 组会把这两条方法摘掉，用来验降级路径。
      openModuleWindow: async (modeId, width, kind) => {
        const k = kind === 'assistant' ? 'assistant' : 'main';
        window.__moduleLog.push({ op: 'open', modeId: String(modeId), width: Number(width), kind: k });
        if (!window.__modules.some((m) => m.modeId === modeId && m.kind === k)) {
          window.__modules = window.__modules.concat([{ modeId: String(modeId), kind: k, anchored: true, bounds: null }]);
        }
        (window.__shapeSubs || []).forEach((cb) => { try { cb({ ok: true, shape: 'strip', modules: window.__modules }) } catch (e) {} });
        return { ok: true, shape: 'strip', modules: window.__modules };
      },
      closeModuleWindow: async (modeId, kind) => {
        const k = kind === 'assistant' ? 'assistant' : kind === 'main' ? 'main' : null;
        window.__moduleLog.push({ op: 'close', modeId: String(modeId), kind: k || 'all' });
        window.__modules = window.__modules.filter((m) => !(m.modeId === modeId && (!k || m.kind === k)));
        (window.__shapeSubs || []).forEach((cb) => { try { cb({ ok: true, shape: 'strip', modules: window.__modules }) } catch (e) {} });
        return { ok: true, shape: 'strip', modules: window.__modules };
      },
      // 浮标已于 2026-10-13 移除（用户："这个浮标没有用就去掉"）：假桥**不再提供**这两个方法，
      // 门面若还偷偷调用会当场抛错；下面另有守卫断言钉"一次都没调过"。
      closeWorkbenchWindow: async () => { window.__closeCalls += 1; return { ok: true } },
    };
    const ctx = {
      effect: (fn) => { fn(); return () => {}; },
      inject: (deps, cb) => { const scope = {}; for (const d of deps) scope[d] = provided[d]; return cb(scope); },
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
    // **测试窗摆副屏**（2026-10-13 项目所有者要求："拉实例测试时放到屏幕二，不然会影响我"）：
    // 探针窗是真窗口，落在主屏上会打断正在干活的人。
    ...(() => {
      const all = screen.getAllDisplays()
      const d = all.length > 1 ? all[1] : all[0]
      if (!d) return {}
      return { x: d.workArea.x + 20, y: d.workArea.y + 20 }
    })(),
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
  // 点之前先断言元素在——否则报错只有一句"null.click"，根本看不出是哪一步（2026-10-13 实付过学费）
  const click = (selector) =>
    evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('click target missing: ' + ${JSON.stringify(selector)}); el.click(); return 0 })()`,
    )
  // **进模式（全屏）现在只有宽窗主屏那条路**（2026-10-13 用户拍板 A：接缝点一下 = 拼接）。
  // 所以切模式要先回宽窗（← 收拼接 + 申请 normal），再点瓷砖「进入」或按钮卡。
  // 两个细节：① 已经在宽窗主屏时没有顶栏（← 只存在于条状）→ 跳过那一步；
  // ② 测"守卫拒绝"时**不能等成功**（`mayBeBlocked`），否则会撞超时。
  const enterModeViaWide = async (id, opts = {}) => {
    if (await evaluate(`!!document.querySelector('[data-wb-btn="back"]')`)) {
      await click('[data-wb-btn="back"]')
    }
    await waitFor(`document.querySelector('[data-wb-tiles]')!==null || document.querySelector('[data-wb-empty]')!==null`, '回宽窗后应看到主屏内容')
    await click(`[data-wb-tile-enter="${id}"],[data-wb-mode="${id}"]`)
    if (!opts.mayBeBlocked) {
      await waitFor(`window.__wbPlugin.__workbenchRegistry().getActive()==='${id}'`, `应进入 ${id}`)
    }
  }

  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  await waitFor(`!!window.__wbPlugin && !!window.__wbPlugin.__workbenchRegistry()`, 'client 未加载')

  const slots = await evaluate('JSON.stringify(window.__wbSlots)')
  assert.equal(
    slots,
    JSON.stringify(['sidebar.footer.action', 'shell.overlay', 'shell.overlay', 'settings.section']),
    '四个挂载点都要注册（shell.overlay 有两条：切换器 + 辅助坞）',
  )
  assert.equal(await evaluate(`typeof (window.__wbService||{}).workbench`), 'object', '应把 workbench 服务 provide 出去')

  // ① 没有模式：入口不留死按钮
  assert.equal(await count('[data-wb-entry]'), 0, '没有模式时不应渲染入口按钮')
  assert.equal(await count('[data-wb-switcher]'), 0, '没有模式时不应有切换器')
  await waitFor(`document.querySelector('[data-wb-settings-none]')!==null`, '设置段应显示"没有模式"')
  const settingsText = await text('[data-wb-settings]')
  assert.ok(settingsText.includes('还没有') || settingsText.includes('没有模式'), `设置段应说明没有模式：${settingsText}`)

  // ② 注册一个模式（走真实服务，不碰内部实现）
  //    带 `context`（2026-10-18 G4）：模式报"正在做什么"，接缝上要能看见。
  await evaluate(`(() => { window.__wbPlugin.__workbenchRegistry().registerMode({
    id:'demo', label:'演示模式', order:20,
    canDeactivate: () => window.__guardDemo !== false,
    onActivate: (e) => { window.__act = (window.__act||[]).concat([e.reason]) },
    context: { get: () => ({ title: '第 3 章 · 雨夜', dirty: true, health: 2 }) },
  }); return 0 })()`)
  await waitFor(`document.querySelector('[data-wb-entry]')!==null`, '注册后入口应出现')
  assert.equal(await evaluate(`document.querySelector('[data-wb-entry]').getAttribute('data-wb-count')`), '1')
  assert.equal((await text('[data-wb-entry]')).includes('工具台'), true)

  // ③ 主屏（2026-10-11 起的形态）：点入口开主屏——左列对话瓷砖 + 右侧瓷砖格；主屏本身不改当前模式，
  // 点模式的按钮卡才真正进入（单模式也不再直进：主屏就是目的地，不是"只有一个选项的列表"）。
  // ③ 里从 2026-10-12 起**带真实记录形状**地断言对话列（空列表 / displayTitle / 有标题三种）。
  // **2026-10-13 形态分工**（对齐原型 v2.2）：壳在位 → 主屏收成长条 → 对话优先、右缘接缝是模式入口，
  // 瓷砖格只在"没有壳能力"（官方壳/老包/探针假宿主）时出现。所以这里断言长条形态的样子。
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, '点入口应打开主屏')
  assert.equal(await count('[data-wb-chat]'), 1, '主屏左列应是对话瓷砖')
  assert.equal(await count('[data-wb-tiles]'), 0, '长条形态不摆瓷砖格（对话优先；瓷砖格是宽窗/无壳能力时的 v1 布局）')
  assert.equal(await count('[data-wb-seam]'), 1, '长条形态应有右缘接缝（模式入口）')
  assert.equal(await count('[data-wb-chat-empty="empty"]'), 1, '有会话服务但列表为空：应如实说明"还没有会话"')
  assert.equal(await count('[data-wb-chat-empty="noservice"]'), 0, '会话服务在位时不该报"服务不可用"')
  // 一条**没有持久标题**的会话：真实内核这种条目只有 displayTitle（title 缺席）。旧实现读 title
  // → 这行是空白。这条断言的反例就是它自己：把 ConversationTile 改回读 title 立刻红。
  await evaluate(
    `window.__wbSessions.__set([{ id:'s1', displayTitle:'未命名会话的派生标题', running:false, retainedBy:'none', blank:false, updatedAt:Date.now() }])`,
  )
  await waitFor(`document.querySelector('[data-wb-chat-session]')!==null`, '有会话时对话列应渲染它')
  assert.equal(await text('[data-wb-chat-title]'), '未命名会话的派生标题', '对话列应显示 displayTitle')
  // 状态条（2026-10-12 接真投影）：这条会话**没有**投影值 → 三条都得如实写"还没数据/未上报"，
  // 绝不拿 0 冒充"没有"（反例：把 telemetryOf 的空值分支改成 ?? 0，这三条立刻红）。
  // 2026-10-13 去噪：没有数据时指标只显示 `—`（原来三处都写"还没数据"，一行刷三次），
  // 但**具体原因必须留在 title 里**——判据从"文案里有没有'还没数据'"改成"**悬停能不能看到原因**"，
  // 这样既守 guide §5（状态要给原因），又不让状态条变成噪音。
  for (const [key, reason] of [
    ['speed', '没有解码数据'],
    ['cache', '没有用量数据'],
    ['context', '没有上下文数据'],
  ]) {
    assert.equal((await text(`[data-wb-metric="${key}"]`)).includes('—'), true, `${key} 无数据时应显示 —`)
    assert.ok(
      (await evaluate(`document.querySelector('[data-wb-metric="${key}"]').title`)).includes(reason),
      `${key} 的原因要留在 title 里（${reason}）`,
    )
  }
  // 确有持久标题的会话：内核两个字段都给，displayTitle 即该标题；再挂上真投影——
  // **形状照 2026-10-12 真内核实测**：`sessionStats` 是扁平的、`tokenUsage` 也是扁平的
  // （host 侧 durable state 才套 `{totals,last}`）。之前按嵌套写读法，命中率在真内核上永远算不出，
  // 就是这条 fixture 与真实形状不一致害的——所以 fixture 必须来自实测，不能凭类型声明猜。
  // 期望值：tok/s = 156/(4100/1000) ≈ 38；缓存 = 13800/(1200+13800+0) = 92%；上下文 = 15000/64000 ≈ 23%。
  await evaluate(
    `window.__wbSessions.__set([{ id:'s2', displayTitle:'归乡记讨论', title:'归乡记讨论', running:true, retainedBy:'none', blank:false, updatedAt:Date.now()+1000,
      projectionValues: {
        sessionStats: { turns:3, steps:9, llmMs:5200, toolMs:1200, ttftMs:340, ttftSteps:3, decodeMs:4100, decodeTokens:156 },
        tokenUsage: { uncachedInputTokens:1200, outputTokens:156, cacheReadTokens:13800, cacheWriteTokens:0 },
        contextPressure: { pressureTokens:15000, contextWindow:64000 },
      } }])`,
  )
  await waitFor(`(document.querySelector('[data-wb-chat-title]')||{}).textContent==='归乡记讨论'`, '有标题的会话应显示标题')
  await waitFor(`(document.querySelector('[data-wb-metric="speed"]')||{}).textContent==='⚡ 38 tok/s'`, 'tok/s 应按内核口径算出真数')
  assert.equal(await text('[data-wb-metric="cache"]'), '缓存命中 92%', '缓存命中率 = cacheRead ÷ (uncached+cacheRead)')
  // 上下文按原型给 `已用/窗口`（15000/64000 → 15k/64k），并给进度条一个 0..100 的填充值
  assert.equal(await text('[data-wb-metric="context"]'), '上下文 15k/64k', '上下文按原型给 已用/窗口')
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-meter-fill]').getAttribute('data-wb-meter-fill')`),
    '23',
    '进度条填充 = 占用比（15000/64000 ≈ 23%）',
  )
  const telemetrySource = await evaluate(
    `(document.querySelector('[data-wb-strip]')||{}).getAttribute?document.querySelector('[data-wb-strip]').getAttribute('data-wb-telemetry'):null`,
  )
  assert.equal(telemetrySource, 'list-row', `本假宿主没有 retain/binding，应退回读列表行投影：${telemetrySource}`)
  // ③e 真聊天瓷砖（只读）：喂一条 0.2.0 形状的会话图（nodes 是 Map、order 是数组），
  // 转录必须经 mode-kit projectChat 投影出带角色的行——**未知内容保留可见摘要**，不藏。
  // 先验**三态里的加载态**：通道在、图还没送到（source=pending）时必须说"正在读取"，
  // 不能错报成"还没有消息"（2026-10-13 补）。
  await evaluate(`window.__wbChat.set('s2', null)`)
  await waitFor(
    `document.querySelector('[data-wb-chat-log-empty]')?.getAttribute('data-wb-chat-log-empty')==='pending'`,
    '图还没送到时应显示加载态',
  )
  assert.ok((await text('[data-wb-chat-log-empty]')).includes('正在读取'), '加载态文案要说"正在读取"')
  // 再验**空态**：图在位但一条消息都没有。注意 s2 是 running=true，而流式态与空态**互斥**
  // （正在生成时该出现的是流式态）——所以验空态前先把 running 关掉，验完再开回来。
  await evaluate(`window.__wbSessions.__set([{ id:'s2', displayTitle:'归乡记讨论', title:'归乡记讨论', running:false, retainedBy:'none', blank:false, updatedAt:Date.now() }])`)
  await evaluate(`window.__wbChat.set('s2', { order:[], nodes:new Map() })`)
  await waitFor(
    `document.querySelector('[data-wb-chat-log-empty]')?.getAttribute('data-wb-chat-log-empty')==='no-messages'`,
    '空图 + 不在生成时应显示"还没有消息"',
  )
  await evaluate(`window.__wbSessions.__set([{ id:'s2', displayTitle:'归乡记讨论', title:'归乡记讨论', running:true, retainedBy:'none', blank:false, updatedAt:Date.now() }])`)
  await evaluate(
    `window.__wbChat.set('s2', { order:['m1','m2','m3','m4'], nodes: new Map([
      ['m1',{kind:'user',data:{content:[{kind:'text',text:'把第二章的结尾改冷一点'}]}}],
      ['m2',{kind:'assistant-step',data:{blocks:[{type:'text',text:'好，先给你三个方向'}]}}],
      ['m3',{kind:'tool-call',data:{name:'write_file',callId:'c1',argsRaw:'{}',phase:'call'}}],
      ['m4',{kind:'user',data:{content:[{kind:'text',text:'这是一段很长的消息。'.repeat(20)}]}}],
    ]) })`,
  )
  await waitFor(`document.querySelectorAll('[data-wb-chat-line]').length>=2`, '真聊天瓷砖应投影出转录行')
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-chat-log]').getAttribute('data-wb-chat-source')`),
    'uiConversation',
    '应走 0.2.0 会话图通道',
  )
  assert.ok((await text('[data-wb-chat-line="user"]')).includes('把第二章的结尾改冷一点'), '作者行应显示正文')
  assert.ok((await text('[data-wb-chat-line="assistant"]')).includes('三个方向'), '助手行应显示正文')
  // 工具调用**不套气泡**，压成活动行（转录投影给结构化 tool：name/phase/isError）
  assert.equal(await count('[data-wb-chat-act]'), 1, '工具调用应渲染成活动行')
  assert.ok((await text('[data-wb-chat-act]')).includes('write_file'), '活动行要带工具名')
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-chat-act]').getAttribute('data-wb-chat-act')`),
    'call',
    '活动行要标出阶段（call/result）',
  )
  // 长文折叠（气泡细节）：旧实现把正文硬截断到 160 字（一个字都不该丢）→ 现在默认折三行 + 「展开全文」
  {
    assert.equal(
      await evaluate(`document.querySelector('[data-wb-msg-toggle]').getAttribute('data-wb-msg-toggle')`),
      'expand',
      '长文默认给「展开全文」',
    )
    assert.equal(await evaluate(`document.querySelector('[data-wb-msg-open]').getAttribute('data-wb-msg-open')`), '0', '长文默认折叠')
    const len = await evaluate(`document.querySelector('[data-wb-msg-open]').textContent.length`)
    assert.ok(len >= 200, `折叠时正文也要**完整渲染**（不再硬截断）：实际 ${len}`)
    await click('[data-wb-msg-toggle]')
    await waitFor(`document.querySelector('[data-wb-msg-open]').getAttribute('data-wb-msg-open')==='1'`, '点「展开全文」应展开')
    assert.equal(
      await evaluate(`document.querySelector('[data-wb-msg-open]').classList.contains('is-clamped')`),
      false,
      '展开后不再折行',
    )
  }
  // 流式态：这条 fixture 的 running=true → 应挂一行"正在生成…"；把它关掉就应收起
  assert.equal(await count('[data-wb-chat-streaming]'), 1, 'running=true 时应显示流式态')
  await evaluate(`window.__wbSessions.__set([{ id:'s2', displayTitle:'归乡记讨论', title:'归乡记讨论', running:false, retainedBy:'none', blank:false, updatedAt:Date.now() }])`)
  await waitFor(`document.querySelector('[data-wb-chat-streaming]')===null`, 'running=false 时流式态应收起')
  await evaluate(`window.__wbSessions.__set([{ id:'s2', displayTitle:'归乡记讨论', title:'归乡记讨论', running:true, retainedBy:'none', blank:false, updatedAt:Date.now() }])`)
  await waitFor(`document.querySelector('[data-wb-chat-streaming]')!==null`, 'running 回到 true 时流式态应回来')
  assert.equal(await count('[data-wb-chat-back]'), 1, '对话列应有「回到完整会话」')
  // ③f 输入框与发送（刀 5）：有发送面时可发；**参数形状必须是内核原语的形状**（不是我们自己发明的）
  assert.equal(await count('[data-wb-composer]'), 1, '有会话时应给出输入框')
  assert.equal(await evaluate(`document.querySelector('[data-wb-send]').disabled`), false, '有发送面时按钮不该禁用')
  await evaluate(`(() => { const t = document.querySelector('[data-wb-composer]'); t.value = '把结尾改冷一点'; return 1 })()`)
  await click('[data-wb-send]')
  await waitFor(`window.__wbSessions.__promptCalls.length===1`, '点发送应调一次内核 prompt')
  assert.deepEqual(
    JSON.parse(await evaluate(`JSON.stringify(window.__wbSessions.__promptCalls[0])`)),
    { parts: [{ type: 'text', text: '把结尾改冷一点' }], mode: 'queue' },
    '发送必须照内核 prompt(parts, mode) 的形状',
  )
  assert.equal(await evaluate(`document.querySelector('[data-wb-composer]').value`), '', 'accepted 后清空输入框')
  // 原生拒绝（ok:false）：**作者写的字一个字都不丢**，并给出处（写作模式定下的纪律）
  await evaluate(`window.__wbSessions.__promptMode = 'reject'`)
  await evaluate(`(() => { const t = document.querySelector('[data-wb-composer]'); t.value = '这段必须留着'; return 1 })()`)
  await click('[data-wb-send]')
  await waitFor(`document.querySelector('[data-wb-notice]')!==null`, '拒绝要有说法')
  assert.equal(await evaluate(`document.querySelector('[data-wb-composer]').value`), '这段必须留着', '拒绝时正文必须留着')
  assert.ok((await text('[data-wb-notice]')).includes('没发出去'), `拒绝提示要说清状态：${await text('[data-wb-notice]')}`)
  // 结果不可核（抛异常）：按 uncertain 处理，正文同样留着，且提示里带"回到完整会话"的出路
  await evaluate(`document.querySelector('[data-wb-notice]').click()`)
  await evaluate(`window.__wbSessions.__promptMode = 'throw'`)
  await click('[data-wb-send]')
  await waitFor(`(document.querySelector('[data-wb-notice]')||{}).textContent?.includes('没能核对')`, '不可核要有说法')
  assert.equal(await evaluate(`document.querySelector('[data-wb-composer]').value`), '这段必须留着', '不可核时正文必须留着')
  await evaluate(`document.querySelector('[data-wb-notice]').click(); window.__wbSessions.__promptMode = 'ok'`)
  // 可发送时 title 允许是**操作提示**（"发送（Enter）"），但不许出现拒绝理由的措辞
  // （2026-10-13：按钮从输入框外侧挪进框内后，title 顺手改成快捷键提示——断言按"意图"判，不写死空串）
  assert.equal(
    /不能|不可|未接|无法|拒绝/.test(await evaluate(`document.querySelector('[data-wb-send]').title`)),
    false,
    '可发送时按钮不该带拒绝理由',
  )

  // ③d 长条接线（2026-10-12 刀 2）：主屏一打开就该请壳收成 strip；然后把探针窗口**真**收到 420 宽，
  // 主屏必须竖排（对话列在瓷砖格之上）且不出现横向溢出——这是"长条门面不破版"的几何断言，
  // 光看文案是看不见的（踩坑速查 #21：视觉层要几何 + 图，别只信文本断言）。
  await waitFor(
    `document.querySelector('[data-wb-switcher]').getAttribute('data-wb-shape')==='strip'`,
    '主屏打开应申请 strip 形态',
  )
  assert.deepEqual(await evaluate(`window.__shapeLog`), ['strip'], '打开主屏只应申请一次 strip')
  win.setContentSize(420, 700)
  await sleep(400)
  const narrow = await evaluate(
    `(() => { const c = document.querySelector('[data-wb-chat]'); const t = document.querySelector('[data-wb-tiles]'); const de = document.documentElement;
      return JSON.stringify({ chatTop: c ? Math.round(c.getBoundingClientRect().top) : -1, tilesTop: t ? Math.round(t.getBoundingClientRect().top) : -1, overflowX: de.scrollWidth - de.clientWidth, cw: de.clientWidth }); })()`,
  )
  const geo = JSON.parse(narrow)
  assert.ok(geo.cw < 460, `窗口应真的收到 420 宽：clientWidth=${geo.cw}`)
  // 2026-10-13：长条里只剩对话（瓷砖格让位给接缝）——所以这里判"对话列在位 + 没有瓷砖格"，
  // 而不是旧版的"对话列在瓷砖格上方"。
  assert.ok(geo.chatTop >= 0 && geo.tilesTop === -1, `420 宽长条里应只有对话列、没有瓷砖格：${narrow}`)
  assert.equal(await count('[data-wb-seam]'), 1, '420 宽长条里接缝（模式入口）要在位')
  assert.ok(geo.overflowX <= 1, `420 宽下不该有横向溢出：${narrow}`)
  win.setContentSize(900, 700)
  await sleep(300)
  assert.equal(await evaluate(`window.__wbPlugin.__workbenchRegistry().getActive()`), null, '主屏本身不应改当前模式')
  // 用户拍板 A 之后：进模式走**宽窗主屏的「进入」**（接缝点一下是拼接，见 ⑪ 组）
  await enterModeViaWide('demo')
  await waitFor(`document.querySelector('[data-wb-switcher]')===null`, '进入模式后主屏应关闭')
  // 进模式这条路现在会**先回宽窗**（← 申请 normal）再点「进入」，所以形态日志里多了几条——
  // 判据改成"头一条是 strip、末一条是 normal"（不再写死整条日志）
  {
    const shapeLogNow = await evaluate(`window.__shapeLog`)
    assert.equal(shapeLogNow[0], 'strip', '打开主屏应申请 strip')
    assert.equal(shapeLogNow[shapeLogNow.length - 1], 'normal', '关闭主屏（进入模式）应还原 normal——模式要宽窗')
  }
  assert.equal(await evaluate(`JSON.stringify(window.__act)`), JSON.stringify(['switch']))
  await waitFor(`document.querySelector('[data-wb-active-label]')!==null`, '入口应显示当前模式名')
  {
    // 2026-10-18：demo 现在带 context ⇒ 入口标签会带上"正在做什么"（`演示模式 · 第 3 章 · 雨夜`），
    // 所以这里判"以模式名开头"，不再死等严格相等（严格相等会把带上下文的正确行为判红）。
    const entryLabel = await text('[data-wb-active-label]')
    assert.ok(entryLabel.startsWith('演示模式'), `入口应显示当前模式名，实际：${entryLabel}`)
    assert.ok(entryLabel.includes('第 3 章 · 雨夜'), `入口也应带上 context，实际：${entryLabel}`)
  }

  // ③e 长条自绘顶栏**五钮**（2026-10-13 起对齐原型 `.topbar`：← 回宽窗主屏 / ⚙ 设置 / — 小条 /
  // ⎋ 退出并还原 / ✕ 走既有关窗语义）。纪律各自有断言：门面**只申请档位**（不自己搬窗口）、
  // `✕` **不顺手改形态**（窗口只是藏起来）、五钮都是**原生 button 且带 title**。
  // 档位判据用"本组起点之后的尾巴"，免得被前面 ③d 的申请史干扰。
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, '重新打开主屏')
  await waitFor(`document.querySelector('[data-wb-bar]')!==null`, '条状形态应自绘顶栏')
  let shapeBase = await evaluate('window.__shapeLog.length')
  const overlayBase = await evaluate('window.__overlayLog.length')
  const shapeTail = async () => (await evaluate('window.__shapeLog')).slice(shapeBase)
  const overlayTail = async () => (await evaluate('window.__overlayLog')).slice(overlayBase)
  const barInfo = JSON.parse(
    await evaluate(
      `(() => { const b=[...document.querySelectorAll('[data-wb-btn]')];
        return JSON.stringify({ kinds: b.map((x) => x.getAttribute('data-wb-btn')), tags: b.map((x) => x.tagName), titles: b.map((x) => x.title) }); })()`,
    ),
  )
  assert.deepEqual(barInfo.kinds, ['back', 'settings', 'mini', 'exit', 'close'], `五钮齐备且语义可辨：${JSON.stringify(barInfo.kinds)}`)
  assert.ok(barInfo.tags.every((t) => t === 'BUTTON'), `五钮必须是原生 button（Tab 可达）：${JSON.stringify(barInfo.tags)}`)
  assert.ok(barInfo.titles.every((t) => t && t.length > 3), `五钮都要有说得清的 title：${JSON.stringify(barInfo.titles)}`)
  assert.equal(await evaluate(`(document.querySelector('[data-wb-bar]')||{}).getAttribute?.('data-wb-bar-shape')`), 'strip')
  // 「退出」必须是**看得懂的文字**（不是字形）：它是回内核主界面的唯一出口。
  // 2026-10-13 项目所有者直接问"怎么回到主界面"——字形 ⎋ 的锅，这条断言就是钉它别再退回去。
  assert.ok(
    String(await text('[data-wb-btn="exit"]')).length >= 2,
    `「退出」钮要用文字标签（可读性）：实际 ${JSON.stringify(await text('[data-wb-btn="exit"]'))}`,
  )
  // ⚙ 走壳既有的设置通道：假桥记一笔（**必须在 ← 之前**——← 会收掉顶栏，那时就没有 ⚙ 了）
  await click('[data-wb-btn="settings"]')
  await waitFor(`window.__settingsCalls===1`, '⚙ 应调用壳的设置通道')
  // ← 与 ⎋ 的区别：← 只把窗口变回宽窗（主屏还在、瓷砖格回来），**不退出工具台**
  await click('[data-wb-btn="back"]')
  await waitFor(`document.querySelector('[data-wb-bar]')===null`, '← 应退出条状（顶栏随之收起）')
  assert.deepEqual(await shapeTail(), ['normal'], '← 只申请 normal')
  assert.equal(await count('[data-wb-switcher]'), 1, '← 不该关掉主屏')
  assert.equal(await count('[data-wb-tiles]'), 1, '回到宽窗后瓷砖格应回来（原型的"工作区选择"）')
  // 回到条状：走门面自己的路径（关主屏再开 → open 变化 → 重新申请 strip），别直接改假桥的状态
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')===null`, '先关掉宽窗主屏')
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-bar]')!==null`, '应回到条状顶栏')
  // **重新取基线**：上面 ← / ⚙ / 重开主屏都会往形态日志里写，后面几组要按"本组起点"判
  shapeBase = await evaluate('window.__shapeLog.length')

  // 先在输入框里留一段**没发出去**的字：`—` 会整块卸载对话列，这正是最容易吞字的地方。
  // 必须走**原型上的原生 setter** 再派发 input：React 在无控组件上装了 value tracker，
  // 直接 `el.value = x` 会把 tracker 一起改掉，于是 onChange 被判定"没变化"而根本不触发
  // （③f 那种直写 DOM 的打法在这里不够用——那里 send() 是直接读 DOM 的）。
  await evaluate(
    `(() => { const b = document.querySelector('[data-wb-composer]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
       setter.call(b, '打到一半先收一下'); b.dispatchEvent(new Event('input', { bubbles: true })); return 0 })()`,
  )
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-composer]').value`),
    '打到一半先收一下',
    '合成输入应真的落到输入框里',
  )
  await click('[data-wb-btn="mini"]')
  await waitFor(`document.querySelector('[data-wb-mini]')!==null`, '点 `—` 应换成小条门面')
  assert.deepEqual(await shapeTail(), ['mini'], '小条只申请档位，窗口几何归壳')
  assert.equal(await count('[data-wb-tiles],[data-wb-chat]'), 0, '小条里不该留对话列与瓷砖格（168px 高塞不下就是破版）')
  // 但**状态数据要在**：原型 `.mini` 不是"少画点东西"，而是同一条数据换个尺寸（2026-10-13 补齐）
  assert.equal(await count('[data-wb-mini] [data-wb-meter]'), 1, '小条也要显示同一份状态数据')
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-mini] [data-wb-meter]').getAttribute('data-wb-meter')`),
    'compact',
    '小条的状态条应是紧凑版（去掉进度条）',
  )
  assert.ok(
    (await text('[data-wb-mini] [data-wb-metric="speed"]')).length > 0,
    '小条状态条要真的渲染出指标文案',
  )
  assert.deepEqual(await overlayTail(), [], '浮标已移除：收成小条时门面不该再申请任何浮标')
  await click('[data-wb-btn="mini"]')
  await waitFor(`document.querySelector('[data-wb-mini]')===null`, '再点一次 `—` 应展开回长条')
  assert.deepEqual(await shapeTail(), ['mini', 'strip'], '展开回 strip')
  assert.equal(await count('[data-wb-tiles]'), 0, '长条里不再摆瓷砖格（对话优先，模式入口走右缘接缝——原型 v2.2）')
  assert.deepEqual(await overlayTail(), [], '浮标已移除：展开后也不该申请浮标')
  // ③f 接缝呼出（原型 v2.2 扇形的第一版）：长条下它是**唯一的模式入口**，必须列出全部模式、能进入
  {
    assert.equal(await count('[data-wb-seam]'), 1, '长条应有右缘接缝')
    const seamModes = await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('[data-wb-seam-mode]')).map((b) => b.getAttribute('data-wb-seam-mode')))`)
    const allModes = await evaluate(`JSON.stringify(window.__wbPlugin.__workbenchRegistry().list().map((m) => m.id))`)
    assert.deepEqual(JSON.parse(seamModes).sort(), JSON.parse(allModes).sort(), '接缝要列出全部可达模式')
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-wb-seam-mode].is-active').length`),
      1,
      '接缝里当前模式要标出来',
    )
    // 点击行为放到 ④/⑤/⑥（那时有两个模式，才谈得上"切到另一个"）——这里只钉"列全 + 标当前"
    // 状态点 + 当前标记（原型 `.st` / `em.tag`）：状态不只靠颜色，文字再说明一次
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-wb-seam-st="active"]').length`),
      1,
      '接缝里当前模式的状态点要标成 active',
    )
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-wb-seam-tag="active"]').length`),
      1,
      '接缝里当前模式要有"当前"文字标记',
    )
  }
  // ③g 「+」弹层（原型 `.sheet`）：上传（还没接，如实禁用）+ 更多工具（= 模式入口）
  {
    assert.equal(await count('[data-wb-plus]'), 1, '输入框左侧应有「+」')
    assert.equal(await count('[data-wb-sheet]'), 0, '弹层默认收起')
    await click('[data-wb-plus]')
    await waitFor(`document.querySelector('[data-wb-sheet]')!==null`, '点「+」应展开弹层')
    const upload = await evaluate(
      `JSON.stringify((() => { const b = document.querySelector('[data-wb-sheet-upload]'); return b ? { disabled: b.disabled, title: b.title } : null })())`,
    )
    const up = JSON.parse(upload)
    assert.ok(up && up.disabled === true, `上传文件还没接，必须如实禁用：${upload}`)
    assert.ok(up.title && up.title.length > 3, `禁用的项要说明原因（title）：${upload}`)
    const sheetModes = await evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('[data-wb-sheet-mode]')).map((b) => b.getAttribute('data-wb-sheet-mode')))`,
    )
    const all = await evaluate(`JSON.stringify(window.__wbPlugin.__workbenchRegistry().list().map((m) => m.id))`)
    assert.deepEqual(JSON.parse(sheetModes).sort(), JSON.parse(all).sort(), '「更多工具」要列出全部模式')
    await click('[data-wb-plus]')
    await waitFor(`document.querySelector('[data-wb-sheet]')===null`, '再点「+」应收起弹层')
  }
  assert.equal(
    await evaluate(`(document.querySelector('[data-wb-composer]')||{}).value`),
    '打到一半先收一下',
    '收成小条再展开，没发出去的字一个字都不能丢',
  )
  // 收尾把草稿清掉：模块级草稿是跨挂载的，留着会让后面各组一进来就看见上一组打的字
  await evaluate(
    `(() => { const b = document.querySelector('[data-wb-composer]');
       Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(b, '');
       b.dispatchEvent(new Event('input', { bubbles: true })); return 0 })()`,
  )

  await evaluate(`document.querySelector('[data-wb-btn="close"]').focus()`)
  assert.equal(
    await evaluate(`document.activeElement && document.activeElement.getAttribute('data-wb-btn')`),
    'close',
    '焦点应能落在三钮上（键盘可达不能只靠注释承诺）',
  )
  await click('[data-wb-btn="close"]')
  await sleep(250)
  assert.equal(await evaluate('window.__closeCalls'), 1, '`✕` 只说"用户按了关闭"，进托盘/退出由壳的既有关窗语义定')
  assert.deepEqual(await shapeTail(), ['mini', 'strip'], '`✕` 不该顺手还原窗口形态或关掉主屏')

  await click('[data-wb-btn="exit"]')
  await waitFor(`document.querySelector('[data-wb-switcher]')===null`, '`⎋` 应退出工具台')
  assert.deepEqual(await shapeTail(), ['mini', 'strip', 'normal'], '`⎋` 退出要把窗口还原成 normal')
  // 收尾把状态交还给后续各组：重新进入 demo（④ 断言"任何时刻只有一个当前模式"要它在场）
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, '重新打开主屏')
  await enterModeViaWide('demo')
  await waitFor(`document.querySelector('[data-wb-switcher]')===null`, '进入模式后主屏应关闭')

  // ④ 多模式：切换器列出全部，当前项有标记
  await evaluate(`(() => { window.__wbPlugin.__workbenchRegistry().registerMode({ id:'demo2', label:'第二个模式', order:30 }); return 0 })()`)
  await waitFor(`document.querySelector('[data-wb-entry]').getAttribute('data-wb-count')==='2'`, '入口计数应更新')
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-switcher]')!==null`, '多模式时点入口应弹切换器')
  assert.equal(await count('[data-wb-seam-mode]'), 2, '接缝应列出两个模式（长条下它是唯一入口）')
  assert.equal(await count('[data-wb-seam-mode].is-active'), 1, '任何时刻只有一个当前模式')
  // **G4（2026-10-18）**：接缝上要显示模式上报的"正在做什么"（这里 demo 报「第 3 章 · 雨夜」）。
  // 以前 context 只用在宽窗主屏的瓷砖/卡片里，长条接缝上完全没有 ⇒ 用户只能靠记。
  // 判据用"容器文本包含"（上下文与标签同在一个胶囊里：`演示模式 · 第 3 章 · 雨夜`）。
  assert.ok(
    (await text('[data-wb-seam-mode="demo"] .dshWbSeamText')).includes('第 3 章 · 雨夜'),
    '接缝上应显示模式的 context（正在写什么）',
  )
  // **G3（2026-10-18）**：context 里的动态状态要变成接缝上的小标记（未保存 / 体检 N 处）。
  // 工具台只**展示**模式报的事实（宪法第十一条），不解释、不编造。
  assert.ok(
    (await text('[data-wb-seam-mode="demo"]')).includes('未保存'),
    '模式报 dirty:true 时接缝上应出现「未保存」标记',
  )
  assert.ok(
    (await text('[data-wb-seam-mode="demo"]')).includes('体检 2'),
    '模式报 health:2 时接缝上应出现「体检 2」标记',
  )
  assert.equal(await evaluate(`document.querySelector('[data-wb-seam-mode].is-active').getAttribute('data-wb-seam-mode')`), 'demo')

  // ⑤ 关闭守卫拒绝：不切换、不自造提示、切换器留在原地
  await evaluate('window.__guardDemo = false')
  await enterModeViaWide('demo2', { mayBeBlocked: true })
  await sleep(300)
  assert.equal(await evaluate(`window.__wbPlugin.__workbenchRegistry().getActive()`), 'demo', '守卫拒绝时不得切换')
  assert.equal(await count('[data-wb-switcher]'), 1, '守卫拒绝后切换器应留在原地（由模式自己说明原因）')
  const switcherText = await text('[data-wb-switcher]')
  assert.equal(/失败|出错|错误/.test(switcherText), false, `工具台不得自造失败文案：${switcherText}`)

  // ⑥ 放行后切换成功，且写进 host 状态文件
  await evaluate('window.__guardDemo = true')
  await enterModeViaWide('demo2')
  await waitFor(`window.__wbPlugin.__workbenchRegistry().getActive()==='demo2'`, '放行后应切换')
  // 注意：切换成功与切换器关闭不在同一个 tick（setActive 先落 activeId，随后才 setOpen(false)），
  // 所以要**等**它消失——直接断言会撞上竞态（2026-10-11 实测）。
  await waitFor(`document.querySelector('[data-wb-switcher]')===null`, '切换成功后切换器应关闭')
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

  // ⑨ 主屏瓷砖：**先摘掉壳的形态能力**（官方壳/老包那条路径）——那时门面不申请 strip，主屏保持宽窗，
  // 瓷砖格与按钮卡才是这一版的布局；长条形态（壳在位）下它们是让位给接缝的。
  await evaluate(`(() => { delete window.dshShell.setWorkbenchShape; delete window.dshShell.getWorkbenchShape; return 0 })()`)
  await evaluate(`(() => { window.__wbPlugin.__workbenchRegistry().registerMode({
    id:'demo3', label:'第三个模式', order:40,
    tile:{ label:'第三模式', view: () => window.React.createElement('div', {'data-wb-tile-demo':'1'}, '瓷砖内容') },
  }); return 0 })()`)
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-tile="demo3"]')!==null`, '提供 tile 的模式应在主屏渲染瓷砖')
  assert.ok((await text('[data-wb-tile="demo3"]')).includes('瓷砖内容'), '瓷砖体部应渲染模式自己的视图组件')
  assert.equal(await count('[data-wb-tile-enter="demo3"]'), 1, '瓷砖应有「进入」按钮')
  assert.equal(await count('[data-wb-mode]'), 2, '没提供 tile 的模式应退化为按钮卡（保证可达）')
  await click('[data-wb-tile-enter="demo3"]')
  await waitFor(`window.__wbPlugin.__workbenchRegistry().getActive()==='demo3'`, '点「进入」应进入该模式')
  await waitFor(`document.querySelector('[data-wb-switcher]')===null`, '进入后主屏应关闭')

  // ⑩ 接缝**扇形几何**（2026-10-13 第二版按原型 `.fan`：**以接缝为轴心按角度排开**、逐颗错峰弹出）。
  // 放在最后单独一组：前面各组要验瓷砖（要宽窗），而扇形只在长条形态出现；这里把壳能力装回去、
  // 再凑够 3 个模式（少于 3 个时"排开"没有中间可言，断言会退化成恒真）。
  await evaluate(`(() => {
    const s = window.dshShell; const shapes = { shape: 'normal' };
    s.setWorkbenchShape = async (v) => { shapes.shape = v; return { ok: true, shape: v, alwaysOnTop: v !== 'normal', spliceWidth: 0, spliceRange: [280, 1200] } };
    s.getWorkbenchShape = async () => ({ ok: true, shape: shapes.shape, alwaysOnTop: shapes.shape !== 'normal', pid: 1, spliceWidth: 0, spliceRange: [280, 1200] });
    return 0
  })()`)
  await evaluate(`(() => { const r = window.__wbPlugin.__workbenchRegistry();
    r.registerMode({ id:'demo4', label:'第四个模式', order:50 });
    r.registerMode({ id:'demo5', label:'第五个模式', order:60 });
    return 0 })()`)
  await click('[data-wb-entry]')
  await waitFor(`document.querySelector('[data-wb-seam]')!==null`, '装回壳能力后主屏应收成长条并出现接缝')
  const seamState = await evaluate(`document.querySelector('[data-wb-seam]').getAttribute('data-wb-seam-open')`)
  assert.equal(seamState, '0', '接缝默认收起（不该一上来就摊开）')
  // **顶栏必须是拖拽区**（2026-10-13 无边框重建后项目所有者："整体拖动好像拖动不了"）：
  // 主窗 `frame:false` 没有标题栏，用户抓的就是"工具台"这一行；读**计算样式**把它钉住，
  // 否则下次改样式又会"拖不动"，而这是只能靠手感受、探针量不到的东西。
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('[data-wb-bar]')).getPropertyValue('-webkit-app-region')`),
    'drag',
    '长条顶栏必须是 -webkit-app-region:drag（无边框主窗靠它拖动）',
  )
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('[data-wb-bar] .dshWbBarBtn')).getPropertyValue('-webkit-app-region')`),
    'no-drag',
    '顶栏里的按钮必须 no-drag，否则点击会被拖拽区吃掉',
  )
  const fanJson = await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('[data-wb-seam-mode]')).map((b) => ({
    id: b.getAttribute('data-wb-seam-mode'),
    a: Number(b.getAttribute('data-wb-seam-a')),
    r: Number(b.getAttribute('data-wb-seam-out')),
    delay: Number(b.getAttribute('data-wb-seam-delay')),
  })))`)
  const fan = JSON.parse(fanJson)
  assert.ok(fan.length >= 3, `这一组要至少 3 个模式才谈得上"扇形"：${fanJson}`)
  const mid = fan[Math.floor(fan.length / 2)]
  // 原型的扇形是**转出来的**：角度从第一颗到最后一颗**递减**（第一颗在上）、正中那颗 0°、半径恒定；
  // 两端必须真的分开、且**上下顺序不能反**（2026-10-13 实机量到反了：writing 在下面、gir 在上面，
  // 看着像"朝内翻"——所以这条判据判的是**方向**，不只是"排开了"）
  assert.ok(fan.every((it, i) => i === 0 || it.a < fan[i - 1].a), `角度应从上到下递减（第一颗在上）：${fanJson}`)
  assert.equal(mid.a, 0, `正中那颗应在 0°：${fanJson}`)
  assert.ok(fan[0].a > 0 && fan[fan.length - 1].a < 0, `第一颗应在上（正角）、最后一颗在下（负角）：${fanJson}`)
  assert.ok(Math.abs(fan[0].a + fan[fan.length - 1].a) <= 1, `两端角度应对称：${fanJson}`)
  assert.ok(fan.every((it) => it.r === fan[0].r && it.r > 0), `弹出半径应恒定且为正：${fanJson}`)
  assert.ok(fan.every((it, i) => i === 0 || it.delay >= fan[i - 1].delay), `逐颗错峰应单调不减：${fanJson}`)
  // 悬停展开：React 的 onMouseEnter 由 mouseover 合成，派发一个冒泡的 mouseover 即可
  await evaluate(`(() => { document.querySelector('[data-wb-seam]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return 0 })()`)
  await waitFor(
    `document.querySelector('[data-wb-seam]').getAttribute('data-wb-seam-open')==='1'`,
    '悬停接缝应展开扇形',
  )
  // **展开时命中区要撑到覆盖扇形**（2026-10-13 项目所有者实报"图标呼出时，鼠标还没挪过去就消失了"：
  // 扇形是从 26px 窄条往里弹 58px 的，鼠标从条上往图标走中途就出了命中区 ⇒ mouseleave ⇒ 立刻收）。
  const openWidth = await evaluate(`Math.round(document.querySelector('[data-wb-seam]').getBoundingClientRect().width)`)
  assert.ok(openWidth > 100, `展开时接缝的命中区应覆盖到扇形（实测 ${openWidth}px，关着时才 26px）`)
  // **离开后要留宽限**：mouseout 之后立刻看还在（不然鼠标根本来不及挪），等超时才收
  await evaluate(`(() => { document.querySelector('[data-wb-seam]').dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); return 0 })()`)
  await sleep(60)
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-seam]').getAttribute('data-wb-seam-open')`),
    '1',
    'mouseout 之后要留宽限（不能立刻收，否则鼠标挪不到图标上）',
  )
  // 宽限期内**再进到接缝/图标上要取消关闭**（这条是"挪过去"的真正兜底）
  await evaluate(`(() => { document.querySelector('[data-wb-seam-item], [data-wb-seam-mode]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return 0 })()`)
  await sleep(400)
  assert.equal(
    await evaluate(`document.querySelector('[data-wb-seam]').getAttribute('data-wb-seam-open')`),
    '1',
    '鼠标进到扇形里的那一颗上时不该被收起',
  )
  // 真的离开（不再回来）→ 超过宽限后收起
  await evaluate(`(() => { document.querySelector('[data-wb-seam]').dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); return 0 })()`)
  await waitFor(
    `document.querySelector('[data-wb-seam]').getAttribute('data-wb-seam-open')==='0'`,
    '彻底移开后（超过宽限）应收起扇形',
  )

  // ⑪ 拼接 = **模块窗口**（2026-10-13 用户拍板："我想的是模块化，即它们也可以分离"）。
  // 壳支持模块窗口时，接缝点一下是**开一个独立窗口**贴到长条右边；模式声明了 `splice.assistant`
  // （用户："左边是写作模式的 agent 对话窗口——我说的是「写作助手」"）就**同时**再开一块助手窗口。
  await evaluate(`(() => { window.__wbPlugin.__workbenchRegistry().registerMode({
    id:'demoDock', label:'带坞视图的模式', order:70,
    splice:{ label:'完整界面', width:640, assistant:{ width:300 }, view: () => window.React.createElement('div', {'data-wb-splice-demo':'1'}, '拼接内容') },
  }); return 0 })()`)
  {
    await waitFor(`document.querySelector('[data-wb-seam-mode="demoDock"]')!==null`, '新注册的模式应出现在扇形里')
    await click('[data-wb-seam-mode="demoDock"]')
    // 声明了 assistant ⇒ **两块**：先主界面（右），再助手（左）
    await waitFor(`window.__moduleLog.length===2`, '声明了 assistant 的模式应同时开出主界面与助手两块窗口')
    assert.deepEqual(
      JSON.parse(await evaluate(`JSON.stringify(window.__moduleLog.slice(0, 2))`)),
      [
        { op: 'open', modeId: 'demoDock', width: 640, kind: 'main' },
        { op: 'open', modeId: 'demoDock', width: 300, kind: 'assistant' },
      ],
      '主界面用 splice.width（640）、助手用 splice.assistant.width（300），kind 要分得清',
    )
    assert.equal(
      await evaluate(`JSON.stringify(window.__modules.map((m) => m.kind).sort())`),
      JSON.stringify(['assistant', 'main']),
      '壳的记账里两块都在（一块 main、一块 assistant）',
    )
    assert.equal(await count('[data-wb-splice]'), 0, '模块窗口路径下**主窗里不该再拼一列**（那是老壳的降级形态）')
    await waitFor(`document.querySelector('[data-wb-seam-tag="spliced"]')!==null`, '接缝里应标出"已拼接"')
    assert.equal(
      await evaluate(`document.querySelector('[data-wb-seam-mode="demoDock"] .dshWbSeamTag').textContent`),
      '已拼接',
      '标记文案要说"已拼接"（不是自己编一个）',
    )
    // 再点同一个 = 关掉（不带 kind ⇒ 两块一起关，壳侧负责）
    await click('[data-wb-seam-mode="demoDock"]')
    await waitFor(`window.__moduleLog.length===3`, '再点一次应关掉模块窗口')
    assert.deepEqual(
      JSON.parse(await evaluate(`JSON.stringify(window.__moduleLog[2])`)),
      { op: 'close', modeId: 'demoDock', kind: 'all' },
      '第二次点应该是 close 同一个模式（不带 kind ⇒ 两块都关）',
    )
    assert.equal(await evaluate(`window.__modules.length`), 0, '关掉后壳的记账里不该留下模块窗口')
    assert.equal(await count('[data-wb-seam-tag="spliced"]'), 0, '关掉后不该再标"已拼接"')
  }

  // ⑫ **降级路径**（老壳 / 官方壳没有模块窗口能力）：退回"窗口内拼接"——主窗撑宽、右侧多一列，
  // 内容优先 `splice.mount(container)`、其次 `splice.view`、都没有才用坞的轻视图。
  // 先把模块窗口两条方法摘掉（测完恢复），这样下面的断言判的就是降级形态。
  await evaluate(`(() => { window.__origOpenModule = window.dshShell.openModuleWindow; window.__origCloseModule = window.dshShell.closeModuleWindow; delete window.dshShell.openModuleWindow; delete window.dshShell.closeModuleWindow; return 0 })()`)

  // ⑫ **拼接要的是"完整界面"**（2026-10-13 用户拍板 A）：单实例模式走 `splice.mount(container)`，
  // 工具台给容器、模式把界面渲染进去；收起时调 dispose（模式据此把自己的界面收回去）。
  await evaluate(`(() => {
    window.__mountCalls = 0; window.__disposeCalls = 0;
    window.__wbPlugin.__workbenchRegistry().registerMode({
      id:'demoMount', label:'单实例模式', order:90,
      splice:{ label:'完整界面', width:600, mount:(container) => {
        window.__mountCalls += 1;
        window.__mountHost = container && container.className;
        const inner = document.createElement('div');
        inner.setAttribute('data-wb-splice-mounted','1');
        inner.textContent = '模式自己的完整界面';
        container.appendChild(inner);
        return () => { window.__disposeCalls += 1; if (inner.parentNode) inner.parentNode.removeChild(inner) };
      } },
    });
    return 0
  })()`)
  {
    // 注册之后要**等它出现在扇形里**再点（registerMode → 门面重渲染不是同一个 tick，2026-10-13 撞过）
    await waitFor(`document.querySelector('[data-wb-seam-mode="demoMount"]')!==null`, '新注册的模式应出现在扇形里')
    await click('[data-wb-seam-mode="demoMount"]')
    await waitFor(`document.querySelector('[data-wb-splice="demoMount"]')!==null`, '给 mount 的模式应能拼上')
    await waitFor(`window.__mountCalls===1`, 'mount 应被调用一次')
    assert.equal(await count('[data-wb-splice-mounted]'), 1, '模式挂进来的内容应真的在拼接列里')
    assert.equal(
      await evaluate(`document.querySelector('[data-wb-splice-host]').getAttribute('data-wb-splice-source')`),
      'mount',
      '这条走的是 mount（不是退回坞视图）',
    )
    assert.equal(await count('[data-wb-splice] [class*="dshWbDock"]'), 0, '不该同时退化成坞视图')
    // **模式自己声明的宽度**优先（写作台那种宽窗界面在 420 里会被裁）：这里声明 600，就该申请 600
    assert.equal(
      await evaluate(`JSON.stringify(window.__spliceLog.slice(-1)[0])`),
      '600',
      '拼接宽度应优先用模式声明的 splice.width（不是写死 420）',
    )
    assert.equal(await evaluate(`window.__disposeCalls`), 0, '还在拼着的时候不该调 dispose')
    await click('[data-wb-splice-collapse="demoMount"]')
    await waitFor(`document.querySelector('[data-wb-splice="demoMount"]')===null`, '收起后拼接列应撤掉')
    assert.equal(await evaluate(`window.__disposeCalls`), 1, '收起时应调一次 dispose（模式收回自己的界面）')
    assert.equal(await count('[data-wb-splice-mounted]'), 0, 'dispose 后模式的内容应被清掉')
  }

  assert.equal(errors.length, 0, `控制台不应有 error：${errors.join(' | ')}`)
  // 收尾恢复模块窗口能力（免得影响后续新增的组）
  await evaluate(`(() => { window.dshShell.openModuleWindow = window.__origOpenModule; window.dshShell.closeModuleWindow = window.__origCloseModule; return 0 })()`)

  console.log('WORKBENCH_UI_OK 11 组断言通过（入口/主屏/对话列（含真实会话形状与 displayTitle 口径）/长条接线与三钮/瓷砖/切换/守卫/host 状态/设置段/接缝扇形几何/拼接）')
  await closeServer(server)
  app.exit(0)
}).catch(async (err) => {
  console.error('WORKBENCH_UI_FAIL', err?.stack || err)
  try {
    if (server) await closeServer(server)
  } catch {}
  app.exit(1)
})
