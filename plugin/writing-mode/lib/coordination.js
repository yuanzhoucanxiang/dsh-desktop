/**
 * 会话创建协调记录（方案 P2 §3.2/§3.3）：跨窗口、跨进程的
 * 「预留 reserved → 创建中 creating → 已绑定 bound / 不确定 uncertain」协议。
 *
 * 为什么需要：两个窗口可能同时对同一作品首次关联写作伙伴。进程内可以用 Promise 共用，
 * 但两个窗口是两个渲染进程，必须有一份**持久、可核对的记录**，否则会各建一个会话。
 *
 * 安全分寸（方案硬要求，逐条对应）：
 *   1. 记录放应用 home 下的 writing-mode 专用目录，按项目身份分桶，统一走 lib/file-lock.js
 *      的受验证跨进程互斥；**网络/内核调用不在锁内等待**（锁只圈住读改写这几步）。
 *   2. 过期 token 不得改写新绑定：confirm/release 必须 operationToken 完全一致，否则 stale-token。
 *   3. 不承诺 exactly-once，也不自动删除疑似孤立会话：external 结果无法确认时进 uncertain，
 *      保留已知 workspace/session 标识，给出继续关联/查看完整会话的恢复路径。
 *   4. 心跳/超时只用于**发现**需要恢复的操作，不授权抢活锁、不触发重复创建。
 *   5. 记录是协调用的辅助状态，不是会话真相：真相永远是内核里的原生会话与内存中的 store。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withFileLock } from './file-lock.js'

export const COORD_SCHEMA = 1
export const PHASES = new Set(['reserved', 'creating', 'bound', 'uncertain'])
/** creating 阶段超过这个时长视为"需要恢复"（只用于提示，不自动改写，见分寸 4）。 */
export const STALE_CREATING_MS = 120000

export function coordinationError(code, status = 400, extra = {}) {
  const err = new Error(code)
  err.code = code
  err.status = status
  Object.assign(err, extra)
  return err
}

/** 应用 home 下的写作模式专用目录（与 store.js 的 configFile 同源）。 */
export function writingHome() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, '.writing-mode')
}

export function coordinationDir() {
  return path.join(writingHome(), 'coordination')
}

/** 项目身份 → 桶文件名（不把路径明文写进文件名；跨平台大小写/分隔符归一）。 */
export function bucketOf(projectKey) {
  const canonical = String(projectKey || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (!canonical) throw coordinationError('project-identity-required', 400)
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32) + '.json'
}

export function recordPath(projectKey) {
  return path.join(coordinationDir(), bucketOf(projectKey))
}

export function emptyRecord(projectKey) {
  return {
    schemaVersion: COORD_SCHEMA,
    projectKey,
    version: 0,
    phase: null,
    operationToken: null,
    owner: null,
    sessionId: null,
    workspaceId: null,
    bindingVersion: null,
    reservedAt: null,
    updatedAt: null,
    history: [],
  }
}

function normalizeRecord(raw, projectKey) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyRecord(projectKey)
  if (raw.schemaVersion !== COORD_SCHEMA) throw coordinationError('unknown-schema', 400, { schemaVersion: raw.schemaVersion })
  if (!PHASES.has(raw.phase)) throw coordinationError('bad-record', 500)
  return raw
}

export function readCoordination(projectKey, opts = {}) {
  const file = recordPath(projectKey)
  if (!fs.existsSync(file)) return emptyRecord(projectKey)
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    // 坏 JSON：保留原件（绝不当作空记录覆盖），并把诊断交给调用方
    throw coordinationError('corrupt-record', 500, { file, detail: err.message })
  }
  const rec = normalizeRecord(raw, projectKey)
  return { ...rec, stale: rec.phase === 'creating' && Date.now() - Number(rec.updatedAt || 0) > (opts.staleMs ?? STALE_CREATING_MS) }
}

