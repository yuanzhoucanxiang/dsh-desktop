/**
 * 备忘与恢复域路由（memory / memory-operation / setting-projection / maintenance / project-recovery）。
 * 从 index.js 原样搬出，行为不变；ctx = { req, res, url, cfg }。
 */
import {
  readMemory,
  applyMemoryOp,
  injectableItems,
  memoryError,
  memoryApiPayload,
  getOperationReceipt,
  syncSettingProjection,
  quotaOf,
} from '../project-memory.js'
import { readSettingProjection, renderSettingProjection, PROJECTION_REL } from '../setting-projection.js'
import { listDraftLocks } from '../draft-checkpoints.js'
import { listCoordinationLocks } from '../coordination.js'
import { effectiveRoots, resolveUnderRoots, resolveProjectDir } from '../store.js'
import { relocationCandidates, recoverRelocation, relocationHistory } from '../project-recovery.js'
import { writeJson, readJsonBody } from '../http.js'

const libraryRootsOf = (roots) => roots.map((r) => r.real).filter(Boolean)

/** GET memory：备忘全量 + 注入清单 + schema/能力/投影。 */
export async function getMemory({ req, res, url, cfg }) {
  const roots = effectiveRoots(cfg)
  const raw = url.searchParams.get('path') || ''
  const target = resolveUnderRoots(raw, roots)
  const proj = target ? resolveProjectDir(target.abs, roots) : null
  if (!proj) {
    writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
    return
  }
  try {
    const payload = memoryApiPayload(proj, {
      libraryRoots: libraryRootsOf(roots),
    })
    writeJson(res, 200, payload)
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
  }
}

/** POST memory：备忘操作（候选/确认/修订/撤回…按 op 分发）。 */
export async function postMemory({ req, res, cfg }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  const roots = effectiveRoots(cfg)
  const target = resolveUnderRoots(parsed?.path || '', roots)
  const proj = target ? resolveProjectDir(target.abs, roots) : null
  if (!proj) {
    writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
    return
  }
  try {
    if (parsed.op === 'update-projection') throw memoryError('projection-operation-private', 400)
    const r = applyMemoryOp(
      proj,
      {
        op: parsed.op,
        baseRevision: parsed.baseRevision,
        baseEtag: parsed.baseEtag,
        id: parsed.id,
        item: parsed.item,
        actor: parsed.actor,
        operationId: parsed.operationId,
        requestHash: parsed.requestHash,
        clientSchemaVersion: parsed.clientSchemaVersion,
      },
      { libraryRoots: libraryRootsOf(roots) }
    )
    writeJson(res, 200, {
      ok: true,
      project: proj,
      memory: r.memory,
      etag: r.etag,
      injectable: injectableItems(r.memory),
      schemaVersion: r.memory.schemaVersion,
      projection: r.memory.projection || null,
      receipt: r.receipt || null,
      replay: Boolean(r.replay),
      // V9：每次写回都带上配额用量，让 UI 能在撞墙前提醒并提供归档入口
      quota: r.quota || quotaOf(r.memory),
      archived: r.archived || null,
    })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
  }
}

/** GET memory-operation：操作回执查询（不触发重写）。 */
export async function getMemoryOperation({ req, res, url, cfg }) {
  const roots = effectiveRoots(cfg)
  const raw = url.searchParams.get('path') || ''
  const operationId = url.searchParams.get('operationId') || ''
  const target = resolveUnderRoots(raw, roots)
  const proj = target ? resolveProjectDir(target.abs, roots) : null
  if (!proj || !operationId) {
    writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
    return
  }
  try {
    const { memory } = readMemory(proj, {
      libraryRoots: libraryRootsOf(roots),
    })
    const receipt = getOperationReceipt(memory, operationId)
    if (!receipt) {
      writeJson(res, 200, { ok: true, found: false, receipt: null })
      return
    }
    writeJson(res, 200, { ok: true, found: true, receipt, revision: memory.revision })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
  }
}

