/**
 * 轻量联网查证（无 API Key）：Bing RSS 搜索 + 可选中文维基。
 * 失败静默返回 []；不阻塞写作台。
 */

const UA = 'Mozilla/5.0 (compatible; dsh-writing-mode/0.1)'
const TIMEOUT_MS = 4000

async function fetchText(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** 从文稿里抽检索词。 */
export function extractSearchQueries(text, brief = '', limit = 4) {
  const raw = String(text || '') + ' ' + String(brief || '').slice(0, 800)
  const stop = new Set([
    '一个', '我们', '他们', '自己', '什么', '这个', '那个', '就是', '可以', '没有',
    '但是', '因为', '所以', '然后', '如果', '这样', '那样', '开始', '已经', '还是',
    '不是', '怎么', '这么', '那么', '一直', '现在', '时候', '出来', '过去', '回来',
    '地方', '东西', '真的', '好像', '觉得', '知道',
  ])
  const freq = new Map()
  for (const w of raw.match(/[一-鿿]{2,4}/g) || []) {
    if (stop.has(w)) continue
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => w)

  const title = (String(brief).match(/作品名[:：]\s*(.+)/) || [])[1]
  if (title) ranked.unshift(title.replace(/[《》「」]/g, '').trim().slice(0, 20))

  // 具体场景词优先（下穿隧道 / 赛道事故…），泛二字词垫底
  const concrete = []
  const generic = []
  for (const q of ranked) {
    if (q.length <= 2) generic.push(q)
    else concrete.push(q)
  }
  for (const p of raw.match(/[一-鿿]{2,8}(?:隧道|下穿|积水|服务区|医院|车站|赛道|警局|大学|公司|事故)/g) || []) {
    concrete.unshift(p)
  }
  const extras = []
  for (const q of concrete.slice(0, 6)) {
    if (q.length > 6) extras.push(...(q.match(/[一-鿿]{2,4}/g) || []))
  }

  const out = []
  const seen = new Set()
  for (const q of [...concrete, ...extras, ...generic]) {
    const k = q.toLowerCase()
    if (!k || seen.has(k) || q.length < 2 || q.length > 16) continue
    if (q.length <= 2 && out.length >= 1) continue
    seen.add(k)
    out.push(q)
    if (out.length >= limit) break
  }
  return out
}

/** Bing RSS：每条 item 有 title / description / link。 */
async function bingRss(query) {
  const url =
    'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(String(query).slice(0, 80))
  const xml = await fetchText(url)
  if (!xml) return []
  const items = []
  const re = /<item>([\s\S]*?)<\/item>/gi
  let m
  while ((m = re.exec(xml)) && items.length < 4) {
    const block = m[1]
    const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1])
    const desc = stripTags((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1])
    const link = decodeEntities((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim()
    if (!title) continue
    items.push({
      query,
      title: title.slice(0, 120),
      snippet: (desc || '').slice(0, 280),
      url: link,
    })
  }
  return items
}

async function wikipediaZh(query) {
  const searchUrl =
    'https://zh.wikipedia.org/w/api.php?action=opensearch&limit=2&namespace=0&format=json&origin=*&search=' +
    encodeURIComponent(query)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(searchUrl, { signal: ctrl.signal, headers: { 'user-agent': UA } })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data) || data.length < 4) return []
    const titles = data[1] || []
    const descs = data[2] || []
    const urls = data[3] || []
    return titles.slice(0, 2).map((title, i) => ({
      query,
      title,
      snippet: stripTags(descs[i] || '').slice(0, 280),
      url: urls[i] || '',
    }))
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

/**
 * 优先 Bing RSS，其次中文维基；均失败则 []。
 */
export async function webResearch(queries, maxQueries = 3, maxHits = 6) {
  const qs = (queries || []).filter(Boolean).slice(0, maxQueries)
  const hits = []
  for (const q of qs) {
    let part = await bingRss(q)
    if (!part.length) part = await wikipediaZh(q)
    hits.push(...part)
    if (hits.length >= maxHits) break
  }
  const seen = new Set()
  return hits
    .filter((h) => {
      const k = h.title.toLowerCase()
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, maxHits)
}

export function formatWebHits(hits) {
  if (!hits.length) return ''
  return hits
    .map((h) => {
      const link = h.url ? `\n  ${h.url}` : ''
      return `- **${h.title}**（查「${h.query}」）：${h.snippet}${link}`
    })
    .join('\n')
}
