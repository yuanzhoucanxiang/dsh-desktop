/**
 * 真聊天瓷砖的读路径（2026-10-12 刀 4，**只读**）。
 *
 * 路子是从本仓库已跑通的实现里抄下来的（写作伙伴面板天天在用）：
 *  - 0.2.0：`uiConversation.binding(id).target('chat')` 拿到图，`target.subscribe()` 收变更；
 *  - 0.1.7：退回会话对象上的 `chat`；
 *  - 消息投影**不自己写**：用 mode-kit 的 `projectChat()`（它负责区分 user / assistant-step /
 *    tool-call / turn-error，还会用 `stripInjectedBlocks` 剥掉注入给模型的 prompt——
 *    少了这一步，作者会在转录里看到一整段系统文字，那是写作模式 0.1.59 修过的真缺陷）。
 *
 * **订阅只做一次**：变更回调里只重读图、不重建订阅。
 * （2026-10-12 探针实测：边收变更边重订阅会在订阅集合上形成回环，探针直接挂死。）
 *
 * 刻意**只做读**：发送要花用户的模型额度，不在这一刀里（plan §6.4.4 的两段交付边界）。
 * `source` 会挂到 UI 的 `data-wb-chat-source` 上，实机一眼能看出走到哪一步：
 * `uiConversation` / `session` / `pending`（通道在、图还没送到，订阅已挂上）/
 * `none`（两条通道都不符）/ `no-service` / `no-session`。
 */
import { projectChat } from '../../../../packages/mode-kit/src/harness/projection.js'

/** 转录最多显示几条（更多留给「回到完整会话」，不在瓷砖里做无限滚动）。 */
export const TRANSCRIPT_LIMIT = 6

function asFunction(value) {
  return typeof value === 'function' ? value : null
}

/** 图对象可能有两种给法：直接是 {nodes, order}，或者是个可快照的 Store / 带 chat 字段的快照。 */
function graphOf(target) {
  if (!target || typeof target !== 'object') return null
  const snap = asFunction(target.getSnapshot)
  const value = snap ? snap.call(target) : target
  if (!value || typeof value !== 'object') return null
  if (value.nodes || Array.isArray(value.order)) return value
  if (value.chat && (value.chat.nodes || Array.isArray(value.chat.order))) return value.chat
  return null
}

function emptyState(source) {
  return { source, messages: [], hasUnknown: false }
}

function projected(source, graph) {
  return { source, ...projectChat(graph) }
}

/**
 * 订阅一条会话的转录。返回 `{ source, messages, hasUnknown, dispose }`（初次同步读的结果），
 * 之后图每次变更都会把新结果推给 `onChange`。读不到时 `source` 说明**为什么**读不到。
 */
export function watchTranscript(sessions, uiConversation, sessionId, onChange) {
  const offs = []
  let closed = false
  const dispose = () => {
    closed = true
    while (offs.length) {
      const off = offs.pop()
      try {
        if (typeof off === 'function') off()
      } catch {
        /* 解订阅失败不影响任何事 */
      }
    }
  }
  const notify = (state) => {
    if (closed || typeof onChange !== 'function') return
    try {
      onChange(state)
    } catch {
      /* 订阅方的异常不该拖垮读路径 */
    }
  }
  // reader 由调用方带进来：闭包里不认外层块级变量（踩过：`read is not defined`）
  const attach = (subscribe, reader) => {
    const ret = subscribe(() => notify(reader()))
    if (typeof ret === 'function') offs.push(ret)
  }

  if (!sessionId) return { ...emptyState('no-session'), dispose }
  if (!sessions && !uiConversation) return { ...emptyState('no-service'), dispose }

  // 0.2.0 通道：uiConversation.binding(id).target('chat')
  try {
    const target = uiConversation?.binding?.(sessionId)?.target?.('chat')
    if (target) {
      const read = () => {
        const graph = graphOf(target)
        return graph ? projected('uiConversation', graph) : emptyState('pending')
      }
      if (asFunction(target.subscribe)) attach(target.subscribe.bind(target), read)
      const first = read()
      return { ...first, dispose }
    }
  } catch {
    /* 通道形状不符，继续试 0.1.7 */
  }

  // 0.1.7 通道：会话对象上的 chat
  try {
    const session = sessions?.binding?.(sessionId)?.session
    const store = session?.chat && asFunction(session.chat.subscribe) ? session.chat : null
    const read = () => {
      const graph = graphOf(store) || graphOf(session?.chat) || graphOf(session)
      return graph ? projected('session', graph) : emptyState('none')
    }
    if (store) attach(store.subscribe.bind(store), read)
    const first = read()
    if (first.source === 'session') return { ...first, dispose }
  } catch {
    /* 两条通道都不符 */
  }

  return { ...emptyState('none'), dispose }
}

/** 给 UI 用的尾部 N 条（最近的在最下面，跟聊天界面一致）。 */
export function tailMessages(messages, limit = TRANSCRIPT_LIMIT) {
  const list = Array.isArray(messages) ? messages : []
  return list.slice(Math.max(0, list.length - limit))
}
