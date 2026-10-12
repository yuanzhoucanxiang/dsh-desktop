/**
 * 工具台主屏左列：「对话」瓷砖（L2 主屏，2026-10-11）。
 *
 * 用户定的主屏形态（2026-10-11）：进入工具台时，左边是 agent 对话窗口，右边是各模式的
 * 内容窗口。这一列 v1 只做**真实但克制**的三件事：显示内核会话列表顶部的会话标题、
 * 如实显示读不到/没有会话、给一枚「回到完整会话」（关主屏；若正有模式激活，先走同一套
 * 守卫退出模式——不绕过守卫）。
 *
 * 完整聊天交互（转录 + 输入框）是下一步：写作模式的伙伴面板已证明 mode-kit 的会话栈
 * 能撑起一块真正的对话瓷砖，但那是独立的下一轮，不在主屏第一刀里。
 *
 * 会话服务是**可选注入**（`runtime.js` 的 getSessions）：官方壳/老内核/探针 harness 没有它时
 * 整列降级为如实说明，不报错、不编造。
 */
import * as react from 'react'
import { T } from './copy.js'
import { getSessions, getChatService } from './runtime.js'
import { formatTelemetry, telemetryOf, watchSessionProjections } from './session-telemetry.js'
import { tailMessages, watchTranscript } from './chat-transcript.js'
import { dispatchMessage, sendSurface } from './chat-send.js'
import { setNotice } from './ui-store.js'

/** 转录行的角色标签：状态不只靠颜色（guide §5）。 */
const WHO = { user: '作者', assistant: '助手', detail: '活动', error: '出错' }

/** 读会话列表快照（防御：快照Store形状不符就返回 null，组件层如实显示）。 */
function readSnapshot(sessions) {
  try {
    const store = sessions?.list
    if (!store || typeof store.getSnapshot !== 'function') return null
    const snap = store.getSnapshot()
    if (!snap || !Array.isArray(snap.ids) || typeof snap.byId !== 'object' || !snap.byId) return null
    return snap
  } catch {
    return null
  }
}

