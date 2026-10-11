/**
 * 切换动作（入口与切换器共用）。
 *
 * 关键纪律（文档 W3）：被模式的关闭守卫拦下时，**工具台不自造提示文案**——
 * 守卫属于模式（写作模式的 closeGuard 会自己说明"正在编辑"），工具台只保持不切。
 */
import { setOpen } from './ui-store.js'

export async function switchMode(registry, id, reason = 'switch') {
  const result = await registry.setActive(id, reason)
  if (result.ok) setOpen(false)
  return result
}

export function exitMode(registry) {
  return switchMode(registry, null, 'exit')
}
