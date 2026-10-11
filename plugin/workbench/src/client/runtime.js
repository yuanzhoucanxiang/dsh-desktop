/**
 * 工具台的运行时句柄：`apply()` 建立注册表后放这里，组件从这里取。
 * （组件与 entry 互相 import 会成环，所以中间放一个只存引用的模块。）
 */

let registry = null

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