export function ConversationTile({ onBack }) {
  const sessions = getSessions()
  const [snap, setSnap] = react.useState(() => readSnapshot(sessions))

  react.useEffect(() => {
    const store = sessions?.list
    if (!store || typeof store.subscribe !== 'function') return undefined
    const sync = () => setSnap(readSnapshot(sessions))
    try {
      return store.subscribe(sync)
    } catch {
      return undefined
    }
  }, [sessions])

  // 真实内核客户端侧的列表快照记录是 {id, displayTitle, running, retainedBy, blank, updatedAt, title?}
  // （runtime/.../dsh-api-session-controller/lib/types/client/sessions/service.js:491-512）：
  // displayTitle 恒有值（有持久标题就用标题，否则按工作目录/会话 id 派生），而 title 只在会话
  // 确有持久标题时才存在——读 title 会让没起过名字的会话这一行空白。
  const first = snap && snap.ids.length > 0 ? snap.byId[snap.ids[0]] : null
  const sessionId = snap && snap.ids.length > 0 ? snap.ids[0] : null

  // 状态条三指标：投影要**从会话句柄上读**（列表行那条 RPC 不带这三个键，见 session-telemetry.js 的注释）。
  // 环境没有 retain 能力（老内核 / 探针假宿主）→ 退回读列表行；两个都没有就是"还没数据"，不编造。
  const [projValues, setProjValues] = react.useState(null)
  const [telemetrySource, setTelemetrySource] = react.useState('no-session')
  react.useEffect(() => {
    const watch = watchSessionProjections(sessions, sessionId, setProjValues)
    setTelemetrySource(watch.source)
    return watch.dispose
  }, [sessionId, sessions])

  const metrics = formatTelemetry(telemetryOf(projValues))

  // 真聊天瓷砖（只读转录）。订阅回调里重读一次——图变了就跟着变；组件卸载时解订阅。
  const [transcript, setTranscript] = react.useState({ source: 'no-session', messages: [] })
  react.useEffect(() => {
    const watch = watchTranscript(
      sessions,
      getChatService(),
      sessionId,
      (next) => setTranscript({ source: next.source, messages: tailMessages(next.messages) }),
    )
    setTranscript({ source: watch.source, messages: tailMessages(watch.messages) })
    return watch.dispose
  }, [sessionId, sessions])
  const log = transcript.messages.length
    ? react.createElement(
        'div',
        { className: 'dshWbChatLog', 'data-wb-chat-log': '', 'data-wb-chat-source': transcript.source },
        transcript.messages.map((m) =>
          react.createElement(
            'div',
            { key: m.key, className: `dshWbChatLine is-${m.kind}`, 'data-wb-chat-line': m.kind },
            react.createElement('span', { className: 'dshWbChatWho' }, WHO[m.kind] || '会话'),
            react.createElement('span', { className: 'dshWbChatText' }, String(m.text || '').slice(0, 160)),
          ),
        ),
      )
    : null
  // 有会话但读不到图（老内核 / 通道形状不符）：说清"读不到"与出路，不留一块空白。
  const logHint =
    !transcript.messages.length && sessionId && (transcript.source === 'none' || transcript.source === 'no-service')
      ? react.createElement(
          'div',
          { className: 'dshWbChatHint', 'data-wb-chat-log-empty': transcript.source },
          '这条会话的内容暂时读不到（内核会话图通道不可用）。点下面「回到完整会话」看全文。',
        )
      : null
  const strip = react.createElement(
    'div',
    {
      className: 'dshWbStrip',
      'data-wb-strip': '',
      'data-wb-telemetry': telemetrySource,
      // 自查用：句柄投影里**到底有哪些键**（真内核上一眼能分清"还没送到"与"根本没这个键"）
      'data-wb-telemetry-keys': Object.keys(projValues || {}).sort().join(','),
    },
    react.createElement('span', { className: 'dshWbStripItem', title: metrics.speed.title, 'data-wb-metric': 'speed' }, metrics.speed.text),
    react.createElement('span', { className: 'dshWbStripItem', title: metrics.cache.title, 'data-wb-metric': 'cache' }, metrics.cache.text),
    react.createElement('span', { className: 'dshWbStripItem', title: metrics.context.title, 'data-wb-metric': 'context' }, metrics.context.text),
  )
  const title = first?.displayTitle ? String(first.displayTitle) : ''

  // 输入框 + 发送（刀 5）。发送面来自会话句柄的 prompt 原语；没有面就禁用并把出路写在 title 上。
  const surface = sendSurface(sessions, sessionId)
  const draftRef = react.useRef(null)
  const [sending, setSending] = react.useState(false)
  const send = async () => {
    const box = draftRef.current
    const text = box ? String(box.value || '') : ''
    if (sending) return
    setSending(true)
    const out = await dispatchMessage(surface.session, text)
    setSending(false)
    if (out.result === 'accepted') {
      if (box) box.value = ''
      return
    }
    // 非 accepted：**作者写的字一个字都不丢**，说清状态与出路
    setNotice({
      kind: 'warn',
      text:
        out.result === 'uncertain'
          ? `这条消息的发送结果没能核对（${out.error}）——你写的内容还留着，可重试；不放心就点「回到完整会话」在原处发。`
          : `这条消息没发出去（${out.error}）——你写的内容还留着。`,
    })
  }
  const composer = first
    ? react.createElement(
        'div',
        { className: 'dshWbComposer', 'data-wb-composer-row': '' },
        react.createElement('textarea', {
          className: 'dshWbComposerInput',
          ref: draftRef,
          rows: 2,
          placeholder: surface.canSend ? '接着和 agent 说…（Enter 发送，Shift+Enter 换行）' : '现在还不能在这里发送',
          disabled: !surface.canSend,
          title: surface.canSend ? '' : surface.reason,
          'data-wb-composer': '',
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          },
        }),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dshWbBtn is-primary',
            disabled: !surface.canSend || sending,
            title: surface.canSend ? '' : surface.reason,
            onClick: () => void send(),
            'data-wb-send': '',
          },
          sending ? '发送中…' : '发送',
        ),
      )
    : null

  return react.createElement(
    'div',
    { className: 'dshWbChatCard', 'data-wb-chat-card': '', 'data-wb-chat-source': transcript.source },
    !sessions
      ? react.createElement('div', { className: 'dshWbChatHint', 'data-wb-chat-empty': 'noservice' }, T.chatNoService)
      : !snap
        ? react.createElement('div', { className: 'dshWbChatHint', 'data-wb-chat-empty': 'unreadable' }, T.chatNoService)
        : !first
          ? react.createElement('div', { className: 'dshWbChatHint', 'data-wb-chat-empty': 'empty' }, T.chatEmpty)
          : react.createElement(
              'div',
              { className: 'dshWbChatSession', 'data-wb-chat-session': '' },
              react.createElement('div', { className: 'dshWbChatSessionTitle', title }, title),
            ),
    log,
    logHint,
    // 没有会话时不摆三条"还没数据"——那时该说的只有上面那句空状态，窄条只会添噪。
    first ? strip : null,
    composer,
    react.createElement(
      'button',
      { type: 'button', className: 'dshWbBtn is-primary', onClick: () => void onBack(), 'data-wb-chat-back': '' },
      T.chatBack,
    ),
  )
}
