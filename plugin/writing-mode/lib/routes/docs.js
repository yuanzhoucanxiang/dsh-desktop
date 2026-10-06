/**
 * 文档与测量域路由（get / save / version / delete / gate / ledger / stats / outline / reorder）。
 * 从 index.js 原样搬出（2026-10-05 阶段二：样板守卫收敛到 helpers.js，错误码/状态码不变）；
 * ctx = { req, res, url, route, cfg }。
 */
import path from 'node:path'
import {
  readDoc, writeDoc, createVersion, deleteDoc, normalizePrefs,
  effectiveRoots, resolveUnderRoots, resolveProjectDir, findProjectRoot, newDraftPath,
} from '../store.js'
import { withFileLock } from '../file-lock.js'
import { runGates, ledgerSummary, outlineSummary } from '../domain.js'
import { seedBaseline, recordSave, projectStatsFor } from '../writing-stats.js'
import { reorderDraftSeries } from '../reorder.js'
import { scheduleDailySnapshot } from '../snapshot.js'
import { writeJson } from '../http.js'
import { readParsed, targetUnder, projectUnder } from './helpers.js'

/** GET get：打开稿件；打开即播种码字基线（首见只记字数不计增量）。 */
export async function getDoc({ req, res, url, cfg }) {
  const target = targetUnder({ res, cfg }, url.searchParams.get('path') || '')
  if (target === null) return
  try {
    const doc = readDoc(target)
    // 打开即播种码字基线：首见稿件只记当前字数、不计增量（防老项目首存虚增）。
    try {
      const proj = findProjectRoot(target.abs)
      if (proj) seedBaseline(proj, target.abs, doc.content)
    } catch {}
    writeJson(res, 200, { ok: true, doc })
  } catch (err) {
    writeJson(res, 404, { ok: false, error: String(err?.message || err) })
  }
}

/** POST save / version：写稿与另存新版；成功后 host 侧码字记账。 */
export async function saveDoc({ req, res, route, cfg }) {
  const parsed = await readParsed({ req, res })
  if (parsed === null) return
  const roots = effectiveRoots(cfg)
  let targetPath = parsed?.path
  if (!targetPath && route === 'save') {
    const rootPath =
      (typeof parsed?.root === 'string' && parsed.root) ||
      cfg.activeRoot ||
      (roots.find((r) => r.real) || {}).real
    if (!rootPath) {
      writeJson(res, 400, { ok: false, error: 'no-root' })
      return
    }
    targetPath = newDraftPath(rootPath, parsed?.title)
  }
  const target = targetUnder({ res, cfg }, targetPath)
  if (target === null) return
  try {
    const doc = route === 'version'
      ? createVersion(target, parsed.content)
      : writeDoc(target, parsed.content, parsed.revision)
    // 码字记账在保存成功之后：host 侧权威；version（另存新版）走同一条口径，
    // 新路径首见自动按播种处理，不会把整章存量算成今日净增。
    try {
      const proj = findProjectRoot(doc.path || target)
      if (proj) {
        recordSave(proj, doc.path || target, doc.content ?? parsed.content)
        // 每日快照（安全网）：每作品每天一份，fire-and-forget，绝不影响保存主链路。
        scheduleDailySnapshot(proj)
      }
    } catch {}
    writeJson(res, 200, { ok: true, doc })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
  }
}

/** POST delete：删稿（带 revision 协议）。 */
export async function deleteDocRoute({ req, res, cfg }) {
  const parsed = await readParsed({ req, res })
  if (parsed === null) return
  const target = targetUnder({ res, cfg }, parsed?.path || '')
  if (target === null) return
  try {
    deleteDoc(target, parsed.revision)
    writeJson(res, 200, { ok: true })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
  }
}

/** POST gate：门禁（content 直给或按 path 现读）。 */
export async function postGate({ req, res, cfg }) {
  const parsed = await readParsed({ req, res })
  if (parsed === null) return
  let content = parsed?.content
  let filePath = parsed?.path || ''
  if (typeof content !== 'string') {
    if (!filePath) {
      writeJson(res, 400, { ok: false, error: 'need-content-or-path' })
      return
    }
    const target = targetUnder({ res, cfg }, filePath)
    if (target === null) return
    try {
      const doc = readDoc(target)
      content = doc.content
      filePath = doc.path
    } catch (err) {
      writeJson(res, 404, { ok: false, error: String(err?.message || err) })
      return
    }
  }
  writeJson(res, 200, { ok: true, gate: runGates(filePath, content), path: filePath })
}

/** POST ledger：台账速览（按稿件路径解析作品）。 */
export async function postLedger({ req, res, cfg }) {
  const parsed = await readParsed({ req, res })
  if (parsed === null) return
  const roots = effectiveRoots(cfg)
  const target = targetUnder({ res, cfg }, parsed?.path || '')
  if (target === null) return
  const proj = findProjectRoot(target.abs)
  if (!proj) {
    writeJson(res, 200, { ok: true, ledger: null })
    return
  }
  if (resolveUnderRoots(proj, roots) === null) {
    writeJson(res, 400, { ok: false, error: 'project-outside-roots' })
    return
  }
  writeJson(res, 200, { ok: true, ledger: ledgerSummary(proj, target.abs) })
}

/** GET stats：码字统计（今日净增/连击/近 14 天 + 目标）。只读不记账；记账只在 save/version 成功后发生。 */
export async function getStats({ req, res, url, cfg }) {
  const roots = effectiveRoots(cfg)
  const target = targetUnder({ res, cfg }, url.searchParams.get('path') || '')
  if (target === null) return
  const found = projectStatsFor(target.abs, { spanDays: 14 })
  if (!found) {
    writeJson(res, 200, { ok: true, stats: null })
    return
  }
  if (resolveUnderRoots(found.projectDir, roots) === null) {
    writeJson(res, 400, { ok: false, error: 'project-outside-roots' })
    return
  }
  writeJson(res, 200, { ok: true, stats: found.summary, dailyGoal: normalizePrefs(cfg.prefs).dailyGoal || 0 })
}

/** GET outline：大纲视图批量口径（只读）：每章当前版字数/钩子/门禁 + structure.md 标题行 */
export async function getOutline({ req, res, url, cfg }) {
  const project = projectUnder({ res, cfg }, url.searchParams.get('project') || '')
  if (project === null) return
  writeJson(res, 200, { ok: true, outline: outlineSummary(project) })
}

/**
 * POST reorder：章节重排序（卡片拖拽）：把期望顺序落实为 draft/ 内的重命名事务。
 * 项目级锁互斥；期望顺序与现有系列一一对应才受理；绝不覆盖既有文件。
 */
export async function postReorder({ req, res, cfg }) {
  const parsed = await readParsed({ req, res })
  if (parsed === null) return
  const project = projectUnder({ res, cfg }, parsed?.project || '')
  if (project === null) return
  if (!Array.isArray(parsed?.order)) {
    writeJson(res, 400, { ok: false, error: 'order-required' })
    return
  }
  try {
    const result = withFileLock(path.join(project, 'state', '.reorder.lock'), () => reorderDraftSeries(project, parsed.order))
    writeJson(res, 200, { ok: true, ...result })
  } catch (err) {
    const code = String(err?.code || err?.message || err)
    const status = code === 'reorder-collision' || code === 'reorder-leftovers' || code === 'reorder-tmp-exists' || code.startsWith('reorder-leftovers')
      ? 409
      : code.startsWith('order-') ? 400 : (err?.status || 500)
    writeJson(res, status, { ok: false, error: code })
  }
}
