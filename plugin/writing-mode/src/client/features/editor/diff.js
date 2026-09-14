/**
 * 极简行 diff：前后缀对齐，中间段整段 del/add（章稿对比够用）。
 * P1-① 从 app/WritingModeApp.js 搬出；纯函数，行为不变。
 */
export function lineDiff(oldText, newText) {
  const a = String(oldText || '').split(/\r?\n/)
  const b = String(newText || '').split(/\r?\n/)
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (
    s < a.length - p &&
    s < b.length - p &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  ) {
    s++
  }
  const out = []
  const ctx = 2
  for (const line of a.slice(Math.max(0, p - ctx), p)) out.push({ t: 'ctx', line })
  for (const line of a.slice(p, a.length - s)) out.push({ t: 'del', line })
  for (const line of b.slice(p, b.length - s)) out.push({ t: 'add', line })
  for (const line of a.slice(a.length - s, a.length - s + Math.min(s, ctx))) {
    out.push({ t: 'ctx', line })
  }
  return out
}
