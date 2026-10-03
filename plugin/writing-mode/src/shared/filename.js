/** 文稿文件名工具（纯函数）：-vN 版本号解析的唯一出处。 */
export const VERSION_RE = /-v\d+(\.[^.]+)?$/i
const VERSION_NUM_RE = /-v(\d+)/i
const EXT_RE = /\.[^.]+$/

/** 解析文件名里的 -vN 版本号；没有版本后缀返回 null。 */
export function versionOf(name) {
  const m = VERSION_RE.exec(String(name || ''))
  return m ? Number(VERSION_NUM_RE.exec(m[0])[1]) : null
}

/** 抹掉 -vN 与扩展名（题名/版本系列比较用）：第1章-v2.md → 第1章。 */
export function stemOf(name) {
  return String(name || '').replace(VERSION_RE, '')
}

/** 抹掉 -vN、保留扩展名（展示名用）：第1章-v2.md → 第1章.md。 */
export function stemWithExtOf(name) {
  return String(name || '').replace(VERSION_RE, '$1')
}

/** 章节标题：先去掉扩展名再抹 -vN（与 host lib/compile.js 的 chapterTitle 同口径）。 */
export function chapterTitleOf(name) {
  return String(name || '').replace(EXT_RE, '').replace(/-v\d+$/i, '')
}

/** 路径末段（文件名）；无末段返回空串。 */
export function basenameOf(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

/** 路径末段的上一级（目录名）；不足两段返回空串。 */
export function folderOf(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}
