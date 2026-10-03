/**
 * 写作台外壳（overlay 根组件）。
 * P1 从 entry.js 搬迁；P1-② 把顶栏 / 状态条 / 左栏 / 稿纸页头 / 查找栏 / 版本对比与改稿预览
 * 拆成 app/ 与 features/ 下的纯 props 子组件——**全部 hooks、editor session 编排、快捷键与
 * 自动保存 effect、assist/gate/ledger/stats 取数、覆盖层状态、右栏三区与 flashMsg 仍在本文件**。
 * 行为保持：DOM、类名、data-*、key 与事件语义逐字不变。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../copy.js'
import { TopBar } from './TopBar.js'
import { StatusBar } from './StatusBar.js'
import { api } from '../services/writing-api.js'
import { harnessSessions } from '../adapters/harness/runtime.js'
import { harnessAdapter } from '../adapters/harness/runtime.js'
import { newOperationToken } from '../adapters/harness/adapter.js'
import { createEditorSession } from '../../shared/editor-session.js'
import { versionOf, stemOf, basenameOf, folderOf } from '../../shared/filename.js'
import { applyBodyAttr, setCloseGuard, commitModeActive, getModeActive, subscribeMode, setModeActive } from '../state/mode-store.js'
import { getPrefs, subscribePrefs, loadPrefs, savePrefs } from '../state/prefs-store.js'
import { getLibrary, subscribeLibrary, refreshLibrary } from '../state/library-store.js'
import { groupFiles, navigationGroups, maxVersionInGroup, resourceChoices } from '../features/library/grouping.js'
import { LibraryPane } from '../features/library/LibraryPane.js'
import { lineDiff } from '../features/editor/diff.js'
import { EditorChrome } from '../features/editor/EditorChrome.js'
import { FindBar } from '../features/editor/FindBar.js'
import { DiffPanel, RewritePanel } from '../features/editor/DiffPanel.js'
import { selectionText } from '../features/tools/selection.js'
import { assistantPrompt, reviewPrompt } from '../features/tools/prompts.js'
import { makeReference, referenceStatus } from '../../shared/reference.js'
import { WritingCompanion } from '../features/companion/index.js'
import { resolveFileByName } from '../features/companion/jump.js'
import { ExportBookPanel } from '../features/export-book/index.js'
import { ProjectArchivePanel } from '../features/archive/index.js'
import { InspectionPanel } from '../features/inspection/index.js'

const LS_FILE = 'dsh-writing-mode-file'
// 两处快捷键提示此前一处写 Ctrl+Shift+S、另一处写 Ctrl+Shift+W，作者照着按发现都不对。
const KEY_HINT = 'Esc 退出 · Ctrl+S 保存 · Ctrl+Shift+S 另存新版 · Ctrl+Shift+W 开关写作台'

export function WritingModeApp() {
  const [active, setActive] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setActive(getModeActive())), [])
  const open = () => setModeActive(true)
  const close = () => setModeActive(false)
  const [roots, setRoots] = react.useState(() => getLibrary().roots)
  const [tree, setTree] = react.useState(() => getLibrary().tree)
  const [activeRoot, setActiveRoot] = react.useState(() => getLibrary().activeRoot)
  react.useEffect(() => subscribeLibrary(() => {
    const lib = getLibrary()
    setRoots(lib.roots)
    setTree(lib.tree)
    setActiveRoot(lib.activeRoot)
  }), [])
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
  const [libraryView, setLibraryView] = react.useState('writing')
  const [collapsed, setCollapsed] = react.useState(() => new Set())
  const [copied, setCopied] = react.useState(false)
  const [diffLines, setDiffLines] = react.useState(null)
  const [diffLabel, setDiffLabel] = react.useState('')
  const [ledger, setLedger] = react.useState(null)
  const [gateOpen, setGateOpen] = react.useState(false)
  const [ledgerOpen, setLedgerOpen] = react.useState(false)
  const [statsOpen, setStatsOpen] = react.useState(false)
  const [newDocMode, setNewDocMode] = react.useState(false)
  const [newDocName, setNewDocName] = react.useState('')
  const [projMode, setProjMode] = react.useState(false)
  const [projTitle, setProjTitle] = react.useState('')
  const [projPremise, setProjPremise] = react.useState('')
  const [projTemplate, setProjTemplate] = react.useState('novel')
  const [templates, setTemplates] = react.useState([])
  const [addRootMode, setAddRootMode] = react.useState(false)
  const [addRootPath, setAddRootPath] = react.useState('')
  const [addRootKind, setAddRootKind] = react.useState('library')
  const [exportProj, setExportProj] = react.useState(null)
  const [archiveProj, setArchiveProj] = react.useState(null)
  const [flash, setFlash] = react.useState('')
  const [prefs, setPrefs] = react.useState(getPrefs)
  react.useEffect(() => subscribePrefs(() => setPrefs({ ...getPrefs() })), [])
  react.useEffect(() => {
    void loadPrefs()
  }, [active])
  const taRef = react.useRef(null)
  const fillOpRef = react.useRef(null) // 「发给写作伙伴」的 operation token（连点不会建出两个会话）
  const aiTarget = react.useRef(null)
  const saveTimer = react.useRef(0)
  // 码字统计（host 在 save/version 成功后记账；这里只读展示）
  const [stats, setStats] = react.useState(null)
  const dailyGoal = prefs.dailyGoal || 0
  // 编辑器查找/替换（textarea 无高亮，靠选区定位）
  const [findOpen, setFindOpen] = react.useState(false)
  const [findQuery, setFindQuery] = react.useState('')
  const [replaceText, setReplaceText] = react.useState('')
  const [findIndex, setFindIndex] = react.useState(0)
  const findInputRef = react.useRef(null)
  // 选区改稿 diff 回路：文字工具「替换选区」先出预览（行级 diff），作者采纳才落稿
  const [rewrite, setRewrite] = react.useState(null)
  // 打字机滚动的镜像测量层（挂在 body 上，跟随 textarea 排版）
  const mirrorRef = react.useRef(null)

  const docBasename = basenameOf(filePath)
  const docFolder = folderOf(filePath)

  /** 同章版本系列（必须在任何 early-return 之前，遵守 Hooks 规则）。 */
  const versionSeries = react.useMemo(() => {
    if (!filePath) return []
    const curVer = versionOf(docBasename)
    if (curVer == null) return []
    const base = stemOf(docBasename)
    const ext = (docBasename.match(/\.[^.]+$/) || [''])[0]
    const out = []
    for (const root of tree) {
      for (const proj of root.projects || []) {
        for (const f of proj.files || []) {
          if (f.abs.replace(/[\\/][^\\/]+$/, '').toLowerCase() !== filePath.replace(/[\\/][^\\/]+$/, '').toLowerCase()) continue
          const n = f.name
          if (stemOf(n).toLowerCase() !== base.toLowerCase() || !n.toLowerCase().endsWith(ext.toLowerCase())) continue
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

  // 取数与失效广播都收进 library-store（失败保留旧缓存 + 并发合并）。
  // 这里保留调用点沿用的名字：语义 = 触发一次刷新。
  const refreshTree = react.useCallback(() => refreshLibrary(), [])

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

  /** 拉取今日码字/连击/近 14 天（GET stats 只读；记账在 host 的 save/version 里）。 */
  const refreshStats = react.useCallback(path => {
    if (!path) { setStats(null); return }
    api('stats', undefined, { path })
      .then(d => { if (d && d.ok) setStats(d.stats || null) })
      .catch(() => {})
  }, [])

  react.useEffect(() => {
    // 打开与每次保存（revision 变化）后刷新；打开路径上 host 的 GET 已先播种基线。
    if (!filePath || documentState.loading) return
    void refreshStats(filePath)
  }, [filePath, documentState.revision, documentState.loading, refreshStats])

  /* ── 编辑器查找/替换 ── */
  const findMatches = react.useMemo(() => {
    if (!findOpen || !findQuery) return []
    const out = []
    let i = content.indexOf(findQuery)
    while (i !== -1) { out.push(i); i = content.indexOf(findQuery, i + findQuery.length) }
    return out
  }, [content, findQuery, findOpen])

  const gotoMatch = react.useCallback(idx => {
    const total = findMatches.length
    if (!total) return
    const pos = ((idx % total) + total) % total
    setFindIndex(pos)
    const ta = taRef.current
    if (ta) {
      const start = findMatches[pos]
      ta.focus()
      ta.setSelectionRange(start, start + findQuery.length)
    }
  }, [findMatches, findQuery.length])

  const findStep = react.useCallback(dir => gotoMatch(findIndex + dir), [gotoMatch, findIndex])

  const replaceCurrent = () => {
    if (!findMatches.length || documentState.loading || isHistoryDoc) return
    const pos = ((findIndex % findMatches.length) + findMatches.length) % findMatches.length
    const start = findMatches[pos]
    setContent(content.slice(0, start) + replaceText + content.slice(start + findQuery.length))
    // 替换后匹配集合会随 content 重算；停在原序号，效果上=「替换后原地等下一次指令」
  }

  const replaceAllMatches = () => {
    if (!findQuery || !findMatches.length || documentState.loading || isHistoryDoc) return
    const n = findMatches.length
    setContent(content.split(findQuery).join(replaceText))
    setFindIndex(0)
    flashMsg(T.findReplaceAll + ' × ' + n)
  }

  react.useEffect(() => {
    // 打开查找栏：聚焦输入框并选中当前稿里的首个匹配
    if (!findOpen) return
    const t = window.setTimeout(() => {
      if (findInputRef.current) { findInputRef.current.focus(); findInputRef.current.select() }
    }, 0)
    return () => window.clearTimeout(t)
  }, [findOpen])

  react.useEffect(() => {
    setFindIndex(0)
  }, [findQuery])

  /* ── 专注深化：打字机滚动（镜像层测量光标行） ── */
  const typewriterScroll = react.useCallback(() => {
    const ta = taRef.current
    if (!ta || !prefs.typewriter) return
    let m = mirrorRef.current
    if (!m) {
      m = document.createElement('div')
      m.setAttribute('aria-hidden', 'true')
      m.style.position = 'absolute'
      m.style.visibility = 'hidden'
      m.style.whiteSpace = 'pre-wrap'
      m.style.overflowWrap = 'break-word'
      m.style.boxSizing = 'border-box'
      m.style.top = '-9999px'
      m.style.left = '-9999px'
      document.body.appendChild(m)
      mirrorRef.current = m
    }
    const cs = getComputedStyle(ta)
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'width']) {
      m.style[prop] = cs[prop]
    }
    const caret = typeof ta.selectionStart === 'number' ? ta.selectionStart : 0
    m.textContent = ta.value.slice(0, caret)
    // 光标近似在镜像内容底部：让光标行保持在稿面中部（textarea 自带溢出滚动）
    ta.scrollTop = Math.max(0, m.scrollHeight - ta.clientHeight / 2)
  }, [prefs.typewriter])

  react.useEffect(() => () => {
    if (mirrorRef.current) { mirrorRef.current.remove(); mirrorRef.current = null }
  }, [])

  react.useEffect(() => {
    if (!prefs.typewriter) return
    const id = window.requestAnimationFrame(() => typewriterScroll())
    return () => window.cancelAnimationFrame(id)
  }, [content, prefs.typewriter, typewriterScroll])

  /** 伙伴回复 [[文稿名]] 的点击跳回：只在作者自己的库内文件清单里解析（解析不到停在原地提示）。 */
  const jumpToFile = react.useCallback((name) => {
    const all = []
    for (const r of tree) for (const p of (r.projects || [])) for (const f of (p.files || [])) all.push(f)
    const hit = resolveFileByName(all, name)
    if (!hit) { flashMsg(`作品里没有「${name}」这篇文稿`); return }
    setFilePath(hit.abs || hit.path)
    setAiOpen(true)
    flashMsg('已跳到 ' + hit.name)
  }, [tree])

  /** 档案层里的 [[跳转]]：先收掉档案层再走同一套解析，否则跳完仍被档案盖着（CompanionMessage 是 memo，回调要稳定）。 */
  const jumpFromArchive = react.useCallback((name) => {
    setArchiveProj(null)
    jumpToFile(name)
  }, [jumpToFile])

  /** 外壳提供了档案窗口桥就走独立页面；没有（官方桌面/浏览器里跑插件）就退回覆盖层，功能不丢。 */
  const wikiBridge = typeof window !== 'undefined' && typeof (window.dshShell || {}).openWiki === 'function'
    ? window.dshShell : null
  const openArchive = react.useCallback((proj) => {
    if (!wikiBridge) { setArchiveProj(proj); return }
    Promise.resolve(wikiBridge.openWiki(proj.path))
      .then((r) => {
        if (r && r.ok === false) {
          setArchiveProj(proj)
          flashMsg('独立窗口没开成（' + r.error + '），先在写作台里打开')
        }
      })
      .catch((err) => {
        setArchiveProj(proj)
        flashMsg('独立窗口没开成（' + (err?.message || err) + '），先在写作台里打开')
      })
  }, [wikiBridge])

  /** 卡片拖拽重排成功后：刷新文件树；编辑中的章节被改名时把打开文档切到新路径（有未保存修改则提示走另存）。 */
  const handleReordered = react.useCallback((renames) => {
    void refreshTree()
    const snap = editor.get()
    const cur = snap.path
    if (!cur || !Array.isArray(renames) || !renames.length) return
    const hit = renames.find((r) => String(r.from).toLowerCase() === String(cur).toLowerCase())
    if (!hit) return
    if (!snap.dirty && snap.status !== 'error') {
      void editor.open(hit.to)
      flashMsg('章节已改名，已切换到新文件')
    } else {
      flashMsg('当前编辑的章节已改名：请先用「另存为新版」把手上的修改存进新文件')
    }
  }, [editor, refreshTree])

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
    setCloseGuard(async () => {
      if (await editor.close()) { commitModeActive(false); return }
      // 退出被守卫拦下时必须说话：此前失败就静默留在写作台，作者以为「退出键坏了」
      flashMsg('保存失败，未退出写作台：当前文字还压在本地，可点稿面下方「重试保存」或「另存新版」')
    })
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
        if (archiveProj) { setArchiveProj(null); return }
        if (exportProj) { setExportProj(null); return }
        // 查找栏开着时 Esc 只关查找栏，不退写作台
        if (findOpen) { setFindOpen(false); return }
        close()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void editor.version()
        else void persist()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, newDocMode, addRootMode, exportProj, archiveProj, findOpen, editor, persist, close])

  function flashMsg(msg) {
    setFlash(String(msg || ''))
    window.setTimeout(() => setFlash(''), 3200)
  }

  async function commitAddRoot() {
    const p = String(addRootPath || '').trim()
    if (!p) return
    const data = await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'add', path: p, active: true, kind: addRootKind }),
    })
    if (!data.ok) { flashMsg('打开文件夹失败：' + (data.error || 'unknown')); return }
    setAddRootMode(false)
    setAddRootPath('')
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
    if (!data.ok) {
      const msg =
        data.error === 'project-exists'
          ? '同名项目已存在'
          : data.error === 'directory-not-empty'
            ? '目标文件夹已有内容，请换名或先清空'
            : data.error === 'invalid-project-name'
              ? '项目名不合法'
              : '创建失败：' + (data.error || '')
      flashMsg(msg)
      return
    }
    setProjMode(false)
    flashMsg(T.created + '：' + (data.project?.name || ''))
    await refreshTree()
    setFilePath(data.project.path.replace(/[\\/]$/, '') + '/project.md')
  }

  async function addProjectResource(project, resource) {
    if (!resource) return
    try {
      const result = await api('project-resource', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: project.path, resource }),
      })
      if (!result.ok) { flashMsg(result.error === 'resource-exists' ? '这份资料已存在，原文未改动' : '添加失败：' + result.error); return }
      await refreshTree()
      setFilePath(result.path)
    } catch (err) { flashMsg('添加失败：' + err.message) }
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


  async function runAssist(action) {
    const snapshot = editor.get()
    const selection = taRef.current ? { start: taRef.current.selectionStart, end: taRef.current.selectionEnd } : { start: 0, end: 0 }
    const isRec = action === 'research' || action === 'spark'
    const text = selectionText({ ta: taRef.current, content })
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
        aiTarget.current = { path: snapshot.path, edit: snapshot.edit, action, ...selection }
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
      // 改稿 diff 回路：不再一步覆写选区——先出预览（原文 vs 建议稿），作者采纳才落
      setRewrite({ before: content.slice(s, e), after: aiOut, start: s, end: e, label: T[target.action] || '' })
    } else {
      flashMsg('生成前没有选区，请使用“插入文末”。')
    }
  }

  function acceptRewrite() {
    if (!rewrite) return
    let pos = rewrite.start
    // 预览期间作者可能继续打字：先按原偏移校验，错位则在附近窗口重新定位原文
    if (content.slice(rewrite.start, rewrite.end) !== rewrite.before) {
      const found = content.indexOf(rewrite.before, Math.max(0, rewrite.start - 2000))
      if (found === -1) { flashMsg(T.rewriteLost); return }
      pos = found
    }
    setContent(content.slice(0, pos) + rewrite.after + content.slice(pos + rewrite.before.length))
    setRewrite(null)
    flashMsg(T.rewriteApplied)
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

  function toggleProj(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  // 浮层只承载瞬时提示；保存/读取失败改成正压在状态条上方的常驻行——
  // 浮层会挡住稿面、无处重试，作者只能凭状态条上一个「未保存」猜。
  const saveLabel = documentState.loading
    ? '打开中…'
    : saveState === 'saving'
      ? T.saving
      : saveState === 'error'
        ? dirty ? '保存失败' : '读取失败'
        : dirty
          ? T.unsaved
          : filePath
            ? T.saved
            : '—'

  async function fillComposer(prompt) {
    const source = editor.get().path
    try {
      // P2：会话获取走 adapter（唯一接触面）。fillOpRef 记住本次操作的 token，
      // 连点"发给写作伙伴"不会因为并发建出两个会话。
      if (!fillOpRef.current) fillOpRef.current = newOperationToken()
      const target = await harnessAdapter().connect(source || activeRoot, fillOpRef.current)
      if (!target) return false
      if (editor.get().path !== source || !getModeActive()) return false
      const already = target.getDraft()
      target.setDraft(already ? already + '\n\n' + prompt : prompt)
      setAiOpen(true); setAiTab('companion'); setFocus(false)
      flashMsg('已追加到写作伙伴输入框，补充想法后发送')
      return true
    } catch (err) { flashMsg(err.message); setAiErr(err.message); return false }
  }
  async function sendToChat() {
    const payload = aiOut || selectionText({ ta: taRef.current, content })
    const prompt = assistantPrompt(payload)
    await fillComposer(prompt)
  }

  async function sendReviewToChat() {
    const prompt = reviewPrompt({ reportContent: content, reportPath: filePath })
    await fillComposer(prompt)
  }

  return jsx.jsx('div', {
    className: 'dshWmRoot',
    role: 'dialog',
    'aria-label': T.toggle,
    children: [
      flash
        ? jsx.jsx('div', { className: 'dshWmFlash', role: 'alert', children: flash }, 'flash')
        : null,
      jsx.jsx(TopBar, {
        roots,
        activeRoot,
        activateRoot,
        setAddRootMode,
        setAddRootPath,
        setAddRootKind,
        addRootMode,
        addRootPath,
        addRootKind,
        commitAddRoot,
        libOpen,
        setLibOpen,
        focus,
        setFocus,
        prefs,
        aiOpen,
        setAiOpen,
        filePath,
        saveState,
        dirty,
        documentState,
        persist,
        close,
      }, 'bar'),
      jsx.jsx(
        'div',
        {
          className: 'dshWmBody',
          children: [
            jsx.jsx(LibraryPane, {
              roots,
              activeTree,
              projects,
              openProjectMode,
              createDocInRoot,
              projMode,
              setProjMode,
              projTitle,
              setProjTitle,
              projPremise,
              setProjPremise,
              projTemplate,
              setProjTemplate,
              templates,
              commitProject,
              newDocMode,
              setNewDocMode,
              newDocName,
              setNewDocName,
              commitNewDoc,
              libraryView,
              setLibraryView,
              libQuery,
              setLibQuery,
              collapsed,
              toggleProj,
              filePath,
              setFilePath,
              handleReordered,
              flashMsg,
              addProjectResource,
              setAddRootMode,
              setAddRootPath,
              KEY_HINT,
              onOpenArchive: (proj) => { setExportProj(null); openArchive(proj) },
              onExportBook: (proj) => { setArchiveProj(null); setExportProj(proj) },
            }, 'docs'),
            jsx.jsx(
              'main',
              {
                className: 'dshWmMain',
                children: [
                  jsx.jsx(EditorChrome, {
                    filePath,
                    docFolder,
                    docBasename,
                    copied,
                    copyPath,
                    isReviewFile,
                    sendReviewToChat,
                    curVerNum,
                    latestVer,
                    isHistoryDoc,
                    versionSeries,
                    setFilePath,
                    comparePrev,
                    saveAsNewVersion,
                  }, 'chrome'),
                  findOpen
                    ? jsx.jsx(FindBar, {
                      findQuery,
                      setFindQuery,
                      replaceText,
                      setReplaceText,
                      findMatches,
                      findIndex,
                      findStep,
                      findInputRef,
                      documentState,
                      isHistoryDoc,
                      replaceCurrent,
                      replaceAllMatches,
                      setFindOpen,
                    }, 'findbar')
                    : null,
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
                        onKeyDown: (e) => {
                          // 海明威模式：禁退格/删除/剪切，初稿只往前写；IME 组合中的按键不拦（拼音要能删）
                          if (
                            prefs.hemingway && !e.isComposing &&
                            (e.key === 'Backspace' || e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x'))
                          ) e.preventDefault()
                        },
                        onKeyUp: () => typewriterScroll(),
                        onClick: () => typewriterScroll(),
                      }),
                    },
                    'ew'
                  ),
                  diffLines
                    ? jsx.jsx(DiffPanel, {
                      diffLines,
                      diffLabel,
                      onClose: () => setDiffLines(null),
                    }, 'diff')
                    : null,
                  rewrite
                    ? jsx.jsx(RewritePanel, {
                      rewrite,
                      onAccept: acceptRewrite,
                      onDiscard: () => setRewrite(null),
                    }, 'rewrite')
                    : null,
                  documentState.error
                    ? jsx.jsxs('div', {
                        className: 'dshWmDocAlert',
                        role: 'alert',
                        'data-wm-doc-alert': saveState,
                        children: [
                          jsx.jsx('span', { children: documentState.error }, 'm'),
                          jsx.jsx('span', { className: 'dshWmSpacer' }, 's'),
                          dirty && filePath
                            ? jsx.jsx('button', {
                                type: 'button',
                                className: 'dshWmBtn',
                                onClick: () => void persist(),
                                children: '重试保存',
                              }, 'retry')
                            : null,
                          filePath
                            ? jsx.jsx('button', {
                                type: 'button',
                                className: 'dshWmBtn is-ghost',
                                title: T.bumpHint,
                                onClick: () => void editor.version(),
                                children: '另存新版',
                              }, 'bump')
                            : null,
                        ],
                      }, 'doc-alert')
                    : null,
                  jsx.jsx(StatusBar, {
                    saveState,
                    dirty,
                    saveLabel,
                    content,
                    filePath,
                    stats,
                    dailyGoal,
                    gate,
                  }, 'st'),
                  exportProj
                    ? jsx.jsx(ExportBookPanel, {
                        proj: exportProj,
                        onClose: () => setExportProj(null),
                        onDone: (data) => {
                          setExportProj(null)
                          const name = String(data?.doc?.path || '').split(/[\\/]/).pop()
                          flashMsg(`已导出 ${data?.stats?.files ?? 0} 篇 → ${name}`)
                          void refreshTree()
                          if (data?.doc?.path) setFilePath(data.doc.path)
                        },
                      }, 'export-book')
                    : null,
                  archiveProj
                    ? jsx.jsx(ProjectArchivePanel, {
                        proj: archiveProj,
                        onClose: () => setArchiveProj(null),
                        // 从档案跳回写作现场：开文档并收掉档案层，编辑器一直挂着，不丢未保存文字
                        onOpenDoc: (abs) => { setFilePath(abs); setArchiveProj(null) },
                        onJumpToFile: jumpFromArchive,
                        onExported: (d) => flashMsg('档案已导出 → ' + String(d?.doc?.path || '').split(/[\\/]/).pop()),
                        onOpenWindow: wikiBridge ? (p) => openArchive(p) : null,
                      }, 'archive')
                    : null,
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
                        jsx.jsx('button', { className: 'dshWmTab' + (aiTab === 'check' ? ' is-on' : ''), onClick: () => setAiTab('check'), children: '检查' }),
                      ] }, 'ah'),
                      // 专注模式由 CSS 收起右栏，组件保持挂载：卸载重挂会重新拉一次会话绑定，
                      // 并在挂回时把原生主视图再聚焦一次（作者只是想看会儿稿子，不该有这么大副作用）。
                      aiTab === 'companion' ? jsx.jsx(WritingCompanion, {
                        path: filePath || activeRoot,
                        sourceInfo: () => {
                          const snap = editor.get()
                          return snap.path ? { path: snap.path, revision: snap.revision } : null
                        },
                        contextText: () => {
                          const selected = Boolean(taRef.current && taRef.current.selectionEnd > taRef.current.selectionStart)
                          const start = selected ? taRef.current.selectionStart : null
                          const end = selected ? taRef.current.selectionEnd : null
                          const excerpt = selected ? content.slice(start, end) : content
                          const snap = editor.get()
                          return makeReference({
                            label: (selected ? '选区 · ' : '稿件 · ') + (filePath || '未命名').split(/[\\/]/).pop() + ' · ' + excerpt.length + ' 字',
                            excerpt,
                            path: filePath || null,
                            revision: snap.path === filePath ? snap.revision : null,
                            start,
                            end,
                            dirty: Boolean(snap.dirty),
                            note: '请以我随后补充的想法为准。',
                          })
                        },
                        onExit: close,
                        // 会话列表点击 = 开该作品概览文档，伙伴会话随 path 解析自然切换
                        onOpenProject: (project) => {
                          setFilePath(String(project).replace(/[\\/]+$/, '') + '/project.md')
                          setAiOpen(true)
                          setAiTab('companion')
                        },
                        // 伙伴回复 [[文稿名]] chip 的点击跳回：只在作者自己的库内文件清单里解析
                        onJumpToFile: jumpToFile,
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
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiHint', children: KEY_HINT },
                              'kbd'
                            ),
                          ],
                        },
                        'ab'
                      ) : null,
                      aiTab === 'check' ? jsx.jsx(InspectionPanel, {
                        T,
                        filePath,
                        gate, gateErr, gateBusy, gateOpen,
                        onToggleGate: () => setGateOpen((v) => !v),
                        onRunGate: runGate,
                        ledger, ledgerOpen,
                        onToggleLedger: () => setLedgerOpen((v) => !v),
                        stats, dailyGoal,
                        statsOpen, onToggleStats: () => setStatsOpen((v) => !v),
                        onSaveGoal: (n) => {
                          const goal = Math.max(0, Math.min(200000, Number(n) || 0))
                          void savePrefs({ dailyGoal: goal })
                          flashMsg(T.statsGoalSaved)
                        },
                      }, 'inspection') : null,
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
