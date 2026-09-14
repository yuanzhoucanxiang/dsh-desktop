/**
 * 原生会话接触面：把「伙伴会话」的查找/创建/输入写入集中在这里（P1 仅搬迁，行为不变）。
 * 依赖：adapters/harness/runtime（服务引用）+ services/writing-api（HTTP）。
 * 不 import 任何组件/JSX/DOM —— P2 将在此补齐创建协调与异常协议。
 */
import { api } from '../../services/writing-api.js'
import { harnessConnection, harnessWorkspaces } from './runtime.js'

export function appendCompanionDraft(sessions, id, text) {
  const info = sessions.provideInfo(id)
  if (!info?.props?.inputActions?.setDraft || !info?.hooks?.input) throw new Error('原生输入框尚未就绪，请稍后重试')
  const draft = info.hooks.input.getSnapshot().draft || ''
  info.props.inputActions.setDraft(draft ? draft + '\n\n' + text : text)
}


export async function ensureCompanionSession(sessions, path, isCurrent = () => true, connection = harnessConnection(), workspaces = harnessWorkspaces()) {
  if (!sessions) throw new Error('Harness 会话服务尚未就绪')
  const binding = await api('companion', undefined, { path })
  if (!binding.ok) throw new Error(binding.error)
  await sessions.refresh()
  if (!isCurrent()) return null
  let id = binding.sessionId
  if (!id || !sessions.list.getSnapshot().byId[id]) {
    const prepared = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, prepare: true }) })
    if (!prepared.ok) throw new Error(prepared.error)
    if (!connection?.agentPresets?.select || !workspaces) throw new Error('Harness 未提供原生角色或工作区服务，请检查内核版本')
    if (!isCurrent()) return null
    const workspace = await workspaces.create({ path: binding.project })
    if (!isCurrent()) return null
    id = await sessions.create({ workspaceId: workspace.workspaceId })
    const selected = await connection.agentPresets.select({ sessionId: id, agentPreset: prepared.preset })
    if (!selected.result.ok) throw new Error(selected.result.error.message)
    sessions.noteAgentPreset(id, selected.result.value.agentPreset)
    const data = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, sessionId: id }) })
    if (!data.ok) throw new Error('会话已创建，但项目关联未保存：' + data.error)
  }
  if (!isCurrent()) return null
  sessions.open(id)
  // Reload the native role picker after the confirmed session becomes current.
  await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, prepare: true }) })
  if (!isCurrent()) return null
  return { ...binding, sessionId: id }
}
