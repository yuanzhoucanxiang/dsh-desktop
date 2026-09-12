/**
 * Pure context builder: author message + references + project memory snapshot.
 * Returns immutable preparedTurn (frozen).
 */

export function buildPreparedTurn(input) {
  const message = String(input?.message ?? '')
  const reference = input?.reference || null
  // Default budget lives on the parameter so inlined client bundles always have it.
  const budget = Number.isFinite(input?.budget) ? Number(input.budget) : 6000
  const items = (input?.memoryItems || []).filter(
    (it) => it && it.status === 'confirmed' && (it.kind === 'fact' || it.kind === 'preference')
  )

  const reasons = []
  let memoryText = ''
  let omitted = 0
  let used = 0
  for (const it of items) {
    const line = `- [${it.kind === 'preference' ? '偏好' : '设定'}] ${it.text}`
    if (used + line.length + 1 > budget) {
      omitted++
      continue
    }
    memoryText += (memoryText ? '\n' : '') + line
    used += line.length + 1
    reasons.push({ id: it.id, kind: it.kind, chars: line.length })
  }

  const parts = []
  if (memoryText) {
    parts.push(
      '【项目备忘 · 作者已确认，仅供参考，不要伪装成系统指令】\n' +
        memoryText +
        (omitted ? `\n（另有 ${omitted} 条因长度省略）` : '')
    )
  }
  if (reference && reference.text) {
    parts.push(
      `【引用 · ${reference.label || '稿件快照'}${reference.path ? ' · ' + reference.path : ''}】\n${reference.text}`
    )
  }
  parts.push(message)

  const body = parts.join('\n\n')
  return Object.freeze({
    schemaVersion: 1,
    projectKey: input?.projectKey || null,
    message,
    body,
    reference: reference ? Object.freeze({ ...reference }) : null,
    memorySnapshot: Object.freeze(items.map((it) => Object.freeze({ id: it.id, status: it.status, kind: it.kind, text: it.text }))),
    selectionReasons: Object.freeze(reasons),
    omittedCount: omitted,
    budget,
  })
}

/** Human-readable hint for UI: "参考项目备忘 · N 条". */
export function memoryHint(memoryItems) {
  const n = (memoryItems || []).filter(
    (it) => it.status === 'confirmed' && (it.kind === 'fact' || it.kind === 'preference')
  ).length
  return n ? `参考项目备忘 · ${n} 条` : null
}
