/**
 * Project memory store.
 * - File: <projectRoot>/state/writing-memory.json
 * - Strict schema; corrupt files never become empty writes
 * - Cross-process lock with owner identity (no mtime-only steal)
 * - Read and write both verify realpath boundaries
 * - Changes keep before/after snapshots
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

export const MEMORY_SCHEMA = 1
export const MEMORY_FILE = 'state/writing-memory.json'
export const KINDS = new Set(['fact', 'preference', 'open-question'])
export const STATUSES = new Set(['proposed', 'confirmed', 'resolved', 'retracted'])
const MAX_ITEMS = 400
const MAX_CHANGES = 800
const MAX_TEXT = 4000

export function memoryError(code, status = 400) {
  return Object.assign(new Error(code), { status, code })
}

function memoryPath(projectDir) {
  return path.join(projectDir, MEMORY_FILE)
}

function etagOf(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Empty-file etag protocol for first create. */
export function emptyEtag() {
  return etagOf(Buffer.from(JSON.stringify(emptyMemory()), 'utf8'))
}

export function emptyMemory() {
  return {
    schemaVersion: MEMORY_SCHEMA,
    revision: 0,
    projectKey: '',
    items: [],
    changes: [],
  }
}

function assertSafeWithin(rootReal, absReal, label) {
  if (!rootReal || !absReal) throw memoryError('path-missing', 400)
  const rel = path.relative(rootReal, absReal)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw memoryError(label || 'path-outside-project', 400)
  }
}

/** Verify project dir, state parent and memory file all stay inside project (+ optional library). */
function assertMemoryPathSafe(projectDir, opts = {}) {
  const projectReal = fs.realpathSync(projectDir)
  const file = memoryPath(projectReal)
  const stateDir = path.dirname(file)
  let stateReal
  try {
    stateReal = fs.realpathSync(stateDir)
  } catch {
    // If state is a broken/escaping junction, realpath fails or we create then recheck.
    try {
      fs.mkdirSync(stateDir, { recursive: true })
    } catch (err) {
      throw memoryError('state-dir-unavailable', 500)
    }
    stateReal = fs.realpathSync(stateDir)
  }
  assertSafeWithin(projectReal, stateReal, 'state-dir-escape')

  if (fs.existsSync(file)) {
    const fileReal = fs.realpathSync(file)
    assertSafeWithin(projectReal, fileReal, 'memory-file-escape')
  }
  // Library root may equal project root (author sets work folder as library).
  if (opts.libraryRoots?.length) {
    const inLib = opts.libraryRoots.some((r) => {
      if (!r) return false
      const rel = path.relative(r, projectReal)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
    if (!inLib) throw memoryError('path-outside-roots', 400)
  }
  return { projectReal, file, stateReal }
}

/* ── Cross-process lock with owner ───────────────────────────────────── */

function lockMetaPath(file) {
  return file + '.lock'
}

function ownerToken() {
  return `${process.pid}:${randomUUID()}`
}

function readLockOwner(lock) {
  try {
    return fs.readFileSync(lock, 'utf8').trim()
  } catch {
    return ''
  }
}

function isOwnerAlive(owner) {
  if (!owner) return false
  const pid = Number(String(owner).split(':')[0])
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means process exists but we cannot signal it
    return err?.code === 'EPERM'
  }
}

/**
 * Exclusive lock. Never unlinks a lock whose owner PID still exists.
 * Crash recovery: if owner PID is dead AND file age > 5s, steal once.
 */
function withFileLock(file, fn) {
  const lock = lockMetaPath(file)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const token = ownerToken()
  const deadline = Date.now() + 5000
  let fd = null
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx')
      fs.writeSync(fd, token)
      fs.fsyncSync(fd)
      // keep fd open as ownership proof for this process
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw memoryError('lock-failed', 500)
      const owner = readLockOwner(lock)
      if (isOwnerAlive(owner)) {
        if (Date.now() > deadline) throw memoryError('lock-timeout', 503)
        const waitUntil = Date.now() + 20
        while (Date.now() < waitUntil) {}
        continue
      }
      // Owner PID dead: only then consider steal after short grace
      try {
        const st = fs.statSync(lock)
        if (Date.now() - st.mtimeMs < 5000) {
          if (Date.now() > deadline) throw memoryError('lock-timeout', 503)
          continue
        }
        fs.unlinkSync(lock)
        continue
      } catch (e) {
        if (Date.now() > deadline) throw memoryError('lock-timeout', 503)
      }
    }
  }
  const my = token
  try {
    // Verify we still own before critical section
    if (readLockOwner(lock) !== my) throw memoryError('lock-lost', 503)
    return fn()
  } finally {
    try {
      if (readLockOwner(lock) === my) {
        try {
          fs.closeSync(fd)
        } catch {}
        try {
          fs.unlinkSync(lock)
        } catch {}
      } else {
        try {
          fs.closeSync(fd)
        } catch {}
      }
    } catch {}
  }
}

