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
    if (data.ok && data.checkpoint) {
      return {
        text: data.checkpoint.text || '',
        reference: data.checkpoint.reference || null,
        rev: data.checkpoint.rev ?? 0,
      }
    }
    return { text: '', reference: null, rev: 0 }
  } catch {
    return { text: '', reference: null, rev: 0 }
  }
}


/**
 * 其他窗口的草稿候选（方案 P3 §4.3）：**只列出，不自动合并**。
 * 每条带窗口标识与更新时间，作者明确采用才写回当前编辑框。
 */
export async function listDraftCandidates(project) {
  try {
    const data = await api('draft', undefined, { project, window: companionWindowId })
    if (!data.ok) return []
    const mine = companionWindowId
    return (data.checkpoints || [])
      .filter((c) => c && c.windowId !== mine && String(c.text || '').trim())
      .map((c) => ({
        windowId: c.windowId,
        updatedAt: c.updatedAt || null,
        rev: c.rev ?? 0,
        text: c.text || '',
        reference: c.reference || null,
      }))
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
    const hash = String(payload.text || '') + '|' + String(payload.reference?.text || '')
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
      const nowHash = String(now.text || '') + '|' + String(now.reference?.text || '')
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
