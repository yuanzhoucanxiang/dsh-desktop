/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T, zh } from '../copy.js'
import { api } from '../services/writing-api.js'
import { harnessSessions } from '../adapters/harness/runtime.js'
import { appendCompanionDraft, ensureCompanionSession } from '../adapters/harness/sessions.js'
import { createEditorSession } from '../../shared/editor-session.js'
import { applyBodyAttr, setCloseGuard, commitModeActive, getModeActive, subscribeMode, setModeActive } from '../state/mode-store.js'
import { getPrefs, subscribePrefs, loadPrefs, savePrefs, versionOf } from '../state/prefs-store.js'
import { WritingCompanion } from '../features/companion/index.js'

const LS_FILE = 'dsh-writing-mode-file'

export function WritingModeApp() {
  const [active, setActive] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setActive(getModeActive())), [])
  const open = () => setModeActive(true)
  const close = () => setModeActive(false)
  const [roots, setRoots] = react.useState([])
  const [tree, setTree] = react.useState([])
  const [activeRoot, setActiveRoot] = react.useState(null)
  const editorRef = react.useRef(null)
  if (!editorRef.current) {
    let recovered = null
    let recoveryKey = 'dsh-writing-recovery'
    try {
      let id = sessionStorage.getItem('dsh-writing-window')
      if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('dsh-writing-window', id) }
      recoveryKey += ':' + id
      recovered = JSON.parse(localStorage.getItem(recoveryKey) || 'null')
      if (!recovered) {
        const last = localStorage.getItem(LS_FILE)
        const drafts = Object.keys(localStorage).filter(k => k.startsWith('dsh-writing-recovery:'))
          .map(k => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } })
          .filter(d => d?.path === last).sort((a, b) => b.updatedAt - a.updatedAt)
        recovered = drafts[0] || null
      }
    } catch {}
    const post = (route, body) => api(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    editorRef.current = createEditorSession({
      read: path => api('get', undefined, { path }),
      save: body => post('save', body),
      version: body => post('version', body),
      backup: draft => {
        if (draft) localStorage.setItem(recoveryKey, JSON.stringify({ ...draft, updatedAt: Date.now() }))
        else localStorage.removeItem(recoveryKey)
      },
    }, recovered)
  }
  const editor = editorRef.current
  const [documentState, setDocumentState] = react.useState(editor.get)
  react.useEffect(() => editor.subscribe(setDocumentState), [editor])
  const { path: filePath, content, dirty, status: saveState } = documentState
  const setContent = value => editor.change(value)
  const setFilePath = path => { void editor.open(path) }
  const [aiOpen, setAiOpen] = react.useState(true)
  const [aiTab, setAiTab] = react.useState('companion')
  const [aiOut, setAiOut] = react.useState('')
  const [aiBusy, setAiBusy] = react.useState(false)
  const [aiErr, setAiErr] = react.useState('')
  const [gate, setGate] = react.useState(null)
  const [gateBusy, setGateBusy] = react.useState(false)
  const [gateErr, setGateErr] = react.useState('')
  const [focus, setFocus] = react.useState(false)
  const [libOpen, setLibOpen] = react.useState(true)
  const [libQuery, setLibQuery] = react.useState('')
  const [collapsed, setCollapsed] = react.useState(() => new Set())
  const [copied, setCopied] = react.useState(false)
  const [diffLines, setDiffLines] = react.useState(null)
  const [diffLabel, setDiffLabel] = react.useState('')
  const [ledger, setLedger] = react.useState(null)
  const [gateOpen, setGateOpen] = react.useState(false)
  const [ledgerOpen, setLedgerOpen] = react.useState(false)
  const [newDocMode, setNewDocMode] = react.useState(false)
  const [newDocName, setNewDocName] = react.useState('')
  const [projMode, setProjMode] = react.useState(false)
  const [projTitle, setProjTitle] = react.useState('')
  const [projPremise, setProjPremise] = react.useState('')
  const [projTemplate, setProjTemplate] = react.useState('novel')
  const [templates, setTemplates] = react.useState([])
  const [addRootMode, setAddRootMode] = react.useState(false)
  const [addRootPath, setAddRootPath] = react.useState('')
  const [flash, setFlash] = react.useState('')
  const [prefs, setPrefs] = react.useState(getPrefs)
  react.useEffect(() => subscribePrefs(() => setPrefs({ ...getPrefs() })), [])
  react.useEffect(() => {
    void loadPrefs()
  }, [active])
  const taRef = react.useRef(null)
  const aiTarget = react.useRef(null)
  const saveTimer = react.useRef(0)
  const fileInputRef = react.useRef(null)
  const runGateRef = react.useRef(() => {})

  const docBasename = filePath
    ? String(filePath).split(/[\\/]/).filter(Boolean).pop()
    : ''
  const docFolder = filePath
    ? (() => {
        const parts = String(filePath).split(/[\\/]/).filter(Boolean)
        if (parts.length < 2) return ''
        return parts[parts.length - 2]
      })()
    : ''

  /** 同章版本系列（必须在任何 early-return 之前，遵守 Hooks 规则）。 */
  const versionSeries = react.useMemo(() => {
    if (!filePath) return []
    const curVer = versionOf(docBasename)
    if (curVer == null) return []
    const base = docBasename.replace(/-v\d+(\.[^.]+)?$/i, '')
    const ext = (docBasename.match(/\.[^.]+$/) || [''])[0]
    const out = []
    for (const root of tree) {
      for (const proj of root.projects || []) {
        for (const f of proj.files || []) {
          if (f.abs.replace(/[\\/][^\\/]+$/, '').toLowerCase() !== filePath.replace(/[\\/][^\\/]+$/, '').toLowerCase()) continue
          const n = f.name
          if (n.replace(/-v\d+(\.[^.]+)?$/i, '').toLowerCase() !== base.toLowerCase() || !n.toLowerCase().endsWith(ext.toLowerCase())) continue
          const v = versionOf(n)
          if (v == null) continue
          out.push({ v, abs: f.abs, name: n })
        }
      }
    }
    out.sort((a, b) => a.v - b.v)
    return out
  }, [filePath, docBasename, tree])

  const curVerNum = versionOf(docBasename)
  const latestVer =
    versionSeries.length > 0 ? versionSeries[versionSeries.length - 1] : null
  const isHistoryDoc =
    curVerNum != null && latestVer != null && curVerNum < latestVer.v

  react.useEffect(() => {
    applyBodyAttr(active)
  }, [active])

  react.useEffect(() => {
    try {
      if (focus) document.body.setAttribute('data-writing-focus', '1')
      else document.body.removeAttribute('data-writing-focus')
    } catch {}
  }, [focus])

  react.useEffect(() => {
    try {
      document.body.setAttribute('data-writing-lib', libOpen ? '1' : '0')
    } catch {}
  }, [libOpen])

  const refreshTree = react.useCallback(async () => {
    const data = await api('config')
    if (!data.ok) return
    setRoots(data.roots || [])
    setTree(data.tree || [])
    const active =
      (data.config && data.config.activeRoot) ||
      (data.roots || []).find((r) => r.default && !r.missing)?.path ||
      (data.roots || [])[0]?.path ||
      null
    setActiveRoot(active)
  }, [])

  react.useEffect(() => {
    if (!active) return
    void refreshTree()
  }, [active, refreshTree])

  react.useEffect(() => {
    if (!active || !harnessSessions()) return
    let running = new Set()
    const update = () => {
      const snapshot = harnessSessions().list.getSnapshot()
      const next = new Set(Object.values(snapshot.byId).filter(s => s.running).map(s => s.id))
      if (Array.from(running).some(id => !next.has(id))) {
        void refreshTree().catch(() => {})
        void editor.refresh()
      }
      running = next
    }
    update()
    return harnessSessions().list.subscribe(update)
  }, [active, editor, refreshTree])

  const persist = react.useCallback(() => editor.flush(), [editor])
  const saveAsNewVersion = () => editor.version()

  react.useEffect(() => {
    if (!active) return
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try { await editor.refresh() } finally { reading = false }
    }
    const timer = window.setInterval(refresh, 2000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [active, editor])

  react.useEffect(() => {
    if (!active || editor.get().path) return
    try { const p = localStorage.getItem(LS_FILE); if (p) void editor.open(p) } catch {}
  }, [active, editor])

  react.useEffect(() => {
    setCloseGuard(async () => { if (await editor.close()) commitModeActive(false) })
    const protect = e => {
      if (!editor.get().dirty && editor.get().status !== 'saving') return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => { setCloseGuard(null); window.removeEventListener('beforeunload', protect) }
  }, [editor])

  react.useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setGate(null); setGateErr(''); setLedger(null); setDiffLines(null)
    try { localStorage.setItem(LS_FILE, filePath) } catch {}
    void refreshTree().catch(err => flashMsg(err.message))
    void api('ledger', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    }).then(d => { if (!cancelled && d.ok) setLedger(d.ledger) }).catch(() => {})
    return () => { cancelled = true }
  }, [filePath, documentState.revision, refreshTree])

  react.useEffect(() => {
    if (!active || !dirty || !filePath || documentState.loading || documentState.status === 'error') return
    saveTimer.current = window.setTimeout(() => { void persist() }, prefs.autoSaveMs || 800)
    return () => window.clearTimeout(saveTimer.current)
  }, [active, dirty, filePath, content, documentState.loading, documentState.status, persist, prefs.autoSaveMs])

  react.useEffect(() => {
    if (!active) return
    const onKey = e => {
      if (e.key === 'Escape') {
        if (newDocMode || addRootMode) return
        close()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void editor.version()
        else void persist()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, newDocMode, addRootMode, editor, persist])

  function flashMsg(msg) {
    setFlash(String(msg || ''))
    window.setTimeout(() => setFlash(''), 3200)
  }

  async function addRootFromPrompt() {
    // Electron 下 window.prompt 常无反馈，改内联输入
    setAddRootMode(true)
    setAddRootPath('')
  }

  async function commitAddRoot() {
    const p = String(addRootPath || '').trim()
    if (!p) return
    const data = await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'add', path: p, active: true }),
    })
    setAddRootMode(false)
    setAddRootPath('')
    if (!data.ok) flashMsg('添加库失败：' + (data.error || 'unknown'))
    void refreshTree()
  }

  async function activateRoot(p) {
    setActiveRoot(p)
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'activate', path: p }),
    })
    void refreshTree()
  }

  function pickNativeFolder() {
    // webkitdirectory 在 Electron 不可靠：直接走内联路径输入
    setAddRootMode(true)
    setAddRootPath('')
  }

  function createDocInRoot() {
    const root =
      roots.find((r) => r.path === activeRoot && !r.missing) ||
      roots.find((r) => !r.missing)
    if (!root) {
      setAddRootMode(true)
      flashMsg('先添加一个库文件夹')
      return
    }
    setNewDocMode(true)
    setNewDocName(T.untitled)
  }

  function openProjectMode() {
    setProjMode(true)
    setProjTitle('')
    setProjPremise('')
    void api('templates')
      .then((d) => {
        if (d.ok) setTemplates(d.templates || [])
      })
      .catch(() => {})
  }

  async function commitProject() {
    const data = await api('create-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: projTitle,
        premise: projPremise,
        templateId: projTemplate,
      }),
    })
    setProjMode(false)
    if (!data.ok) {
      flashMsg(data.error === 'project-exists' ? '同名项目已存在' : '创建失败：' + (data.error || ''))
      return
    }
    flashMsg(T.created + '：' + (data.project?.name || ''))
    void refreshTree()
  }

  async function commitNewDoc() {
    const root = roots.find(r => r.path === activeRoot && !r.missing) || roots.find(r => !r.missing)
    if (!root) return
    const name = (newDocName || T.untitled).trim() || T.untitled
    if (await editor.create(root.path, name)) {
      setNewDocMode(false); setNewDocName('')
      taRef.current?.focus()
    }
  }

  function selectionText() {
    const ta = taRef.current
    if (!ta) return content.slice(0, 4000)
    const s = ta.selectionStart
    const e = ta.selectionEnd
    if (typeof s === 'number' && typeof e === 'number' && e > s) {
      return content.slice(s, e)
    }
    return content.slice(Math.max(0, (s || 0) - 400), (s || 0) + 1600) || content.slice(0, 2000)
  }

  async function runAssist(action) {
    const snapshot = editor.get()
    const selection = taRef.current ? { start: taRef.current.selectionStart, end: taRef.current.selectionEnd } : { start: 0, end: 0 }
    const isRec = action === 'research' || action === 'spark'
    const text = selectionText()
    if (!isRec && !text.trim()) {
      setAiErr(T.noText)
      flashMsg(T.noText)
      return
    }
    setAiBusy(true)
    setAiErr('')
    setAiOut('')
    try {
      const data = await api('assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          text: text || content.slice(0, 4000),
          path: filePath,
          style: action === 'spark' ? 'spark' : 'research',
        }),
      })
      if (data.ok) {
        if (editor.get().path !== snapshot.path || editor.get().edit !== snapshot.edit) {
          flashMsg('文稿已切换或修改，本次 AI 结果未应用。')
          return
        }
        aiTarget.current = { path: snapshot.path, edit: snapshot.edit, ...selection }
        setAiOut(data.result || '')
        return
      }
      if (data.error === 'llm-unavailable') {
        // 内核未挂 llm：给出可发送会话的提示，避免「点了没反应」
        const tip =
          T.aiUnavailable +
          '\n\n【可直接发送到会话】\n请作为写作助手，对下列文本做「' +
          (T[action] || action) +
          '」：\n\n' +
          (text || content).slice(0, 2000)
        setAiOut(tip)
        setAiErr(T.aiUnavailable)
        flashMsg(T.aiUnavailable)
        return
      }
      setAiErr(String(data.error || 'failed'))
      flashMsg(String(data.error || 'failed'))
    } catch (err) {
      const m = String(err && err.message ? err.message : err)
      setAiErr(m)
      flashMsg(m)
    } finally {
      setAiBusy(false)
    }
  }

  const runGate = react.useCallback(async () => {
    setGateBusy(true)
    setGateErr('')
    try {
      const data = await api('gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      })
      if (data.ok && data.gate) {
        setGate(data.gate)
        if (data.gate.kind === 'none') setGateErr(T.gatesNone)
      } else {
        setGateErr(String(data.error || 'failed'))
      }
    } catch (err) {
      setGateErr(String(err && err.message ? err.message : err))
    } finally {
      setGateBusy(false)
    }
  }, [filePath, content])
  runGateRef.current = runGate

  // 打开文件后自动跑一次门禁
  react.useEffect(() => {
    if (!active || !filePath || !prefs.autoGate) return
    const ext = String(filePath).toLowerCase().split('.').pop()
    if (ext !== 'md' && ext !== 'markdown' && ext !== 'fountain') return
    void runGate()
  }, [active, filePath, documentState.revision, prefs.autoGate])

  function applyInsert() {
    if (!aiOut) return
    if (isHistoryDoc || !aiTarget.current || aiTarget.current.path !== filePath || aiTarget.current.edit !== editor.get().edit) {
      flashMsg('文稿已变化或为历史稿，请重新生成；历史稿请先另存新版。')
      return
    }
    setContent((c) => (c.endsWith('\n') ? c : c + '\n') + '\n' + aiOut + '\n')
  }

  function applyReplace() {
    if (!aiOut) return
    const target = aiTarget.current
    if (isHistoryDoc || !target || target.path !== filePath || target.edit !== editor.get().edit) {
      flashMsg('文稿已变化，请重新选择并生成。')
      return
    }
    const s = target.start
    const e = target.end
    if (typeof s === 'number' && typeof e === 'number' && e > s) {
      setContent(content.slice(0, s) + aiOut + content.slice(e))
    } else {
      flashMsg('生成前没有选区，请使用“插入文末”。')
    }
  }

  async function copyPath() {
    if (!filePath) return
    try {
      await navigator.clipboard.writeText(filePath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  if (!active) {
    // 浮动入口由 ensureDomFloat 常驻注入；overlay 空闲时不重复渲染
    // 注意：此 return 必须位于**全部 hooks 之后**
    return null
  }

  const activeTree = tree.find((r) => {
    if (!activeRoot) return false
    return String(r.path).toLowerCase() === String(activeRoot).toLowerCase()
  }) || tree.find((r) => r.active) || tree[0]

  const projects = activeTree ? activeTree.projects || [] : []

  /** 把 rel 路径按顶层目录分组；q 非空时按文件名/路径过滤。 */
  function groupFiles(files, q) {
    const query = String(q || '').trim().toLowerCase()
    const map = new Map()
    for (const f of files || []) {
      if (query) {
        const hay = (f.name + ' ' + f.rel).toLowerCase()
        if (!hay.includes(query)) continue
      }
      const top = String(f.rel || '').includes('/')
        ? String(f.rel).split('/')[0]
        : '·'
      if (!map.has(top)) map.set(top, [])
      map.get(top).push(f)
    }
    const order = ['draft', 'bible', 'outline', 'state', 'reviews', '·']
    const keys = [...map.keys()].sort((a, b) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'zh')
    })
    return keys.map((k) => ({ key: k, files: map.get(k) }))
  }

  function maxVersionInGroup(files) {
    const max = new Map()
    for (const f of files || []) {
      const v = versionOf(f.name)
      const key = f.abs.replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()
      if (v != null) max.set(key, Math.max(max.get(key) || 0, v))
    }
    return max
  }

  function toggleProj(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 文件行（带版本徽标）
  function fileButton(f, maxVer) {
    const ver = versionOf(f.name)
    const latest = maxVer instanceof Map ? maxVer.get(f.abs.replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()) : 0
    const isHist = ver != null && ver < latest
    return jsx.jsx(
      'button',
      {
        type: 'button',
        className: 'dshWmItem' + (filePath && f.abs === filePath ? ' is-on' : ''),
        onClick: () => setFilePath(f.abs),
        title: f.rel,
        children: [
          jsx.jsx(
            'div',
            {
              className: 'dshWmItemRow',
              children: [
                jsx.jsx(
                  'span',
                  {
                    className: 'dshWmItemTitle',
                    style: { flex: 1, minWidth: 0 },
                    children: f.name.replace(/-v\d+(\.[^.]+)?$/i, '$1'),
                  },
                  't'
                ),
                ver != null
                  ? jsx.jsx(
                      'span',
                      {
                        className: 'dshWmVer' + (isHist ? ' is-hist' : ''),
                        children: 'v' + ver,
                      },
                      'v'
                    )
                  : null,
              ],
            },
            'row'
          ),
          jsx.jsx(
            'span',
            { className: 'dshWmItemMeta', children: f.chars + T.chars },
            'm'
          ),
        ],
      },
      f.abs
    )
  }

  /** 极简行 diff：前后缀对齐，中间段整段 del/add（章稿对比够用）。 */
  function lineDiff(oldText, newText) {
    const a = String(oldText || '').split(/\r?\n/)
    const b = String(newText || '').split(/\r?\n/)
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let s = 0
    while (
      s < a.length - p &&
      s < b.length - p &&
      a[a.length - 1 - s] === b[b.length - 1 - s]
    ) {
      s++
    }
    const out = []
    const ctx = 2
    for (const line of a.slice(Math.max(0, p - ctx), p)) out.push({ t: 'ctx', line })
    for (const line of a.slice(p, a.length - s)) out.push({ t: 'del', line })
    for (const line of b.slice(p, b.length - s)) out.push({ t: 'add', line })
    for (const line of a.slice(a.length - s, a.length - s + Math.min(s, ctx))) {
      out.push({ t: 'ctx', line })
    }
    return out
  }

  async function comparePrev() {
    if (curVerNum == null || versionSeries.length < 2) return
    const idx = versionSeries.findIndex((s) => s.abs === filePath)
    const prev = versionSeries[idx - 1]
    if (!prev) return
    const a = await api('get', undefined, { path: prev.abs })
    const b = await api('get', undefined, { path: filePath })
    if (!a.ok || !b.ok) return
    setDiffLines(lineDiff(a.doc.content, b.doc.content))
    setDiffLabel(`v${prev.v} → v${curVerNum}`)
  }

  const isReviewFile = /(^|[\\/])reviews[\\/]/i.test(String(filePath || ''))

  async function fillComposer(prompt) {
    const source = editor.get().path
    try {
      const next = await ensureCompanionSession(harnessSessions(), source || activeRoot, () => editor.get().path === source && getModeActive())
      if (!next) return false
      appendCompanionDraft(harnessSessions(), next.sessionId, prompt)
      setAiOpen(true); setAiTab('companion'); setFocus(false)
      flashMsg('已追加到写作伙伴输入框，补充想法后发送')
      return true
    } catch (err) { flashMsg(err.message); setAiErr(err.message); return false }
  }
  async function sendToChat() {
    const payload = aiOut || selectionText()
    const prompt = payload
      ? `请作为写作助手处理下面的文稿：\n\n${payload}`
      : `请作为写作助手，帮我完善当前文稿。`
    await fillComposer(prompt)
  }

  async function sendReviewToChat() {
    const prompt =
      '请作为写作主理，严格按下列评审报告修订对应文稿（只改 draft/bible/outline/state，报告本身不要改）。\n' +
      '先读报告与 draft 当前版本，再输出修改计划并执行；完成后把新版本号写入 project.md。\n\n' +
      '=== 评审报告 ===\n' +
      content +
      '\n\n=== 报告路径 ===\n' +
      filePath +
      '\n'
    await fillComposer(prompt)
  }

  const notice = documentState.error || flash
  return jsx.jsx('div', {
    className: 'dshWmRoot',
    role: 'dialog',
    'aria-label': T.toggle,
    children: [
      notice
        ? jsx.jsx('div', { className: 'dshWmFlash', role: 'alert', children: notice }, 'flash')
        : null,
      jsx.jsx(
        'div',
        {
          className: 'dshWmBar',
          children: [
            jsx.jsx('span', { className: 'dshWmBrand', children: '写作台' }),
            roots.length > 0
              ? jsx.jsx(
                  'select',
                  {
                    className: 'dshWmSelect',
                    value: activeRoot || '',
                    onChange: (e) => void activateRoot(e.target.value),
                    title: T.switchRoot,
                    children: roots.map((r) =>
                      jsx.jsx(
                        'option',
                        {
                          value: r.path,
                          children: (r.missing ? '⚠ ' : '') + (r.label || r.path),
                        },
                        r.path
                      )
                    ),
                  },
                  'roots'
                )
              : null,
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-ghost',
              onClick: () => setAddRootMode(true),
              title: T.addRoot,
              children: '+',
            }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-ghost',
              onClick: () => setAddRootMode(true),
              children: '…',
              title: T.addRoot,
            }),
            addRootMode
              ? jsx.jsx(
                  'span',
                  {
                    className: 'dshWmBarGroup',
                    children: [
                      jsx.jsx('input', {
                        className: 'dshWmSearch',
                        style: { width: 180, margin: 0 },
                        value: addRootPath,
                        placeholder: 'E:\\剧本',
                        autoFocus: true,
                        onChange: (e) => setAddRootPath(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') void commitAddRoot()
                          if (e.key === 'Escape') setAddRootMode(false)
                        },
                      }),
                      jsx.jsx('button', {
                        type: 'button',
                        className: 'dshWmBtn is-primary',
                        onClick: () => void commitAddRoot(),
                        children: 'OK',
                      }),
                    ],
                  },
                  'add-root'
                )
              : null,
            jsx.jsx('span', { className: 'dshWmBarSpacer' }),
            jsx.jsx(
              'div',
              {
                className: 'dshWmBarGroup',
                children: [
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn is-ghost',
                    onClick: () => setLibOpen((v) => !v),
                    title: libOpen ? T.hideLib : T.showLib,
                    children: libOpen ? '⟨' : '⟩',
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn' + (focus ? ' is-on' : ''),
                    onClick: () => setFocus((v) => !v),
                    children: T.focus,
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn' + (aiOpen ? ' is-on' : ''),
                    onClick: () => setAiOpen((v) => !v),
                    children: aiOpen ? T.closeAi : T.openAi,
                  }),
                ],
              },
              'views'
            ),
            jsx.jsx('span', { className: 'dshWmBarGroup', children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                disabled: !filePath,
                onClick: () => void persist(),
                children: saveState === 'saving' ? T.saving : saveState === 'saved' ? T.saved : T.save,
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                disabled: !filePath,
                title: T.bumpHint || T.saveAsNew,
                onClick: () => void saveAsNewVersion(),
                children: 'v+1',
              }),
            ]}, 'file-ops'),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-primary',
              onClick: close,
              children: T.exit,
            }),
          ],
        },
        'bar'
      ),
      jsx.jsx(
        'div',
        {
          className: 'dshWmBody',
          children: [
            jsx.jsx(
              'aside',
              {
                className: 'dshWmSide',
                children: [
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmSideHead',
                      children: [
                        jsx.jsx('span', { children: T.docs }),
                        jsx.jsx('span', { style: { flex: 1 } }),
                        jsx.jsx('button', {
                          type: 'button',
                          className: 'dshWmBtn',
                          onClick: openProjectMode,
                          children: T.newProject,
                        }),
                        jsx.jsx('button', {
                          type: 'button',
                          className: 'dshWmBtn',
                          onClick: createDocInRoot,
                          children: T.newDoc,
                        }),
                      ],
                    },
                    'dh'
                  ),
                  projMode
                    ? jsx.jsx(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            padding: '0 10px 10px',
                          },
                          children: [
                            jsx.jsx('input', {
                              className: 'dshWmSearch',
                              style: { margin: 0 },
                              value: projTitle,
                              autoFocus: true,
                              placeholder: T.projTitle,
                              onChange: (e) => setProjTitle(e.target.value),
                            }),
                            jsx.jsx('input', {
                              className: 'dshWmSearch',
                              style: { margin: 0 },
                              value: projPremise,
                              placeholder: T.projPremise,
                              onChange: (e) => setProjPremise(e.target.value),
                            }),
                            jsx.jsx(
                              'select',
                              {
                                className: 'dshWmSearch',
                                style: { margin: 0 },
                                value: projTemplate,
                                onChange: (e) => setProjTemplate(e.target.value),
                                children: (templates.length
                                  ? templates
                                  : [
                                      { id: 'novel', name: '小说 · 长篇连载' },
                                      { id: 'shortdrama', name: '短剧 · 竖屏' },
                                      { id: 'screenplay', name: '电影 / 剧集' },
                                    ]
                                ).map((t) =>
                                  jsx.jsx(
                                    'option',
                                    { value: t.id, children: t.name },
                                    t.id
                                  )
                                ),
                              },
                              'tmpl'
                            ),
                            jsx.jsx(
                              'div',
                              {
                                style: { display: 'flex', gap: 6 },
                                children: [
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-primary',
                                    onClick: () => void commitProject(),
                                    children: T.create,
                                  }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    onClick: () => setProjMode(false),
                                    children: T.cancel,
                                  }),
                                ],
                              },
                              'pb'
                            ),
                          ],
                        },
                        'proj'
                      )
                    : null,
                  newDocMode
                    ? jsx.jsx(
                        'div',
                        {
                          style: { display: 'flex', gap: 6, padding: '0 10px 8px' },
                          children: [
                            jsx.jsx('input', {
                              className: 'dshWmSearch',
                              style: { margin: 0, flex: 1 },
                              value: newDocName,
                              autoFocus: true,
                              placeholder: T.untitled,
                              onChange: (e) => setNewDocName(e.target.value),
                              onKeyDown: (e) => {
                                if (e.key === 'Enter') commitNewDoc()
                                if (e.key === 'Escape') setNewDocMode(false)
                              },
                            }),
                            jsx.jsx('button', {
                              type: 'button',
                              className: 'dshWmBtn is-primary',
                              onClick: commitNewDoc,
                              children: 'OK',
                            }),
                          ],
                        },
                        'new-doc'
                      )
                    : null,
                  roots.length > 0
                    ? jsx.jsx(
                        'div',
                        {
                          style: { padding: '8px 8px 0' },
                          children: jsx.jsx('input', {
                            className: 'dshWmSearch',
                            value: libQuery,
                            placeholder: T.search,
                            onChange: (e) => setLibQuery(e.target.value),
                          }),
                        },
                        'sq'
                      )
                    : null,
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmList',
                      children:
                        roots.length === 0
                          ? jsx.jsx(
                              'div',
                              {
                                className: 'dshWmWelcome',
                                children: [
                                  jsx.jsx(
                                    'div',
                                    { className: 'dshWmWelcomeTitle', children: T.toggle },
                                    'wt'
                                  ),
                                  jsx.jsx(
                                    'div',
                                    { className: 'dshWmWelcomeBody', children: T.empty },
                                    'wb'
                                  ),
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmBtn is-primary',
                                      onClick: () => {
                                        setAddRootMode(true)
                                        setAddRootPath('E:\\剧本')
                                      },
                                      children: T.emptyCta,
                                    },
                                    'wc'
                                  ),
                                  jsx.jsx(
                                    'div',
                                    {
                                      className: 'dshWmAiHint',
                                      children: 'Esc · Ctrl+S · Ctrl+Shift+S',
                                    },
                                    'wk'
                                  ),
                                ],
                              },
                              'wel'
                            )
                          : projects.length === 0
                            ? jsx.jsx('div', {
                                className: 'dshWmEmpty',
                                children: (activeTree && activeTree.missing ? T.missing + '\n' : '') + T.noProjects,
                              })
                            : projects.map((proj) => {
                                const groups = groupFiles(proj.files, libQuery)
                                const openP = !collapsed.has(proj.path)
                                const maxDraft = maxVersionInGroup(
                                  (proj.files || []).filter((f) => String(f.rel).startsWith('draft/'))
                                )
                                if (libQuery && groups.length === 0) return null
                                return jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmProj',
                                    children: [
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'dshWmProjToggle',
                                          onClick: () => toggleProj(proj.path),
                                          children: [
                                            jsx.jsx(
                                              'span',
                                              {
                                                className:
                                                  'dshWmProjChev' + (openP ? ' is-open' : ''),
                                                children: '▸',
                                              },
                                              'c'
                                            ),
                                            jsx.jsx('span', { children: proj.name }, 'n'),
                                          ],
                                        },
                                        'pt'
                                      ),
                                      openP
                                        ? groups.map((g) =>
                                            jsx.jsx(
                                              react.Fragment,
                                              {
                                                children: [
                                                  jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmFolder',
                                                      children: g.key === '·' ? 'ROOT' : g.key,
                                                    },
                                                    'fh'
                                                  ),
                                                  ...g.files.map((f) =>
                                                    fileButton(
                                                      f,
                                                      g.key === 'draft' || String(f.rel).includes('/draft/')
                                                        ? maxDraft
                                                        : 0
                                                    )
                                                  ),
                                                ],
                                              },
                                              'g-' + g.key
                                            )
                                          )
                                        : null,
                                    ],
                                  },
                                  proj.path
                                )
                              }),
                    },
                    'dl'
                  ),
                ],
              },
              'docs'
            ),
            jsx.jsx(
              'main',
              {
                className: 'dshWmMain',
                children: [
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmDocChrome',
                      children: [
                        jsx.jsx(
                          'div',
                          {
                            className: 'dshWmPathRow',
                            children: [
                              jsx.jsx('span', {
                                className: 'dshWmPathText',
                                children: filePath ? (docFolder ? docFolder + ' / ' : '') + docBasename : '—',
                              }),
                              filePath
                                ? jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-ghost',
                                    onClick: () => void copyPath(),
                                    children: copied ? T.copied : T.copyPath,
                                  })
                                : null,
                              isReviewFile
                                ? jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    onClick: sendReviewToChat,
                                    children: T.reviewFix,
                                  })
                                : null,
                            ],
                          },
                          'pr'
                        ),
                        jsx.jsx(
                          'div',
                          {
                            className: 'dshWmDocName',
                            children:
                              (docBasename || T.untitled).replace(/-v\d+(\.[^.]+)?$/i, '$1') +
                              (curVerNum != null ? '  v' + curVerNum : ''),
                          },
                          'dn'
                        ),
                        isHistoryDoc && latestVer
                          ? jsx.jsx(
                              'div',
                              {
                                className: 'dshWmHistBanner',
                                children: [
                                  jsx.jsx('span', {
                                    children: T.isHistory + ' · ' + T.isLatest + ' v' + latestVer.v,
                                  }, 'h'),
                                  jsx.jsx('span', { style: { flex: 1 } }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    onClick: () => setFilePath(latestVer.abs),
                                    children: T.openLatest,
                                  }),
                                ],
                              },
                              'hb'
                            )
                          : null,
                        versionSeries.length > 1
                          ? jsx.jsx(
                              'div',
                              {
                                className: 'dshWmVerBar',
                                children: [
                                  jsx.jsx(
                                    'span',
                                    { className: 'dshWmVerBarLabel', children: T.versions },
                                    'vl'
                                  ),
                                  ...versionSeries.map((s) =>
                                    jsx.jsx(
                                      'button',
                                      {
                                        type: 'button',
                                        className:
                                          'dshWmVerChip' +
                                          (s.abs === filePath ? ' is-on' : ''),
                                        onClick: () => setFilePath(s.abs),
                                        children: 'v' + s.v,
                                      },
                                      'v' + s.v
                                    )
                                  ),
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmBtn is-ghost',
                                      disabled: curVerNum == null || versionSeries.length < 2,
                                      onClick: () => void comparePrev(),
                                      children: T.comparePrev,
                                    },
                                    'cmp'
                                  ),
                                ],
                              },
                              'vb'
                            )
                          : null,
                        jsx.jsx('div', { className: 'dshWmDocRule' }, 'dr'),
                      ],
                    },
                    'chrome'
                  ),
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmEditorWrap',
                      children: jsx.jsx('textarea', {
                        ref: taRef,
                        className: 'dshWmEditor',
                        value: content,
                        spellCheck: false,
                        readOnly: documentState.loading || isHistoryDoc,
                        placeholder: filePath ? '开始写…' : '# …',
                        onChange: (e) => {
                          setContent(e.target.value)
                        },
                      }),
                    },
                    'ew'
                  ),
                  diffLines
                    ? jsx.jsx(
                        'div',
                        {
                          className: 'dshWmDiff',
                          children: [
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmDiffHead',
                                children: [
                                  jsx.jsx('span', {
                                    children: T.diffTitle + ' ' + diffLabel,
                                  }),
                                  jsx.jsx('span', { style: { flex: 1 } }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-ghost',
                                    onClick: () => setDiffLines(null),
                                    children: T.closeDiff,
                                  }),
                                ],
                              },
                              'dh'
                            ),
                            ...diffLines.map((d, i) =>
                              jsx.jsx(
                                'div',
                                {
                                  className: 'dshWmDiffLine ' + d.t,
                                  children: (d.t === 'add' ? '+ ' : d.t === 'del' ? '- ' : '  ') + d.line,
                                },
                                'L' + i
                              )
                            ),
                          ],
                        },
                        'diff'
                      )
                    : null,
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmStatus',
                      children: [
                        jsx.jsx('span', {
                          className:
                            'dot ' + (dirty ? 'is-dirty' : saveState === 'saved' ? 'is-saved' : ''),
                        }),
                        jsx.jsx('span', {
                          children: dirty ? T.unsaved : saveState === 'saved' ? T.saved : '—',
                        }),
                        jsx.jsx('span', { className: 'dshWmStatusSep', children: '·' }),
                        jsx.jsx('span', {
                          children: `${content.replace(/\s+/g, '').length} ${T.chars}`,
                        }),
                        jsx.jsx('span', {
                          className: 'dshWmStatusSep',
                          children: '·',
                        }),
                        jsx.jsx('span', {
                          children: (filePath || '').toLowerCase().endsWith('.fountain')
                            ? 'Fountain'
                            : 'Markdown',
                        }),
                        gate
                          ? jsx.jsx('span', {
                              className: 'dshWmStatusSep',
                              children: '·',
                            })
                          : null,
                        gate
                          ? jsx.jsx('span', {
                              style: {
                                color: gate.pass
                                  ? 'var(--dsw-alias-state-success-primary)'
                                  : 'var(--dsw-alias-state-error-primary)',
                                fontWeight: 600,
                              },
                              children: gate.pass
                                ? T.gateShort + ' ✓'
                                : T.gateShort + ' ' + gate.fail,
                            })
                          : null,
                      ],
                    },
                    'st'
                  ),
                ],
              },
              'main'
            ),
            aiOpen
              ? jsx.jsx(
                  'aside',
                  {
                    className: 'dshWmSide is-ai',
                    children: [
                      jsx.jsxs('div', { className: 'dshWmSideHead', children: [
                        jsx.jsx('button', { className: 'dshWmTab' + (aiTab === 'companion' ? ' is-on' : ''), onClick: () => setAiTab('companion'), children: T.ai }),
                        jsx.jsx('button', { className: 'dshWmTab' + (aiTab === 'tools' ? ' is-on' : ''), onClick: () => setAiTab('tools'), children: '文字工具' }),
                      ] }, 'ah'),
                      aiTab === 'companion' && !focus ? jsx.jsx(WritingCompanion, {
                        path: filePath || activeRoot,
                        contextText: () => {
                          const selected = taRef.current && taRef.current.selectionEnd > taRef.current.selectionStart
                          const text = selected ? content.slice(taRef.current.selectionStart, taRef.current.selectionEnd) : content
                          return { label: (selected ? '选区 · ' : '稿件 · ') + (filePath || '未命名').split(/[\\/]/).pop() + ' · ' + text.length + ' 字', text: '当前文件：' + (filePath || '未命名') + '\n以下是' + (selected ? '选中的片段' : '编辑器中的稿件快照') + '（可能尚未保存），请以我随后补充的想法为准：\n\n' + text }
                        },
                        onExit: close,
                      }, 'companion') : null,
                      aiTab === 'tools' ? jsx.jsx(
                        'div',
                        {
                          className: 'dshWmAiBody',
                          children: [
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiSection', children: [
                                jsx.jsx('div', { className: 'dshWmAiSectionTitle', children: 'AI' }, 'at'),
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmAiActions',
                                    children: ['polish', 'continue', 'outline', 'compress', 'expand', 'research', 'spark'].map((a) =>
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className:
                                            'dshWmBtn' +
                                            (a === 'research' || a === 'spark' ? ' is-on' : ''),
                                          disabled: aiBusy,
                                          onClick: () => void runAssist(a),
                                          children: T[a] || a,
                                        },
                                        a
                                      )
                                    ),
                                  },
                                  'acts'
                                ),
                              ]},
                              'sec-ai'
                            ),
                            aiBusy
                              ? jsx.jsx('div', { className: 'dshWmAiHint', children: T.applying })
                              : null,
                            aiErr
                              ? jsx.jsx('div', { className: 'dshWmAiHint', children: aiErr })
                              : null,
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiMain', children: [
                                jsx.jsx('div', { className: 'dshWmAiOut', children: aiOut || ' ' }, 'out'),
                              ]},
                              'aim'
                            ),
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmAiActions',
                                children: [
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    disabled: !aiOut,
                                    onClick: applyInsert,
                                    children: T.insert,
                                  }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    disabled: !aiOut,
                                    onClick: applyReplace,
                                    children: T.replaceSel,
                                  }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-primary',
                                    onClick: sendToChat,
                                    children: T.sendChat,
                                  }),
                                ],
                              },
                              'apply'
                            ),
                            /* ── 门禁：默认收起，只露一行摘要 ── */
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmSec',
                                children: [
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmSecToggle',
                                      onClick: () => setGateOpen((v) => !v),
                                      children: [
                                        jsx.jsx('span', {
                                          children: (gateOpen ? '▾ ' : '▸ ') + T.gates,
                                        }, 't'),
                                        jsx.jsx('span', {
                                          className:
                                            'dshWmSecBadge' +
                                            (gate
                                              ? gate.pass
                                                ? ' is-pass'
                                                : ' is-fail'
                                              : ''),
                                          children: gateBusy
                                            ? T.applying
                                            : gate
                                              ? gate.pass
                                                ? T.gatesPass
                                                : T.gatesFail.replace('{n}', String(gate.fail))
                                              : '—',
                                        }, 'b'),
                                      ],
                                    },
                                    'gt'
                                  ),
                                  gateOpen
                                    ? jsx.jsx(
                                        'div',
                                        {
                                          className: 'dshWmSec',
                                          children: [
                                            jsx.jsx(
                                              'div',
                                              {
                                                className: 'dshWmAiActions',
                                                children: [
                                                  jsx.jsx('button', {
                                                    type: 'button',
                                                    className: 'dshWmBtn',
                                                    disabled: gateBusy || !filePath,
                                                    onClick: () => void runGate(),
                                                    children: gateBusy ? T.applying : T.runGates,
                                                  }),
                                                ],
                                              },
                                              'gb'
                                            ),
                                            gateErr
                                              ? jsx.jsx('div', {
                                                  className: 'dshWmAiHint',
                                                  children: gateErr,
                                                }, 'ge')
                                              : null,
                                            !gate && !gateErr
                                              ? jsx.jsx('div', {
                                                  className: 'dshWmAiHint',
                                                  children: T.gatesIdle,
                                                }, 'gi')
                                              : null,
                                            gate && gate.rows
                                              ? jsx.jsx(
                                                  'div',
                                                  {
                                                    className: 'dshWmGateList',
                                                    children: gate.rows.map((r, i) =>
                                                      jsx.jsx(
                                                        'div',
                                                        {
                                                          className: 'dshWmGateRow',
                                                          children: [
                                                            jsx.jsx('span', {
                                                              className: r.ok ? 'ok' : 'bad',
                                                              children: r.ok ? 'PASS' : 'FAIL',
                                                            }),
                                                            jsx.jsx('span', {
                                                              className: 'dshWmGateLabel',
                                                              children: r.label,
                                                            }),
                                                            jsx.jsx('span', {
                                                              className: 'dshWmGateDetail',
                                                              children: r.detail,
                                                            }),
                                                          ],
                                                        },
                                                        'r' + i
                                                      )
                                                    ),
                                                  },
                                                  'gl'
                                                )
                                              : null,
                                          ],
                                        },
                                        'gb2'
                                      )
                                    : null,
                                ],
                              },
                              'gh'
                            ),
                            /* ── 台账：默认收起 ── */
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmSec',
                                children: [
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmSecToggle',
                                      onClick: () => setLedgerOpen((v) => !v),
                                      children: [
                                        jsx.jsx('span', {
                                          children: (ledgerOpen ? '▾ ' : '▸ ') + T.ledger,
                                        }, 't'),
                                        jsx.jsx('span', {
                                          className: 'dshWmSecBadge',
                                          children: ledger
                                            ? (ledger.foreshadowOpen != null
                                                ? ledger.foreshadowOpen + ' · '
                                                : '') + (ledger.latestReview || '—').slice(0, 18)
                                            : '—',
                                        }, 'b'),
                                      ],
                                    },
                                    'lt'
                                  ),
                                  ledgerOpen
                                    ? ledger
                                      ? jsx.jsx(
                                          'div',
                                          {
                                            className: 'dshWmLedger',
                                            children: [
                                              jsx.jsx(
                                                'div',
                                                {
                                                  className: 'dshWmLedgerRow',
                                                  children: [
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerK',
                                                      children: T.ledgerHook,
                                                    }),
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerV',
                                                      children: ledger.hook || '—',
                                                    }),
                                                  ],
                                                },
                                                'lh'
                                              ),
                                              jsx.jsx(
                                                'div',
                                                {
                                                  className: 'dshWmLedgerRow',
                                                  children: [
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerK',
                                                      children: T.ledgerFores,
                                                    }),
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerV',
                                                      children:
                                                        ledger.foreshadowOpen == null
                                                          ? '—'
                                                          : String(ledger.foreshadowOpen),
                                                    }),
                                                  ],
                                                },
                                                'lf'
                                              ),
                                              jsx.jsx(
                                                'div',
                                                {
                                                  className: 'dshWmLedgerRow',
                                                  children: [
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerK',
                                                      children: T.ledgerReview,
                                                    }),
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerV',
                                                      children: ledger.latestReview || '—',
                                                    }),
                                                  ],
                                                },
                                                'lr'
                                              ),
                                              ledger.timeline && ledger.timeline.length
                                                ? jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmLedgerRow',
                                                      children: [
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerK',
                                                          children: T.ledgerTimeline,
                                                        }),
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerV',
                                                          children:
                                                            ledger.timeline[
                                                              ledger.timeline.length - 1
                                                            ],
                                                        }),
                                                      ],
                                                    },
                                                    'lts'
                                                  )
                                                : null,
                                            ],
                                          },
                                          'lb'
                                        )
                                      : jsx.jsx(
                                          'div',
                                          {
                                            className: 'dshWmAiHint',
                                            children: T.ledgerNone,
                                          },
                                          'ln'
                                        )
                                    : null,
                                ],
                              },
                              'lsec'
                            ),
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiHint', children: 'Esc · Ctrl+S · Ctrl+Shift+W' },
                              'kbd'
                            ),
                          ],
                        },
                        'ab'
                      ) : null,
                    ],
                  },
                  'ai'
                )
              : null,
          ],
        },
        'body'
      ),
    ],
  })
}
