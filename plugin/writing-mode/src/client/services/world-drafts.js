import { api } from './writing-api.js'
import { companionWindowId } from '../state/companion-drafts.js'

// 每项目复用一个 journal 实例：面板重挂载时不能丢掉写入队列与已知的 rev，
// 否则晚到的回包会按过期基线写、或把作者正在保留的编辑漏掉（并行修改方 2026-09-21 加）。
const journals = new Map()

export function parseWorldDraft(text) {
  try { const d = JSON.parse(text); return d?.version === 1 && Array.isArray(d.drafts) ? d : null } catch { return null }
}

/**
 * V7：列表阶段预取的份数。
 * 其余副本仍由 snapshotOf 点了再取。为何不一概惰取：作者点「恢复」后如果还要等一次
 * 网络往返才能看到内容，就会引入渲染竞态（界面与测试都受影响）；而常见的就 1–3 份。
 * 预取是**逐桶单独请求**，不是“列表即全量正文”，传输量仍受 PREFETCH 与 MAX_DRAFT_LIST 双重限制。
 */
const PREFETCH = 4

/** 从快照里取标题，供列表展示（没有快照时用 host 给的汇总）。 */
export function titlesOf(entry) {
  if (entry?.snapshot?.drafts?.length) return entry.snapshot.drafts.map(d => d.title || '未命名')
  return entry?.titles || []
}

/**
 * V7：列表只回传元数据（windowId / rev / updatedAt / 标题汇总），**不带正文**。
 *
 * 原来 recoveries() 每次刷新都把所有窗口桶的全文拉下来并 JSON.parse（单桶上限 500KB，
 * 且上限一度被删成无界）。现在列表用 host 预解析好的 summary 渲染，作者真要恢复某一份时
 * 再用 snapshotOf(windowId) 单独取那一个桶——请求数与传输量都被限制在"作者点了几次"。
 */
export function createWorldJournal(project, notify) {
  if (journals.has(project)) {
    const existing = journals.get(project)
    existing.listen(notify)
    return existing
  }
  const windowId = companionWindowId || crypto.randomUUID()
  const key = 'dsh-world-journal:' + project + ':' + windowId
  let revision = null
  let queue = Promise.resolve()
  let latest = null
  let pending = false
  const read = () => api('world-draft', undefined, { project, window: windowId })
  const list = async () => {
    const r = await read()
    if (!r.ok) throw new Error(r.error)
    return {
      items: (r.checkpoints || []).filter(c => c && !c.cleared && (c.summary?.draftCount || 0) > 0),
      total: Number(r.total) || 0,
      truncated: Boolean(r.truncated),
    }
  }
  /** 惰取单个窗口桶的全文快照；读不回来返回 null，由调用方给可见提示。 */
  const snapshotOf = async (id) => {
    const r = await api('world-draft', undefined, { project, window: id })
    if (!r?.ok) throw new Error(r.error || 'draft-read-failed')
    return parseWorldDraft(r.checkpoint?.text || '')
  }
  const save = state => {
    // Synchronous fallback protects the interval before the host response.
    localStorage.setItem(key, JSON.stringify(state))
    latest = JSON.stringify(state); pending = true; notify('正在保留窗口编辑…')
    const body = latest
    queue = queue.catch(() => {}).then(async () => {
      if (revision === null) { const r = await read(); if (!r.ok) throw new Error(r.error); revision = r.checkpoint?.rev || 0 }
      const r = await api('world-draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, windowId, text: body, baseRev: revision }) })
      if (!r.ok) throw new Error(r.error)
      revision = r.checkpoint?.rev ?? r.rev
      if (body === latest) { pending = false; notify('窗口编辑已保留，关闭后可恢复') }
    }).catch(err => { pending = true; notify('窗口编辑尚未落盘，请重试：' + err.message) })
    return queue
  }
  const recoveries = async () => {
    const { items, total, truncated } = await list()
    const all = items.map(c => ({
      windowId: c.windowId,
      updatedAt: c.updatedAt || null,
      titles: c.summary?.titles || [],
      draftCount: c.summary?.draftCount || 0,
      snapshot: null, // 惰取：见 snapshotOf
    }))
    // Other windows' browser fallbacks are also offered; never overwrite them.
    // 浏览器侧兜底副本本来就在本地，带全文，不需要请求。
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith('dsh-world-journal:' + project + ':')) continue
      const id = k.slice(('dsh-world-journal:' + project + ':').length)
      const snapshot = parseWorldDraft(localStorage.getItem(k))
      if (snapshot?.drafts?.length) {
        const old = all.findIndex(c => c.windowId === id)
        if (old >= 0) all.splice(old, 1)
        all.push({ windowId: id, updatedAt: null, titles: snapshot.drafts.map(d => d.title || '未命名'), draftCount: snapshot.drafts.length, snapshot })
      }
    }
    const others = all.filter(c => c.windowId !== windowId)
    await Promise.all(others.slice(0, PREFETCH).map(async (c) => {
      if (c.snapshot) return
      try { c.snapshot = await snapshotOf(c.windowId) } catch { c.snapshot = null }
    }))
    return { items: others, total, truncated }
  }
  const journal = { save, recoveries, snapshotOf, listen: listener => { notify = listener }, pending: () => pending, own: () => parseWorldDraft(localStorage.getItem(key)), windowId }
  journals.set(project, journal)
  return journal
}
