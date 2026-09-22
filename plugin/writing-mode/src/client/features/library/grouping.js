/**
 * 文件库分组与版本归并（P1-① 从 app/WritingModeApp.js 搬出；行为不变）。
 * 纯函数：只依赖 versionOf（版本号解析）与传入的文件数组。
 */
import { versionOf } from '../../state/prefs-store.js'

/** 版本归并键：抹掉 -vN 后缀，同一文件的不同版本归到同一键。 */
export function groupKeyOf(absPath) {
  return String(absPath || '').replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()
}

export function groupFiles(files, q) {
  const query = String(q || '').trim().toLowerCase()
  const map = new Map()
  for (const f of files || []) {
    if (query) {
      const hay = (f.name + ' ' + f.rel).toLowerCase()
      if (!hay.includes(query)) continue
    }
    const top = String(f.rel || '').includes('/')
      ? String(f.rel).slice(0, String(f.rel).lastIndexOf('/'))
      : '·'
    if (!map.has(top)) map.set(top, [])
    map.get(top).push(f)
  }
  const order = ['draft', 'bible', 'outline', 'state', 'reviews', '·']
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a.split('/')[0])
    const ib = order.indexOf(b.split('/')[0])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'zh')
  })
  return keys.map((k) => ({ key: k, files: map.get(k) }))
}

export function maxVersionInGroup(files) {
  const max = new Map()
  for (const f of files || []) {
    const v = versionOf(f.name)
    const key = groupKeyOf(f.abs)
    if (v != null) max.set(key, Math.max(max.get(key) || 0, v))
  }
  return max
}
