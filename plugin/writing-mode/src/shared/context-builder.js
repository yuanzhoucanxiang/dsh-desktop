/**
 * 当轮上下文构建（方案 P3 §4.2 + world-settings §7）：
 * 把"作者这一轮真正要发的东西"冻结成一个不可变对象。
 *
 * 契约要点：
 *   1. 只自动参考 **confirmed** 的 fact/preference；world 设定注入 **结论+边界**（host 派生 text），
 *      **explanation 不注入**。
 *   2. 顺序：作者固定优先（排除 > 固定）；其余 world 设定按确定性标题/标签匹配排序，普通备忘保持稳定顺序。
 *   3. 自动部分 Unicode 字符预算（默认 6000）；作者消息与显式引用不受限；整条省略不截断边界。
 *   4. preparedTurn 全嵌套冻结。
 * 纯函数：不做 IO、不读时钟、不改入参。
 */
import { isWorldSettingItem, settingInjectUnit, rankWorldSettingIds } from './world-setting.js'

export const DEFAULT_MEMORY_BUDGET = 6000

/** Unicode 码点计数（预算口径，见 C02）。 */
export const codePointLength = (text) => [...String(text ?? '')].length

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

/** 自动顺序：world 设定按当轮匹配排序，其余保持列表稳定顺序。 */
export function orderForInjection(items, turnText, pinnedIds, excludedIds) {
  const list = Array.isArray(items) ? items : []
  const pinned = new Set((pinnedIds || []).map(String))
  const excluded = new Set((excludedIds || []).map(String))
  const rankedWorld = rankWorldSettingIds(list, turnText, [...pinned], [...excluded])
  const worldOrder = new Map(rankedWorld.map((r, i) => [r.id, i]))
  const world = []
  const rest = []
  for (const it of list) {
    if (!it || pinned.has(String(it.id)) || excluded.has(String(it.id))) continue
    if (isWorldSettingItem(it) && it.status === 'confirmed') world.push(it)
    else rest.push(it)
  }
  world.sort((a, b) => {
    const ia = worldOrder.has(String(a.id)) ? worldOrder.get(String(a.id)) : Number.MAX_SAFE_INTEGER
    const ib = worldOrder.has(String(b.id)) ? worldOrder.get(String(b.id)) : Number.MAX_SAFE_INTEGER
    if (ia !== ib) return ia - ib
    return String(a.id) < String(b.id) ? -1 : 1
  })
  return [...world, ...rest]
}

/**
 * 选出本轮要带的条目，返回 { selected, omissions }。
 */
export function selectMemory(items, pinnedIds, budget = DEFAULT_MEMORY_BUDGET, excludedIds = [], turnText = '') {
  const list = Array.isArray(items) ? items : []
  const pinned = new Set((pinnedIds || []).map((id) => String(id)))
  const excluded = new Set((excludedIds || []).map((id) => String(id)))
  const selected = []
  const omissions = []
  let used = 0
  const take = (item, reason, isPinned) => {
    const world = isWorldSettingItem(item) ? settingInjectUnit(item) : null
    const label = world?.label || LABEL_OF[item.kind] || '设定'
    const text = world?.text || item.text
    const title = world?.title || ''
    const line = title ? `- [${label}] ${title}：${text}` : `- [${label}] ${text}`
    const cost = [...line].length + 1
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
      text,
      title,
      setting: world ? Object.freeze({ type: 'world', title: world.title, tags: world.tags || [] }) : null,
      reason,
      pinned: isPinned,
      chars: cost,
      line,
    })
  }
  // 1) 作者固定优先（排除 > 固定）
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
    if (excluded.has(String(item.id))) {
      omissions.push({ id: item.id, kind: item.kind, status: item.status, reason: 'excluded-by-author', pinned: true })
      continue
    }
    take(item, 'author-pinned', true)
  }
  // 2) 其余确定性补齐（world 匹配优先）；被作者排除的可注入条目也要如实报告
  const pinnedTaken = new Set(selected.map((s) => String(s.id)))
  for (const item of list) {
    if (!isInjectable(item)) continue
    if (excluded.has(String(item.id))) {
      omissions.push({ id: item.id, kind: item.kind, status: item.status, reason: 'excluded-by-author', pinned: false })
    }
  }
  for (const item of orderForInjection(list, turnText, pinnedIds, excludedIds)) {
    if (!isInjectable(item)) continue
    if (excluded.has(String(item.id))) continue
    if (pinnedTaken.has(String(item.id))) continue
    take(item, isWorldSettingItem(item) ? 'world-match-or-stable' : 'auto', false)
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
    snapshotFingerprint: reference.snapshotFingerprint || null,
    stale: Boolean(reference.stale),
  })
}

export function buildPreparedTurn(input) {
  const message = String(input?.message ?? '')
  const budget = Number.isFinite(input?.budget) ? input.budget : DEFAULT_MEMORY_BUDGET
  const includeMemory = input?.includeMemory !== false
  const reference = buildReference(input?.reference)
  const items = Array.isArray(input?.memoryItems) ? input.memoryItems : []
  const { selected, omissions, charsUsed } = includeMemory
    ? selectMemory(items, input?.pinnedMemoryIds, budget, input?.excludedMemoryIds, message)
    : { selected: [], omissions: [], charsUsed: 0 }

  const parts = []
  if (selected.length) {
    const body = selected.map((s) => s.line || `- [${s.label}] ${s.text}`).join('\n')
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
    schemaVersion: 3,
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

void freezeItem
