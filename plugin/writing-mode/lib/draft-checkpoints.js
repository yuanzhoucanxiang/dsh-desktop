/**
 * Durable unsent-draft checkpoints.
 * Refuses silent truncation; clears by deleting file when empty.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

export const SCHEMA = 1
export const MAX_TEXT = 500000
export const MAX_REF = 200000

function draftRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'writing-mode', 'drafts')
}

function bucketKey(project, windowId) {
  const p = String(project || '').replace(/\\/g, '/').toLowerCase()
  const w = String(windowId || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default'
  return createHash('sha256').update(p + '\n' + w).digest('hex').slice(0, 32)
}

function draftFile(project, windowId) {
  return path.join(draftRoot(), bucketKey(project, windowId) + '.json')
}

export function draftError(code, status = 400) {
  return Object.assign(new Error(code), { status, code })
}

export function readCheckpoint(project, windowId) {
  const file = draftFile(project, windowId)
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data.schemaVersion !== SCHEMA) return null
    return data
  } catch {
    return null
  }
}

export function writeCheckpoint(project, windowId, draft) {
  const file = draftFile(project, windowId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
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
      }
    : null
  if (!text && !reference) {
    try {
      fs.rmSync(file, { force: true })
    } catch {}
    return { ok: true, cleared: true }
  }
  const data = {
    schemaVersion: SCHEMA,
    project: String(project || ''),
    windowId: String(windowId || 'default'),
    text,
    reference,
    revision: draft?.revision ?? null,
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
  const out = []
  for (const name of names) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (data.project === project) out.push(data)
    } catch {}
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return out
}
