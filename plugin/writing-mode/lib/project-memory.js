/**
 * Project memory store.
 * - File: <projectRoot>/state/writing-memory.json
 * - schema 1: legacy plain items (read-compatible)
 * - schema 2: world-setting extension + operation idempotency + projection meta
 * - Strict schema; corrupt files never become empty writes
 * - Cross-process lock with owner identity (no mtime-only steal)
 * - Read and write both verify realpath boundaries
 * - Changes keep before/after snapshots
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { safeProjectPath, renderSettingProjection, writeSettingProjection, hashText, PROJECTION_REL } from './setting-projection.js'
import { createHash, randomUUID } from 'node:crypto'
import { withFileLock as lockWithFile } from './file-lock.js'
import {
  normalizeSetting,
  deriveSettingText,
  stableStringify,
  MAX_SETTING_CHARS,
  MAX_SOURCES,
} from './world-setting.js'

export const MEMORY_SCHEMA = 2
export const MEMORY_SCHEMA_LEGACY = 1
export const MEMORY_FILE = 'state/writing-memory.json'
export const KINDS = new Set(['fact', 'preference', 'open-question'])
export const STATUSES = new Set(['proposed', 'confirmed', 'resolved', 'retracted'])
const MAX_ITEMS = 400
const MAX_CHANGES = 800
const MAX_TEXT = 4000
const MAX_TEXT_SETTING = MAX_SETTING_CHARS
const MAX_OPERATIONS = 200
const SETTING_OPS = new Set(['save-setting-candidate', 'confirm-setting', 'retract-setting'])
const CLIENT_SCHEMA_MIN_FOR_SETTING_ITEM = 2

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
    operations: [],
    projection: defaultProjection(),
  }
}

export function defaultProjection() {
  return {
    path: 'bible/世界观整理.md',
    status: 'idle',
    managedHash: null,
    sourceRevision: null,
    lastError: null,
  }
}

/** Empty-file etag protocol for first create. */
export function emptyEtag() {
  return etagOf(Buffer.from(JSON.stringify(emptyMemory()), 'utf8'))
}

function assertSafeWithin(rootReal, absReal, label) {
  if (!rootReal || !absReal) throw memoryError('path-missing', 400)
  const rel = path.relative(rootReal, absReal)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw memoryError(label || 'path-outside-project', 400)
  }
}

