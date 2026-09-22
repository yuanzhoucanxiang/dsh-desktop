/**
 * Durable unsent-draft checkpoints with per-bucket revision (T03).
 * POST requires baseRev matching stored rev (or 0 for new).
 * Queue on client serializes writes; backend still rejects stale baseRev.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { withFileLock, inspectLock } from './file-lock.js'
import { identityKey } from './project-identity.js'

export const SCHEMA = 2
export const MAX_TEXT = 500000
export const MAX_REF = 200000
/** V7：列表回传上限（防止响应体随历史窗口数无界增长）。 */
export const MAX_DRAFT_LIST = 24
/** V4：草稿写入是高频自动保存，不能让它卡满 8s；活锁短等、残留锁更快失败。 */
const DRAFT_LOCK_OPTS = { deadlineMs: 1500, staleFastFailMs: 250 }

function draftRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'writing-mode', 'drafts')
}

function bucketKey(project, windowId) {
  // V6：走全库统一的 identityKey（分隔符 / 尾部斜杠 / 大小写 / \0 分桶后缀），
  // 与 coordination.bucketOf 同口径，不再因为一个尾部分隔符就分裂成两个桶。
  const p = identityKey(project)
  const w = String(windowId || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default'
  return createHash('sha256').update(p + '\n' + w).digest('hex').slice(0, 32)
}

function draftFile(project, windowId) {
  return path.join(draftRoot(), bucketKey(project, windowId) + '.json')
}

export function draftError(code, status = 400) {
  return Object.assign(new Error(code), { status, code })
}

function readCheckpointFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || ![1, SCHEMA].includes(data.schemaVersion) || typeof data.text !== 'string' || typeof data.project !== 'string' || typeof data.windowId !== 'string' || (data.schemaVersion === SCHEMA && (!Number.isInteger(data.rev) || data.rev < 0)) || (data.reference != null && (typeof data.reference !== 'object' || Array.isArray(data.reference)))) throw draftError('corrupt-draft', 409)
    return {
      ...data,
      rev: Number(data.rev) || 0,
      cleared: Boolean(data.cleared),
    }
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw draftError(err instanceof SyntaxError || err.code === 'corrupt-draft' ? 'corrupt-draft' : 'draft-read-failed', 409)
  }
}

/**
 * V6 升级兼容：旧口径的桶文件名（只读回退）。
 *
 * identityKey 现在会剥尾部分隔符（与 coordination 同口径），旧版不剥。对于带尾分隔符
 * 写过的桶，新口径算出的是另一个文件名——若不回退，那些草稿升级后就读不到了
 * （而 listCheckpoints 按身份匹配仍会把它们列出来，形成「看得到读不到」的不对称）。
 * 回退是**只读**的：写入一律落新桶，下次保存自然完成迁移（baseRev 从旧桶的 rev 接着算）。
 * 不带尾分隔符时旧口径与新口径完全相同，返回 null，零开销、零行为变化。
 */
