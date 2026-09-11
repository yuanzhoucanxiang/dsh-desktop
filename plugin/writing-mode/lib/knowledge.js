/**
 * 写作经验条目：给人看的口吻，不是教科书定义。
 * 找资料时当「旁注」，不当地基；真正事实靠联网查。
 */
import fs from 'node:fs'
import path from 'node:path'

/** @typedef {{ id:string, category:string, title:string, content:string, keywords:string[] }} KnowledgeItem */

/** @type {KnowledgeItem[]} */
export const BUILTIN_KNOWLEDGE = [
  {
    id: 'hook-or-drop',
    category: '开篇',
    title: '前三秒/前三百字',
    keywords: ['开篇', '开头', '钩子', '前几章', '前3秒', '黄金三章'],
    content:
      '读者很少「再给一次机会」。短剧几乎在三秒内定生死；网文前几章要让人物有具体麻烦，而不是先铺设定。开场可以先给一个反常细节，再补背景。',
  },
  {
    id: 'people-change',
    category: '人物',
    title: '人不是设定表',
    keywords: ['人物', '角色', '弧光', '动机', '性格'],
    content:
      '别急着堆「性格标签」。让人物在压力下做一个具体选择，比三页背景更有效。变化要落在他肯为什么让步——嘴上说的和手上做的不一致时，戏才出来。',
  },
  {
    id: 'talk-less',
    category: '对白',
    title: '台词少解释',
    keywords: ['对白', '台词', '潜台词', '说话'],
    content:
      '角色很少把心事说全。能用动作、停顿、转移话题解决的，就别写成说明文。每句对白最好推进关系或信息，两者都没有就考虑删。',
  },
  {
    id: 'plant-payoff',
    category: '伏笔',
    title: '埋了就要响',
    keywords: ['伏笔', '回收', '线索', '契诃夫'],
    content:
      '可以埋，但别堆一堆没下文的细节。回收时最好让人「想起来」而不是「被告诉」。若中间要吊胃口，至少推进一点，别原地打转。',
  },
  {
    id: 'breathe',
    category: '节奏',
    title: '喘气与加速',
    keywords: ['节奏', '爽点', '情绪', '卡点', '追读'],
    content:
      '一直紧会累，一直松会弃。高潮前后各留一点静场；章尾/集尾给一个「还想知道后来」的口子就够，不必每次都爆大料。平台不同，前段密度可以差很多。',
  },
  {
    id: 'physics-check',
    category: '连贯',
    title: '身体会记得',
    keywords: ['连续性', '物理', '动作', '伤势', '逻辑'],
    content:
      '人怎么进屋、门有多宽、伤了哪条腿——这些读者不一定说得出，但会隐约觉得假。写动作时在脑子里过一遍「这在物理上做得到吗」，比事后补丁省事。',
  },
]

export function loadKnowledgeFromRoot(rootReal) {
  if (!rootReal) return []
  const out = []
  const dir = path.join(rootReal, 'knowledge')
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of ents) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue
    const id = ent.name.replace(/\.md$/i, '')
    let text
    try {
      text = fs.readFileSync(path.join(dir, ent.name), 'utf8')
    } catch {
      continue
    }
    const title = (text.match(/^#\s+(.+)$/m) || [, id])[1].trim()
    const tags = [...text.matchAll(/^#tags?:\s*(.+)$/im)]
      .map((m) => m[1].split(/[,，\s]+/).filter(Boolean))
      .flat()
    out.push({
      id: 'file:' + id,
      category: '库内笔记',
      title,
      content: text.slice(0, 2000),
      keywords: tags.length ? tags : [id, title],
    })
  }
  return out
}

export function searchKnowledge(query, extraItems = [], limit = 3) {
  const q = String(query || '').toLowerCase()
  const items = [...BUILTIN_KNOWLEDGE, ...extraItems]
  if (!q.trim()) return []
  const scored = items.map((it) => {
    const hay = (it.title + ' ' + it.category + ' ' + it.keywords.join(' ') + ' ' + it.content).toLowerCase()
    let score = 0
    for (const kw of it.keywords) {
      if (q.includes(String(kw).toLowerCase())) score += 3
      if (hay.includes(String(kw).toLowerCase())) score += 1
    }
    if (q.includes(it.title.toLowerCase())) score += 4
    const grams = q.match(/[一-鿿]{2}/g) || []
    for (const g of grams) {
      if (hay.includes(g)) score += 1
    }
    return { it, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored
    .filter((s) => s.score >= 2)
    .slice(0, limit)
    .map((s) => s.it)
}

export function formatKnowledgeHits(hits) {
  if (!hits.length) return ''
  return hits.map((h) => `· ${h.title}：${h.content.slice(0, 120)}`).join('\n')
}