function assertMemoryPathSafe(projectDir, opts = {}) {
  const projectReal = fs.realpathSync(projectDir)
  const file = memoryPath(projectReal)
  const stateDir = path.dirname(file)
  let stateReal
  try {
    stateReal = fs.realpathSync(stateDir)
  } catch {
    try {
      fs.mkdirSync(stateDir, { recursive: true })
    } catch {
      throw memoryError('state-dir-unavailable', 500)
    }
    stateReal = fs.realpathSync(stateDir)
  }
  assertSafeWithin(projectReal, stateReal, 'state-dir-escape')

  if (fs.existsSync(file)) {
    const fileReal = fs.realpathSync(file)
    assertSafeWithin(projectReal, fileReal, 'memory-file-escape')
  }
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

function withFileLock(file, fn) {
  return lockWithFile(file, fn, memoryError)
}

function normalizeProjection(raw) {
  const base = defaultProjection()
  if (!raw || typeof raw !== 'object') return base
  return {
    path: String(raw.path || base.path),
    status: ['idle', 'pending', 'synced', 'conflict'].includes(raw.status) ? raw.status : base.status,
    managedHash: raw.managedHash != null ? String(raw.managedHash) : null,
    sourceRevision: Number.isInteger(raw.sourceRevision) ? raw.sourceRevision : null,
    lastError: raw.lastError != null ? String(raw.lastError) : null,
    intent: raw.intent && typeof raw.intent === 'object' ? raw.intent : null,
  }
}

function validateSources(sources) {
  if (sources == null) return []
  if (!Array.isArray(sources)) throw memoryError('bad-setting', 400)
  if (sources.length > MAX_SOURCES) throw memoryError('sources-too-many', 413)
  return sources
}

function validateSettingObject(setting) {
  if (!setting || typeof setting !== 'object' || Array.isArray(setting)) throw memoryError('bad-setting', 400)
  if (setting.type !== 'world') throw memoryError('bad-setting-type', 400)
  const { setting: norm } = normalizeSetting(setting, { requireTitleConclusion: false })
  return { ...norm, sources: validateSources(norm.sources) }
}

function validateExistingMemory(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw memoryError('corrupt-memory', 500)
  if (data.schemaVersion !== MEMORY_SCHEMA && data.schemaVersion !== MEMORY_SCHEMA_LEGACY) {
    throw memoryError('unknown-schema', 400)
  }
  if (!Number.isInteger(data.revision) || data.revision < 0) throw memoryError('bad-memory', 500)
  if (!Array.isArray(data.items) || !Array.isArray(data.changes)) throw memoryError('bad-memory', 500)
  for (const it of data.items) {
    if (!it || typeof it !== 'object') throw memoryError('bad-memory', 500)
    if (typeof it.id !== 'string' || !it.id) throw memoryError('bad-memory', 500)
    if (!KINDS.has(it.kind) || !STATUSES.has(it.status)) throw memoryError('bad-memory', 500)
    if (typeof it.text !== 'string' || !it.text) throw memoryError('bad-memory', 500)
    if (it.setting != null) {
      if (data.schemaVersion === MEMORY_SCHEMA_LEGACY) throw memoryError('unknown-schema', 400)
      if (it.kind !== 'fact') throw memoryError('bad-setting', 500)
      validateSettingObject(it.setting)
    }
  }
  if (data.schemaVersion >= 2) {
    if (data.operations != null && !Array.isArray(data.operations)) throw memoryError('bad-memory', 500)
  }
  return data
}

/** 读侧：schema1 原样返回（不升级）；补齐 operations/projection 空位便于 API。 */
export function readMemory(projectDir, opts = {}) {
  const { projectReal, file } = assertMemoryPathSafe(projectDir, opts)
  let raw
  try {
    raw = fs.readFileSync(file)
  } catch (err) {
    if (err.code === 'ENOENT') {
      const empty = emptyMemory()
      return { ok: true, memory: empty, etag: emptyEtag(), migrated: false }
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
  if (!Array.isArray(memory.operations)) memory.operations = []
  if (!memory.projection) memory.projection = defaultProjection()
  else memory.projection = normalizeProjection(memory.projection)
  return {
    ok: true,
    memory,
    etag: etagOf(raw),
    migrated: false,
    schemaVersion: memory.schemaVersion,
  }
}

function normalizeToken(v) {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (!s) return null
  return s
}

function pushChange(memory, change, actor = 'host') {
  memory.changes = memory.changes || []
  if (memory.schemaVersion >= 2 && memory.changes.length >= MAX_CHANGES) {
    throw memoryError('history-full', 409)
  }
  memory.changes.push({ at: new Date().toISOString(), actor: String(actor || 'host').slice(0, 40), ...change })
  if (memory.schemaVersion < 2 && memory.changes.length > MAX_CHANGES) {
    memory.changes = memory.changes.slice(-MAX_CHANGES)
  }
}

function hashPayload(obj) {
  return createHash('sha256').update(stableStringify(obj), 'utf8').digest('hex')
}

function findOperation(memory, operationId) {
  return (memory.operations || []).find((op) => op && op.operationId === operationId) || null
}

function assertIdempotent(memory, { operationId, requestHash, op }) {
  if (!operationId) throw memoryError('operation-id-required', 400)
  if (!requestHash) throw memoryError('request-hash-required', 400)
  const existing = findOperation(memory, operationId)
  if (!existing) {
    if ((memory.operations || []).length >= MAX_OPERATIONS) throw memoryError('operations-full', 409)
    return { replay: false }
  }
  if (existing.requestHash !== requestHash || existing.op !== op) throw memoryError('operation-conflict', 409)
  return { replay: true, receipt: existing, op }
}

function recordOperation(memory, { operationId, requestHash, op, itemId, status }) {
  const receipt = {
    operationId: String(operationId),
    requestHash: String(requestHash),
    op: String(op),
    itemId: itemId || null,
    status: status || null,
    at: new Date().toISOString(),
    revision: memory.revision,
  }
  memory.operations = memory.operations || []
  memory.operations.push(receipt)
  return receipt
}

function validateItemInput(input, existing = null) {
  const kind = String(input?.kind || existing?.kind || 'fact')
  const status = String(input?.status || existing?.status || 'proposed')
  let text = String(input?.text ?? existing?.text ?? '').trim()
  if (!KINDS.has(kind)) throw memoryError('bad-kind')
  if (!STATUSES.has(status)) throw memoryError('bad-status')

  let setting = null
  const hasSettingInput = input && input.setting !== undefined && input.setting !== null
  if (hasSettingInput) {
    const requireTitleConclusion = status === 'confirmed'
    const norm = normalizeSetting(input.setting, { requireTitleConclusion })
    if (kind !== 'fact') throw memoryError('bad-setting-kind')
    setting = norm.setting
    // host 派生 text；客户端不得提交与 setting 矛盾的 text
    const derived = deriveSettingText(setting)
    if (!derived) {
      if (status === 'confirmed') throw memoryError('empty-conclusion')
      text = text || setting.title || '（候选设定）'
    } else {
      text = derived
    }
    if ([...text].length > MAX_TEXT_SETTING + 32) throw memoryError('text-too-long', 413)
  } else if (existing?.setting) {
    setting = validateSettingObject(existing.setting)
    if (input && input.text != null && String(input.text).trim()) {
      // schema2 + 已有 setting：普通 update 不得用旧 text 抹掉派生关系时，仍以 setting 为准
      text = deriveSettingText(setting) || String(input.text).trim()
    } else {
      text = deriveSettingText(setting) || existing.text
    }
  } else {
    if (!text) throw memoryError('empty-text')
    if (text.length > MAX_TEXT) throw memoryError('text-too-long', 413)
  }

  const source = existing?.source && typeof existing.source === 'object' ? { ...existing.source } : {}
  if (input?.source && typeof input.source === 'object') {
    if (input.source.kind) source.kind = String(input.source.kind)
    if (input.source.sessionId) source.sessionId = String(input.source.sessionId).slice(0, 160)
    if (input.source.messageId) source.messageId = String(input.source.messageId).slice(0, 160)
    if (input.source.path) source.path = String(input.source.path).slice(0, 500)
  }
  if (!source.kind) source.kind = 'author'
  return { kind, status, text, source, setting }
}

function cloneChangeSnapshot(it) {
  return {
    text: it.text,
    status: it.status,
    source: it.source,
    itemRevision: it.itemRevision ?? null,
    setting: it.setting ? structuredClone(it.setting) : undefined,
  }
}

function bumpItemRevision(item, prev) {
  item.itemRevision = (Number.isInteger(prev?.itemRevision) ? prev.itemRevision : 0) + 1
}

function migrateSchema1To2(memory) {
  const next = {
    schemaVersion: MEMORY_SCHEMA,
    revision: memory.revision,
    projectKey: memory.projectKey || '',
    items: (memory.items || []).map((it) => ({ ...it })),
    changes: (memory.changes || []).map((c) => ({ ...c })),
    operations: [],
    projection: defaultProjection(),
  }
  return next
}

function backupMemoryFile(file) {
  if (!fs.existsSync(file)) return null
  const bakDir = safeProjectPath(path.dirname(path.dirname(file)), 'state/backups')
  fs.mkdirSync(bakDir, { recursive: true })
  const raw = fs.readFileSync(file)
  const bak = path.join(bakDir, `writing-memory-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.json`)
  safeProjectPath(path.dirname(path.dirname(file)), path.relative(path.dirname(path.dirname(file)), bak))
  fs.writeFileSync(bak, raw, { flag: 'wx' })
  return bak
}

function commitMemory(file, projectReal, memory, opts) {
  const payload = Buffer.from(JSON.stringify(memory, null, 2), 'utf8')
  const tmp = path.join(path.dirname(file), `.${randomUUID()}.tmp`)
  fs.writeFileSync(tmp, payload)
  assertMemoryPathSafe(projectReal, opts)
  fs.renameSync(tmp, file)
  return { memory, etag: etagOf(payload) }
}

function assertClientMayTouchSetting(req, target) {
  if (!target?.setting) return
  const clientSchema = req?.clientSchemaVersion
  const n = clientSchema == null ? null : Number(clientSchema)
  if (n == null || !Number.isFinite(n) || n < CLIENT_SCHEMA_MIN_FOR_SETTING_ITEM) {
    throw memoryError('upgrade-required', 428)
  }
}

/**
 * Mutate memory under lock.
 * Legacy ops: add/update/restore/retract/resolve
 * Setting ops: save-setting-candidate | confirm-setting (require operationId + requestHash)
 */
export function applyMemoryOp(projectDir, req = {}, opts = {}) {
  const { op, baseRevision, baseEtag, id, item, actor } = req
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
    let memory = structuredClone(current.memory)
    let etagNow = current.etag

    // 幂等优先：先查收据，再校验 revision/etag（方案 §4.2）
    if (SETTING_OPS.has(op)) {
      const operationId = req.operationId
      const requestHash = hashPayload({ op, id: id || null, item: item || null, actor: actor || 'author' })
      const idem = assertIdempotent(memory, { operationId, requestHash, op })
      if (idem.replay) {
        return { ...readMemory(projectReal, opts), receipt: idem.receipt, replay: true }
      }
    }

    if (revNum !== current.memory.revision) throw memoryError('revision-conflict', 409)
    if (etagTok !== current.etag) throw memoryError('etag-conflict', 409)
    const legacy = memory.schemaVersion === MEMORY_SCHEMA_LEGACY
    if (legacy) memory = migrateSchema1To2(memory)

    memory.revision += 1
    memory.projectKey = projectReal
    if (!Array.isArray(memory.operations)) memory.operations = []
    if (!memory.projection) memory.projection = defaultProjection()
    const now = new Date().toISOString()

    const isSettingOp = SETTING_OPS.has(op)
    let receipt = null

    if (isSettingOp) {
      const operationId = req.operationId
      const requestHash = hashPayload({ op, id: id || null, item: item || null, actor: actor || 'author' })
      // 收据在 revision+1 之前已确认非 replay；此处落盘
      if (op === 'save-setting-candidate') {
        if (id) {
          const target = memory.items.find((it) => it.id === id)
          if (!target) throw memoryError('not-found', 404)
          assertClientMayTouchSetting(req, target)
          if (target.status === 'confirmed') throw memoryError('confirmed-edit-requires-confirmation', 409)
          const validated = validateItemInput({ ...item, status: 'proposed', setting: item?.setting ?? target.setting }, target)
          const before = cloneChangeSnapshot(target)
          const prevRev = target.itemRevision
          target.kind = 'fact'
          target.status = 'proposed'
          target.text = validated.text
          target.source = validated.source
          if (validated.setting) target.setting = validated.setting
          target.updatedAt = now
          bumpItemRevision(target, { itemRevision: prevRev })
          pushChange(memory, {
            op: 'save-setting-candidate',
            id: target.id,
            status: target.status,
            before,
            after: cloneChangeSnapshot(target),
          }, actor)
          receipt = recordOperation(memory, { operationId, requestHash, op, itemId: target.id, status: target.status })
        } else {
          const validated = validateItemInput({ ...item, status: 'proposed' })
          if (!validated.setting) throw memoryError('setting-required')
          if (memory.items.length >= MAX_ITEMS) throw memoryError('memory-full', 400)
          const entry = {
            id: randomUUID(),
            kind: 'fact',
            status: 'proposed',
            text: validated.text,
            source: validated.source,
            setting: validated.setting,
            itemRevision: 1,
            createdAt: now,
            updatedAt: now,
            confirmedAt: null,
            resolvedAt: null,
            retractedAt: null,
          }
          memory.items.push(entry)
          pushChange(memory, {
            op: 'save-setting-candidate',
            id: entry.id,
            status: entry.status,
            after: cloneChangeSnapshot(entry),
          }, actor)
          receipt = recordOperation(memory, { operationId, requestHash, op, itemId: entry.id, status: entry.status })
        }
      } else if (op === 'confirm-setting') {
        const validated = validateItemInput({ ...item, status: 'confirmed' }, null)
        if (!validated.setting) throw memoryError('setting-required')
        if (id) {
          const target = memory.items.find((it) => it.id === id)
          if (!target) throw memoryError('not-found', 404)
          assertClientMayTouchSetting(req, target)
          const before = cloneChangeSnapshot(target)
          const prevRev = target.itemRevision
          target.kind = 'fact'
          target.status = 'confirmed'
          target.text = validated.text
          target.source = validated.source
          target.setting = validated.setting
          target.updatedAt = now
          target.confirmedAt = now
          target.retractedAt = null
          target.resolvedAt = null
          bumpItemRevision(target, { itemRevision: prevRev })
          pushChange(memory, {
            op: 'confirm-setting',
            id: target.id,
            status: target.status,
            before,
            after: cloneChangeSnapshot(target),
          }, actor)
          receipt = recordOperation(memory, { operationId, requestHash, op, itemId: target.id, status: target.status })
        } else {
          if (memory.items.length >= MAX_ITEMS) throw memoryError('memory-full', 400)
          const entry = {
            id: randomUUID(),
            kind: 'fact',
            status: 'confirmed',
            text: validated.text,
            source: validated.source,
            setting: validated.setting,
            itemRevision: 1,
            createdAt: now,
            updatedAt: now,
            confirmedAt: now,
            resolvedAt: null,
            retractedAt: null,
          }
          memory.items.push(entry)
          pushChange(memory, {
            op: 'confirm-setting',
            id: entry.id,
            status: entry.status,
            after: cloneChangeSnapshot(entry),
          }, actor)
          receipt = recordOperation(memory, { operationId, requestHash, op, itemId: entry.id, status: entry.status })
        }
        // 确认后投影待同步
        memory.projection = { ...memory.projection, status: 'pending', intent: null, lastError: null }
      } else if (op === 'retract-setting') {
        const target = memory.items.find(it => it.id === id)
        if (!target?.setting) throw memoryError('not-found', 404)
        assertClientMayTouchSetting(req, target)
        const before = cloneChangeSnapshot(target)
        target.status = 'retracted'
        target.retractedAt = now
        target.updatedAt = now
        target.itemRevision = (target.itemRevision || 0) + 1
        pushChange(memory, { op, id, before, after: cloneChangeSnapshot(target) }, actor)
        receipt = recordOperation(memory, { operationId, requestHash, op, itemId: id, status: target.status })
        memory.projection = { ...memory.projection, status: 'pending', intent: null, lastError: null }
      } else {
        throw memoryError('bad-op')
      }
    } else if (op === 'add') {
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
        itemRevision: 1,
      }
      if (validated.setting) entry.setting = validated.setting
      memory.items.push(entry)
      pushChange(memory, {
        op: 'add',
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        after: cloneChangeSnapshot(entry),
      }, actor)
    } else if (op === 'update' || op === 'restore') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      assertClientMayTouchSetting(req, target)
      const validated = validateItemInput(
        {
          kind: item?.kind ?? target.kind,
          status: item?.status ?? target.status,
          text: item?.text ?? target.text,
          source: item?.source,
          setting: item?.setting,
        },
        target
      )
      const before = cloneChangeSnapshot(target)
      const prevRev = target.itemRevision
      target.kind = validated.kind
      target.status = validated.status
      target.text = validated.text
      target.source = validated.source
      if (validated.setting !== undefined && validated.setting !== null) target.setting = validated.setting
      target.updatedAt = now
      if (op === 'restore') {
        target.retractedAt = null
        target.resolvedAt = null
      }
      if (target.status === 'confirmed' && !target.confirmedAt) target.confirmedAt = now
      if (op === 'restore' && validated.status === 'confirmed') target.confirmedAt = now
      bumpItemRevision(target, { itemRevision: prevRev })
      pushChange(memory, {
        op,
        id: target.id,
        status: target.status,
        before,
        after: cloneChangeSnapshot(target),
      }, actor)
      if (target.setting) memory.projection = { ...memory.projection, status: 'pending', intent: null, lastError: null }
    } else if (op === 'retract' || op === 'resolve') {
      const target = memory.items.find((it) => it.id === id)
      if (!target) throw memoryError('not-found', 404)
      assertClientMayTouchSetting(req, target)
      const before = cloneChangeSnapshot(target)
      const prevRev = target.itemRevision
      target.status = op === 'retract' ? 'retracted' : 'resolved'
      if (op === 'retract') target.retractedAt = now
      else target.resolvedAt = now
      target.updatedAt = now
      bumpItemRevision(target, { itemRevision: prevRev })
      pushChange(memory, {
        op,
        id: target.id,
        before,
        after: cloneChangeSnapshot(target),
      }, actor)
      if (target.setting) memory.projection = { ...memory.projection, status: 'pending', intent: null, lastError: null }
    } else if (op === 'update-projection') {
      if (!req.projection || typeof req.projection !== 'object') throw memoryError('projection-required')
      memory.projection = normalizeProjection(req.projection)
      pushChange(memory, {
        op: 'update-projection',
        id: null,
        status: memory.projection.status,
        after: { projection: memory.projection },
      }, actor)
    } else {
      throw memoryError('bad-op')
    }

    // All validation completed; migration and the requested mutation commit together.
    if (legacy) backupMemoryFile(file)
    const committed = commitMemory(file, projectReal, memory, opts)
    return { ...committed, receipt, replay: false, migratedFrom: legacy ? MEMORY_SCHEMA_LEGACY : null }
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
    if (c.id === id && (c.before?.text || c.before?.setting)) return c.before
  }
  const item = (memory?.items || []).find((it) => it.id === id)
  return item
    ? { text: item.text, status: item.status, source: item.source, setting: item.setting, itemRevision: item.itemRevision }
    : null
}