function validateExistingMemory(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw memoryError('corrupt-memory', 500)
  if (data.schemaVersion !== MEMORY_SCHEMA) throw memoryError('unknown-schema', 400)
  if (!Number.isInteger(data.revision) || data.revision < 0) throw memoryError('bad-memory', 500)
  if (!Array.isArray(data.items) || !Array.isArray(data.changes)) throw memoryError('bad-memory', 500)
  for (const it of data.items) {
    if (!it || typeof it !== 'object') throw memoryError('bad-memory', 500)
    if (typeof it.id !== 'string' || !it.id) throw memoryError('bad-memory', 500)
    if (!KINDS.has(it.kind) || !STATUSES.has(it.status)) throw memoryError('bad-memory', 500)
    if (typeof it.text !== 'string' || !it.text) throw memoryError('bad-memory', 500)
  }
  return data
}

export function readMemory(projectDir, opts = {}) {
  const { projectReal, file } = assertMemoryPathSafe(projectDir, opts)
  let raw
  try {
    raw = fs.readFileSync(file)
  } catch (err) {
    if (err.code === 'ENOENT') {
      const empty = emptyMemory()
      return { ok: true, memory: empty, etag: emptyEtag() }
    }
    throw memoryError('read-failed', 500)
  }
  let data
  try {
    data = JSON.parse(raw.toString('utf8'))
  } catch {
    throw memoryError('corrupt-memory', 500)
  }
  const memory = validateExistingMemory(data)
  memory.projectKey = memory.projectKey || projectReal
  return { ok: true, memory, etag: etagOf(raw) }
}

function normalizeToken(v) {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (!s) return null
  return s
}

function pushChange(memory, change) {
  memory.changes = memory.changes || []
  memory.changes.push({ at: new Date().toISOString(), ...change })
  if (memory.changes.length > MAX_CHANGES) {
    memory.changes = memory.changes.slice(-MAX_CHANGES)
  }
}

function validateItemInput(input, existing = null) {
  const kind = String(input?.kind || existing?.kind || 'fact')
  const status = String(input?.status || existing?.status || 'proposed')
  const text = String(input?.text ?? existing?.text ?? '').trim()
  if (!KINDS.has(kind)) throw memoryError('bad-kind')
  if (!STATUSES.has(status)) throw memoryError('bad-status')
  if (!text) throw memoryError('empty-text')
  if (text.length > MAX_TEXT) throw memoryError('text-too-long', 413)
  const source = existing?.source && typeof existing.source === 'object' ? { ...existing.source } : {}
  if (input?.source && typeof input.source === 'object') {
    if (input.source.kind) source.kind = input.source.kind
    if (input.source.sessionId) source.sessionId = String(input.source.sessionId).slice(0, 160)
    if (input.source.messageId) source.messageId = String(input.source.messageId).slice(0, 160)
    if (input.source.path) source.path = String(input.source.path).slice(0, 500)
  }
  if (!source.kind) source.kind = 'author'
  return { kind, status, text, source }
}

/**
 * Mutate memory under lock. Requires BOTH baseRevision and baseEtag
 * (or empty-file protocol: baseRevision 0 + emptyEtag()).
 */
