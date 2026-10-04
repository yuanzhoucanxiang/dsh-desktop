/**
 * 作品档案的 wiki 站点形态（route=wiki 的多页版）。
 *
 * 与 archive-html.js 的分工：**导出 = 单文件自包含快照**（打印/分享，渲染保持不动）；
 * **wiki 窗口 = 多页站点**——首页是入口（前提 + 统计 + 分区入口卡 + 设定/人物速览 + 章节导读），
 * 设定 / 进度 / 时间与伏笔 / 资料各成一页；资料按篇成页（doc-N），篇内 ##/### 小节 ≥2 的篇目
 * 再拆节页（doc-N-sK，「每个人物一页」由此落地）；每章正文一页（ch-N，带上一章/下一章）。
 * 页间只靠同源相对 GET 链接（?route=wiki&path=…&page=…）导航：CSP 禁脚本（index.js WIKI_CSP），
 * 自定义协议下 GET 表单不导航，所以不用表单、不用任何脚本。
 *
 * 渲染原语、转义与标记白名单、资料分组口径、基础样式全部复用 archive-html.js（单一事实源），
 * 本文件只做页面组装，零 IO——章节正文由 index.js 以 chapterText 注入（读不到就如实说明）。
 *
 * 链接标记约定：本文件产出的所有 <a> 一律 class 在 href 前——门禁脚本用 `<a href="?route=wiki…`
 * 精确匹配切换条（switcherSection）的链接，站内翻页链接不该混进那一组断言。
 */
import {
  ARCHIVE_HTML_VERSION,
  CSS,
  escapeHtml,
  inline,
  isLabelOnly,
  renderMarkdown,
  buildRefResolver,
  switcherSection,
  settingsSection,
  progressSection,
  ledgerSection,
  docArticle,
  dayBars,
} from './archive-html.js'

/** 页 id 白名单：只有这些形状能成为 page 参数（数据存在性在渲染时逐层回落）。 */
const PAGE_ID = /^(index|settings|progress|ledger|docs|doc-\d+|doc-\d+-s\d+|ch-\d+)$/

/** page 参数规范化：非法形状一律回首页——手抖改 URL 不该看到错误页。 */
export function parseWikiPage(raw) {
  const p = String(raw ?? '').trim()
  return PAGE_ID.test(p) ? p : 'index'
}

/** 站内链接：与 switcherSection 同形态（path 在前），首页省略 page。 */
export function pageHref(projectPath, page) {
  let u = '?route=wiki&amp;path=' + escapeHtml(encodeURIComponent(String(projectPath || '')))
  if (page && page !== 'index') u += '&amp;page=' + page
  return u
}

/**
 * 篇内分节：按 ## / ### 小节切（# 是篇目标题、归导语；#### 及更深留在所属节内）。
 * 「每个人物一页」靠它落地：人物稿里每个 ##/### 小节成为一张节页。
 */
export function splitDocSections(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  const intro = []
  let cur = null
  for (const line of lines) {
    const h = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (h) {
      if (cur) sections.push(cur)
      cur = { title: h[2], level: h[1].length, body: [] }
    } else if (cur) cur.body.push(line)
    else intro.push(line)
  }
  if (cur) sections.push(cur)
  return { intro: intro.join('\n').trim(), sections }
}

/** 卡片用的一句摘录：跳过标题/表格/分隔线/空标签行，取第一条有内容的行，截 60 字。 */
function excerptOf(text, n = 60) {
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let t = raw.trim()
    if (!t || /^#{1,6}\s/.test(t) || /^\|/.test(t) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(t) || isLabelOnly(t)) continue
    t = t.replace(/^[-*+]\s+/, '').replace(/^>\s?/, '').replace(/^\d+[.)]\s+/, '').trim()
    if (!t || isLabelOnly(t)) continue
    return escapeHtml(t.length > n ? t.slice(0, n) + '…' : t)
  }
  return ''
}

/** [[文稿名]] → 站内页链接：解析口径与导出页一致（buildRefResolver），只是目标从页内锚点换成页。 */
function siteRefs(model, projectPath) {
  const anchor = buildRefResolver(model)
  return (name) => {
    const a = anchor(name)
    return a ? pageHref(projectPath, a.slice(1)) : ''
  }
}

const NAV_ITEMS = [
  ['index', '首页'],
  ['settings', '设定'],
  ['progress', '进度'],
  ['ledger', '时间与伏笔'],
  ['docs', '资料'],
]

