/**
 * ask_user_question 的识别与作答（2026-10-10）。
 *
 * 为什么需要：写作伙伴的 preset 挂了 @deepseek-ai/dsh-tool-ask-user（模型确实能提问），但提问不是
 * 聊天节点，而是一条 Client 侧 Remote 事件瀑布（user-questions/request）；官方卡片渲染在**普通会话
 * 视图**的 composer 座位里，而写作模式是全屏浮层（.dshWmRoot，z-index 2000）——卡片被盖住。
 * 于是作者在写作台里只看到一行折叠的「工具活动」+ 一坨原始 JSON，模型那边却阻塞等着回答。
 *
 * 本模块只做纯函数：认出提问、把答案拼成内核要的形状。不作答、不碰 React/DOM，
 * node 侧可直接断言（test/writing-questions.mjs）。
 */

/** 会向作者提问的工具名（内核 dsh-tool-ask-user；request_user_input 是历史别名）。 */
const ASK_TOOLS = new Set(['ask_user_question', 'request_user_input'])

/** 模型参数用 snake_case（multi_select），内核事件用 camelCase（multiSelect）——两个都收。 */
function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((o) => o && typeof o === 'object' && typeof o.label === 'string' && o.label !== '')
    .map((o) => ({
      label: o.label,
      description: typeof o.description === 'string' ? o.description : '',
    }))
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const question = typeof raw.question === 'string' ? raw.question : ''
  if (!id || !question) return null
  return {
    id,
    question,
    header: typeof raw.header === 'string' ? raw.header : '',
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    options: normalizeOptions(raw.options),
    multiSelect: raw.multiSelect === true || raw.multi_select === true,
  }
}

/** 工具调用参数（argsRaw，JSON 文本）→ 问题清单；不是提问 / 解析不出 / 流式中途 → null。 */
export function parseQuestions(argsRaw) {
  const text = String(argsRaw || '').trim()
  if (!text) return null
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    return null // 流式 delta 期间的半截 JSON：等它长完再来
  }
  const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : null
  if (!list) return null
  const questions = list.map(normalizeItem).filter(Boolean)
  return questions.length ? questions : null
}

/** 投影行 → 结构化调用信息；非工具行给 null，字段缺失给空串，不抛。 */
export function toolCallOf(row) {
  const tool = row && row.tool
  if (!tool || typeof tool !== 'object') return null
  return {
    name: String(tool.name || ''),
    callId: String(tool.callId || ''),
    argsRaw: String(tool.argsRaw || ''),
    phase: String(tool.phase || ''),
    isError: tool.isError === true,
  }
}

/** 这一行是不是一次「向作者提问」的调用；是则给出 callId 与问题清单。 */
export function askCallOf(row) {
  const call = toolCallOf(row)
  if (!call || !ASK_TOOLS.has(call.name)) return null
  const questions = parseQuestions(call.argsRaw)
  if (!questions) return null
  return { callId: call.callId, name: call.name, questions, phase: call.phase, isError: call.isError }
}

/**
 * 拼内核要的答案批次：{ answers: [{ id, selected: string[], custom? }] }。
 * picks：{ [questionId]: { selected: string[], custom?: string } }。
 * 未作答的问题保留成 { id, selected: [] }（内核契约允许"跳过"，但要求每题恰好出现一次）。
 * 单选时 custom 顶替所选（内核契约：custom overrides the selected choice）。
 */
export function buildAnswer(questions, picks = {}) {
  const list = Array.isArray(questions) ? questions : []
  return {
    answers: list.map((q) => {
      const pick = picks[q.id] || {}
      const selected = Array.isArray(pick.selected)
        ? pick.selected.filter((s) => typeof s === 'string')
        : []
      const custom = typeof pick.custom === 'string' ? pick.custom.trim() : ''
      const item = { id: q.id, selected: q.multiSelect ? selected : custom ? [] : selected }
      if (custom) item.custom = custom
      return item
    }),
  }
}

/** 作者到底答了没有：全空就不该发（内核会把它当"跳过"，不如让作者自己决定）。 */
export function hasAnyAnswer(questions, picks = {}) {
  return (Array.isArray(questions) ? questions : []).some((q) => {
    const pick = picks[q.id] || {}
    const custom = typeof pick.custom === 'string' ? pick.custom.trim() : ''
    return custom !== '' || (Array.isArray(pick.selected) && pick.selected.length > 0)
  })
}

/**
 * 作答失败的人话。
 * 要点：**前台还开着的提问**客户端替不了它作答（内核 user-questions 契约：那时只有那个等待中的
 * 请求能结算），所以最常见的失败不是 bug，而是"该去完整会话里答"。
 */
export function answerFailureText(code) {
  switch (String(code || '')) {
    case 'not-answerable':
    case 'BAD_ANSWER':
    case 'ASK_CANCELLED':
      return '这次提问已经不在可作答状态，去完整会话看看它走到哪一步了。'
    case 'REPLY_QUEUED':
      return '已经提交过一次回答，正在等模型接上。'
    case 'answer-unavailable':
    case 'no-session':
      return '当前内核没有提问作答通道，去完整会话处理。'
    case 'no-call-id':
      return '这次提问没带调用标识，去完整会话处理。'
    default:
      return '这次没提交成功——模型还在前台等回答时，只能去完整会话里答。'
  }
}
