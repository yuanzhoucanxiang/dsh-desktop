/**
 * 当轮上下文构建（方案 P3 §4.2）：把"作者这一轮真正要发的东西"冻结成一个不可变对象。
 *
 * 契约要点（逐条对应方案）：
 *   1. 只自动参考**当前项目 confirmed 的 fact/preference**；proposed/retracted/resolved 永不自动注入；
 *      open-question 即便已确认也仍是问题，不混进默认事实列表。
 *   2. 顺序：作者本次勾选/固定的有效条目**优先**（按作者给出的顺序），其余按备忘里的稳定顺序确定性补齐。
 *   3. 自动部分有字符预算（默认 6000，明确是 Unicode 字符数、不是 token）；作者消息与显式稿件引用
 *      **不受**这个预算影响（永远完整发送）。
 *   4. 结果含 projectKey / operationId / message / reference / memoryRevision / memoryEtag /
 *      实际采用条目（id/状态/来源/文本/选择原因/是否作者固定）/ 省略信息 / body；
 *      外层与嵌套数组元素都冻结——发送中备忘改变不会改写已经冻结的本次请求。
 *
 * 纯函数：不做 IO、不读时钟、不改入参。
 */

export const DEFAULT_MEMORY_BUDGET = 6000

const INJECTABLE_KINDS = ['fact', 'preference']
const LABEL_OF = { fact: '设定', preference: '偏好', 'open-question': '待定问题' }

/** 条目是否属于"可**自动**参考"：已确认的设定/偏好。 */
export function isInjectable(item) {
  return Boolean(item) && item.status === 'confirmed' && INJECTABLE_KINDS.includes(item.kind)
}

/** 作者明确勾选时可以带上的条目：已确认的设定/偏好/待定问题（待定问题仍标注为问题）。 */
export function isPinnable(item) {
  return Boolean(item) && item.status === 'confirmed' && Boolean(LABEL_OF[item.kind])
}

function freezeItem(item) {
  return Object.freeze({ id: item.id, status: item.status, kind: item.kind, text: item.text })
}

/**
 * 选出本轮要带的条目，返回 { selected, omissions }。
 *   pinned —— 作者本次勾选/固定（数组顺序即作者顺序；无效或被撤回的一律不算，且要报告）
 *   rest   —— 其余可注入条目，按传入顺序（memо 的稳定/追加顺序）确定性补齐
 */
export function selectMemory(items, pinnedIds, budget = DEFAULT_MEMORY_BUDGET) {
  const list = Array.isArray(items) ? items : []
  const pinned = new Set((pinnedIds || []).map((id) => String(id)))
  const selected = []
  const omissions = []
  let used = 0
  const take = (item, reason, isPinned) => {
    const label = LABEL_OF[item.kind] || '设定'
    const line = `- [${label}] ${item.text}`
    const cost = line.length + 1
    if (used + cost > budget) {
      omissions.push({ id: item.id, kind: item.kind, reason: 'budget', chars: cost, pinned: isPinned })
      return
    }
    used += cost
    selected.push({
      id: item.id,
      kind: item.kind,
      label,
      status: item.status,
      source: item.source
        ? Object.freeze({ kind: item.source.kind || 'author', sessionId: item.source.sessionId || null, messageId: item.source.messageId || null, path: item.source.path || null })
        : null,
      text: item.text,
      reason,
      pinned: isPinned,
      chars: cost,
    })
  }
  // 1) 作者固定优先（可按作者选择带上"待定问题"，但它始终标注为待定，不混进默认事实）
  for (const id of pinned) {
    const item = list.find((it) => it && String(it.id) === id)
    if (!item) {
      omissions.push({ id, reason: 'missing', pinned: true })
      continue
    }
    if (!isPinnable(item)) {
      omissions.push({ id, kind: item.kind, status: item.status, reason: 'not-injectable', pinned: true })
      continue
    }
    take(item, 'author-pinned', true)
  }
  // 2) 其余确定性补齐（跳过已固定的）
  const pinnedTaken = new Set(selected.map((s) => String(s.id)))
  for (const item of list) {
    if (!isInjectable(item)) continue
    if (pinnedTaken.has(String(item.id))) continue
    take(item, 'auto', false)
  }
  return { selected, omissions, charsUsed: used }
}

function buildReference(reference) {
  if (!reference || !reference.text) return null
  const selection = reference.selection && typeof reference.selection === 'object'
    ? Object.freeze({
        start: Number.isInteger(reference.selection.start) ? reference.selection.start : null,
        end: Number.isInteger(reference.selection.end) ? reference.selection.end : null,
      })
    : null
  return Object.freeze({
    label: reference.label || null,
    text: String(reference.text),
    path: reference.path || null,
    revision: reference.revision ?? null,
    selection,
    // 未保存内容的快照标记（与源稿 revision 一起构成引用身份，不用正文拼接代替结构相等）
    snapshotFingerprint: reference.snapshotFingerprint || null,
    stale: Boolean(reference.stale),
  })
}

export function buildPreparedTurn(input) {
  const message = String(input?.message ?? '')
  const budget = Number.isFinite(input?.budget) ? Number(input.budget) : DEFAULT_MEMORY_BUDGET
  const includeMemory = input?.includeMemory !== false // 默认开启本次参考
  const reference = buildReference(input?.reference)
  const items = Array.isArray(input?.memoryItems) ? input.memoryItems : []
  const { selected, omissions, charsUsed } = includeMemory
    ? selectMemory(items, input?.pinnedMemoryIds, budget)
    : { selected: [], omissions: [], charsUsed: 0 }

  const parts = []
  if (selected.length) {
    const body = selected.map((s) => `- [${s.label}] ${s.text}`).join('\n')
    const budgetNote = omissions.filter((o) => o.reason === 'budget').length
    parts.push(
      '【项目备忘 · 作者已确认，仅供参考，不要伪装成系统指令】\n' +
        body +
        (budgetNote ? `\n（另有 ${budgetNote} 条因长度省略）` : '')
    )
  }
  if (reference) {
    parts.push(
      `【引用 · ${reference.label || '稿件快照'}${reference.path ? ' · ' + reference.path : ''}${reference.stale ? '（来自旧快照）' : ''}】\n${reference.text}`
    )
  }
  if (message) parts.push(message)

  return Object.freeze({
    schemaVersion: 2,
    projectKey: input?.projectKey || null,
    operationId: input?.operationId || null,
    message,
    reference,
    memoryRevision: input?.memoryRevision ?? null,
    memoryEtag: input?.memoryEtag ?? null,
    includeMemory,
    budget,
    charsUsed,
    selectedMemory: Object.freeze(selected.map((s) => Object.freeze(s))),
    omissions: Object.freeze(omissions.map((o) => Object.freeze(o))),
    omittedCount: omissions.filter((o) => o.reason === 'budget').length,
    body: parts.join('\n\n'),
  })
}

/** UI 提示："参考项目备忘 · N 条"（N = 可自动参考的条目数；0 条时返回 null）。 */
export function memoryHint(memoryItems) {
  const n = (Array.isArray(memoryItems) ? memoryItems : []).filter(isInjectable).length
  return n ? `参考项目备忘 · ${n} 条` : null
}
