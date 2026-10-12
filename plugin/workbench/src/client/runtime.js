/**
 * 工具台的运行时句柄：`apply()` 建立注册表后放这里，组件从这里取。
 * （组件与 entry 互相 import 会成环，所以中间放一个只存引用的模块。）
 */

let registry = null
/** 内核 `sessions` 服务（可选注入拿到；没有会话服务的环境 → null，对话列如实降级）。 */
let sessions = null
/** 内核 `uiConversation` 服务（0.2.0 的会话图通道；可选注入，缺席 → 退回 sessions 的 0.1.7 通道）。 */
let chatService = null

export function setRegistry(next) {
  registry = next
}

export function getRegistry() {
  if (!registry) throw new Error('workbench registry 尚未建立')
  return registry
}

export function peekRegistry() {
  return registry
}

export function setSessions(next) {
  sessions = next && typeof next === 'object' ? next : null
}

export function getSessions() {
  return sessions
}

export function setChatService(next) {
  chatService = next && typeof next === 'object' ? next : null
}

export function getChatService() {
  return chatService
}