/** GET/POST setting-projection：可读稿投影的读与重建（POST 在项目锁内、固定路径）。 */
export async function settingProjectionRoute({ req, res, url, cfg }) {
  const parsed = req.method === 'POST' ? await readJsonBody(req) : { path: url.searchParams.get('path') }
  if (!parsed) { writeJson(res, 400, { ok: false, error: 'invalid-json' }); return }
  const roots = effectiveRoots(cfg)
  const target = resolveUnderRoots(parsed.path || '', roots)
  const proj = target ? resolveProjectDir(target.abs, roots) : null
  if (!proj) { writeJson(res, 400, { ok: false, error: 'path-outside-roots' }); return }
  try {
    const opts = { libraryRoots: libraryRootsOf(roots) }
    if (req.method === 'GET') {
      const current = readMemory(proj, opts)
      const disk = readSettingProjection(proj)
      const proposed = renderSettingProjection(current.memory.items, { sourceRevision: current.memory.revision, projectKey: proj })
      writeJson(res, 200, { ok: true, ...disk, proposed, projection: current.memory.projection, revision: current.memory.revision, etag: current.etag })
    } else {
      if (parsed.targetPath && parsed.targetPath !== PROJECTION_REL) throw memoryError('projection-path-fixed', 409)
      writeJson(res, 200, syncSettingProjection(proj, parsed, opts))
    }
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err.code || err.message || err) })
  }
}

/**
 * V4/V9：维护入口——锁诊断（**只读**）+ 当前作品的配额用量。
 * CXR01 之后这里不再移动任何锁：内核在跑就意味着可能有写入者，
 * 而在线移动他人的锁无法保证互斥。
 */
export async function maintenanceRoute({ req, res, url, cfg }) {
  if (req.method === 'GET') {
    const rawPath = url.searchParams.get('path') || ''
    let quota = null
    let memoryErrorCode = null
    if (rawPath) {
      const roots = effectiveRoots(cfg)
      const t = resolveUnderRoots(rawPath, roots)
      const proj = t ? resolveProjectDir(t.abs, roots) : null
      if (proj) {
        try {
          quota = quotaOf(readMemory(proj, { libraryRoots: libraryRootsOf(roots) }).memory)
        } catch (err) {
          memoryErrorCode = String(err?.code || err?.message || err)
        }
      }
    }
    writeJson(res, 200, {
      ok: true,
      locks: { drafts: listDraftLocks(), coordination: listCoordinationLocks() },
      quota,
      memoryError: memoryErrorCode,
    })
    return
  }
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  if (parsed.action === 'clear-stale-locks') {
    // CXR01（P1）：这个动作**不再移动任何锁**，改为拒绝 + 只读诊断 + 可操作指引。
    // 理由：复核之后、改名之前可能有写入者取得该锁，移走它就造成两个写入方临界区重叠；
    // 而本接口跑在内核里，“没有任何写入者”无法被证明。自动隔离只能走离线维护。
    try {
      const drafts = listDraftLocks()
      const coordination = listCoordinationLocks()
      const stale = [...drafts, ...coordination].filter((r) => r.dead)
      writeJson(res, 409, {
        ok: false,
        error: 'stale-lock-clear-refused-online',
        reason: '在线移动他人的锁无法保证互斥（复核与改名之间可能有写入者取得该锁），会把活锁移走造成临界区重叠。',
        stale,
        instruction: stale.length
          ? `请关闭 DeepSeek Harness Desktop（确认没有正在保存的写入），再手动删除这些锁文件：${stale.map((r) => r.path).join('; ')}`
          : '当前没有残留锁。列出的锁若 alive=true 属于正在写入的进程，不要删。',
        locks: { drafts, coordination },
      })
    } catch (err) {
      writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
    }
    return
  }
  writeJson(res, 400, { ok: false, error: 'unknown-action' })
}

/** GET/POST project-recovery：作品迁移候选 / 执行恢复（显式确认才导入无关联稿件）。 */
export async function projectRecoveryRoute({ req, res, url, cfg }) {
  const body = req.method === 'POST' ? await readJsonBody(req) : { path: url.searchParams.get('path') }
  const roots = effectiveRoots(cfg)
  const t = body && resolveUnderRoots(body.path, roots)
  const proj = t && resolveProjectDir(t.abs, roots)
  if (!proj) return writeJson(res, 400, { ok: false, error: 'bad-path' })
  try {
    if (req.method === 'GET') return writeJson(res, 200, { ok: true, candidates: relocationCandidates(proj, cfg.companions), histories: relocationHistory(proj) })
    const result = recoverRelocation(proj, body.oldPath, body.token, cfg.companions, { confirmUnrelated: body.confirmUnrelated === true })
    return writeJson(res, 200, { ok: true, ...result })
  } catch (err) { return writeJson(res, err.status || 500, { ok: false, error: err.code || err.message }) }
}