function legacyDraftFile(project, windowId) {
  const legacy = String(project ?? '').replace(/\\/g, '/').toLowerCase()
  if (legacy === identityKey(project)) return null
  const w = String(windowId || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default'
  return path.join(draftRoot(), createHash('sha256').update(legacy + '\n' + w).digest('hex').slice(0, 32) + '.json')
}

export function readCheckpoint(project, windowId) {
  const own = readCheckpointFile(draftFile(project, windowId))
  if (own !== null) return own
  // 当前桶不存在才回退；当前桶**损坏**时依旧抛 corrupt-draft，不拿旧桶掩盖损坏
  const legacy = legacyDraftFile(project, windowId)
  if (!legacy) return null
  const rec = readCheckpointFile(legacy)
  return rec ? { ...rec, legacyBucket: true } : null
}

/**
 * @param {string} project
 * @param {string} windowId
 * @param {{text?:string, reference?:object|null, baseRev?:number|null}} draft
 */
export function writeCheckpoint(project, windowId, draft, lockOpts = DRAFT_LOCK_OPTS) {
  return withFileLock(draftFile(project, windowId), () => writeUnlocked(project, windowId, draft), draftError, lockOpts)
}

export function damagedCheckpointHash(project, windowId) {
  try { return createHash('sha256').update(fs.readFileSync(draftFile(project, windowId))).digest('hex') } catch { return null }
}

export function recoverDamagedCheckpoint(project, windowId, draft, expectedHash) {
  const file = draftFile(project, windowId)
  return withFileLock(file, () => {
    if (!expectedHash || damagedCheckpointHash(project, windowId) !== expectedHash) throw draftError('recovery-source-changed', 409)
    try { readCheckpoint(project, windowId); throw draftError('draft-not-corrupt', 409) }
    catch (err) { if (err.code !== 'corrupt-draft') throw err }
    const backup = file + '.damaged-' + randomUUID() + '.bak'
    fs.renameSync(file, backup)
    try { return { ...writeUnlocked(project, windowId, { ...draft, baseRev: 0 }), backup: path.basename(backup) } }
    catch (err) { if (!fs.existsSync(file)) fs.copyFileSync(backup, file, fs.constants.COPYFILE_EXCL); throw err }
  }, draftError, DRAFT_LOCK_OPTS)
}
function writeUnlocked(project, windowId, draft) {
  const file = draftFile(project, windowId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const current = readCheckpoint(project, windowId)
  const storedRev = current?.rev ?? 0
  const baseRev = draft?.baseRev
  if (baseRev === undefined || baseRev === null || !Number.isInteger(Number(baseRev))) {
    throw draftError('draft-rev-required', 428)
  }
  if (Number(baseRev) !== storedRev) {
    throw draftError('draft-rev-conflict', 409)
  }
  const text = String(draft?.text || '')
  if (text.length > MAX_TEXT) throw draftError('draft-too-large', 413)
  const refText = draft?.reference ? String(draft.reference.text || '') : null
  if (refText && refText.length > MAX_REF) throw draftError('reference-too-large', 413)
  const reference = draft?.reference
    ? {
        label: String(draft.reference.label || '引用').slice(0, 200),
        text: refText,
        path: draft.reference.path ? String(draft.reference.path).slice(0, 500) : null,
        revision: draft.reference.revision ?? null,
        selection: draft.reference.selection || null,
        // B08：引用身份字段必须一起持久化——漏掉快照指纹会让"取自未保存快照"的引用
        // 在 round-trip 之后被 referenceStatus 判成 current（2026-09-14 复核实测）。
        snapshotFingerprint: draft.reference.snapshotFingerprint ? String(draft.reference.snapshotFingerprint).slice(0, 200) : null,
        note: draft.reference.note ? String(draft.reference.note).slice(0, 500) : null,
        legacy: draft.reference.legacy === true ? true : undefined,
      }
    : null
  if (!text && !reference) {
    // W03: clear is a version bump tombstone, never a protocol reset.
    const nextRevClear = storedRev + 1
    const data = {
      schemaVersion: SCHEMA,
      project: String(project || ''),
      windowId: String(windowId || 'default'),
      text: '',
      reference: null,
      rev: nextRevClear,
      cleared: true,
      updatedAt: new Date().toISOString(),
    }
    const tmp = file + '.' + randomUUID() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return { ok: true, cleared: true, rev: nextRevClear, checkpoint: data }
  }
  const nextRev = storedRev + 1
  const data = {
    schemaVersion: SCHEMA,
    project: String(project || ''),
    windowId: String(windowId || 'default'),
    text,
    reference,
    rev: nextRev,
    updatedAt: new Date().toISOString(),
  }
  const tmp = file + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return { ok: true, checkpoint: data }
}

export function listCheckpoints(project) {
  const dir = draftRoot()
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  // V6：按**归一化身份**比对，不是原始串全等。旧记录里存的是当时的原始路径串
  // （可能带尾部分隔符、可能是未经 realpath 的拼法），用原口径比会让跨窗口恢复
  // 列表悄悄为空——作者看不到另一个窗口的草稿，却得不到任何错误。
  const key = identityKey(project)
  const out = []
  for (const name of names) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (identityKey(data.project) === key) out.push(data)
    } catch {}
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return out
}

/**
 * V7：列表回传的元数据投影——**不带正文**。
 *
 * 为什么：原来 GET draft 把每个窗口桶的全文一起返回（单桶上限 500KB），上限被删后
 * 响应体 = 历史窗口数 × 500KB，而 world-drafts.recoveries() 每次刷新都拉全量。
 * 现在列表只给元数据 + 前 120 字摘要（世界观桶额外给标题汇总，够渲染列表），
 * 作者真要恢复某一份时再按 windowId 单独取那一个桶的全文。
 */
export function checkpointMeta(record, { world = false } = {}) {
  const text = String(record?.text ?? '')
  const meta = {
    windowId: record?.windowId ?? null,
    rev: Number(record?.rev) || 0,
    updatedAt: record?.updatedAt ?? null,
    cleared: Boolean(record?.cleared),
    chars: [...text].length,
    preview: text.slice(0, 120),
    hasReference: Boolean(record?.reference),
  }
  if (world) {
    let version = null
    let draftCount = 0
    let titles = []
    try {
      const parsed = JSON.parse(text)
      if (parsed && parsed.version === 1 && Array.isArray(parsed.drafts)) {
        version = parsed.version
        draftCount = parsed.drafts.length
        titles = parsed.drafts.slice(0, 10).map((d) => String(d?.title || '未命名').slice(0, 60))
      }
    } catch { /* 非世界观快照：只给摘要，不假装能解析 */ }
    meta.summary = { version, draftCount, titles }
  } else if (record?.reference) {
    // 引用的**身份**字段可以进列表（不含正文），采用时再取全文
    meta.reference = {
      label: record.reference.label ?? null,
      path: record.reference.path ?? null,
      revision: record.reference.revision ?? null,
      snapshotFingerprint: record.reference.snapshotFingerprint ?? null,
      chars: [...String(record.reference.text ?? '')].length,
    }
  }
  return meta
}

/** V4：草稿目录里的锁诊断（包含残留锁），供维护入口与启动诊断使用。
 *  path 是锁文件的**绝对路径**——CXR01 之后不再自动清理，作者需要知道到底删哪个文件。 */
export function listDraftLocks() {
  const dir = draftRoot()
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json.lock'))
  } catch {
    return []
  }
  return names.map((n) => {
    const file = path.join(dir, n.slice(0, -'.lock'.length))
    const info = inspectLock(file)
    // dead = 令牌可解析且 PID 已消失。alive=false 但 dead=false 意味着“持有者读不出来”
    // （例如对方正在写入的空档），既不算残留也不得动。
    return { lock: n, path: info.lock, owner: info.owner, alive: info.alive, dead: info.dead }
  })
}

/**
 * CXR01（2026-09-22 独立复核，P1）：**只读**列出持有者可证明已消失的残留锁，不做任何移动。
 *
 * 原 `sweepStaleDraftLocks()` 会把它们改名隔离。复核证明 check-then-rename 无法原子化：
 * 清扫者在复核之后、改名之前暂停，就可能把**别人刚取得的活锁**移走，
 * 于是两个写入方临界区重叠、静默覆写。把窗口缩到微秒不是互斥保证，
 * revision/etag 也兜不了（它们是临界区**内部**的读后比较）。
 *
 * 所以现在：在线路径只报告 + 给出绝对路径，由作者**关闭应用后**手动删除；
 * 真要自动隔离只能走离线维护（显式传 `{ offline: true }` 调 quarantineStaleLock）。
 * 代价：崩溃留下的残留锁会卡着那个桶直到手动处理——宁可暂时不可写，不要重叠覆写。
 */
export function listStaleDraftLocks() {
  return listDraftLocks().filter((row) => row.dead)
}