/** 顶条：书名链回首页 + 五个分区导航（当前区高亮）。粘性，往下翻也能换区。 */
function sitebar(model, projectPath, current) {
  const links = NAV_ITEMS.map(([id, label]) =>
    '<a class="nl' + (id === current ? ' is-current' : '') + '" href="' + pageHref(projectPath, id) + '">'
    + escapeHtml(label) + '</a>')
  return '<nav class="sitebar" aria-label="站点导航"><a class="brand" href="' + pageHref(projectPath, 'index') + '">'
    + escapeHtml(String(model.title || '作品档案')) + '</a><span class="navs">' + links.join('') + '</span></nav>'
}

/** 面包屑：子页用。最后一项是当前页（不可点）。 */
function crumb(projectPath, items) {
  const parts = items.map(([page, label], i) =>
    (i === items.length - 1 || !page)
      ? '<span>' + escapeHtml(label) + '</span>'
      : '<a class="pg" href="' + pageHref(projectPath, page) + '">' + escapeHtml(label) + '</a>')
  return '<p class="crumb">' + parts.join('<span class="sep"> › </span>') + '</p>'
}

/** 上一页/下一页（章页、节页用）。 */
function pager(prev, next) {
  return '<p class="pager">'
    + (prev ? '<a class="pg" href="' + prev.href + '">← ' + escapeHtml(prev.label) + '</a>' : '<span></span>')
    + (next ? '<a class="pg" href="' + next.href + '">' + escapeHtml(next.label) + ' →</a>' : '<span></span>')
    + '</p>'
}

/** 首页：入口，不是全部内容的堆叠——前提 + 统计 + 分区入口卡 + 设定/人物速览 + 章节导读。 */
function indexPage(model, projectPath, refs) {
  const chapters = model.chapters || []
  const docs = model.docs || []
  const settings = model.settings || []
  const ledger = model.ledger || {}
  const s = model.stats || {}
  const goal = Number(model.dailyGoal) || 0
  const total = chapters.reduce((n, r) => n + (Number(r.chars) || 0), 0)

  const statLine = '<p class="stats"><span><b>' + escapeHtml(Number(s.today) || 0) + '</b> 字 · 今天</span>'
    + '<span><b>' + escapeHtml(Number(s.streak) || 0) + '</b> 天连更</span>'
    + (goal ? '<span>日目标 <b>' + escapeHtml(goal) + '</b></span>' : '')
    + '<span><b>' + chapters.length + '</b> 章 · ' + escapeHtml(total) + ' 字</span></p>'
    + dayBars(model.stats)

  const entry = '<div class="pglist">' + [
    ['settings', '设定', (settings.length + (model.plainItems || []).length) + ' 条已确认' + (model.proposedCount ? ' · ' + model.proposedCount + ' 条候选' : '')],
    ['progress', '进度', chapters.length + ' 章 · ' + total + ' 字'],
    ['ledger', '时间与伏笔', '未回收伏笔 ' + (ledger.foreshadowOpen ?? 0)],
    ['docs', '资料', docs.length + ' 篇'],
  ].map(([p, label, meta]) =>
    '<a class="pgcard" href="' + pageHref(projectPath, p) + '"><h3>' + escapeHtml(label) + '</h3>'
    + '<p class="meta">' + escapeHtml(String(meta)) + '</p></a>').join('') + '</div>'

  // 设定速览：条目标题链到设定页的对应卡片（卡片锚点与导出页同一套 id）
  const setPreview = settings.length
    ? '<section><h2>设定</h2><p class="charline">' + settings.slice(0, 8).map((it, i) =>
      '<a class="pg" href="' + pageHref(projectPath, 'settings') + '#set-' + (i + 1) + '">'
      + escapeHtml(it.title || '（未命名条目）') + '</a>').join(' · ')
      + (settings.length > 8
        ? ' · <a class="pg" href="' + pageHref(projectPath, 'settings') + '">全部 ' + settings.length + ' 条 →</a>'
        : '')
      + '</p></section>'
    : ''

  // 人物速览：人物组资料的节页直达（没有分节的篇链到篇目页）
  const charLinks = []
  docs.forEach((d, i) => {
    if (d.group !== '人物') return
    const n = i + 1
    const { sections } = d.markdown === false ? { sections: [] } : splitDocSections(d.content)
    if (sections.length >= 2) {
      sections.forEach((sec, k) => charLinks.push({ href: pageHref(projectPath, 'doc-' + n + '-s' + (k + 1)), label: sec.title }))
    } else {
      charLinks.push({ href: pageHref(projectPath, 'doc-' + n), label: d.label || d.rel })
    }
  })
  const chars = charLinks.length
    ? '<section><h2>人物</h2><p class="charline">' + charLinks.slice(0, 16).map((c) =>
      '<a class="pg" href="' + c.href + '">' + escapeHtml(c.label) + '</a>').join(' · ')
      + (charLinks.length > 16 ? ' · <a class="pg" href="' + pageHref(projectPath, 'docs') + '">全部资料 →</a>' : '')
      + '</p></section>'
    : ''

  const chList = chapters.length
    ? '<section><h2>章节</h2><ol class="chapters">' + chapters.slice(0, 8).map((r, i) =>
      '<li><span class="ch-name"><a class="pg" href="' + pageHref(projectPath, 'ch-' + (i + 1)) + '">' + inline(r.name, refs) + '</a></span>'
      + '<span class="ch-meta">' + escapeHtml(Number(r.chars) || 0) + ' 字</span></li>').join('') + '</ol>'
      + (chapters.length > 8
        ? '<p class="note"><a class="pg" href="' + pageHref(projectPath, 'progress') + '">全部 ' + chapters.length + ' 章 →</a></p>'
        : '')
      + '</section>'
    : ''

  return '<header><h1>' + escapeHtml(String(model.title || '作品档案')) + '</h1>'
    + '<p class="sub">作品档案 · 生成于 ' + escapeHtml(model.generatedAt || '')
    + ' · 只读投影 · 改设定请回写作台的项目备忘</p>'
    + (model.premise ? '<p class="premise">' + inline(model.premise, refs) + '</p>' : '')
    + '</header>'
    + statLine
    + entry
    + setPreview
    + chars
    + chList
}

