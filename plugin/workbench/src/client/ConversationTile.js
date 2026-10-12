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
import { TelemetryMeter, useSessionSnapshot, useSessionTelemetry } from './use-session.js'
import { tailMessages, watchTranscript } from './chat-transcript.js'
import { dispatchMessage, sendSurface } from './chat-send.js'
import { getChatDraft, setChatDraft, setNotice } from './ui-store.js'

/** 转录行的角色标签：状态不只靠颜色（guide §5）。 */
const WHO = { user: '作者', assistant: '助手', detail: '活动', error: '出错' }

/** 超过这个长度的气泡默认折三行（点「展开全文」看全文；不再硬截断，一个字都不丢）。 */
const LONG_TEXT = 180

export function ConversationTile({ onBack, modes = [], onPickMode }) {
  const sessions = getSessions()
  // 快照与遥测都走共享 hook（小条用同一份数据，见 use-session.js）
  const { snap, first, sessionId, running } = useSessionSnapshot(sessions)
  const { metrics, source: telemetrySource, values: projValues } = useSessionTelemetry(sessions, sessionId)
  const [sheetOpen, setSheetOpen] = react.useState(false)
  // 展开过的长消息（按 key 记）：长文默认折三行，点「展开」看全文
  const [expanded, setExpanded] = react.useState({})

  // 真实内核客户端侧的列表快照记录是 {id, displayTitle, running, retainedBy, blank, updatedAt, title?}
  // （runtime/.../dsh-api-session-controller/lib/types/client/sessions/service.js:491-512）：
  // displayTitle 恒有值（有持久标题就用标题，否则按工作目录/会话 id 派生），而 title 只在会话
  // 确有持久标题时才存在——读 title 会让没起过名字的会话这一行空白。`first/sessionId` 现在由
  // useSessionSnapshot 给出（2026-10-13 抽出共享 hook，小条复用同一份）。

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
  // 工具活动行（转录投影给的是结构化 tool：{name, phase, isError}）——不套气泡，压成一行，
  // 免得"调用了个工具"在窄条里跟作者的话一样占地方
  const actLine = (m) => {
    const tool = m.tool
    if (!tool) return null
    const phase = tool.phase === 'result' ? (tool.isError ? '失败' : '完成') : '进行中'
    return react.createElement(
      'div',
      { key: m.key, className: `dshWbAct${tool.isError ? ' is-error' : ''}`, 'data-wb-chat-act': tool.phase || 'call' },
      react.createElement('span', { className: 'dshWbActIcon', 'aria-hidden': 'true' }, '⚙'),
      react.createElement('span', { className: 'dshWbActName', title: tool.argsRaw || '' }, tool.name || '工具'),
      react.createElement('span', { className: 'dshWbActPhase' }, phase),
    )
  }
  const log = transcript.messages.length
    ? react.createElement(
        'div',
        { className: 'dshWbChatLog', 'data-wb-chat-log': '', 'data-wb-chat-source': transcript.source },
        // 日期分隔（原型里是 `.day`）：v1 只写"今天"——不编造历史日期，等真转录带时间戳再说
        react.createElement('div', { className: 'dshWbChatDay', 'data-wb-chat-day': '' }, '今天'),
        // 气泡（原型 `.msg.user` / `.msg.agent`）：作者那一侧自己，助手/活动/出错在另一侧；
        // 工具调用走活动行（上面 actLine），不套气泡
        transcript.messages.map((m) => {
          if (m.kind === 'detail' && m.tool) return actLine(m)
          const full = String(m.text || '')
          const isLong = full.length > LONG_TEXT
          const open = expanded[m.key] === true
          return react.createElement(
            'div',
            { key: m.key, className: `dshWbMsg is-${m.kind}`, 'data-wb-chat-line': m.kind },
            m.kind !== 'user' ? react.createElement('span', { className: 'dshWbMsgWho' }, WHO[m.kind] || '会话') : null,
            react.createElement(
              'span',
              {
                className: `dshWbMsgBody${isLong && !open ? ' is-clamped' : ''}`,
                'data-wb-msg-open': isLong ? (open ? '1' : '0') : null,
              },
              full,
            ),
            // 长文折叠：默认三行，点一下展开全文（比原来"硬截断 160 字"诚实——一个字都不丢）
            isLong
              ? react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshWbMsgMore',
                    onClick: () => setExpanded((prev) => ({ ...prev, [m.key]: !open })),
                    'data-wb-msg-toggle': open ? 'collapse' : 'expand',
                  },
                  open ? '收起' : `展开全文（${full.length} 字）`,
                )
              : null,
          )
        }),
        // 流式态：正在生成时把这一行挂在最下面（带实时 tok/s，读不到就不显示那一段）
        running
          ? react.createElement(
              'div',
              { className: 'dshWbStreaming', 'data-wb-chat-streaming': '' },
              react.createElement('span', { className: 'dshWbStreamDot', 'aria-hidden': 'true' }),
              react.createElement('span', null, '正在生成…'),
              metrics.speed.text.includes('还没数据')
                ? null
                : react.createElement('span', { className: 'dshWbStreamSpeed', 'data-wb-chat-stream-speed': '' }, metrics.speed.text),
            )
          : null,
      )
    : null
  // 三态说清（空 / 正在读 / 读不到）——`pending` 是**正在读**，不能错报成"还没有消息"
  const logHint =
    transcript.source === 'pending' && !transcript.messages.length
      ? react.createElement(
          'div',
          { className: 'dshWbChatHint', 'data-wb-chat-log-empty': 'pending' },
          '正在读取这条会话的内容…',
        )
      : !transcript.messages.length && sessionId && (transcript.source === 'none' || transcript.source === 'no-service')
      ? react.createElement(
          'div',
          { className: 'dshWbChatHint', 'data-wb-chat-log-empty': transcript.source },
          '这条会话的内容暂时读不到（内核会话图通道不可用）。点下面「回到完整会话」看全文。',
        )
      : // 通道在位、只是**还没有消息**：也要说明，否则窄条中间就是一大片空白（2026-10-13 截图抓到）。
        // 正在生成时不摆这句——那时该出现的是下面的流式态，不是"还没有消息"。
        !transcript.messages.length && sessionId && !running
        ? react.createElement(
            'div',
            { className: 'dshWbChatHint', 'data-wb-chat-log-empty': 'no-messages' },
            '这条会话还没有消息。在下面发一条，或点「回到完整会话」看历史。',
          )
        : null
  // 状态条走共享组件（小条用的是同一个，见 use-session.js 的 TelemetryMeter）
  const strip = react.createElement(TelemetryMeter, { metrics, source: telemetrySource, values: projValues })
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
      setChatDraft('')
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
  // 「+」弹层（原型 `.sheet`）：上传（还没接，如实禁用并说明）+ 更多工具（= 模式入口，与接缝同一批）
  const sheet = sheetOpen
    ? react.createElement(
        'div',
        { className: 'dshWbSheet', 'data-wb-sheet': '', role: 'menu' },
        react.createElement('div', { className: 'dshWbSheetCap' }, '上传'),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dshWbSheetItem',
            disabled: true,
            title: '附件上传还没接（内核的文件通道尚未接入工具台）',
            'data-wb-sheet-upload': '',
          },
          '📎 上传文件',
        ),
        react.createElement('div', { className: 'dshWbSheetSep' }),
        react.createElement('div', { className: 'dshWbSheetCap' }, '更多工具'),
        modes.length === 0
          ? react.createElement('div', { className: 'dshWbSheetEmpty' }, T.seamEmpty)
          : modes.map((m) =>
              react.createElement(
                'button',
                {
                  key: m.id,
                  type: 'button',
                  className: `dshWbSheetItem${m.active ? ' is-active' : ''}`,
                  onClick: () => {
                    setSheetOpen(false)
                    onPickMode?.(m.id)
                  },
                  'data-wb-sheet-mode': m.id,
                },
                m.label,
              ),
            ),
      )
    : null

  const composer = first
    ? react.createElement(
        react.Fragment,
        null,
        react.createElement(
          'div',
          { className: 'dshWbComposer', 'data-wb-composer-row': '' },
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'dshWbPlus',
              title: '上传文件和更多工具',
              'aria-expanded': sheetOpen ? 'true' : 'false',
              onClick: () => setSheetOpen((v) => !v),
              'data-wb-plus': '',
            },
            '+',
          ),
          sheet,
          // 输入框与发送**同框**（原型把发送放在输入框内右下），textarea 右侧留出按钮的位置
          react.createElement(
            'div',
            { className: 'dshWbInputWrap' },
            react.createElement('textarea', {
              className: 'dshWbComposerInput',
              ref: draftRef,
              // 未发送正文记在模块级（见 ui-store.js 的 getChatDraft）：`—` 收小条会卸载这一整块，
              // 只靠 DOM 就会把作者打到一半的字吞掉。刻意不落盘。
              defaultValue: getChatDraft(),
              onChange: (event) => setChatDraft(event.target.value),
              rows: 2,
              placeholder: surface.canSend ? '发消息……' : '现在还不能在这里发送',
              disabled: !surface.canSend,
              title: surface.canSend ? 'Enter 发送，Shift+Enter 换行' : surface.reason,
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
                className: 'dshWbSendIn',
                disabled: !surface.canSend || sending,
                title: surface.canSend ? '发送（Enter）' : surface.reason,
                onClick: () => void send(),
                'data-wb-send': '',
              },
              sending ? '发送中…' : '发送',
            ),
          ),
        ),
        // 状态条在输入框**下方**（原型顺序：`.composer` → `.meter`）
        first ? strip : null,
        react.createElement(
          'div',
          { className: 'dshWbChatFoot' },
          react.createElement(
            'button',
            { type: 'button', className: 'dshWbLinkBtn', onClick: () => void onBack(), 'data-wb-chat-back': '' },
            T.chatBack,
          ),
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
    // 对话主体：有消息就是可滚动的气泡列；没消息就把说明**居中**（贴在底部会显得像页脚）
    react.createElement(
      'div',
      {
        className: `dshWbChatBody${transcript.messages.length ? '' : ' is-empty'}`,
        'data-wb-chat-body': transcript.messages.length ? 'filled' : 'empty',
      },
      log,
      logHint,
    ),
    // 输入区（含状态条与次要出口）钉在**底部**：上面是对话，下面这一块不参与滚动
    composer,
  )
}
