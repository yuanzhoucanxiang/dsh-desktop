/**
 * 长条门面的发送面（2026-10-12 刀 5）。
 *
 * 原语是内核会话对象上的 `prompt(parts, mode)`——签名照本仓库已跑通的生产代码
 * （`packages/mode-kit/src/harness/adapter.js:765`：`session.prompt([{ type:'text', text: body }], 'queue')`），
 * **不自己发明**：返回 `{ok:true}` 才算交出去；`ok:false` 是原生明确拒绝；抛异常是
 * "交出去了但结果不可核"。三种结果分开处理，且**任何非 accepted 都不清作者的正文**
 * （写作模式当年就是靠这条纪律避免"发送失败把草稿弄丢"）。
 *
 * 门面只做"发进当前这条会话"，不碰项目绑定、不排队相关逻辑——那些是模式自己的事。
 */

/** 有没有发送面：会话句柄在、且它支持 prompt。`reason` 是给作者看的出路说明。 */
export function sendSurface(sessions, sessionId) {
  if (!sessionId) return { canSend: false, session: null, reason: '还没有会话，先在内核界面里发起一段对话。' }
  let session = null
  try {
    session = sessions?.binding?.(sessionId)?.session || null
  } catch {
    session = null
  }
  if (!session || typeof session.prompt !== 'function') {
    return { canSend: false, session: null, reason: '这个内核版本没有给出发送面。点下面「回到完整会话」在原处发送。' }
  }
  return { canSend: true, session, reason: '' }
}

/**
 * 发一条消息。返回 `{ result: 'accepted' | 'rejected' | 'uncertain', error?, retainedBody }`。
 * `retainedBody` 永远带回来：调用方只在 accepted 时清输入框。
 */
export async function dispatchMessage(session, text) {
  const body = String(text || '').trim()
  if (!body) return { result: 'rejected', code: 'empty-body', error: '还没写内容', retainedBody: '' }
  if (!session || typeof session.prompt !== 'function') {
    return { result: 'rejected', code: 'no-send-surface', error: '没有发送面', retainedBody: body }
  }
  try {
    const res = await session.prompt([{ type: 'text', text: body }], 'queue')
    if (res && res.ok === true) return { result: 'accepted', retainedBody: '' }
    if (res && res.ok === false) {
      return { result: 'rejected', code: String(res.error?.code || 'send-rejected'), error: String(res.error?.message || res.error || '内核拒绝了这条消息'), retainedBody: body }
    }
    // 没给 ok 字段：不猜成功，按"不可核"处理，正文留着
    return { result: 'uncertain', code: 'no-response-shape', error: '发送结果无法核对', retainedBody: body }
  } catch (err) {
    return { result: 'uncertain', code: String(err?.code || 'send-threw'), error: String(err?.message || err), retainedBody: body }
  }
}