/** 资料索引页：按组列篇目卡（标签 + 一句摘录 + 小节数/相对路径）。 */
function docsIndexPage(model, projectPath) {
  const docs = model.docs || []
  if (!docs.length) return '<section><h2>资料</h2><p class="note">这个项目还没有设定集、大纲或状态资料。</p></section>'
  let out = '<section><h2>资料<span class="meta">' + escapeHtml(docs.length) + ' 篇</span></h2>'
  let group = null
  docs.forEach((d, i) => {
    if (d.group !== group) {
      if (group !== null) out += '</div>'
      group = d.group
      out += '<h3 class="grouptitle">' + inline(group) + '</h3><div class="pglist">'
    }
    const n = i + 1
    const { sections } = d.markdown === false ? { sections: [] } : splitDocSections(d.content)
    const excerpt = excerptOf(d.content)
    out += '<a class="pgcard" data-rel="' + escapeHtml(d.rel) + '" href="' + pageHref(projectPath, 'doc-' + n) + '">'
      + '<h3>' + escapeHtml(d.label || d.rel) + '</h3>'
      + (excerpt ? '<p class="excerpt">' + excerpt + '</p>' : '')
      + '<p class="meta">' + (sections.length >= 2 ? escapeHtml(sections.length) + ' 小节 · ' : '') + escapeHtml(d.rel) + '</p></a>'
  })
  return out + '</div></section>'
}

/** 篇目页：小节 ≥2 时是导语 + 节卡（正文在节页，不在这里堆叠）；否则整篇铺开（与导出页同一形态）。 */
function docPage(model, projectPath, refs, n) {
  const d = (model.docs || [])[n - 1]
  if (!d) return null
  const head = crumb(projectPath, [['index', '首页'], ['docs', '资料'], [null, d.label || d.rel]])
    + '<header><h1>' + escapeHtml(d.label || d.rel) + '</h1>'
    + '<p class="sub">' + escapeHtml(d.rel) + ' · ' + escapeHtml(d.group) + '</p></header>'
  if (d.markdown === false) return head + docArticle(d, n - 1, refs)
  const { intro, sections } = splitDocSections(d.content)
  if (sections.length < 2) return head + docArticle(d, n - 1, refs)
  const introHtml = intro ? '<div class="body docintro">' + renderMarkdown(intro, refs) + '</div>' : ''
  const cards = '<div class="pglist">' + sections.map((sec, k) => {
    const excerpt = excerptOf(sec.body.join('\n'))
    return '<a class="pgcard lv' + sec.level + '" data-section="' + (k + 1) + '" href="'
      + pageHref(projectPath, 'doc-' + n + '-s' + (k + 1)) + '">'
      + '<h3>' + escapeHtml(sec.title) + '</h3>'
      + (excerpt ? '<p class="excerpt">' + excerpt + '</p>' : '')
      + '</a>'
  }).join('') + '</div>'
  return head + introHtml + cards
}

