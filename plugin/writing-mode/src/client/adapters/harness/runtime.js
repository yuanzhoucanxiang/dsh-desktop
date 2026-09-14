/**
 * Harness 运行时引用（唯一 native 接触面之一）。
 * 只保存 apply(ctx) 注入的服务引用，不 import 任何组件/JSX；P2 在此之上补能力探测。
 */
let sessionsRef = null
let connectionRef = null
let workspacesRef = null

export function bindHarness(ctx) {
  sessionsRef = ctx.sessions || null
  connectionRef = ctx.connection?.api || null
  workspacesRef = ctx.workspaces || null
}

export function harnessSessions() { return sessionsRef }
export function harnessConnection() { return connectionRef }
export function harnessWorkspaces() { return workspacesRef }
