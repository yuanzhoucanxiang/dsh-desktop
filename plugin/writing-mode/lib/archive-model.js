/**
 * 档案页的数据组装（从 index.js 原样搬出，行为不变）：`archive-export`（落盘成单文件快照）
 * 与 `wiki`（多页站点）共用同一份口径，免得两个出口对「什么算已确认设定」「哪篇算当前版」各说各话。
 * 抛出的错误带 status/code，由调用方原样回给客户端——这里不决定「是文件还是页面」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readDoc, storeError, normalizePrefs, listProjectFiles } from './store.js'
import { readMemory } from './project-memory.js'
import { outlineSummary, ledgerSummary } from './domain.js'
import { projectStatsFor } from './writing-stats.js'
import { latestOfSeries, naturalSortFiles, chapterTitle, safeBookTitle } from './compile.js'
import { renderArchiveHtml, docGroupOf, docGroupRank, docLabelOf, premiseOf } from './archive-html.js'

export function buildArchiveModel(projectReal, prefs, titleOverride, extra) {
  const mem = readMemory(projectReal)
  if (mem?.error) throw storeError('memory-' + mem.error, 409)
  const items = mem?.memory?.items || []
  const isWorld = (it) => it.kind === 'fact' && it.setting?.type === 'world'
  const confirmed = items.filter((it) => it.status === 'confirmed')
  const settings = confirmed.filter(isWorld).map((it) => ({
    title: it.setting?.title || '',
    conclusion: it.setting?.conclusion || it.text || '',
    explanation: it.setting?.explanation || '',
    boundaries: it.setting?.boundaries || '',
    tags: it.setting?.tags || [],
    sources: it.setting?.sources || [],
    fromKind: it.source?.kind || 'author',
  }))
  const plainItems = confirmed.filter((it) => !isWorld(it)).map((it) => ({ kind: it.kind, text: it.text }))
  const outline = outlineSummary(projectReal)
  const statsFound = projectStatsFor(projectReal, { spanDays: 14 })
  const allFiles = listProjectFiles(projectReal)
  const docFiles = naturalSortFiles(latestOfSeries(allFiles.filter((f) => !f.rel.startsWith('draft/'))).latest)
    .sort((a, b) => docGroupRank(docGroupOf(a.rel)) - docGroupRank(docGroupOf(b.rel))
      || String(a.rel).localeCompare(String(b.rel), 'zh', { numeric: true }))
  const docs = []
  try {
    for (const f of docFiles) {
      docs.push({
        rel: f.rel,
        label: docLabelOf(f.rel, f.name),
        group: docGroupOf(f.rel),
        content: fs.readFileSync(f.abs, 'utf8'),
        markdown: /\.(md|markdown)$/i.test(f.name),
      })
    }
  } catch {
    // 扫描到读取之间文件被移走：如实报，不半成品
    throw storeError('source-changed', 409)
  }
  const bookTitle = safeBookTitle(String(titleOverride || '').trim() || path.basename(projectReal))
  if (!bookTitle) throw storeError('invalid-title', 400)
  const projectDoc = docs.find((d) => String(d.rel).toLowerCase() === 'project.md')
  const model = {
    title: bookTitle,
    premise: premiseOf(projectDoc?.content || ''),
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    settings,
    proposedCount: items.filter((it) => it.status === 'proposed').length,
    plainItems,
    chapters: outline.rows.map((r) => ({ ...r, name: chapterTitle(r.name) })),
    stats: statsFound?.summary || null,
    dailyGoal: normalizePrefs(prefs).dailyGoal || 0,
    ledger: ledgerSummary(projectReal, outline.rows[0]?.abs),
    docs,
    ...(extra || {}),
  }
  return { model, bookTitle, counts: { settings: settings.length, docs: docs.length, chapters: outline.rows.length } }
}

/** 导出口：同一份 model 渲染成单文件自包含 HTML（打印/分享快照，渲染层保持不动）。 */
export function assembleArchiveModel(projectReal, prefs, titleOverride, extra) {
  const { model, bookTitle, counts } = buildArchiveModel(projectReal, prefs, titleOverride, extra)
  return { html: renderArchiveHtml(model), bookTitle, counts }
}

/**
 * 档案页是「作者自己写的文字 + 我们的模板」拼出来的文档，CSP 把可执行性整个关掉：
 * 页面本来就没有脚本（导航全靠锚点与相对链接），这条头是第二道防线——稿子里的 <script>
 * 既已被转义，也绝不会被放行执行。样式必须 'unsafe-inline'（单文件自包含的代价）。
 */
export const WIKI_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
