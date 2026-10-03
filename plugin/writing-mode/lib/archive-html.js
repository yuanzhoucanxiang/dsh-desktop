/**
 * 作品档案导出（HTML）的纯函数核心：把已确认设定、写作进度与资料文稿渲染成一页自包含 HTML。
 *
 * 零 IO——读文件、路径校验、独占创建都在 index.js 的 archive-export 路由里（与 compile 同一分工）。
 * 定位与档案面板一致：**只读投影**，页面本身不保存任何东西，删掉可随时重生成。
 *
 * 安全边界：所有文字先整体转义，之后只放进出过白名单的少量标记（标题 / 列表 / 表格 / 引用 /
 * 粗斜体 / 行内码 / http(s) 链接 / [[文稿名]] 标注）。作者稿子里写的 <script> 或 javascript:
 * 只会以字面文字出现，不会变成可执行的东西。
 */

import { PROJECT_RESOURCES } from './templates.js'

export const ARCHIVE_HTML_VERSION = 1

// 摘出行内片段时用的哨兵。转义后的作者文字里不会出现 \u0000（下面先整体剔除），所以不会误伤。
const HOLD = '\u0000'

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/\u0000/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 只放行 http/https：javascript:、data: 与相对跳转一律不进导出页（档案页不该有能力导航别处）。 */
function safeHref(url) {
  const raw = String(url ?? '').replace(/&amp;/g, '&').trim()
  return /^https?:\/\/\S{1,500}$/i.test(raw) ? raw : ''
}

/**
 * [[文稿名]] → 页内锚点。解析规则与客户端 features/companion/jump.js 对齐：
 * 精确文件名 → 抹掉 -vN 的题名 → 无扩展名时前缀匹配，多版本取最新；都解析不到返回 ''
 * （那就仍然渲染成不可导航的标注——导出页不该有能力跳到页外）。
 * 可解析的目标是页面上真有的东西：资料区每篇 + 进度区每一章。
 */
export function buildRefResolver(model = {}) {
  const base = (p) => String(p || '').split(/[\\/]/).pop()
  const stem = (n) => n.replace(/-v\d+(\.[^.]+)?$/i, '$1').toLowerCase()
  const version = (n) => Number(n.match(/-v(\d+)(\.[^.]+)$/i)?.[1] || 0)
  const targets = [
    ...(model.docs || []).map((d, i) => ({ name: base(d.rel), anchor: 'doc-' + (i + 1) })),
    ...(model.chapters || []).map((c, i) => ({ name: c.name, anchor: 'ch-' + (i + 1) })),
  ].filter((t) => t.name)
  const latest = (arr) => arr.slice().sort((a, b) => version(b.name) - version(a.name))[0]
  return (wanted) => {
    const want = String(wanted || '').trim().toLowerCase()
    if (!want) return ''
    const hit = latest(targets.filter((t) => t.name.toLowerCase() === want))
      || latest(targets.filter((t) => stem(t.name) === stem(want)))
      || (!/\.[^.]+$/.test(want) ? latest(targets.filter((t) => t.name.toLowerCase().startsWith(want))) : null)
    return hit ? '#' + hit.anchor : ''
  }
}

// 锚点 id 只由 host 生成（doc-N / ch-N / set-N / sec-*），作者文字进不了 href。
const SAFE_ANCHOR = /^#[a-z0-9-]{1,80}$/

/**
 * 行内标记。入参必须是**已转义**的文字；行内码、链接与 [[标注]] 先摘出来占位，
 * 其余规则跑完再放回，避免代码里的 ** 被当成粗体。
 */
