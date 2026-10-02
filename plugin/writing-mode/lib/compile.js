/**
 * 导出成书（Compile）的纯函数核心：候选筛选、版本归并、排序、拼接。
 *
 * 零 IO——读文件、路径校验、独占创建全在 index.js 的 compile 路由里
 * （经 store 的 listProjectFiles / resolveUnderRoots / writeDoc）。
 * 版本归并与排序口径与客户端 features/library/grouping.js 对齐：
 * 「同一目录、同名同扩展名的 -vN 系列，最大 N 为当前」；顺序 = 作者在文档树里
 * 看到的顺序（项目相对路径按中文 + 数字自然序，第2章 排在 第10章 前）。
 */

/** 与客户端 state/prefs-store.js 的 versionOf 同口径：文件名尾的 -vN。 */
export function versionOfName(name) {
  const m = String(name || '').match(/-v(\d+)(\.[^.]+)?$/i)
  return m ? Number(m[1]) : null
}

/**
 * 版本系列键：抹掉文件名尾的 -vN（保留目录与扩展名）。
 * 输入用项目相对路径（POSIX 斜杠），与 listProjectFiles 的 rel 对齐。
 */
export function seriesKeyOf(rel) {
  return String(rel || '').replace(/-v(\d+)(\.[^.]+)$/i, '$2').toLowerCase()
}

/**
 * 每个版本系列只保留当前版（最大 vN）；无 -vN 的文件自己成系列、始终保留。
 * 返回 { latest, skipped }，各自保持输入的相对顺序。
 */
export function latestOfSeries(files) {
  const max = new Map()
  for (const f of files || []) {
    const v = versionOfName(f.name)
    if (v === null) continue
    const key = seriesKeyOf(f.rel)
    if (v > (max.get(key) || 0)) max.set(key, v)
  }
  const latest = []
  const skipped = []
  for (const f of files || []) {
    const v = versionOfName(f.name)
    if (v !== null && v < max.get(seriesKeyOf(f.rel))) skipped.push(f)
    else latest.push(f)
  }
  return { latest, skipped }
}

/** 成书顺序 = 文档树顺序：rel 按中文 + numeric 自然序（第2章 < 第10章）。 */
export function naturalSortFiles(files) {
  return [...(files || [])].sort((a, b) => String(a.rel).localeCompare(String(b.rel), 'zh', { numeric: true }))
}

/** 章节标题：去扩展名与 -vN 后缀，保留作者命名（如「第3章-夜行」）。 */
export function chapterTitle(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/-v\d+$/i, '')
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 书名片段安全化：剔除文件系统非法字符，拒绝空名 / 纯点段 / Windows 保留名。
 * 与 store.safeProjectDirName 同规则——成片写进项目根，文件名必须安全。
 */
export function safeBookTitle(title) {
  const t = String(title || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim()
  if (!t || /^\.+$/.test(t) || WIN_RESERVED.test(t)) return null
  return t
}

/** 拼接用的换行归一：原稿字节不动，导出文件统一 LF。 */
export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 该章正文自带标题行（首行是 Markdown  heading）时不再补插，避免双重标题。 */
function hasOwnHeading(body) {
  return /^\s*#{1,6}\s/.test(body)
}

/**
 * 拼合成书文本。
 * entries: [{ title, content }]，顺序即章节顺序（调用方排好）。
 * format: 'fountain' 用题页 + `===` 分页（不插章节标题，fountain 自有场景结构）；
 *         其余按 Markdown：书头 + 可选的章节标题（章自带标题时跳过）。
 * 返回 { text, chars, files }；chars 与状态栏同口径（去空白计字）。
 */
export function compileBook(entries, { format, title, date, titles = true } = {}) {
  const norm = (entries || []).map((e) => ({
    title: String(e.title || ''),
    content: normalizeNewlines(e.content),
  }))
  const chars = norm.reduce((n, e) => n + e.content.replace(/\s+/g, '').length, 0)
  let text
  if (format === 'fountain') {
    const meta = `/*\n${date} 导出 · 共 ${norm.length} 篇 · ${chars} 字\n*/`
    text = `Title: ${title}\n\n${meta}\n\n` + norm.map((e) => e.content.trim()).join('\n\n===\n\n') + '\n'
  } else {
    const header = `# ${title}\n\n> ${date} 导出 · 共 ${norm.length} 篇 · ${chars} 字\n\n---\n`
    const parts = norm.map((e) => {
      const body = e.content.trim()
      return titles && !hasOwnHeading(body) ? `# ${e.title}\n\n${body}` : body
    })
    text = header + '\n' + parts.join('\n\n') + '\n'
  }
  return { text, chars, files: norm.length }
}
