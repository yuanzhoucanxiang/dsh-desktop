/**
 * 作品档案（只读投影）：把「已确认设定 + 写作进度 + 资料文稿」拼成一页可翻阅的参考档案。
 *
 * 定位（对齐策划案 §18.3「单一权威数据」）：本面板**不写文件、不新增存储、不加 host 路由**，
 * 数据全部来自既有只读接口（memory / outline / stats / ledger / get），关掉再开就是最新状态。
 * 世界观讨论的产物在这里是"读"的一端：确认动作仍然只在项目备忘里做。
 *
 * 覆盖在中央编辑区之上（与「成书」面板同一手法：编辑器保持挂载，关掉后写作现场原样还在）。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'
import { versionOf, chapterTitleOf } from '../../../shared/filename.js'
import { navFileLabels, groupKeyOf, maxVersionInGroup } from '../library/grouping.js'
import { CompanionMessage } from '../companion/CompanionMessage.js'

const LOADING = { phase: 'loading' }

const ERR_TEXT = {
  'memory-unavailable': '项目备忘读不到',
  'identity-unverified': '作品身份未被 host 确认',
  'invalid-project': '没能识别这个项目',
  'path-outside-roots': '项目路径不在文库根内',
}

async function call(route, init, params) {
  const d = await api(route, init, params)
  if (!d || d.ok === false) throw new Error(ERR_TEXT[String(d && d.error)] || String(d?.error || '读取失败'))
  return d
}

/** 一条设定给作者看的最小充分信息：结论 + 边界 +（折叠的）说明与出处。 */
function SettingCard({ item }) {
  const s = item.setting || {}
  const excerpts = (s.sources || []).filter((x) => x && x.excerpt).slice(0, 2)
  return jsx.jsxs('article', {
    className: 'dshWmWikiCard' + (s.boundaries ? ' has-boundary' : ''),
    'data-wm-wiki-card-id': item.id,
    children: [
      jsx.jsxs('header', { className: 'dshWmWikiCardHead', children: [
        jsx.jsx('h4', { children: s.title || '（未命名条目）' }, 't'),
        jsx.jsx('span', {
          className: 'dshWmWikiCardFrom',
          title: item.source?.sessionId ? '会话 ' + item.source.sessionId : undefined,
          children: item.source?.kind === 'assistant' ? '来自讨论' : item.source?.kind === 'host' ? '内核' : '作者记录',
        }, 'f'),
      ] }),
      jsx.jsx('p', { className: 'dshWmWikiConclusion', children: s.conclusion || item.text || '' }, 'c'),
      s.boundaries
        ? jsx.jsx('p', { className: 'dshWmWikiBoundary', children: '边界 / 例外：' + s.boundaries }, 'b')
        : null,
      s.explanation || excerpts.length || (s.tags || []).length
        ? jsx.jsxs('details', { className: 'dshWmWikiMore', children: [
            jsx.jsx('summary', { children: '展开说明与出处' }),
            s.explanation ? jsx.jsx('p', { className: 'dshWmWikiPlain', children: s.explanation }, 'e') : null,
            ...excerpts.map((x, i) => jsx.jsxs('blockquote', { className: 'dshWmWikiExcerpt', children: [
              jsx.jsx('span', { className: 'dshWmWikiExcerptWho', children: x.role === 'author' ? '你说过' : '伙伴说过' }),
              jsx.jsx('p', { children: x.excerpt }),
            ] }, 'x' + i)),
            (s.tags || []).length
              ? jsx.jsx('div', { className: 'dshWmWikiTags', children: s.tags.map((t) => jsx.jsx('span', { className: 'dshWmWikiTag', children: t }, t)) }, 'g')
              : null,
          ] }, 'more')
        : null,
    ],
  })
}

