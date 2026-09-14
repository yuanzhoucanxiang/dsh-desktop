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
let adapterRef = null

export function bindHarness(ctx) {
  sessionsRef = ctx.sessions || null
  connectionRef = ctx.connection?.api || null
  workspacesRef = ctx.workspaces || null
  adapterRef = null // 服务引用换了，adapter 必须重建（否则拿着旧 store）
}

export function harnessSessions() { return sessionsRef }
export function harnessConnection() { return connectionRef }
export function harnessWorkspaces() { return workspacesRef }

/** 本渲染进程唯一的 harness adapter（懒创建；bindHarness 之后失效重建）。 */
export function harnessAdapter() {
  if (!adapterRef) {
    adapterRef = createHarnessAdapter({
      sessions: sessionsRef,
      workspaces: workspacesRef,
      connection: connectionRef ? { agentPresets: connectionRef.agentPresets } : null,
      api,
    })
  }
  return adapterRef
}

/** 测试钩子：丢弃当前 adapter（不触碰任何原生状态）。 */
export function resetHarnessAdapter() { adapterRef = null }
