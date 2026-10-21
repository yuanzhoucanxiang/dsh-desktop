import fs from 'node:fs'
import path from 'node:path'

// 文档完整性检查：表格间距、围栏成对、相对链接可达。
const files = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'demo-out', '.git'].includes(e.name)) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (p.endsWith('.md')) files.push(p)
  }
}
walk('.')

let bad = 0
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  const lines = text.split('\n')

  // 1) 围栏成对
  const fence = (text.match(/^```/gm) || []).length
  if (fence % 2) {
    console.log('FENCE ' + f + ' (共 ' + fence + ' 个 ```)')
    bad++
  }

  // 2) 表格后必须有空行
  let inTable = false
  for (let i = 0; i < lines.length; i++) {
    const isRow = /^\|.*\|$/.test(lines[i].trim())
    if (isRow) {
      inTable = true
      continue
    }
    if (inTable) {
      if (lines[i].trim() !== '') {
        console.log('TABLE ' + f + ':' + (i + 1) + ' 表格后缺空行 -> ' + lines[i].slice(0, 40))
        bad++
      }
      inTable = false
    }
  }

  // 3) 相对链接可达
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let u = m[1].trim()
    if (!u || u.startsWith('#') || /^https?:|^mailto:/.test(u)) continue
    u = u.split('#')[0]
    if (!u || u.startsWith('/')) continue
    if (!fs.existsSync(path.resolve(path.dirname(f), u))) {
      console.log('LINK ' + f + ' -> ' + u)
      bad++
    }
  }
}

console.log('MD ' + files.length + ' checked, issues=' + bad)
process.exit(bad ? 1 : 0)
