/**
 * review5/6 draft conflict protocol (S01/S03 surface).
 * node plugin/writing-mode/test/review5-protocol.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('PASS', name, extra)
  } else {
    fail++
    console.log('FAIL', name, extra)
  }
}

const reactStub = {
  memo: (c) => c,
  createElement: () => null,
  cloneElement: (c) => c,
  Fragment: 'Fragment',
  createContext: (d) => ({ _default: d, Provider: null, Consumer: null }),
  useContext: () => ({}),
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (f) => f(),
  useCallback: (f) => f,
  useRef: (i) => ({ current: i }),
  forwardRef: (f) => f,
  Component: class Component {},
  PureComponent: class PureComponent {},
}
const jsxStub = { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' }

const root = process.cwd()
const code = fs.readFileSync(path.join(root, 'plugin/writing-mode/client.js'), 'utf8')
let mod = null
const fetchLog = []
const sandbox = {
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  crypto: globalThis.crypto,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => 'win1', setItem: () => {} },
  navigator: { language: 'zh-CN' },
  console,
  // factory 内含 decode-named-character-reference（DOM 版）顶层 createElement
  document: {
    createElement: () => ({ innerHTML: '', textContent: '', getAttribute: () => null }),
    getElementById: () => null,
    head: { appendChild() {} },
  },
  fetch: async (url, opts) => {
    fetchLog.push({ url: String(url), method: opts?.method || 'GET' })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, checkpoint: { text: '', reference: null, rev: 1 } }),
    }
  },
  window: {
    __ModuleLoader__: {
      load: (entry) => {
        mod = entry.factory(hostRequire)
      },
    },
  },
}
function hostRequire(name) {
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') return jsxStub
  return {}
}
vm.runInNewContext(code, sandbox)

const project = 'E:/tmp/proj-r6'
ok('exports draft APIs', Boolean(mod?.resolveDraftConflict && mod?.retryDraftConflictRemote && mod?.subscribeDraftStatus))

// S03 failed remote — cannot adopt
mod.__draftConflict.set(project, {
  remoteStatus: 'failed',
  remoteRev: null,
  remoteText: '',
  remoteReference: null,
  localText: 'LOCAL',
  localReference: null,
})
const rejected = await mod.resolveDraftConflict(project, 'keep-remote', {})
ok('S03 keep-remote rejects failed remote', rejected?.error === 'remote-not-valid', rejected?.error)
ok('S03 conflict retained', mod.__draftConflict.has(project))

// S03 valid remote — adopt + S01 native draft
mod.__draftConflict.set(project, {
  remoteStatus: 'valid',
  remoteRev: 12,
  remoteText: 'REMOTE',
  remoteReference: { label: 'sel', text: 'r' },
  localText: 'LOCAL',
  localReference: null,
})
let nativeApplied = null
let localApplied = null
const applied = await mod.resolveDraftConflict(project, 'keep-remote', {
  setNativeDraft: (t) => {
    nativeApplied = t
  },
  setLocalDraft: (t) => {
    localApplied = t
  },
  setReference: () => {},
})
ok('S03 valid remote adopt ok', applied?.ok === true, JSON.stringify(applied))
ok('S01 native draft = remote', nativeApplied === 'REMOTE', String(nativeApplied))
ok('S01 local draft = remote', localApplied === 'REMOTE', String(localApplied))
ok('conflict cleared after adopt', !mod.__draftConflict.has(project))

// subscribe/status listener fires
let notified = 0
const unsub = mod.subscribeDraftStatus(() => {
  notified++
})
mod.__draftConflict.set(project, {
  remoteStatus: 'loading',
  remoteRev: null,
  remoteText: '',
  remoteReference: null,
  localText: 'X',
  localReference: null,
})
// no notify on set — retry will notify
const retry = await mod.retryDraftConflictRemote(project)
ok('retry draft remote runs', retry != null, JSON.stringify(retry))
ok('status subscribed at least once', notified >= 1, String(notified))
unsub()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