export function inlineMarks(escaped, resolveRef) {
  const held = []
  const keep = (html) => {
    held.push(html)
    return HOLD + (held.length - 1) + HOLD
  }
  let s = String(escaped ?? '')
  s = s.replace(/`([^`\n]+)`/g, (m, code) => keep('<code>' + code + '</code>'))
  s = s.replace(/\[\[([^\]\n]{1,80})\]\]/g, (m, name) => {
    const href = typeof resolveRef === 'function' ? String(resolveRef(name) || '') : ''
    return keep(SAFE_ANCHOR.test(href)
      ? '<a class="ref" href="' + href + '">' + name + '</a>'
      : '<span class="ref">' + name + '</span>')
  })
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^)\n]{1,500})\)/g, (m, label, url) => {
    const href = safeHref(url)
    return keep(href
      ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
      : label)
  })
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  return s.replace(new RegExp(HOLD + '(\\d+)' + HOLD, 'g'), (m, n) => held[Number(n)] ?? '')
}

const isBlank = (l) => !l || !String(l).trim()
const headingOf = (l) => /^(#{1,6})\s+(.*)$/.exec(String(l))
const isHr = (l) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(String(l))
const bulletOf = (l) => /^\s*[-*+]\s+(.*)$/.exec(String(l))
const orderedOf = (l) => /^\s*\d+[.)]\s+(.*)$/.exec(String(l))
const quoteOf = (l) => /^\s*>\s?(.*)$/.exec(String(l))
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(String(l))
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(String(l))
const cellsOf = (l) => String(l).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const inline = (text, refs) => inlineMarks(escapeHtml(text), refs)

/**
 * 资料正文的 Markdown 子集渲染（块级）：标题 / 分隔线 / 表格 / 引用 / 有序无序列表 / 段落。
 * 认不出的语法一律当普通段落，不抛错——资料是作者手写的，长得奇怪也得原样读得出来。
 */
export function renderMarkdown(text, refs, opts) {
  const prefix = String((opts && opts.anchorPrefix) || '')
  const sink = Array.isArray(opts && opts.headings) ? opts.headings : null
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i += 1; continue }
    const h = headingOf(line)
    if (h) {
      const lvl = Math.min(6, h[1].length + 2) // 页面本身占了 h1/h2，文稿标题从 h3 起
      const title = h[2].trim()
      let id = ''
      // 篇内锚点同样只由 host 生成（<prefix>-h-<序号>）：作者写的标题文字进不了 id
      if (prefix && SAFE_ANCHOR.test('#' + prefix + '-h-' + (sink.length + 1))) {
        const anchor = '#' + prefix + '-h-' + (sink.length + 1)
        id = ' id="' + anchor.slice(1) + '"'
        sink.push({ level: lvl, title, anchor })
      }
      out.push('<h' + lvl + id + '>' + inline(title, refs) + '</h' + lvl + '>')
      i += 1
      continue
    }
    if (isHr(line)) { out.push('<hr>'); i += 1; continue }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cellsOf(line)
      i += 2
      const body = []
      while (i < lines.length && isTableRow(lines[i])) { body.push(cellsOf(lines[i])); i += 1 }
      const thead = '<thead><tr>' + head.map((c) => '<th>' + inline(c, refs) + '</th>').join('') + '</tr></thead>'
      const tbody = '<tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c, refs) + '</td>').join('') + '</tr>').join('') + '</tbody>'
      out.push('<div class="tablewrap"><table>' + thead + tbody + '</table></div>')
      continue
    }
    if (quoteOf(line)) {
      const buf = []
      while (i < lines.length && quoteOf(lines[i])) { buf.push(quoteOf(lines[i])[1]); i += 1 }
      out.push('<blockquote>' + inline(buf.join(' '), refs) + '</blockquote>')
      continue
    }
    if (bulletOf(line)) {
      const buf = []
      while (i < lines.length && bulletOf(lines[i])) { buf.push(bulletOf(lines[i])[1]); i += 1 }
      out.push('<ul>' + buf.map((x) => '<li>' + inline(x, refs) + '</li>').join('') + '</ul>')
      continue
    }
    if (orderedOf(line)) {
      const buf = []
      while (i < lines.length && orderedOf(lines[i])) { buf.push(orderedOf(lines[i])[1]); i += 1 }
      out.push('<ol>' + buf.map((x) => '<li>' + inline(x, refs) + '</li>').join('') + '</ol>')
      continue
    }
    const para = []
    while (
      i < lines.length
      && !isBlank(lines[i]) && !headingOf(lines[i]) && !isHr(lines[i])
      && !bulletOf(lines[i]) && !orderedOf(lines[i]) && !quoteOf(lines[i]) && !isTableRow(lines[i])
    ) { para.push(lines[i]); i += 1 }
    out.push('<p>' + inline(para.join('\n'), refs).replace(/\n/g, '<br>') + '</p>')
  }
  return out.join('\n')
}

/** 自包含样式：屏幕上是稿纸色的档案页，打印时去底色、留分页。 */
const CSS = `
:root{--ink:#292a26;--ink2:#52554b;--ink3:#777b6c;--line:#cfcec4;--paper:#f7f5ef;--layer:#efede7;--brand:#526d51;--warn:#c9a227;--bad:#b34636}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.85 "Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",Georgia,serif}
.wrap{max-width:820px;margin:0 auto;padding:48px 28px 72px}
header h1{font-size:30px;margin:0 0 6px;letter-spacing:.02em}
.sub{margin:0;color:var(--ink3);font-size:12px;font-family:system-ui,sans-serif}
.premise{margin:16px 0 0;padding:12px 14px;border-left:3px solid var(--brand);background:var(--layer);color:var(--ink2)}
h2{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin:44px 0 14px;padding-bottom:6px;border-bottom:1px solid var(--line);font-family:system-ui,sans-serif}
h2 .meta{float:right;font-weight:400;letter-spacing:0;text-transform:none}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--layer);border:1px solid var(--line);border-radius:12px;padding:14px 16px;break-inside:avoid}
.card.boundary{border-left:3px solid var(--warn)}
.card h3{margin:0;font-size:16px}
.from{float:right;font-size:11px;color:var(--ink3);font-family:system-ui,sans-serif}
.concl{margin:8px 0 0}
.bound{margin:6px 0 0;font-size:13.5px;color:var(--ink2)}
details{margin-top:8px;font-size:13.5px;color:var(--ink2)}
summary{cursor:pointer;font-size:11.5px;color:var(--ink3);font-family:system-ui,sans-serif}
blockquote{margin:8px 0 0;padding-left:10px;border-left:2px solid var(--line);color:var(--ink2);font-size:13.5px}
blockquote .who{display:block;font-size:11px;color:var(--ink3);font-family:system-ui,sans-serif}
.tags{margin:8px 0 0;font-size:11.5px;color:var(--ink3);font-family:system-ui,sans-serif}
.note{margin:12px 0 0;font-size:12.5px;color:var(--ink3);font-family:system-ui,sans-serif}
ul.plain{list-style:none;margin:0;padding:0}
ul.plain li{display:flex;gap:10px;padding:5px 0;border-bottom:1px dotted var(--line)}
.kind{flex:none;min-width:34px;font-size:11px;color:var(--ink3);font-family:system-ui,sans-serif}
.stats{display:flex;flex-wrap:wrap;gap:18px;font-family:system-ui,sans-serif;font-size:13px;color:var(--ink2);margin:0 0 10px}
.stats b{font-size:19px;color:var(--ink)}
ol.chapters{margin:0;padding-left:26px}
ol.chapters li{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;padding:3px 0}
.ch-name{font-weight:600}
.ch-meta,.ch-hook,.gate{font-size:12px;color:var(--ink3);font-family:system-ui,sans-serif}
.ch-hook{flex:1;min-width:120px}
.gate{padding:0 7px;border-radius:999px;background:var(--layer)}
.gate.pass{color:var(--brand)}
.gate.fail{color:var(--bad)}
.doc{margin:0 0 20px}
.doc h3{margin:22px 0 4px;font-size:15px}
.doc .rel{font-size:11px;color:var(--ink3);font-family:ui-monospace,Consolas,monospace}
.doc .body{border-top:1px solid var(--line);padding-top:6px}
.doc .body h3,.doc .body h4,.doc .body h5{margin:14px 0 4px;font-size:14px}
.tablewrap{overflow:auto}
table{border-collapse:collapse;font-size:13.5px;min-width:100%}
th,td{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top}
hr{border:0;border-top:1px solid var(--line);margin:18px 0}
.ref{border-bottom:1px dotted var(--ink3)}
code{font-family:ui-monospace,Consolas,monospace;font-size:.9em;background:var(--layer);border-radius:4px;padding:.05em .3em}
a{color:inherit}
footer{margin-top:44px;padding-top:12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink3);font-family:system-ui,sans-serif}
[id]{scroll-margin-top:14px}
.toc{margin:28px 0 0;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--layer)}
.switcher{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin:22px 0 0;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--layer);font-family:system-ui,sans-serif;font-size:12.5px}
.switcherLabel{color:var(--ink3);margin-right:2px}
.switcher a{color:var(--ink2);text-decoration:none;border-bottom:1px dotted var(--ink3)}
.switcher a:hover{color:var(--brand);border-bottom-color:var(--brand)}
.switcher .is-current{color:var(--ink);font-weight:600}
.switcher .sep{color:var(--ink3);opacity:.5}
.toc h2{margin:0 0 8px;border:0;padding:0}
.toc ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.toc li{font-size:13px}
.toc a{text-decoration:none;border-bottom:1px solid transparent}
.toc a:hover{border-bottom-color:var(--ink3)}
.tocSub{display:block;margin-top:2px;font-size:12px;color:var(--ink3);line-height:1.9}
.docToc{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0 10px;padding:8px 12px;border-left:2px solid var(--line);font-size:12.5px;font-family:system-ui,sans-serif}
.docToc a{color:var(--ink2);text-decoration:none;border-bottom:1px dotted transparent}
.docToc a:hover{color:var(--ink);border-bottom-color:var(--ink3)}
.docToc .lv4,.docToc .lv5,.docToc .lv6{font-size:12px;color:var(--ink3)}
.ref{border-bottom:1px dotted var(--ink3);text-decoration:none}
a.ref:hover{color:var(--brand)}
@media print{
 .toc,.docToc,.switcher{display:none}
}
@media print{
 body{background:#fff;font-size:11.5pt;line-height:1.6}
 .wrap{max-width:none;padding:0}
 h2{margin-top:20pt}
 .card,.doc{background:#fff}
 summary{display:none}
 a{text-decoration:none}
}
@page{margin:18mm 16mm}
`

const FROM_LABEL = { assistant: '来自讨论', host: '内核', author: '作者记录' }
const KIND_LABEL = { preference: '偏好', 'open-question': '待定', fact: '设定' }

function settingsSection(m, refs) {
  const list = m.settings || []
  const cards = list.map((it, i) => {
    const excerpts = (it.sources || []).filter((x) => x && x.excerpt).slice(0, 2)
    const more = []
    if (it.explanation) more.push('<p>' + inline(it.explanation, refs) + '</p>')
    more.push(...excerpts.map((x) => '<blockquote><span class="who">'
      + inline(x.role === 'author' ? '你说过' : '伙伴说过') + '</span><p>' + inline(x.excerpt, refs) + '</p></blockquote>'))
    if ((it.tags || []).length) more.push('<p class="tags">标签：' + it.tags.map((t) => inline(t, refs)).join(' · ') + '</p>')
    return '<article class="card' + (it.boundaries ? ' boundary' : '') + '" id="set-' + (i + 1) + '">'
      + '<span class="from">' + inline(FROM_LABEL[it.fromKind] || '作者记录') + '</span>'
      + '<h3>' + inline(it.title || '（未命名条目）', refs) + '</h3>'
      + '<p class="concl">' + inline(it.conclusion || it.text || '', refs) + '</p>'
      + (it.boundaries ? '<p class="bound">边界 / 例外：' + inline(it.boundaries, refs) + '</p>' : '')
      + (more.length ? '<details open><summary>说明与出处</summary>' + more.join('') + '</details>' : '')
      + '</article>'
  })
  const plain = (m.plainItems || []).map((it) => '<li><span class="kind">'
    + inline(KIND_LABEL[it.kind] || '设定') + '</span><span>' + inline(it.text, refs) + '</span></li>')
  return '<section id="sec-settings"><h2>设定<span class="meta">' + inline((list.length + (m.plainItems || []).length) + ' 条已确认') + '</span></h2>'
    + (cards.length ? '<div class="cards">' + cards.join('') + '</div>' : '')
    + (plain.length ? '<p class="note">其他已确认备忘</p><ul class="plain">' + plain.join('') + '</ul>' : '')
    + (list.length || plain.length ? '' : '<p class="note">还没有已确认的设定。与写作伙伴讨论后，在项目备忘里确认的条目才会进这份档案。</p>')
    + (m.proposedCount ? '<p class="note">另有 ' + inline(m.proposedCount) + ' 条候选未确认，未列入档案。</p>' : '')
    + '</section>'
}

function progressSection(m, refs) {
  const rows = m.chapters || []
  const s = m.stats || {}
  const goal = Number(m.dailyGoal) || 0
  const total = rows.reduce((n, r) => n + (Number(r.chars) || 0), 0)
  const gate = (r) => (r.gate
    ? '<span class="gate ' + (r.gate.pass ? 'pass' : 'fail') + '">'
      + inline(r.gate.pass ? '门禁 ✓' : '门禁 ' + (r.gate.fail ?? '?')) + '</span>'
    : '')
  return '<section id="sec-progress"><h2>进度<span class="meta">' + inline(rows.length + ' 篇 · ' + total + ' 字') + '</span></h2>'
    + '<p class="stats"><span><b>' + inline(Number(s.today) || 0) + '</b> 字 · 今天</span>'
    + '<span><b>' + inline(Number(s.streak) || 0) + '</b> 天连更</span>'
    + (goal ? '<span>日目标 <b>' + inline(goal) + '</b></span>' : '')
    + '</p>'
    + (rows.length
      ? '<ol class="chapters">' + rows.map((r, i) => '<li id="ch-' + (i + 1) + '"><span class="ch-name">' + inline(r.name, refs) + '</span>'
        + '<span class="ch-meta">' + inline((Number(r.chars) || 0) + ' 字') + '</span>' + gate(r)
        + (r.hook ? '<span class="ch-hook">' + inline(r.hook, refs) + '</span>' : '') + '</li>').join('') + '</ol>'
      : '<p class="note">draft/ 下还没有正文。</p>')
    + (s.corrupt ? '<p class="note">统计文件读取异常，上面的数字可能不准。</p>' : '')
    + '</section>'
}

function ledgerSection(m, refs) {
  const l = m.ledger || {}
  const timeline = (l.timeline || []).map((x) => '<li>' + inline(x, refs) + '</li>')
  return '<section id="sec-ledger"><h2>时间与伏笔</h2>'
    + (timeline.length ? '<ul>' + timeline.join('') + '</ul>' : '<p class="note">bible/timeline.md 还没有条目。</p>')
    + '<p class="note">未回收伏笔 ' + inline(l.foreshadowOpen ?? 0)
    + (l.latestReview ? ' · 最新评审 ' + inline(l.latestReview) : '')
    + (l.hook ? ' · 章末钩子 ' + inline(l.hook, refs) : '') + '</p></section>'
}

/**
 * 作品切换器：一排链接（当前这部不是链接）。档案页 CSP 关着脚本，所以不能做下拉 + onchange；
 * 试过 GET 表单，但 Chromium 对 `dsh-app:` 这类自定义协议不提交表单（点了没导航），
 * 于是回到最朴素也最稳的办法——相对链接，浏览器原生就能跳，无需任何脚本。
 * 只有 ≥2 部作品时才给。projects 由 wiki 出口自己算并塞进 model（见 index.js 的 route=wiki），
 * 导出出口不塞——那是一部作品的快照，不是入口，所以自然长不出这块。
 */
export function switcherSection(m) {
  const list = (m.projects || []).filter((p) => p && p.path)
  if (list.length < 2) return ''
  const current = String(m.currentPath || '').toLowerCase()
  const items = list.map((p) => {
    const label = escapeHtml(p.name || p.path) + (p.rootLabel ? ' · ' + escapeHtml(p.rootLabel) : '')
    if (String(p.path).toLowerCase() === current) return '<span class="is-current">' + label + '</span>'
    return '<a href="?route=wiki&amp;path=' + escapeHtml(encodeURIComponent(p.path)) + '">' + label + '</a>'
  })
  return '<nav class="switcher" aria-label="切换作品"><span class="switcherLabel">换作品</span>'
    + items.join('<span class="sep">·</span>') + '</nav>'
}

/** 目录：条目不多时连设定与资料一起列，多到一定量就只留四个大区，不把导航变成负担。 */
function tocSection(m) {
  const SUB_LIMIT = 40
  const group = (label, href, subs) => '<li><a href="' + href + '">' + escapeHtml(label) + '</a>'
    + (subs.length && subs.length <= SUB_LIMIT
      ? '<span class="tocSub">' + subs.map((s) => '<a href="' + s.href + '">' + escapeHtml(s.label) + '</a>').join(' · ') + '</span>'
      : '') + '</li>'
  const items = [
    group('设定', '#sec-settings', (m.settings || []).map((it, i) => ({ href: '#set-' + (i + 1), label: it.title || '（未命名条目）' }))),
    group('进度', '#sec-progress', (m.chapters || []).map((c, i) => ({ href: '#ch-' + (i + 1), label: c.name }))),
    group('时间与伏笔', '#sec-ledger', []),
    group('资料', '#sec-docs', (m.docs || []).map((d, i) => ({ href: '#doc-' + (i + 1), label: d.label || d.rel }))),
  ]
  return '<nav class="toc" aria-label="目录"><h2>目录</h2><ul>' + items.join('') + '</ul></nav>'
}

function docsSection(m, refs) {
  const docs = m.docs || []
  if (!docs.length) return '<section id="sec-docs"><h2>资料</h2><p class="note">这个项目还没有设定集、大纲或状态资料。</p></section>'
  let out = '<section id="sec-docs"><h2>资料<span class="meta">' + inline(docs.length + ' 篇') + '</span></h2>'
  let group = null
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    if (d.group !== group) {
      if (group !== null) out += '</div>'
      group = d.group
      out += '<div class="docgroup"><h3>' + inline(group) + '</h3>'
    }
    // 篇内小目录：标题 ≥2 才给（一篇只有一个标题时，目录纯属噪音）
    const headings = []
    const body = d.markdown === false
      ? '<pre>' + escapeHtml(d.content) + '</pre>'
      : renderMarkdown(d.content, refs, { anchorPrefix: 'doc-' + (i + 1), headings })
    out += '<article class="doc" id="doc-' + (i + 1) + '"><div class="rel">' + inline(d.rel) + '</div>'
      + (headings.length >= 2
        ? '<nav class="docToc" aria-label="本篇目录">' + headings.map((x) =>
          '<a class="lv' + x.level + '" href="' + x.anchor + '">' + escapeHtml(x.title) + '</a>').join('') + '</nav>'
        : '')
      + '<div class="body">' + body + '</div></article>'
  }
  return out + '</div></section>'
}

/**
 * model = { title, premise, generatedAt, settings[], proposedCount, plainItems[],
 *           chapters[{name,chars,gate,gatePass,gateFail,hook}], stats{today,streak,corrupt},
 *           dailyGoal, ledger{timeline[],foreshadowOpen,latestReview,hook},
 *           docs[{rel,label,group,content,markdown}] }
 */
export function renderArchiveHtml(model = {}) {
  const title = String(model.title || '作品档案')
  // 页内引用解析器要先建好：资料与设定正文里的 [[文稿名]] 要能跳到本页的章节 / 资料锚点
  const refs = buildRefResolver(model)
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="generator" content="dsh-writing-mode archive ' + ARCHIVE_HTML_VERSION + '">'
    + '<title>' + escapeHtml(title) + ' · 作品档案</title>'
    + '<style>' + CSS + '</style></head><body><div class="wrap">'
    + '<header><h1>' + escapeHtml(title) + '</h1>'
    + '<p class="sub">作品档案 · 生成于 ' + escapeHtml(model.generatedAt || '')
    + ' · 只读投影：改设定请回写作台的项目备忘，这份文件删掉可随时重生成</p>'
    + (model.premise ? '<p class="premise">' + inline(model.premise, refs) + '</p>' : '')
    + '</header>'
    + switcherSection(model)
    + tocSection(model)
    + settingsSection(model, refs)
    + progressSection(model, refs)
    + ledgerSection(model, refs)
    + docsSection(model, refs)
    + '<footer>内容来自作品自己的文件：已确认设定读自 state/writing-memory.json（权威），'
    + '进度与资料读自 draft/、bible/、outline/、state/。本页不额外保存任何东西。</footer>'
    + '</div></body></html>\n'
}

/* ---- 资料分组 / 标签 / 前提：与客户端文档库同一套目录口径，导出页不该出现第三套名字 ---- */

const DOC_GROUPS = [
  ['作品概览', (rel) => rel === 'project.md'],
  ['人物', (rel) => rel === 'bible/characters.md' || rel === 'bible/relationships.md'],
  ['世界与设定', (rel) => rel.startsWith('bible/')],
  ['故事规划', (rel) => rel.startsWith('outline/')],
  ['创作跟踪', (rel) => rel.startsWith('state/')],
  ['评审', (rel) => rel.startsWith('reviews/')],
  ['其他文档', () => true],
]

const normRel = (rel) => String(rel ?? '').replaceAll('\\', '/').toLowerCase()

export function docGroupOf(rel) {
  const r = normRel(rel)
  return (DOC_GROUPS.find(([, test]) => test(r)) || DOC_GROUPS[DOC_GROUPS.length - 1])[0]
}

export function docGroupRank(group) {
  const i = DOC_GROUPS.findIndex(([name]) => name === group)
  return i < 0 ? DOC_GROUPS.length : i
}

/** 标签表直接复用 host 的按需添加资料白名单，避免两处各写一份中文名。 */
const DOC_LABELS = new Map([
  ...PROJECT_RESOURCES.map(([rel, label]) => [normRel(rel), label]),
  ['project.md', '作品概览'],
  ['bible/世界观整理.md', '已确认设定（整理稿）'],
])

export function docLabelOf(rel, name) {
  return DOC_LABELS.get(normRel(rel)) || String(name || rel || '')
}

/**
 * 作品概览里的一句话：优先「一句话故事 / 前提 / 梗概」小节下的第一段，退回首段正文。
 * 退回首段时要跳过"光有标签没有内容"的行（模板里 `核心冲突：` 后面还没填时，
 * 把它当前提显示出来只会像半成品）——真实作品上踩过。
 */
export function premiseOf(projectMarkdown) {
  const text = String(projectMarkdown ?? '')
  const one = /一句话(?:故事|前提|梗概)[^\n]*\n+([^\n#]+)/.exec(text)
  const first = (one && one[1].trim()) || ''
  if (first && !/[:：]\s*$/.test(first)) return first.slice(0, 300)
  const para = (text.split(/\r?\n\s*\r?\n/).find((block) => {
    const t = block.trim()
    return t && !/^\s*#/.test(t) && !/[:：]\s*$/.test(t.split('\n')[0]) && t.length >= 6
  }) || '').trim()
  return para.slice(0, 300)
}
