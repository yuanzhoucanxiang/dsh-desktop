/**
 * Project memory store.
 * - File: <projectRoot>/state/writing-memory.json
 * - Strict schema; corrupt/unknown files never become empty writes
 * - Cross-process lock around read-modify-write
 * - Changes keep item snapshots for history restore
 * - All realpaths of file + parent must stay under project root / library
 */
import fs from 'node:fs'
import path from 'node:path'
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

function lockPath(file) {
  return file + '.lock'
}

function withFileLock(file, fn) {
  const lock = lockPath(file)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const deadline = Date.now() + 3000
  let fd
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx')
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw memoryError('lock-failed', 500)
      // Stale lock: older than 10s and we cannot prove holder alive
      try {
        const st = fs.statSync(lock)
        if (Date.now() - st.mtimeMs > 10000) {
          // try steal once
          fs.unlinkSync(lock)
          continue
        }
      } catch {}
      if (Date.now() > deadline) throw memoryError('lock-timeout', 503)
      // busy wait briefly
      const waitUntil = Date.now() + 25
      while (Date.now() < waitUntil) {}
    }
  }
  try {
    const token = randomUUID()
    fs.writeSync(fd, token)
    fs.fsyncSync(fd)
    return fn()
  } finally {
    try {
      fs.closeSync(fd)
    } catch {}
    try {
      fs.unlinkSync(lock)
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

export function readMemory(projectDir) {
  const file = memoryPath(projectDir)
  let raw
  try {
    raw = fs.readFileSync(file)
  } catch (err) {
    if (err.code === 'ENOENT') {
      const empty = emptyMemory()
      return { ok: true, memory: empty, etag: etagOf(JSON.stringify(empty)) }
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
  return { ok: true, memory, etag: etagOf(raw) }
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
 * @param {string} projectDir
 * @param {{op:string, baseRevision?:number, baseEtag?:string, id?:string, item?:object}} args
 * @param {{libraryRoots?:string[]}} [opts] allowed root reals for path checks
 */
export function applyMemoryOp(projectDir, { op, baseRevision, baseEtag, id, item }, opts = {}) {
  const projectReal = fs.realpathSync(projectDir)
  const file = memoryPath(projectReal)
  // Final path + parent must stay under projectReal (blocks junction escape of state/)
  const fileParent = path.dirname(file)
  let parentReal
  try {
    parentReal = fs.realpathSync(fileParent)
  } catch {
    // state/ may not exist yet — create under project then re-check
    fs.mkdirSync(fileParent, { recursive: true })
    parentReal = fs.realpathSync(fileParent)
  }
  assertSafeWithin(projectReal, parentReal, 'state-dir-escape')
  if (fs.existsSync(file)) {
    const fileReal = fs.realpathSync(file)
    assertSafeWithin(projectReal, fileReal, 'memory-file-escape')
  }
  if (opts.libraryRoots?.length) {
    const inLib = opts.libraryRoots.some((r) => {
      const rel = path.relative(r, projectReal)
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
    })
    if (!inLib) throw memoryError('path-outside-roots', 400)
  }

  return withFileLock(file, () => {
    const current = readMemory(projectReal)
    if (baseRevision !== undefined && baseRevision !== null && baseRevision !== '') {
      if (Number(baseRevision) !== current.memory.revision) {
        throw memoryError('revision-conflict', 409)
      }
    }
    if (baseEtag && baseEtag !== current.etag) {
      throw memoryError('etag-conflict', 409)
    }
    // Require at least one optimistic token when file already has data
    if (current.memory.revision > 0 && baseEtag === undefined && baseRevision === undefined) {
      throw memoryError('revision-required', 428)
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
      const validated = validateItemInput({ ...item, kind: item?.kind ?? target.kind, status: item?.status ?? target.status, text: item?.text ?? target.text }, target)
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
      pushChange(memory, { op, id: target.id, status: target.status, before, after: { text: target.text, status: target.status, source: target.source } })
    } else if (op === 'retract') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      const before = { text: target.text, status: target.status, source: target.source }
      target.status = 'retracted'
      target.retractedAt = now
      target.updatedAt = now
      pushChange(memory, { op: 'retract', id: target.id, before, after: { text: target.text, status: target.status, source: target.source } })
    } else if (op === 'resolve') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      const before = { text: target.text, status: target.status, source: target.source }
      target.status = 'resolved'
      target.resolvedAt = now
      target.updatedAt = now
      pushChange(memory, { op: 'resolve', id: target.id, before, after: { text: target.text, status: target.status, source: target.source } })
    } else {
      throw memoryError('bad-op')
    }

    const payload = Buffer.from(JSON.stringify(memory, null, 2), 'utf8')
    const tmp = path.join(fileParent, '.' + randomUUID() + '.tmp')
    fs.writeFileSync(tmp, payload)
    // Re-check parent still safe at commit time
    assertSafeWithin(projectReal, fs.realpathSync(fileParent), 'state-dir-escape')
    fs.renameSync(tmp, file)
    return { memory, etag: etagOf(payload) }
  })
}

export function injectableItems(memory, { kinds = ['fact', 'preference'] } = {}) {
  return (memory?.items || []).filter(
    (it) => it.status === 'confirmed' && kinds.includes(it.kind)
  )
}

/** Find historical snapshot text for restore. */
export function findHistorySnapshot(memory, id) {
  const changes = memory?.changes || []
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i]
    if (c.id === id && c.before?.text) return c.before
  }
  const item = (memory?.items || []).find((it) => it.id === id)
  return item ? { text: item.text, status: item.status, source: item.source } : null
}
