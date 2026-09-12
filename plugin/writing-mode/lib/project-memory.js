/**
 * Project memory store: JSON at <projectRoot>/state/writing-memory.json
 * Single-file items + change log; revision + etag for optimistic concurrency.
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
  return Object.assign(new Error(code), { status })
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

export function readMemory(projectDir) {
  const file = memoryPath(projectDir)
  let raw
  try {
    raw = fs.readFileSync(file)
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: true, memory: emptyMemory(), etag: etagOf(JSON.stringify(emptyMemory())) }
    }
    throw memoryError('read-failed', 500)
  }
  let data
  try {
    data = JSON.parse(raw.toString('utf8'))
  } catch {
    throw memoryError('corrupt-memory', 500)
  }
  if (!data || typeof data !== 'object') throw memoryError('corrupt-memory', 500)
  if (data.schemaVersion !== MEMORY_SCHEMA) throw memoryError('unknown-schema', 400)
  const memory = {
    schemaVersion: MEMORY_SCHEMA,
    revision: Number(data.revision) || 0,
    projectKey: String(data.projectKey || ''),
    items: Array.isArray(data.items) ? data.items : [],
    changes: Array.isArray(data.changes) ? data.changes : [],
  }
  return { ok: true, memory, etag: etagOf(raw) }
}

function pushChange(memory, change) {
  memory.changes = memory.changes || []
  memory.changes.push({ at: new Date().toISOString(), ...change })
  if (memory.changes.length > MAX_CHANGES) {
    memory.changes = memory.changes.slice(-MAX_CHANGES)
  }
}

function validateItemInput(input) {
  const kind = String(input.kind || 'fact')
  const status = String(input.status || 'proposed')
  const text = String(input.text || '').trim().slice(0, MAX_TEXT)
  if (!KINDS.has(kind)) throw memoryError('bad-kind')
  if (!STATUSES.has(status)) throw memoryError('bad-status')
  if (!text) throw memoryError('empty-text')
  return { kind, status, text }
}

/**
 * Mutate memory under revision check. Returns new memory + etag.
 * op: add | update | retract | resolve | restore
 */
export function applyMemoryOp(projectDir, { op, baseRevision, baseEtag, projectId, item, id }) {
  const current = readMemory(projectDir)
  if (baseRevision !== undefined && Number(baseRevision) !== current.memory.revision) {
    throw memoryError('revision-conflict', 409)
  }
  if (baseEtag && baseEtag !== current.etag) {
    throw memoryError('etag-conflict', 409)
  }
  const memory = structuredClone(current.memory)
  memory.revision += 1
  const now = new Date().toISOString()

  if (op === 'add') {
    const validated = validateItemInput(item || {})
    if (memory.items.length >= MAX_ITEMS) throw memoryError('memory-full', 400)
    const entry = {
      id: randomUUID(),
      kind: validated.kind,
      status: validated.status,
      text: validated.text,
      source: {
        kind: item?.source?.kind === 'author' || item?.source?.kind === 'assistant' || item?.source?.kind === 'document'
          ? item.source.kind
          : 'author',
      },
      createdAt: now,
      updatedAt: now,
      confirmedAt: validated.status === 'confirmed' ? now : null,
      resolvedAt: null,
      retractedAt: null,
    }
    memory.items.push(entry)
    pushChange(memory, { op: 'add', id: entry.id, kind: entry.kind, status: entry.status })
  } else if (op === 'update') {
    const target = memory.items.find((it) => it.id === id)
    if (!target) throw memoryError('not-found', 404)
    const validated = validateItemInput({ ...target, ...item, text: item?.text ?? target.text })
    target.kind = validated.kind
    target.status = validated.status
    target.text = validated.text
    target.updatedAt = now
    if (validated.status === 'confirmed' && !target.confirmedAt) target.confirmedAt = now
    pushChange(memory, { op: 'update', id: target.id, status: target.status })
  } else if (op === 'retract') {
    const target = memory.items.find((it) => it.id === id)
    if (!target) throw memoryError('not-found', 404)
    target.status = 'retracted'
    target.retractedAt = now
    target.updatedAt = now
    pushChange(memory, { op: 'retract', id: target.id })
  } else if (op === 'resolve') {
    const target = memory.items.find((it) => it.id === id)
    if (!target) throw memoryError('not-found', 404)
    target.status = 'resolved'
    target.resolvedAt = now
    target.updatedAt = now
    pushChange(memory, { op: 'resolve', id: target.id })
  } else if (op === 'restore') {
    // Restore is always a forward revision: copy historical text into a new confirmed item if needed
    const target = memory.items.find((it) => it.id === id)
    if (!target) throw memoryError('not-found', 404)
    const validated = validateItemInput({ ...target, ...item })
    target.kind = validated.kind
    target.status = validated.status
    target.text = validated.text
    target.updatedAt = now
    target.retractedAt = null
    target.resolvedAt = null
    if (validated.status === 'confirmed') target.confirmedAt = now
    pushChange(memory, { op: 'restore', id: target.id, status: target.status })
  } else {
    throw memoryError('bad-op')
  }

  const file = memoryPath(projectDir)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const payload = Buffer.from(JSON.stringify(memory, null, 2), 'utf8')
  const tmp = file + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(tmp, payload)
  fs.renameSync(tmp, file)
  return { memory, etag: etagOf(payload) }
}

/** Items safe to inject into a turn. */
export function injectableItems(memory, { kinds = ['fact', 'preference'] } = {}) {
  return (memory?.items || []).filter(
    (it) => it.status === 'confirmed' && kinds.includes(it.kind)
  )
}