export function applyMemoryOp(projectDir, { op, baseRevision, baseEtag, id, item }, opts = {}) {
  const { projectReal, file } = assertMemoryPathSafe(projectDir, opts)

  const revTok = normalizeToken(baseRevision)
  const etagTok = normalizeToken(baseEtag)
  if (revTok === null || etagTok === null) {
    throw memoryError('revision-required', 428)
  }
  const revNum = Number(revTok)
  if (!Number.isInteger(revNum) || revNum < 0) {
    throw memoryError('bad-revision', 400)
  }

  return withFileLock(file, () => {
    const current = readMemory(projectReal, opts)
    if (revNum !== current.memory.revision) {
      throw memoryError('revision-conflict', 409)
    }
    if (etagTok !== current.etag) {
      throw memoryError('etag-conflict', 409)
    }

    const memory = structuredClone(current.memory)
    memory.revision += 1
    memory.projectKey = projectReal
    const now = new Date().toISOString()

    if (op === 'add') {
      const validated = validateItemInput(item)
      if (memory.items.length >= MAX_ITEMS) throw memoryError('memory-full', 400)
      const entry = {
        id: randomUUID(),
        kind: validated.kind,
        status: validated.status,
        text: validated.text,
        source: validated.source,
        createdAt: now,
        updatedAt: now,
        confirmedAt: validated.status === 'confirmed' ? now : null,
        resolvedAt: null,
        retractedAt: null,
      }
      memory.items.push(entry)
      pushChange(memory, {
        op: 'add',
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        after: { text: entry.text, source: entry.source },
      })
    } else if (op === 'update' || op === 'restore') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      const validated = validateItemInput(
        {
          kind: item?.kind ?? target.kind,
          status: item?.status ?? target.status,
          text: item?.text ?? target.text,
          source: item?.source,
        },
        target
      )
      const before = { text: target.text, status: target.status, source: target.source }
      target.kind = validated.kind
      target.status = validated.status
      target.text = validated.text
      target.source = validated.source
      target.updatedAt = now
      if (op === 'restore') {
        target.retractedAt = null
        target.resolvedAt = null
      }
      if (target.status === 'confirmed' && !target.confirmedAt) target.confirmedAt = now
      if (op === 'restore' && validated.status === 'confirmed') target.confirmedAt = now
      pushChange(memory, {
        op,
        id: target.id,
        status: target.status,
        before,
        after: { text: target.text, status: target.status, source: target.source },
      })
    } else if (op === 'retract') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      const before = { text: target.text, status: target.status, source: target.source }
      target.status = 'retracted'
      target.retractedAt = now
      target.updatedAt = now
      pushChange(memory, {
        op: 'retract',
        id: target.id,
        before,
        after: { text: target.text, status: target.status, source: target.source },
      })
    } else if (op === 'resolve') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      const before = { text: target.text, status: target.status, source: target.source }
      target.status = 'resolved'
      target.resolvedAt = now
      target.updatedAt = now
      pushChange(memory, {
        op: 'resolve',
        id: target.id,
        before,
        after: { text: target.text, status: target.status, source: target.source },
      })
    } else {
      throw memoryError('bad-op')
    }

    const payload = Buffer.from(JSON.stringify(memory, null, 2), 'utf8')
    const tmp = path.join(path.dirname(file), `.${randomUUID()}.tmp`)
    fs.writeFileSync(tmp, payload)
    // Re-verify boundary at commit
    assertMemoryPathSafe(projectReal, opts)
    fs.renameSync(tmp, file)
    return { memory, etag: etagOf(payload) }
  })
}

export function injectableItems(memory, { kinds = ['fact', 'preference'] } = {}) {
  return (memory?.items || []).filter(
    (it) => it.status === 'confirmed' && kinds.includes(it.kind)
  )
}

export function findHistorySnapshot(memory, id) {
  const changes = memory?.changes || []
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i]
    if (c.id === id && c.before?.text) return c.before
  }
  const item = (memory?.items || []).find((it) => it.id === id)
  return item ? { text: item.text, status: item.status, source: item.source } : null
}

// silence unused import lint
void os