export function getOperationReceipt(memory, operationId) {
  return findOperation(memory || { operations: [] }, operationId)
}

/** 扩展 GET 载荷。 */
export function memoryApiPayload(projectDir, opts = {}) {
  const r = readMemory(projectDir, opts)
  return {
    ok: true,
    project: r.memory.projectKey || projectDir,
    memory: r.memory,
    etag: r.etag,
    injectable: injectableItems(r.memory),
    schemaVersion: r.memory.schemaVersion,
    capabilities: {
      schemaVersion: MEMORY_SCHEMA,
      worldSettings: true,
      settingOps: ['save-setting-candidate', 'confirm-setting'],
      maxSettingChars: MAX_SETTING_CHARS,
      maxSources: MAX_SOURCES,
      projectionPath: 'bible/世界观整理.md',
    },
    projection: r.memory.projection || defaultProjection(),
  }
}

// silence unused import lint
void os

/** One project lock covers source read, intent, file CAS and final metadata. */
export function syncSettingProjection(projectDir, request = {}, opts = {}) {
  const { file, projectReal } = assertMemoryPathSafe(projectDir, opts)
  return withFileLock(file, () => {
    const current = readMemory(projectReal, opts)
    if (normalizeToken(request.baseRevision) === null || normalizeToken(request.baseEtag) === null) throw memoryError('revision-required', 428)
    if (Number(request.baseRevision) !== current.memory.revision || request.baseEtag !== current.etag) throw memoryError('revision-conflict', 409)
    const memory = structuredClone(current.memory)
    if (memory.schemaVersion !== MEMORY_SCHEMA) throw memoryError('upgrade-required', 428)
    const fingerprint = hashPayload(memory.items)
    const reused = memory.projection?.intent?.fingerprint === fingerprint
    const intent = reused ? memory.projection.intent : {
      fingerprint, sourceRevision: memory.revision, generatedAt: new Date().toISOString(), hash: null,
    }
    const content = renderSettingProjection(memory.items, { sourceRevision: intent.sourceRevision, generatedAt: intent.generatedAt, projectKey: projectReal })
    const expectedHash = hashText(content)
    if (reused && intent.hash !== expectedHash) throw memoryError('projection-intent-invalid', 409)
    intent.hash = expectedHash
    memory.projection = { ...memory.projection, status: 'pending', lastError: null, intent }
    memory.revision++
    commitMemory(file, projectReal, memory, opts)
    const pendingProjection = structuredClone(memory.projection)
    try {
      const written = writeSettingProjection(projectReal, content, {
        managedHash: memory.projection.managedHash, recoveryHash: reused ? intent.hash : null,
        sourceRevision: intent.sourceRevision, preserve: request.preserve === true, expectedFileHash: request.expectedFileHash,
      })
      memory.projection = { path: PROJECTION_REL, status: 'synced', managedHash: written.hash, sourceRevision: intent.sourceRevision, intent: null, lastError: null }
      memory.revision++
      return { ok: true, ...written, ...commitMemory(file, projectReal, memory, opts), projection: memory.projection }
    } catch (err) {
      memory.projection = { ...pendingProjection, status: err.status === 409 ? 'conflict' : 'pending', lastError: err.code || err.message }
      memory.revision++
      commitMemory(file, projectReal, memory, opts)
      throw err
    }
  })
}