/** 节页：篇内一个小节一页（「每个人物一页」）。带节间上下页与返回篇目。 */
function sectionPage(model, projectPath, refs, n, k) {
  const d = (model.docs || [])[n - 1]
  if (!d || d.markdown === false) return null
  const { sections } = splitDocSections(d.content)
  if (sections.length < 2) return null
  const sec = sections[k - 1]
  if (!sec) return null
  const body = renderMarkdown(sec.body.join('\n'), refs)
  const prev = k > 1 ? { href: pageHref(projectPath, 'doc-' + n + '-s' + (k - 1)), label: sections[k - 2].title } : null
  const next = k < sections.length ? { href: pageHref(projectPath, 'doc-' + n + '-s' + (k + 1)), label: sections[k].title } : null
  return crumb(projectPath, [['index', '首页'], ['docs', '资料'], ['doc-' + n, d.label || d.rel], [null, sec.title]])
    + '<header><h1>' + escapeHtml(sec.title) + '</h1>'
    + '<p class="sub">' + escapeHtml(d.label || d.rel) + ' · 第 ' + escapeHtml(k) + ' 节 · 共 ' + escapeHtml(sections.length) + ' 节</p></header>'
    + '<div class="body">' + (body.trim() || '<p class="note">这一节还没有正文。</p>') + '</div>'
    + pager(prev, next)
    + '<p class="note"><a class="pg" href="' + pageHref(projectPath, 'doc-' + n) + '">返回篇目：' + escapeHtml(d.label || d.rel) + '</a></p>'
}

/**
 * 章节正文用散文分段渲染，不走 renderMarkdown：手稿里「他说：」这种行绝不能被空标签过滤吞掉，
 * 空标签过滤是给资料模板降噪的，不是给正文用的。
 */
function proseHtml(text, refs) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
    .map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim())
    .map((b) => '<p>' + inline(b, refs).replace(/\n/g, '<br>') + '</p>')
    .join('\n')
}

/** 章页：当版正文一页，带上下章。chapterText 由 index.js 现读注入（null = 读不到，如实说明）。 */
function chapterPage(model, projectPath, refs, n, chapterText) {
  const rows = model.chapters || []
  const r = rows[n - 1]
  if (!r) return null
  const prev = n > 1 ? { href: pageHref(projectPath, 'ch-' + (n - 1)), label: rows[n - 2].name } : null
  const next = n < rows.length ? { href: pageHref(projectPath, 'ch-' + (n + 1)), label: rows[n].name } : null
  const gate = r.gate
    ? ' <span class="gate ' + (r.gate.pass ? 'pass' : 'fail') + '">'
      + inline(r.gate.pass ? '门禁 ✓' : '门禁 ' + (r.gate.fail ?? '?')) + '</span>'
    : ''
  return crumb(projectPath, [['index', '首页'], ['progress', '进度'], [null, r.name]])
    + '<header><h1>' + inline(r.name, refs) + '</h1>'
    + '<p class="sub">' + escapeHtml(Number(r.chars) || 0) + ' 字' + gate + '</p></header>'
    + '<div class="body">'
    + (chapterText == null
      ? '<p class="note">这一章的文件现在读不到（可能在档案打开期间被移动或改名）；回写作台确认后重开档案。</p>'
      : proseHtml(chapterText, refs) || '<p class="note">这一章还是空的。</p>')
    + '</div>'
    + pager(prev, next)
}

/**
 * 站点整页。opts: { page（原始 page 参数，规范化在内部做）, projectPath, chapterText }。
 * 越界页逐层回落：节不在 → 篇目页；篇不在 → 资料索引；章不在 → 进度页；形状非法 → 首页。
 */
