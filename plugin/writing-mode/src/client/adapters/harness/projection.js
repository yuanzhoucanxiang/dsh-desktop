/**
 * 会话投影（方案 P2 §3.1）：把原生 session store 的 chat 图投影成**稳定、可订阅**的行列表，
 * UI 只消费这里的结果——不再直接读 `chat.nodes/order`、`provideInfo` 或工作区创建 API。
 *
 * 行形状与 P1 的 `companionRows` 保持一致（key/kind/text/reference/detail），
 * 这样渲染层不用改，只是数据来源换成了 adapter。
 *
 * 投影可以随时丢弃重建：聊天历史的唯一真相永远是原生会话（方案 §3.1）。
 */

const REFERENCE_SEPARATOR = '\n\n--- 供本次讨论参考的稿件快照（可能尚未保存） ---\n'

/** 文本块拼接（原生节点里正文可能是 content[] 或 blocks[]）。 */
export function textOf(parts) {
  return (parts || []).filter((p) => p && (p.kind === 'text' || p.type === 'text')).map((p) => p.text || '').join('')
}

/** 归一化用于"这一轮到底发出去没有"的比对（换行/空白差异不该影响判定）。 */
function normalizeForMatch(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/**
 * 把 chat 图投影成消息行。
 * 未知节点**保留可见摘要**（不隐藏）：方案要求未识别内容仍可见且可进完整会话。
 */
export function projectChat(chat) {
  if (!chat) return { messages: [], hasUnknown: false }
  const nodes = chat.nodes
  const order = chat.order || []
  const messages = []
  let hasUnknown = false
  for (const key of order) {
    const node = nodes && typeof nodes.get === 'function' ? nodes.get(key) : nodes ? nodes[key] : null
    if (!node || node.visibility === 'hidden') continue
    const data = node.data || {}
    if (node.kind === 'user' || node.kind === 'steering') {
      const raw = textOf(data.content)
      const idx = raw.indexOf(REFERENCE_SEPARATOR)
      const text = idx >= 0 ? raw.slice(0, idx) : raw
      const reference = idx >= 0 ? raw.slice(idx + REFERENCE_SEPARATOR.length) : undefined
      messages.push({ key, kind: 'user', text: text || '附件消息（在完整会话中查看）', reference })
      continue
    }
    if (node.kind === 'assistant-step') {
      const text = textOf(data.blocks)
      if (text) messages.push({ key, kind: 'assistant', text })
      continue
    }
    if (node.kind === 'turn-tail') continue // footer of the same assistant step
    if (node.kind === 'tool-call') {
      messages.push({ key, kind: 'detail', text: '工具活动', detail: data })
      continue
    }
    if (node.kind === 'turn-error') {
      messages.push({ key, kind: 'error', text: data.failure?.message || '这次回复未能完成，请查看完整会话。' })
      continue
    }
    hasUnknown = true
    messages.push({ key, kind: 'detail', text: node.kind === 'context' ? '补充上下文' : '会话活动', detail: data })
  }
  return { messages, hasUnknown }
}

/**
 * 「这一轮到底有没有被受理」的原生证据（方案 §3.3）：发送返回失败时用它核对，
 * 有证据才算 accepted，没证据才算 uncertain —— 绝不凭"超时"就重发。
 */
export function turnEvidence(session, body) {
  const snap = session && typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
  if (!snap) return { accepted: false, queued: false, evidence: 'no-session-snapshot' }
  const needle = normalizeForMatch(String(body || '').split(REFERENCE_SEPARATOR)[0]).slice(0, 200)
  if (!needle) return { accepted: false, queued: false, evidence: 'empty-body' }
  const chat = snap.chat
  const nodes = chat?.nodes
  for (const key of (chat?.order || [])) {
    const node = nodes && typeof nodes.get === 'function' ? nodes.get(key) : nodes ? nodes[key] : null
    if (!node || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const text = normalizeForMatch(textOf(node.data?.content)).slice(0, 200)
    if (text.includes(needle.slice(0, 80))) return { accepted: true, queued: false, evidence: 'user-node' }
  }
  for (const row of snap.queue || []) {
    const text = normalizeForMatch(row?.text || row?.preview || '')
    if (text.includes(needle.slice(0, 80))) return { accepted: true, queued: true, evidence: 'queue-row' }
  }
  return { accepted: false, queued: false, evidence: 'not-found' }
}

/**
 * 稳定快照：无变化时返回**同一个对象引用**（React 的 useSyncExternalStore 依赖这点）。
 * 指纹由调用方给出：应当包含各来源的**对象身份**（用 WeakMap 取稳定 id，而不是 String() ——
 * 否则任何对象都变成 "[object Object]"，内容变了也换不了引用）与关键标量。
 */
export function createSnapshotCache() {
  let cache = null
  let lastKey = ''
  const ids = new WeakMap()
  let seq = 0
  const idOf = (part) => {
    if (part && typeof part === 'object') {
      if (!ids.has(part)) ids.set(part, ++seq)
      return `o${ids.get(part)}`
    }
    return String(part ?? '')
  }
  return {
    get(fingerprintParts, build) {
      const key = fingerprintParts.map(idOf).join('\u0000')
      if (cache && key === lastKey) return cache
      cache = build()
      lastKey = key
      return cache
    },
    peek() {
      return cache
    },
  }
}
