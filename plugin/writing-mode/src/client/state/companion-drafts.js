/**
 * 伙伴草稿 store：每项目/窗口的草稿快照、保存状态、dirty 与冲突。
 *
 * 设计约束（沿用评审结论，P3 在此基础上扩展）：
 * - 草稿状态与「业务错误」严格分离：本模块只用 draftStatusStore 记录草稿侧状态，
 *   不把保存失败写进通用 error 通道（X01）。
 * - 成功只确认对应快照（rev/hash 匹配才清 dirty），不因旧请求成功清掉新版本 dirty。
 * - 冲突时保留编辑框内容并提供比较/刷新入口，不把自动刷新当保存成功。
 * - 迟到 GET 不得写入已编辑缓存（loadCompanionDraft 只在干净态落地）。
 * - 不依赖 React / DOM：纯 store + 纯函数，供 features/* 与测试共用。
 */
import { api } from '../services/writing-api.js'

export const companionDrafts = new Map() // in-memory cache of last known checkpoint
export let companionWindowId = null
try {
  let id = sessionStorage.getItem('dsh-writing-window')
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('dsh-writing-window', id) }
  companionWindowId = id
} catch { companionWindowId = 'default' }

export async function loadCompanionDraft(project) {
  // Do NOT mutate shared cache here — adopt only after generation check (T02/W02).
  try {
    const data = await api('draft', undefined, { project, window: companionWindowId })
    if (!data.ok) return { error: data.error || 'draft-read-failed' }
    if (data.ok && data.checkpoint) {
      return {
        text: data.checkpoint.text || '',
        reference: data.checkpoint.reference || null,
        rev: data.checkpoint.rev ?? 0,
      }
    }
    return { text: '', reference: null, rev: 0 }
  } catch {
    return { error: 'draft-read-failed' }
  }
}


/**
 * 草稿快照身份：正文 + **完整引用身份**（来源/版本/选区/指纹）+ 引用正文。
 *
 * B08 的教训：成功判据与"当前是否仍是这一份快照"必须调用**同一个**函数——只改了一处的话，
 * 保存响应回来永远匹配不上，dirty 就再也清不掉（复核基线里直接表现为"存完仍 dirty"）。
 */
export function draftSnapshotIdentity(text, reference) {
  const refIdentity = reference
    ? [
        reference.path ?? '',
        reference.revision ?? '',
        reference.selection ? `${reference.selection.start}-${reference.selection.end}` : '',
        reference.snapshotFingerprint ?? '',
      ].join('~')
    : 'none'
  return `${String(text || '')}|${refIdentity}|${String(reference?.text || '')}`
}

/**
 * 其他窗口的草稿候选（方案 P3 §4.3）：**只列出，不自动合并**。
 * 每条带窗口标识与更新时间，作者明确采用才写回当前编辑框。
 */
/**
 * 采用"另一个窗口的草稿"之前，先把**当前这份**完整快照另存到一个独立窗口桶（B06）。
 * 为什么：所谓"原稿仍在候选里"必须是真能找回的副本，而不是文案。存成独立桶后，
 * 它会立刻出现在"其他窗口的草稿"候选列表里，作者随时能切回来。
 */