export function renderWikiSite(model = {}, opts = {}) {
  const projectPath = String(opts.projectPath || model.currentPath || '')
  const page = parseWikiPage(opts.page)
  const refs = siteRefs(model, projectPath)
  let nav = page
  let body = null
  let m
  if (page === 'settings') {
    body = settingsSection(model, refs)
  } else if (page === 'progress') {
    body = progressSection(model, refs, { chapterHref: (i) => pageHref(projectPath, 'ch-' + i) })
  } else if (page === 'ledger') {
    body = ledgerSection(model, refs)
  } else if (page === 'docs') {
    body = docsIndexPage(model, projectPath)
  } else if ((m = /^doc-(\d+)-s(\d+)$/.exec(page))) {
    nav = 'docs'
    body = sectionPage(model, projectPath, refs, Number(m[1]), Number(m[2]))
      || docPage(model, projectPath, refs, Number(m[1]))
      || docsIndexPage(model, projectPath)
  } else if ((m = /^doc-(\d+)$/.exec(page))) {
    nav = 'docs'
    body = docPage(model, projectPath, refs, Number(m[1])) || docsIndexPage(model, projectPath)
  } else if ((m = /^ch-(\d+)$/.exec(page))) {
    nav = 'progress'
    body = chapterPage(model, projectPath, refs, Number(m[1]), opts.chapterText)
      || progressSection(model, refs, { chapterHref: (i) => pageHref(projectPath, 'ch-' + i) })
  } else {
    nav = 'index'
    body = indexPage(model, projectPath, refs)
  }
  const title = String(model.title || '作品档案')
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="generator" content="dsh-writing-mode archive ' + ARCHIVE_HTML_VERSION + '">'
    + '<title>' + escapeHtml(title) + ' · 作品档案</title>'
    + '<style>' + CSS + SITE_CSS + '</style></head><body><div class="wrap">'
    + sitebar(model, projectPath, nav)
    + switcherSection(model)
    + body
    + '<footer>内容来自作品自己的文件：已确认设定读自 state/writing-memory.json（权威），'
    + '进度与资料读自 draft/、bible/、outline/、state/。本页不额外保存任何东西。</footer>'
    + '</div></body></html>\n'
}

/** 站点附加样式（基础样式复用 archive-html 的 CSS）：顶条 / 面包屑 / 卡片网格 / 上下页。 */
const SITE_CSS = `
.sitebar{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;margin:0 0 4px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--layer);font-family:system-ui,sans-serif;font-size:13px;position:sticky;top:10px;z-index:2;box-shadow:0 8px 24px rgba(41,42,38,.08)}
.sitebar .brand{font-weight:700;font-size:14px;text-decoration:none}
.sitebar .navs{display:flex;flex-wrap:wrap;gap:4px 14px}
.sitebar .nl{color:var(--ink2);text-decoration:none;border-bottom:1px dotted transparent;padding-bottom:1px}
.sitebar .nl:hover{color:var(--brand)}
.sitebar .nl.is-current{color:var(--ink);font-weight:600;border-bottom-color:var(--ink3)}
.crumb{margin:20px 0 0;font-size:12px;color:var(--ink3);font-family:system-ui,sans-serif}
.crumb .sep{opacity:.5}
.pglist{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin-top:14px}
.pgcard{display:block;background:var(--layer);border:1px solid var(--line);border-radius:12px;padding:12px 14px;text-decoration:none;color:inherit;break-inside:avoid}
.pgcard:hover{border-color:var(--brand)}
.pgcard h3{margin:0;font-size:15px}
.pgcard.lv3 h3{padding-left:16px}
.pgcard .excerpt{margin:6px 0 0;font-size:12.5px;color:var(--ink2);line-height:1.7}
.pgcard .meta{margin:6px 0 0;font-size:11px;color:var(--ink3);font-family:system-ui,sans-serif}
h3.grouptitle{margin:26px 0 4px;font-size:13px;letter-spacing:.06em;color:var(--ink3);font-family:system-ui,sans-serif}
.charline{margin:8px 0 0;line-height:2.1}
a.pg{color:inherit;text-decoration:none;border-bottom:1px dotted var(--ink3)}
a.pg:hover{color:var(--brand);border-bottom-color:var(--brand)}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:30px;font-size:13px;font-family:system-ui,sans-serif}
.docintro{padding-bottom:8px;border-bottom:1px solid var(--line)}
pre{white-space:pre-wrap;word-break:break-word}
@media print{
 .sitebar,.crumb,.pager{display:none}
}
`