/** 资料文稿：默认只列名字与字数，展开才去读正文（一次只拉该拉的那篇）。 */
function DocCard({ file, onOpenDoc, onJumpToFile }) {
  const [doc, setDoc] = react.useState(null)
  const [state, setState] = react.useState(LOADING)
  const [open, setOpen] = react.useState(false)
  const label = navFileLabels[file.rel]?.[1] || file.name
  const load = react.useCallback(async () => {
    setState(LOADING)
    try {
      const d = await call('get', undefined, { path: file.abs })
      setDoc(d.doc)
      setState({ phase: 'ready' })
    } catch (err) {
      setState({ phase: 'error', error: '读不到这篇资料：' + String(err?.message || err) })
    }
  }, [file.abs])
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !doc) void load()
  }
  return jsx.jsxs('section', {
    className: 'dshWmWikiDoc',
    'data-wm-wiki-doc': file.rel,
    children: [
      jsx.jsxs('div', { className: 'dshWmWikiDocHead', children: [
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmWikiDocToggle',
          onClick: toggle,
          'aria-expanded': open,
          children: (open ? '▾ ' : '▸ ') + label,
        }),
        jsx.jsx('span', { className: 'dshWmWikiDocChars', children: (doc ? String(doc.content || '').length : file.chars || 0) + ' 字' }, 'c'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmQuiet',
          title: '在编辑器里打开并继续写（' + file.rel + '）',
          onClick: () => onOpenDoc(file.abs),
          children: '去写',
        }, 'o'),
      ] }),
      open
        ? state.phase === 'loading'
          ? jsx.jsx('p', { className: 'dshWmAiHint', role: 'status', children: '读取中…' }, 'l')
          : state.phase === 'error'
            ? jsx.jsxs('p', { className: 'dshWmWikiSectionError', role: 'alert', 'data-wm-wiki-doc-error': file.rel, children: [
                state.error,
                jsx.jsx('button', { type: 'button', className: 'dshWmQuiet', onClick: () => void load(), children: '重试' }),
              ] }, 'e')
            : jsx.jsx('div', {
                className: 'dshWmWikiDocBody',
                children: jsx.jsx(CompanionMessage, { text: doc.content, kind: 'assistant', onJumpToFile }),
              }, 'b')
        : null,
    ],
  }, file.rel)
}

function Section({ title, meta, children }) {
  return jsx.jsxs('section', { className: 'dshWmWikiSection', 'data-wm-wiki-section': title, children: [
    jsx.jsxs('div', { className: 'dshWmWikiSectionHead', children: [
      jsx.jsx('h3', { children: title }),
      meta ? jsx.jsx('span', { className: 'dshWmWikiSectionMeta', children: meta }) : null,
    ] }),
    children,
  ] })
}

/** 每一区自己说话：读不到就给原因和重试，不给整页开白屏。 */
function SectionState({ state, onRetry, hasContent, empty }) {
  if (state.phase === 'loading') return jsx.jsx('p', { className: 'dshWmAiHint', role: 'status', children: '读取中…' })
  if (state.phase === 'error') {
    return jsx.jsxs('p', { className: 'dshWmWikiSectionError', role: 'alert', 'data-wm-wiki-error': '1', children: [
      state.error,
      jsx.jsx('button', { type: 'button', className: 'dshWmQuiet', onClick: onRetry, children: '重试' }),
    ] })
  }
  return hasContent ? null : empty
}