function writeRecord(file, record) {
  const body = JSON.stringify(record, null, 2)
  const tmp = path.join(path.dirname(file), `.${randomUUID()}.tmp`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

/** 读改写三段都在锁内完成；fn 必须是纯计算，不得含网络/内核调用。 */
function mutate(projectKey, fn) {
  const file = recordPath(projectKey)
  return withFileLock(file, () => {
    let current
    try {
      current = readCoordination(projectKey)
    } catch (err) {
      // 坏记录不覆盖：交给作者/诊断路径处理
      throw err
    }
    const next = fn(current)
    if (!next) return current
    next.version = Number(current.version || 0) + 1
    next.updatedAt = Date.now()
    next.projectKey = projectKey
    next.schemaVersion = COORD_SCHEMA
    next.history = [...(current.history || []), { at: next.updatedAt, phase: next.phase, operationToken: next.operationToken, by: 'host' }].slice(-20)
    writeRecord(file, next)
    return next
  }, coordinationError)
}

/**
 * 预留一个创建操作。返回 { outcome, record }：
 *   'claimed'     —— 本次拿到创建权（caller 随后标 creating 再真正创建）
 *   'bound'       —— 已有绑定，直接用它的 sessionId（不重复创建）
 *   'in-progress' —— 另一个 owner 正在创建中（等待它 confirm，或进 uncertain，**不要另建**）
 *   'uncertain'   —— 上次创建结果不明，需要恢复路径而不是新建
 */
export function claimCoordination({ projectKey, operationToken, owner = null, now = Date.now() }) {
  if (!operationToken) throw coordinationError('operation-token-required', 400)
  return mutate(projectKey, (current) => {
    if (current.phase === 'bound' && current.sessionId) {
      return { ...current, _outcome: 'bound' }
    }
    // 预留中/创建中且 token 不同 → 一律视为"别人正在创建"（**包括仅 reserved**）：
    // reserved 到 creating 之间隔着一次网络调用，窗口 B 若把别人的预留当"没人要"就会双建会话
    // （2026-09-14 fixture 实测到双建）。等对方 confirm，或走恢复入口——不抢。
    if ((current.phase === 'creating' || current.phase === 'reserved') && current.operationToken !== operationToken) {
      return { ...current, _outcome: 'in-progress' }
    }
    if (current.phase === 'uncertain' && current.operationToken !== operationToken) {
      return { ...current, _outcome: 'uncertain' }
    }
    return {
      ...current,
      phase: 'reserved',
      operationToken,
      owner,
      reservedAt: now,
      _outcome: 'claimed',
    }
  })
}

/** 进入"创建中"（在真正调内核之前调用；此时不要持锁做网络调用）。 */
export function markCreatingCoordination({ projectKey, operationToken }) {
  return mutate(projectKey, (current) => {
    if (current.operationToken !== operationToken) return { ...current, _outcome: 'stale-token' }
    if (current.phase === 'bound') return { ...current, _outcome: 'already-bound' }
    return { ...current, phase: 'creating', _outcome: 'creating' }
  })
}

/**
 * 确认绑定。只有持有当前 operationToken 的调用方能写；过期 token 一律 stale-token。
 * knownIds 允许在 sessionId 未知时只写 workspaceId（H04：workspace 已建但 session 结果丢失）。
 */
export function confirmCoordination({ projectKey, operationToken, sessionId = null, workspaceId = null, bindingVersion = null }) {
  return mutate(projectKey, (current) => {
    if (current.operationToken !== operationToken) return { ...current, _outcome: 'stale-token' }
    if (!sessionId && !workspaceId) return { ...current, _outcome: 'nothing-to-confirm' }
    return {
      ...current,
      phase: sessionId ? 'bound' : 'creating',
      sessionId: sessionId || current.sessionId,
      workspaceId: workspaceId || current.workspaceId,
      bindingVersion: bindingVersion ?? current.bindingVersion,
      _outcome: sessionId ? 'bound' : 'partial',
    }
  })
}

/** 外部结果无法确认 → uncertain，保留已知标识（不删记录、不删会话）。 */
export function markUncertainCoordination({ projectKey, operationToken, workspaceId = null, sessionId = null, reason = 'unconfirmed' }) {
  return mutate(projectKey, (current) => {
    if (current.operationToken !== operationToken) return { ...current, _outcome: 'stale-token' }
    return {
      ...current,
      phase: 'uncertain',
      workspaceId: workspaceId || current.workspaceId,
      sessionId: sessionId || current.sessionId,
      reason,
      _outcome: 'uncertain',
    }
  })
}

/**
 * 释放预留。**只有"预留但一个原生对象都还没建"（phase=reserved 且无已知标识）才允许删除**；
 * creating/uncertain 一律拒绝——外部创建可能已经发生，删了记录就再也找不到它（分寸 3）。
 */
export function releaseCoordination({ projectKey, operationToken }) {
  const file = recordPath(projectKey)
  return withFileLock(file, () => {
    const current = readCoordination(projectKey)
    if (current.phase === null) return { ...current, _outcome: 'absent' }
    if (current.operationToken !== operationToken) return { ...current, _outcome: 'stale-token' }
    if (current.phase !== 'reserved' || current.workspaceId || current.sessionId) {
      return { ...current, _outcome: 'kept' }
    }
    try {
      fs.unlinkSync(file)
    } catch {}
    return { ...emptyRecord(projectKey), _outcome: 'released' }
  }, coordinationError)
}

/**
 * 清掉一条记录（作者明确"放弃这次关联"时才由 UI 调用）。
 *
 * B03 加固：删除同样受**互斥 + 记录条件**约束——调用方要带上它看到的 operationToken / version，
 * 与当前记录不一致就拒绝（别人已经推进过这条记录，你不能按旧认知删）。删除仍在文件锁内完成，
 * 且不做"重建"以外的任何副作用：记录没了就真的没了，所以条件不满足时宁可拒绝。
 */
export function forgetCoordination({ projectKey, operationToken = null, expectedVersion = null, force = false }) {
  const file = recordPath(projectKey)
  if (force !== true && operationToken === null && expectedVersion === null) {
    throw coordinationError('forget-needs-guard', 400)
  }
  return withFileLock(file, () => {
    let current
    try {
      current = readCoordination(projectKey)
    } catch {
      // 坏记录：不删（原件保留给诊断）
      return { ok: false, file, error: 'corrupt-record' }
    }
    if (current.phase === null) return { ok: true, file, absent: true, retained: true }
    if (!force) {
      if (operationToken !== null && current.operationToken !== operationToken) {
        return { ok: false, file, error: 'stale-token', retained: true, phase: current.phase }
      }
      if (expectedVersion !== null && Number(current.version) !== Number(expectedVersion)) {
        return { ok: false, file, error: 'version-mismatch', retained: true, phase: current.phase, version: current.version }
      }
    }
    try {
      fs.unlinkSync(file)
      return { ok: true, file }
    } catch (err) {
      if (err.code === 'ENOENT') return { ok: true, file, absent: true }
      throw coordinationError('forget-failed', 500, { detail: err.message })
    }
  }, coordinationError)
}
