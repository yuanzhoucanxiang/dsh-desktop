/**
 * 「【选择】」块：写作伙伴给作者的可点选项（2026-10-11）。
 *
 * 为什么走文本约定、而不是只用 ask_user_question：内核契约（dsh-user-questions）下，前台等待还开着的
 * 提问**只有那次等待中的请求能结算**，而那个请求被官方卡片拿着、卡片渲染在普通会话视图里、被写作模式
 * 全屏浮层盖住——客户端够不着。所以「点一下、模型立刻继续」这件事在工具通道上做不到；文本选项走的是
 * 普通消息，模型本来就没被阻塞，点一下就是一次正常发言。工具通道仍在（timed 模式 + 提问卡）兜底
 * 模型真去调工具的情况。
 *
 * 约定（写在伙伴人设里）：单独一行「【选择】」，其后每行一个以「- 」开头的选项，放在回复末尾。
 * 解析不出来就当普通文字——**不猜、不误伤正文里本来就有的列表**。
 *
 * 纯函数，不碰 React/DOM，node 侧可直接断言（test/writing-choices.mjs）。
 */

export const CHOICE_MARKER = '【选择】'

/** 一次最多收几个选项（人设里写的是五个；这里再兜一层，防止模型写成长清单）。 */
export const CHOICE_MAX = 5

/** 选项行：`- 文案` / `* 文案`（Markdown 无序列表的两种写法）。 */
const OPTION_RE = /^[-*]\s+(.+)$/

/**
 * 从一段回复里取出选项块。
 * @param text 回复原文（可能还在流式增长）。
 * @returns `{ options, body }`；没有完整选项块时 null（body = 去掉选项块之后的正文）。
 *
 * 判据（宁可漏、不可错）：
 *   - marker 行必须**独占一行**（trim 后完全等于「【选择】」），取最后一个；
 *   - 选项至少两条（一条不构成"选择"，多半是模型随手写的）；
 *   - 选项行必须紧跟在 marker 之后（空行跳过），遇到第一个非选项行即结束。
 */
export function parseChoiceBlock(text) {
  const raw = String(text || '')
  if (!raw.includes(CHOICE_MARKER)) return null
  const lines = raw.split('\n')
  let markerAt = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === CHOICE_MARKER) { markerAt = i; break }
  }
  if (markerAt === -1) return null
  const options = []
  for (let i = markerAt + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '') continue
    const match = OPTION_RE.exec(trimmed)
    if (!match) break
    const label = match[1].trim()
    if (label) options.push(label)
    if (options.length >= CHOICE_MAX) break
  }
  if (options.length < 2) return null
  return { options, body: lines.slice(0, markerAt).join('\n').replace(/\s+$/, '') }
}

/** 点选后发出去的那句话：把标签原样送出（作者的话就是他的话，不替他改写）。 */
export function choiceMessage(label) {
  return String(label || '').trim()
}
