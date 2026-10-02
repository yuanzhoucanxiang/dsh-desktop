/**
 * 伙伴回复里的 [[文稿名]] 跳转：纯函数层（React 组件只消费这里的产物）。
 *
 * 语义与安全边界（对照 v0.1.40 的「模型输出不能导航编辑器」决策）：
 * - 导航永远由作者**点击**触发（chip），模型文字本身不会移动编辑器；
 * - 跳转目标只从**作者自己的库内文件清单**里解析，解析不到就停在原地提示，
 *   模型编造的文件名不会打开任何东西；
 * - [[...]] 只在助手消息里渲染成可点 chip，作者原文原样保留。
 */

export const JUMP_PROTOCOL = 'dsh-wm-jump:'

/** 助手消息文本预处理：[[文件名]] → 可点链接（交给 react-markdown 的 a 组件）。 */
export function rewriteJumpLinks(text) {
  return String(text ?? '').replace(/\[\[([^\[\]\n]{1,80})\]\]/g, (m, name) => {
    const clean = String(name).trim()
    if (!clean) return m
    return `[${clean}](${JUMP_PROTOCOL}${encodeURIComponent(clean)})`
  })
}

/** 解析跳转 href；非本协议返回 null。 */
export function parseJumpHref(href) {
  const raw = String(href ?? '')
  if (!raw.startsWith(JUMP_PROTOCOL)) return null
  try {
    const name = decodeURIComponent(raw.slice(JUMP_PROTOCOL.length))
    return name.trim() || null
  } catch {
    return null
  }
}

const normKey = (s) => String(s ?? '').toLowerCase()
const stemOf = (s) => String(s ?? '').replace(/-v\d+(\.[^.]+)$/i, '$1')
const versionOf = (s) => {
  const m = String(s ?? '').match(/-v(\d+)(\.[^.]+)$/i)
  return m ? Number(m[1]) : 0
}
const baseOf = (s) => String(s ?? '').split(/[\\/]/).pop()

/**
 * 从库内文件清单解析 [[名字]]：
 * 1) 文件名全等（含版本号）；2) 抹掉 -vN 的题名相等（多版本取最新）；
 * 3) 文件名以题名开头（前缀，仍取最新）。都找不到返回 null。
 * files 条目形状 = listProjectFiles：{ name, rel, abs, mtime }。
 */
export function resolveFileByName(files, name) {
  const list = Array.isArray(files) ? files.filter(Boolean) : []
  if (!list.length || !name) return null
  const latest = (arr) => arr.sort((a, b) => versionOf(b.name) - versionOf(a.name))[0]
  const want = normKey(baseOf(name).trim())
  if (!want) return null
  // 1) 文件名全等（含版本号）
  const byExact = list.filter((f) => normKey(baseOf(f.name)) === want)
  if (byExact.length) return latest(byExact)
  // 2) 抹掉 -vN 的题名相等（多版本取最新）
  const wantStem = normKey(stemOf(want))
  const byStem = list.filter((f) => normKey(stemOf(baseOf(f.name))) === wantStem)
  if (byStem.length) return latest(byStem)
  // 3) 名字没带扩展名时（如「第1章」）退前缀匹配，仍取最新
  const hasExt = /\.[^.]+$/.test(want)
  if (!hasExt) {
    const byPrefix = list.filter((f) => normKey(baseOf(f.name)).startsWith(want))
    if (byPrefix.length) return latest(byPrefix)
  }
  return null
}