export function ProjectArchivePanel({ proj, onClose, onOpenDoc, onJumpToFile, onExported, onOpenWindow }) {
  const [settings, setSettings] = react.useState(LOADING)
  const [progress, setProgress] = react.useState(LOADING)
  const [ledger, setLedger] = react.useState(LOADING)
  const [exporting, setExporting] = react.useState(false)
  const [exportResult, setExportResult] = react.useState(null)
  const [exportError, setExportError] = react.useState('')
  const [copiedPath, setCopiedPath] = react.useState(false)

  const EXPORT_ERR = {
    'memory-corrupt': '作品设定读不出（state/writing-memory.json 损坏）：原文已保留，请先在项目备忘里处理。',
    'memory-unknown-schema': '作品设定是未知版本：不猜、不覆盖，请先在项目备忘里处理。',
    'source-changed': '导出期间有资料被移动或删除，已放弃，请重试。',
    'version-conflict': '档案编号已用尽（同名档案超过 100 份），请清理后重试。',
    'no-project': '没能识别这个项目，请刷新文档库后重试。',
  }

  const doExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    setExportResult(null)
    try {
      const d = await api('archive-export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: proj.path }) })
      if (d?.ok) {
        setExportResult(d)
        if (onExported) onExported(d)
      } else {
        setExportError(EXPORT_ERR[String(d?.error)] || ('导出失败：' + String(d?.error || 'unknown')))
      }
    } catch (err) {
      setExportError('导出失败：' + String(err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  const copyExportPath = async () => {
    try { await navigator.clipboard.writeText(String(exportResult?.doc?.path || '')); setCopiedPath(true); window.setTimeout(() => setCopiedPath(false), 1500) } catch {}
  }

  const loadSettings = react.useCallback(async () => {
    setSettings(LOADING)
    try {
      const d = await call('memory', undefined, { path: proj.path })
      setSettings({ phase: 'ready', items: d.memory?.items || [] })
    } catch (err) {
      setSettings({ phase: 'error', error: '设定读不到：' + String(err?.message || err) })
    }
  }, [proj.path])

  const loadProgress = react.useCallback(async () => {
    setProgress(LOADING)
    try {
      const [outline, stats] = await Promise.all([
        call('outline', undefined, { project: proj.path }),
        call('stats', undefined, { path: proj.path }),
      ])
      setProgress({
        phase: 'ready',
        rows: outline.outline?.rows || [],
        structure: outline.outline?.structure || [],
        stats: stats.stats,
        dailyGoal: stats.dailyGoal || 0,
      })
    } catch (err) {
      setProgress({ phase: 'error', error: '进度读不到：' + String(err?.message || err) })
    }
  }, [proj.path])

  const loadLedger = react.useCallback(async () => {
    setLedger(LOADING)
    try {
      const entry = (proj.files || []).find((f) => String(f.rel).startsWith('draft/'))
        || (proj.files || []).find((f) => f.rel === 'project.md')
      if (!entry) {
        setLedger({ phase: 'ready', ledger: null })
        return
      }
      const d = await call('ledger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: entry.abs }) })
      setLedger({ phase: 'ready', ledger: d.ledger })
    } catch (err) {
      setLedger({ phase: 'error', error: '台账读不到：' + String(err?.message || err) })
    }
  }, [proj])

  react.useEffect(() => {
    void loadSettings()
    void loadProgress()
    void loadLedger()
  }, [loadSettings, loadProgress, loadLedger])

  const items = settings.items || []
  const confirmed = items.filter((it) => it.status === 'confirmed')
  const world = confirmed.filter((it) => it.kind === 'fact' && it.setting?.type === 'world')
  const worldIds = new Set(world.map((it) => it.id))
  const plain = confirmed.filter((it) => !worldIds.has(it.id))
  const proposed = items.filter((it) => it.status === 'proposed').length
  const rows = progress.rows || []
  const totalChars = rows.reduce((n, r) => n + (Number(r.chars) || 0), 0)
  const days = progress.stats?.days || []
  const maxDay = Math.max(1, ...days.map((d) => Number(d.total) || 0))
  const goal = Number(progress.dailyGoal) || 0
  const today = Number(progress.stats?.today) || 0
  // 资料区：每篇只取当前版（-vN 系列留最新），契约内目录排在前面
  const maxVer = maxVersionInGroup(proj.files || [])
  const docs = (proj.files || [])
    .filter((f) => !String(f.rel).startsWith('draft/'))
    .filter((f) => {
      const v = versionOf(f.name)
      return v === null || v === maxVer.get(groupKeyOf(f.abs))
    })
    .sort((a, b) => {
      const rank = (rel) => (rel === 'project.md' ? 0 : rel.startsWith('bible/') ? 1 : rel.startsWith('outline/') ? 2 : rel.startsWith('state/') ? 3 : 4)
      return rank(a.rel) - rank(b.rel) || String(a.rel).localeCompare(String(b.rel), 'zh', { numeric: true })
    })
  const groups = []
  for (const f of docs) {
    const key = navFileLabels[f.rel]?.[0] || (f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '其他文档')
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.files.push(f)
    else groups.push({ key, files: [f] })
  }

  return jsx.jsxs('div', {
    className: 'dshWmWiki',
    role: 'region',
    'aria-label': '作品档案',
    'data-wm-archive': proj.path,
    children: [
      jsx.jsxs('div', { className: 'dshWmWikiBar', children: [
        jsx.jsx('span', { className: 'dshWmWikiTitle', children: proj.name || '作品档案' }),
        jsx.jsx('span', { className: 'dshWmWikiSub', children: '只读档案：内容来自已确认设定与文稿本身，这里改动不了它们' }),
        jsx.jsx('span', { className: 'dshWmSpacer' }),
        onOpenWindow
          ? jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn',
              onClick: () => onOpenWindow(proj),
              title: '在独立窗口打开这一页（可缩放、可打印；内容是同一份只读投影）',
              children: '独立窗口',
            }, 'open-window')
          : null,
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn',
          onClick: () => { void doExport() },
          disabled: exporting,
          title: '导出为一页自包含 HTML：可分享、可打印；写进作品根目录，原稿一律不动',
          children: exporting ? '导出中…' : '导出 HTML',
        }, 'export'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn',
          onClick: () => { void loadSettings(); void loadProgress(); void loadLedger() },
          children: '刷新',
        }),
        jsx.jsx('button', { type: 'button', className: 'dshWmBtn is-primary', onClick: onClose, children: '关闭档案' }),
      ] }),
      exportError
        ? jsx.jsxs('div', { className: 'dshWmWikiBarNote is-error', role: 'alert', 'data-wm-wiki-export-error': '1', children: [
            exportError,
            jsx.jsx('button', { type: 'button', className: 'dshWmQuiet', onClick: () => void doExport(), children: '重试' }),
          ] }, 'export-error')
        : null,
      exportResult
        ? jsx.jsxs('div', { className: 'dshWmWikiBarNote', 'data-wm-wiki-export': exportResult.doc.path, children: [
            jsx.jsx('span', { children: '已导出 ' + String(exportResult.doc.path).split(/[\\/]/).pop()
              + `（设定 ${exportResult.stats.settings} 条 · 资料 ${exportResult.stats.docs} 篇 · ${Math.round((exportResult.doc.bytes || 0) / 1024)} KB）` }),
            jsx.jsx('span', { className: 'dshWmWikiExportPath', title: exportResult.doc.path, children: exportResult.doc.path }),
            jsx.jsx('button', { type: 'button', className: 'dshWmQuiet', onClick: () => void copyExportPath(), children: copiedPath ? '已复制' : '复制路径' }),
          ] }, 'export-ok')
        : null,
      jsx.jsxs('div', { className: 'dshWmWikiScroll', children: [
        jsx.jsxs(Section, {
          title: '设定',
          meta: world.length + plain.length ? `${world.length + plain.length} 条已确认` : '',
          children: [
            jsx.jsx(SectionState, {
              state: settings,
              onRetry: () => void loadSettings(),
              hasContent: world.length + plain.length > 0,
              empty: jsx.jsxs('div', { className: 'dshWmAiHint', children: [
                '还没有已确认的设定。与写作伙伴讨论后，在右栏「项目备忘」里确认的条目会自动出现在这里。',
                proposed ? `（另有 ${proposed} 条候选，确认前不进档案。）` : null,
              ] }),
            }),
            world.length
              ? jsx.jsx('div', { className: 'dshWmWikiCards', 'data-wm-wiki-cards': String(world.length), children: world.map((it) => jsx.jsx(SettingCard, { item: it }, it.id)) }, 'world')
              : null,
            plain.length
              ? jsx.jsxs('div', { className: 'dshWmWikiPlainList', 'data-wm-wiki-plain': String(plain.length), children: [
                  jsx.jsx('div', { className: 'dshWmWikiSubHead', children: '其他已确认备忘' }),
                  ...plain.map((it) => jsx.jsxs('div', { className: 'dshWmWikiPlainRow', children: [
                    jsx.jsx('span', { className: 'dshWmWikiPlainKind', children: it.kind === 'preference' ? '偏好' : it.kind === 'open-question' ? '待定' : '设定' }),
                    jsx.jsx('span', { children: it.text }),
                  ] }, it.id)),
                ] }, 'plain')
              : null,
            settings.phase === 'ready' && proposed && world.length + plain.length
              ? jsx.jsx('p', { className: 'dshWmWikiNote', 'data-wm-wiki-proposed': String(proposed), children: `另有 ${proposed} 条候选未确认，未列入档案。` })
              : null,
          ],
        }, 'sec-settings'),
        jsx.jsxs(Section, {
          title: '进度',
          meta: rows.length ? `${rows.length} 篇 · ${totalChars} 字` : '',
          children: [
            jsx.jsx(SectionState, {
              state: progress,
              onRetry: () => void loadProgress(),
              hasContent: rows.length > 0,
              empty: jsx.jsx('div', { className: 'dshWmAiHint', children: 'draft/ 下还没有正文。' }),
            }),
            progress.phase === 'ready'
              ? jsx.jsxs('div', { className: 'dshWmWikiStats', 'data-wm-wiki-stats': '1', children: [
                  jsx.jsxs('span', { children: [jsx.jsx('b', { 'data-wm-wiki-today': String(today), children: String(today) }), ' 字 · 今天'] }, 'today'),
                  jsx.jsxs('span', { children: [jsx.jsx('b', { children: String(progress.stats?.streak || 0) }), ' 天连更'] }, 'streak'),
                  goal ? jsx.jsxs('span', { children: ['日目标 ', jsx.jsx('b', { children: String(goal) })] }, 'goal') : null,
                  progress.stats?.corrupt ? jsx.jsx('span', { className: 'dshWmWikiSectionError', children: '统计文件损坏，数字可能不准' }, 'corrupt') : null,
                ] }, 'stats')
              : null,
            progress.phase === 'ready' && days.length
              ? jsx.jsx('div', {
                  className: 'dshWmWikiBars',
                  'data-wm-wiki-bars': String(days.length),
                  title: '近 14 天每日净增字数',
                  children: days.map((d) => jsx.jsx('span', {
                    className: 'dshWmWikiDayBar' + (goal > 0 && (Number(d.total) || 0) >= goal ? ' is-hit' : ''),
                    style: { height: Math.max(3, Math.round(((Number(d.total) || 0) / maxDay) * 100)) + '%' },
                    title: d.day + '：' + (d.total || 0) + ' 字',
                  }, d.day)),
                }, 'bars')
              : null,
            progress.phase === 'ready' && rows.length
              ? jsx.jsx('ol', {
                  className: 'dshWmWikiChapters',
                  'data-wm-wiki-chapters': String(rows.length),
                  children: rows.map((r) => jsx.jsxs('li', { children: [
                    jsx.jsx('button', { type: 'button', className: 'dshWmWikiChapterName', title: '打开 ' + r.name, onClick: () => onOpenDoc(r.abs), children: chapterTitleOf(r.name) }),
                    jsx.jsx('span', { className: 'dshWmWikiChapterChars', children: (r.chars || 0) + ' 字' }),
                    r.gate ? jsx.jsx('span', { className: 'dshWmWikiChapterGate' + (r.gate.pass ? ' is-pass' : ' is-fail'), title: r.gate.pass ? '门禁全部通过' : '在「检查」页看明细', children: r.gate.pass ? '门禁 ✓' : '门禁 ' + r.gate.fail }) : null,
                    r.hook ? jsx.jsx('span', { className: 'dshWmWikiChapterHook', title: r.hook, children: r.hook }) : null,
                  ] }, r.abs)),
                })
              : null,
            progress.phase === 'ready' && progress.structure.length
              ? jsx.jsxs('details', { className: 'dshWmWikiStructure', children: [
                  jsx.jsx('summary', { children: '结构（outline/structure.md 标题行）' }),
                  ...progress.structure.map((l, i) => jsx.jsx('div', { children: l.replace(/^#+\s*/, '') }, 's' + i)),
                ] }, 'struct')
              : null,
          ],
        }, 'sec-progress'),
        jsx.jsx(Section, {
          title: '时间与伏笔',
          children: [
            jsx.jsx(SectionState, {
              state: ledger,
              onRetry: () => void loadLedger(),
              hasContent: Boolean(ledger.ledger),
              empty: jsx.jsx('div', { className: 'dshWmAiHint', children: '还没有时间线与伏笔记录（写进 bible/timeline.md 与 outline/foreshadow.md 后会出现在这里）。' }),
            }),
            ledger.phase === 'ready' && ledger.ledger
              ? jsx.jsxs('div', { className: 'dshWmWikiLedger', 'data-wm-wiki-ledger': '1', children: [
                  (ledger.ledger.timeline || []).length
                    ? jsx.jsx('ul', { className: 'dshWmWikiTimeline', children: ledger.ledger.timeline.map((l, i) => jsx.jsx('li', { children: l }, i)) })
                    : jsx.jsx('p', { className: 'dshWmAiHint', children: 'bible/timeline.md 还没有条目。' }),
                  jsx.jsxs('div', { className: 'dshWmWikiLedgerFoot', children: [
                    jsx.jsxs('span', { children: ['未回收伏笔 ', jsx.jsx('b', { children: String(ledger.ledger.foreshadowOpen ?? 0) })] }, 'f'),
                    ledger.ledger.latestReview ? jsx.jsxs('span', { children: ['最新评审 ', jsx.jsx('b', { children: ledger.ledger.latestReview })] }, 'r') : null,
                    ledger.ledger.hook ? jsx.jsxs('span', { className: 'dshWmWikiHook', title: ledger.ledger.hook, children: ['章末钩子 ', jsx.jsx('b', { children: ledger.ledger.hook })] }, 'h') : null,
                  ] }),
                ] }, 'ledger')
              : null,
          ],
        }, 'sec-ledger'),
        jsx.jsxs(Section, {
          title: '资料',
          meta: docs.length ? `${docs.length} 篇` : '',
          children: [
            docs.length
              ? groups.map((g) => jsx.jsxs('div', { className: 'dshWmWikiDocGroup', children: [
                  jsx.jsx('div', { className: 'dshWmWikiSubHead', children: g.key }),
                  ...g.files.map((f) => jsx.jsx(DocCard, { file: f, onOpenDoc, onJumpToFile }, f.rel)),
                ] }, g.key))
              : jsx.jsx('div', { className: 'dshWmAiHint', children: '这个项目还没有设定集、大纲或状态资料，可在左栏项目行的「＋ 添加资料」按需建。' }),
          ],
        }, 'sec-docs'),
      ] }),
    ],
  })
}
