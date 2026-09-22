/**
 * 文件库分组与版本归并（P1-① 从 app/WritingModeApp.js 搬出；行为不变）。
 * 纯函数：只依赖 versionOf（版本号解析）与传入的文件数组。
 */
import { versionOf } from '../../state/prefs-store.js'

const NAV_FILES = {
  'project.md': ['作品概览', '创作方向'],
  'bible/characters.md': ['人物', '人物档案'],
  'bible/relationships.md': ['人物', '人物关系'],
  'bible/world.md': ['世界与设定', '世界观资料（手写）'],
  'bible/timeline.md': ['世界与设定', '时间线'],
  'bible/世界观整理.md': ['世界与设定', '已确认设定（整理稿）'],
  'outline/structure.md': ['故事规划', '故事结构'],
  'outline/units.md': ['故事规划', '章节与场次安排'],
  'outline/foreshadow.md': ['故事规划', '伏笔与回收'],
  'state/character-state.md': ['创作跟踪', '人物状态'],
}

export function navigationGroups(files, q) {
  const query = String(q || '').trim().toLowerCase()
  const groups = new Map()
  for (const f of files || []) {
    const rel = String(f.rel || '').replaceAll('\\', '/')
    const known = NAV_FILES[rel]
    const key = known?.[0] || (rel.startsWith('draft/') ? '正文' : (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '其他文档'))
    const label = known?.[1] || (rel.startsWith('draft/') ? f.name.replace(/\.md$/i, '') : f.name)
    if (query && !`${label} ${key} ${f.name} ${rel}`.toLowerCase().includes(query)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...f, displayName: label })
  }
  const order = ['正文', '作品概览', '人物', '世界与设定', '故事规划', '创作跟踪']
  return [...groups].map(([key, files]) => ({ key, files })).sort((a, b) => {
    const rank = key => order.includes(key) ? order.indexOf(key) : 99
    return rank(a.key) - rank(b.key) || a.key.localeCompare(b.key, 'zh')
  })
}

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

export const resourceChoices = Object.entries(NAV_FILES).filter(([rel]) => rel !== 'project.md' && rel !== 'bible/世界观整理.md').map(([rel, [, label]]) => ({ rel, label }))
