/**
 * Harness 运行时引用（唯一 native 接触面之一）。
 * 只保存 apply(ctx) 注入的服务引用，不 import 任何组件/JSX。
 *
 * P2 起本模块还负责**本渲染进程唯一**的 adapter 实例：进程内"同作品只创建一次会话"
 * 靠 adapter 实例级的 inflight 表，所以不能每个组件各建一个。
 */
import { createHarnessAdapter } from './adapter.js'
import { api } from '../../services/writing-api.js'

let sessionsRef = null
let connectionRef = null
let workspacesRef = null
// 0.1.7 起 remote.* / uiWorkspace 等服务要从存下来的 ctx 惰性解析：
// entry.js 的 inject 绝不能加它们（0.1.1 没有，加了 fiber 永不激活），属性访问才需要 inject。
let ctxRef = null
let adapterRef = null

export function bindHarness(ctx) {
  sessionsRef = ctx.sessions || null
  connectionRef = ctx.connection?.api || null
  workspacesRef = ctx.workspaces || null
  ctxRef = ctx || null
  adapterRef = null // 服务引用换了，adapter 必须重建（否则拿着旧 store）
}

export function harnessSessions() { return sessionsRef }
export function harnessConnection() { return connectionRef }
export function harnessWorkspaces() { return workspacesRef }

/** 惰性解析带点/可选服务名；服务不存在（旧内核）时返回 null，不抛。 */
export function tryService(name) {
  try {
    return typeof ctxRef?.get === 'function' ? ctxRef.get(name) || null : null
  } catch {
    return null
  }
}

/** 0.1.7 建会话通道：remote.session.create({cwd|workspaceId, agentPreset}) 一把建并绑 preset。 */
export function harnessRemoteSession() { return tryService('remote.session') }

/** 0.1.7 草稿通道：conversation.input.shell(sessionId)（0.1.1 没有这个服务，解析不到就是 null）。 */
export function harnessConversation() { return tryService('conversation') }

/** 本渲染进程唯一的 harness adapter（懒创建；bindHarness 之后失效重建）。 */
export function harnessAdapter() {
  if (!adapterRef) {
    adapterRef = createHarnessAdapter({
      sessions: sessionsRef,
      workspaces: workspacesRef,
      connection: connectionRef ? { agentPresets: connectionRef.agentPresets } : null,
      remoteSession: harnessRemoteSession,
      uiWorkspace: () => tryService('uiWorkspace'),
      conversation: harnessConversation,
      api,
    })
  }
  return adapterRef
}

/** 测试钩子：丢弃当前 adapter（不触碰任何原生状态）。 */
export function resetHarnessAdapter() { adapterRef = null }