export async function stashDraftForRecovery(project, { text, reference }) {
  const body = String(text || '')
  if (!body.trim()) return { ok: true, skipped: 'empty' }
  const windowId = `${companionWindowId || 'default'}-before-adopt-${Date.now()}`
  try {
    const data = await api('draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, windowId, text: body, reference: reference || null, baseRev: 0 }),
    })
    return { ok: Boolean(data?.ok), windowId, checkpoint: data?.checkpoint, error: data?.error }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/** V7：列表只有元数据，正文按 windowId 惰取。候选最多取 8 份，避免无界拉全文。 */
const MAX_DRAFT_CANDIDATES = 8

/** 取指定窗口桶的全文 checkpoint；读不回来返回 null。 */
export async function fetchDraftSnapshot(project, windowId) {
  const data = await api('draft', undefined, { project, window: windowId })
  if (!data?.ok) return null
  return data.checkpoint || null
}

export async function listDraftCandidates(project) {
  try {
    const data = await api('draft', undefined, { project, window: companionWindowId })
    if (!data.ok) return []
    const mine = companionWindowId
    // host 现在回元数据（chars/preview/updatedAt）而不是全文，所以先筛后取：
    // 只对作者真能看到的那几份候选发请求，返回结构与以前一致（调用方无需改）。
    const metas = (data.checkpoints || [])
      .filter((c) => c && c.windowId !== mine && !c.cleared && Number(c.chars || 0) > 0)
      .slice(0, MAX_DRAFT_CANDIDATES)
    const out = []
    for (const m of metas) {
      const cp = await fetchDraftSnapshot(project, m.windowId)
      if (!cp || !String(cp.text || '').trim()) continue
      out.push({
        windowId: cp.windowId || m.windowId,
        updatedAt: cp.updatedAt || m.updatedAt || null,
        rev: cp.rev ?? m.rev ?? 0,
        text: cp.text || '',
        reference: cp.reference || null,
      })
    }
    return out
  } catch {
    return []
  }
}

export const draftSaveQueue = new Map()
export const companionRecoveryState = new Map()
export const companionDraftDirty = new Map()
/** conflict: { remoteStatus, remoteRev, remoteText, remoteReference, localText, localReference } */
export const companionDraftConflict = new Map()
/**
 * V01: observable save status — subscribers never need optional callbacks.
 * phase: idle|pending|saving|saved|error|conflict
 */
export const companionDraftStatus = new Map() // project -> { phase, error, code, rev, textHash }
export const draftStatusListeners = new Set()

export function setDraftStatus(project, patch) {
  const prev = companionDraftStatus.get(project) || {
    phase: 'idle',
    error: '',
    code: '',
    rev: null,
    textHash: '',
  }
  companionDraftStatus.set(project, { ...prev, ...patch })
  notifyDraftStatus()
}
export function getDraftStatus(project) {
  return companionDraftStatus.get(project) || { phase: 'idle', error: '', code: '', rev: null, textHash: '' }
}
export function notifyDraftStatus() {
  for (const fn of draftStatusListeners) {
    try {
      fn()
    } catch {}
  }
}
export function subscribeDraftStatus(fn) {
  draftStatusListeners.add(fn)
  return () => draftStatusListeners.delete(fn)
}
export function isDraftConflict(project) {
  return Boolean(companionDraftConflict.get(project))
}
export function draftErrorText(code) {
  if (code === 'corrupt-draft') return '原草稿文件已损坏，已停止覆盖；可保留损坏副本后保存当前文字。'
  if (code === 'draft-too-large') return '草稿过长，未能保存。请缩短后重试。'
  if (code === 'reference-too-large') return '引用过长，未能保存。请缩短选区后重试。'
  if (code === 'draft-conflict') return '草稿与另一处写入冲突，请选择保留本地或采用远端。'
  if (code === 'draft-rev-conflict') return '草稿版本冲突，请刷新基线后重试。'
  if (code === 'network') return '网络中断，草稿尚未保存。可重试保存。'
  if (code === 'invalid-response') return '保存响应无效，草稿尚未确认落盘。'
  return '草稿未能保存：' + (code || 'save-failed')
}

export function applyDraftSnapshot(project, { text, reference }, appliers) {
  const t = String(text ?? '')
  const r = reference || null
  const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
  companionDrafts.set(project, { ...prev, text: t, reference: r })
  if (appliers?.setLocalDraft) appliers.setLocalDraft(t)
  if (appliers?.setReference) appliers.setReference(r)
  if (appliers?.setNativeDraft) {
    try {
      appliers.setNativeDraft(t)
    } catch {}
  }
  notifyDraftStatus()
}

export function resolveDraftConflict(project, mode, appliers) {
  const snap = companionDraftConflict.get(project)
  if (!snap) return Promise.resolve({ ok: false, error: 'no-conflict' })
  if (mode === 'keep-local') {
    const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
    if (Number.isInteger(snap.remoteRev)) {
      companionDrafts.set(project, { ...prev, rev: snap.remoteRev })
    }
    companionDraftConflict.delete(project)
    companionDraftDirty.set(project, true)
    setDraftStatus(project, { phase: 'pending', error: '', code: '' })
    return persistCompanionDraft(project)
  }
  if (mode === 'keep-remote') {
    if (snap.remoteStatus !== 'valid' || !Number.isInteger(snap.remoteRev)) {
      return Promise.resolve({ ok: false, error: 'remote-not-valid' })
    }
    applyDraftSnapshot(
      project,
      { text: snap.remoteText || '', reference: snap.remoteReference || null },
      appliers
    )
    const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
    companionDrafts.set(project, { ...prev, rev: snap.remoteRev })
    companionDraftConflict.delete(project)
    companionDraftDirty.set(project, false)
    setDraftStatus(project, { phase: 'saved', error: '', code: '', rev: snap.remoteRev })
    return Promise.resolve({ ok: true })
  }
  return Promise.resolve({ ok: false, error: 'bad-mode' })
}

export async function retryDraftConflictRemote(project) {
  const snap = companionDraftConflict.get(project)
  if (!snap) return { ok: false, error: 'no-conflict' }
  try {
    const cur = await api('draft', undefined, { project, window: companionWindowId })
    if (cur?.ok && cur.checkpoint && Number.isInteger(cur.checkpoint.rev)) {
      companionDraftConflict.set(project, {
        ...snap,
        remoteStatus: 'valid',
        remoteRev: cur.checkpoint.rev,
        remoteText: cur.checkpoint.text || '',
        remoteReference: cur.checkpoint.reference || null,
      })
      notifyDraftStatus()
      return { ok: true }
    }
  } catch {}
  companionDraftConflict.set(project, { ...snap, remoteStatus: 'failed' })
  notifyDraftStatus()
  return { ok: false, error: 'remote-read-failed' }
}

/** V01: all save paths publish phase/result; fetch errors become visible. */
export function persistCompanionDraft(project, onStatus) {
  const cached0 = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
  const sentHash = String(cached0.text || '') + '|' + String(cached0.reference?.text || '')
  if (companionRecoveryState.get(project) === 'pending') {
    setDraftStatus(project, { phase: 'pending', error: '', code: 'recovery-pending' })
    if (onStatus) onStatus('deferred')
    return Promise.resolve({ ok: false, error: 'recovery-pending', deferred: true })
  }
  if (isDraftConflict(project)) {
    setDraftStatus(project, { phase: 'conflict', error: draftErrorText('draft-conflict'), code: 'draft-conflict' })
    if (onStatus) onStatus('error:draft-conflict')
    return Promise.resolve({ ok: false, error: 'draft-conflict' })
  }
  const prevQ = draftSaveQueue.get(project) || Promise.resolve()
  const next = prevQ.then(async () => {
    if (isDraftConflict(project)) {
      setDraftStatus(project, { phase: 'conflict', error: draftErrorText('draft-conflict'), code: 'draft-conflict' })
      if (onStatus) onStatus('error:draft-conflict')
      return { ok: false, error: 'draft-conflict' }
    }
    const cached = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
    const payload = {
      project,
      windowId: companionWindowId,
      text: cached.text,
      reference: cached.reference,
      baseRev: cached.rev ?? 0,
    }
    // B08：成功判据覆盖**完整引用身份**，否则"同文不同源"的两份引用会被旧请求的响应提前确认。
    // 与下面的 nowHash 共用同一个函数（这是关键：两处口径必须一致）。
    const hash = draftSnapshotIdentity(payload.text, payload.reference)
    setDraftStatus(project, { phase: 'saving', error: '', code: '' })
    let data
    try {
      data = await api('draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      // V01: network rejection is a visible error
      setDraftStatus(project, {
        phase: 'error',
        error: draftErrorText('network'),
        code: 'network',
        textHash: hash,
      })
      if (onStatus) onStatus('error:network')
      return { ok: false, error: 'network' }
    }
    if (data?.ok) {
      const rev = data.checkpoint?.rev ?? data.rev
      if (Number.isInteger(rev)) {
        const now = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
        companionDrafts.set(project, { ...now, rev })
      }
      // Only clear dirty if this save still matches current local snapshot
      const now = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
      const nowHash = draftSnapshotIdentity(now.text, now.reference)
      if (nowHash === hash) {
        companionDraftDirty.set(project, false)
      }
      setDraftStatus(project, {
        phase: 'saved',
        error: '',
        code: '',
        rev: Number.isInteger(rev) ? rev : null,
        textHash: hash,
      })
      if (onStatus) onStatus('saved')
      return data
    }
    const code = data?.error || 'save-failed'
    if (code === 'draft-rev-conflict') {
      const conflict = {
        remoteStatus: 'loading',
        remoteRev: null,
        remoteText: '',
        remoteReference: null,
        localText: cached.text,
        localReference: cached.reference,
      }
      companionDraftConflict.set(project, conflict)
      setDraftStatus(project, { phase: 'conflict', error: draftErrorText('draft-conflict'), code: 'draft-conflict' })
      try {
        const cur = await api('draft', undefined, { project, window: companionWindowId })
        if (cur?.ok && cur.checkpoint && Number.isInteger(cur.checkpoint.rev)) {
          companionDraftConflict.set(project, {
            ...conflict,
            remoteStatus: 'valid',
            remoteRev: cur.checkpoint.rev,
            remoteText: cur.checkpoint.text || '',
            remoteReference: cur.checkpoint.reference || null,
          })
        } else {
          companionDraftConflict.set(project, { ...conflict, remoteStatus: 'failed' })
        }
      } catch {
        companionDraftConflict.set(project, { ...conflict, remoteStatus: 'failed' })
      }
      notifyDraftStatus()
      if (onStatus) onStatus('error:draft-conflict')
      return data
    }
    // HTTP 4xx/5xx / invalid response → visible error, keep dirty
    setDraftStatus(project, {
      phase: 'error',
      error: draftErrorText(code),
      code,
      textHash: hash,
    })
    if (onStatus) onStatus('error:' + code)
    return data
  })
  draftSaveQueue.set(project, next.catch(() => {}))
  return next
}

export async function recoverDamagedDraft(project) {
  const observed = await api('draft', undefined, { project, window: companionWindowId })
  if (observed.error !== 'corrupt-draft' || !observed.damagedHash) return { ok: false, error: 'recovery-source-changed' }
  const local = companionDrafts.get(project) || { text: '', reference: null }
  const r = await api('draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, windowId: companionWindowId, text: local.text, reference: local.reference, recoverDamaged: true, expectedHash: observed.damagedHash }) })
  if (r.ok) {
    const current = companionDrafts.get(project) || local
    companionDrafts.set(project, { ...current, rev: r.checkpoint.rev })
    if (draftSnapshotIdentity(current.text, current.reference) === draftSnapshotIdentity(local.text, local.reference)) {
      companionDraftDirty.delete(project); setDraftStatus(project, { phase: 'saved', error: '', code: '' })
    } else void persistCompanionDraft(project)
  }
  return r
}
