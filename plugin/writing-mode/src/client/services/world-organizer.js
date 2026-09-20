import { newOperationToken } from '../adapters/harness/adapter.js'
import { normalizeSources } from '../../shared/world-setting.js'

export async function snapshotHash(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('')
}

/** Correlate only a new, exact author turn and its final reply. No draft mutation. */
export async function organizeWorld(input) {
  const handle = input.handle
  const selected = input.selected
  const extra = input.extra || ''
  const signal = input.signal
  const before = handle.getSnapshot()
  if (before.status !== 'ready' || before.running || before.queue?.length) throw new Error('会话正在忙，请等当前回复完成后整理')
  if (!selected?.length) throw new Error('请先选入要整理的消息')
  const baseline = new Set(before.messages.map(m => m.key))
  const sources = []
  for (const chosen of selected) {
    const row = before.messages.find(m => m.key === chosen.id)
    if (!row || row.text !== chosen.text || !['user', 'assistant'].includes(row.kind)) throw new Error('所选来源已变化，请重新选择')
    sources.push({ sessionId: before.sessionId, messageId: row.key, role: row.kind === 'user' ? 'author' : 'assistant', excerpt: row.text, snapshotHash: await snapshotHash(row.text) })
  }
  normalizeSources(sources) // explicit capacity failure, never silently truncate provenance
  if (signal?.aborted) throw new Error('已停止等待；可在完整会话查看回复')
  const operationId = newOperationToken()
  const body = `整理请求编号：${operationId}\n请仅把下面选定讨论整理为世界观候选，不执行文件写入。区分作者结论、助手建议与未决问题，不编造作者确认。标题/结论/说明/边界可长可短。只输出 JSON：{"schemaVersion":1,"settings":[{"title":"","conclusion":"","explanation":"","boundaries":"","tags":[],"mark":"suggestion 或 open"}],"notes":""}。不要生成来源或权限字段。\n补充要求：${extra}\n\n` + sources.map(s => `【${s.role} ${s.messageId}】\n${s.excerpt}`).join('\n\n')
  return new Promise((resolve, reject) => {
    let done = false, accepted = false, unsubscribe = () => {}
    const finish = (err, value) => {
      if (done) return
      done = true; clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort)
      err ? reject(err) : resolve(value)
    }
    const abort = () => finish(new Error('已停止等待；请求可能仍在完整会话中运行，请核对后再整理'))
    const timer = setTimeout(() => finish(new Error('等待回复超时；请先核对完整会话，不会自动重发')), 300000)
    const inspect = () => {
      if (done || !accepted) return
      try {
        const snap = handle.getSnapshot()
        if (snap.sessionId !== before.sessionId || snap.projectKey !== before.projectKey) return finish(new Error('会话已变化，未采用迟到结果'))
        const index = snap.messages.findIndex(m => !baseline.has(m.key) && m.kind === 'user' && m.text === body)
        if (index < 0) return
        const following = snap.messages.slice(index + 1)
        if (following.some(m => m.kind === 'user')) return finish(new Error('整理期间出现其他回合，请在完整会话核对结果后手动整理'))
        if (following.some(m => m.kind === 'error')) return finish(new Error('整理回复失败，来源与输入已保留'))
        if (snap.running || snap.pending?.length) return
        const answer = following.filter(m => !baseline.has(m.key) && m.kind === 'assistant').at(-1)
        if (answer) finish(null, { text: answer.text, sources, operationId, messageId: answer.key, sessionId: snap.sessionId })
      } catch (err) { finish(err) }
    }
    unsubscribe = handle.subscribe(inspect)
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(handle.send(Object.freeze({ body, message: body, operationId, projectKey: before.projectKey }))).then(sent => {
      if (done) return
      if (sent.result !== 'accepted') return finish(new Error(sent.result === 'uncertain' ? '无法确认整理请求是否受理；请先核对完整会话，不会自动重发' : `整理未发送：${sent.error || sent.code || 'rejected'}`))
      accepted = true; inspect()
    }, err => finish(err))
  })
}
