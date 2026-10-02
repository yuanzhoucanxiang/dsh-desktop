/**
 * 内核能力缺口 → 作者看得懂的话。纯函数，不碰 React/DOM，node 侧可直接断言。
 *
 * 来历：adapter 一直在算 missing/degraded，但没有任何组件读它，能力缺失在界面上只剩
 * 「输入框灰着、按钮点不动」——作者不知道少了什么、还能不能继续写（2026-09-26 适配
 * 内核 0.1.7 后遗留的 UX 空档）。这里把能力位翻成「现在能做什么 / 不能做什么 / 文字会不会丢」。
 */

const HARD_REASON = {
  sessions: '内核会话服务未挂载',
  'sessions.refresh': '读不到内核的会话列表',
  coordination: '写作模式的本机服务没有响应',
  api: '写作模式的本机服务没有响应',
}

const CREATE_REASON = '当前内核没有创建写作伙伴会话的通道，已有会话仍可继续'

const SOFT_REASON = {
  'sessions.binding': '读不到原生会话的输入面',
  'input:sessions.provideInfo|conversation.input.shell': '原生输入框的读写通道不可用，草稿只存在写作台本地',
  'sessions.open|retain': '无法把主视图切到完整会话',
}

const push = (list, text) => {
  if (text && !list.includes(text)) list.push(text)
}

/** caps 来自 adapter.capabilities()（{flags,missing,degraded,canCreate,canSend}）。 */
export function companionCapability(caps) {
  const flags = (caps && caps.flags) || {}
  const missing = (caps && caps.missing) || []
  const degraded = (caps && caps.degraded) || []
  const canSend = Boolean(caps && caps.canSend)

  const blocked = []
  if (!flags.sessions) push(blocked, HARD_REASON.sessions)
  else if (!flags['sessions.binding']) push(blocked, SOFT_REASON['sessions.binding'])
  if (!flags.api) push(blocked, HARD_REASON.api)
  if (!flags.coordination) push(blocked, HARD_REASON.coordination)

  const limited = []
  for (const key of missing) {
    if (String(key).startsWith('create:')) push(limited, CREATE_REASON)
    else push(limited, HARD_REASON[key])
  }
  for (const key of degraded) push(limited, SOFT_REASON[key])

  const level = !canSend ? 'blocked' : limited.length ? 'limited' : 'ok'
  return {
    level,
    canSend,
    reasons: level === 'blocked' ? blocked : level === 'limited' ? limited : [],
    headline: level === 'blocked'
      ? '写作伙伴暂时连不上内核'
      : level === 'limited'
        ? '可以继续聊，部分能力受限'
        : '',
    // 只有连不上的时候才需要安抚「写下来的东西不会丢」——草稿确实另有本地存档。
    note: level === 'blocked' ? '这里写下的想法会存进本地草稿，伙伴恢复后可以直接发送。' : '',
  }
}
