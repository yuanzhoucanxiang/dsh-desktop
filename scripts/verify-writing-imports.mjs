/**
 * verify-writing-imports —— 客户端"跨模块漏 import"检查（R7）。
 *
 * 为什么需要：node 侧回归跑的是 host（lib/），客户端 bundle 只有 Electron E2E 才真正执行；
 * 拆分搬迁后"忘了补 import"会让某个名字在运行期变成未定义全局，构建与 node 测试都发现不了。
 * 规则：某模块用到一个名字，该名字在**另一个客户端模块**里被声明/导入，却没在本模块声明或
 * 导入 → 报错。只对"别处确实有同名声明"的名字报错，浏览器全局与拼写错误不在此列。
 *
 * 用法：node scripts/verify-writing-imports.mjs   （并入 npm run verify:writing-architecture）
 *      node scripts/verify-writing-imports.mjs --debug <名字>
 *        —— 打印该名字在每个出现文件里的判定状态，以及"被当成声明的规则"（定位漏报用）
 *      DSH_WRITING_SRC=<目录> 可改检查对象（selftest 用它注入漏 import 验证本脚本真会报错）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
// 自检脚本会把 src 树复制到临时目录再注入"漏 import"，用环境变量指过去
const SRC = process.env.DSH_WRITING_SRC || path.join(root, 'plugin/writing-mode/src')
const CLIENT = path.join(SRC, 'client')
const rel = (p) => path.relative(root, p).split(path.sep).join('/')

const RESERVED = new Set([
  'if', 'else', 'for', 'while', 'do', 'return', 'function', 'async', 'await', 'catch', 'try', 'finally',
  'new', 'typeof', 'instanceof', 'in', 'of', 'class', 'extends', 'super', 'this', 'null', 'true', 'false',
  'undefined', 'case', 'switch', 'break', 'continue', 'throw', 'delete', 'void', 'yield', 'static', 'get',
  'set', 'import', 'from', 'export', 'default', 'const', 'let', 'var', 'arguments',
])
const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s) && !RESERVED.has(s)

/** 去掉注释、字符串与正则字面量，避免把文档/错误码/正则标志当代码判断。
 *  注意：字符串剥离**只在同一行内配对**（不许跨行）——否则中文正文里一个不成对的
 *  撇号会把后续大段真实代码一起吞掉，造成漏报（2026-09-14 实测踩过）。 */
const codeOnly = (t) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\\n]|\\.)*`/g, '``')
    // 正则字面量（仅在其典型出现位置剥离，避免把除法当正则）：= /re/ , ( /re/ , : /re/ …
    .replace(/([=(,:;[!&|?{}]\s*)\/(?![/*])(?:\\.|\[[^\]\n]*\]|[^/\n\\])+\/[gimsuy]*/g, '$1 RE')

const IMPORTS_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
/** 再导出 `export { a, b } from '…'`（如 entry.js 的测试钩子）：既算"本模块有这些名字"，
 *  又不该被当作"使用"——用法扫描会把它当引用，于是合法再导出被误报成漏 import。 */
const REEXPORTS_RE = /^export\s+\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm
function importedNames(text) {
  const out = new Set()
  const takeClause = (clause) => {
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (star) out.add(star[1])
    const braces = clause.match(/\{([\s\S]*?)\}/)
    if (braces) {
      for (const piece of braces[1].split(',')) {
        const n = piece.trim().split(/\s+as\s+/).pop().trim()
        if (isIdent(n)) out.add(n)
      }
    }
    const def = clause
      .replace(/\{[\s\S]*\}/, '')
      .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, '')
      .replace(/,/g, ' ')
      .trim()
    if (isIdent(def)) out.add(def)
  }
  for (const m of text.matchAll(IMPORTS_RE)) takeClause(m[1])
  for (const m of text.matchAll(REEXPORTS_RE)) {
    for (const piece of m[1].split(',')) {
      const n = piece.trim().split(/\s+as\s+/).pop().trim()
      if (isIdent(n)) out.add(n)
    }
  }
  return out
}

/**
 * 从开括号位置做严格括号配对，返回内部文本与收尾下标（不配对返回 null）。
 *
 * 为什么不能用 /\(([^)]*)\)/、/\{([^}]*)\}/ 这类正则：**它们可以跨行**，一个跨行的
 * 括号组会把中间成片的真实代码整体当成「形参 / 解构」，于是某个没 import 的名字被
 * 判成「本模块已声明」→ 静默漏报。2026-09-14 定位到 R7 的漏报正是此因：
 * `WritingCompanion` 的 JSX 用法被一个跨 3 行的箭头形参括号吞掉（用 --debug 复算得出）。
 */
function balanced(text, openIndex) {
  const open = text[openIndex]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) return null
  const stack = [close]
  for (let i = openIndex + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') stack.push(')')
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (ch !== stack[stack.length - 1]) break // 括号不配对：按不可信处理，保守结束
      stack.pop()
      if (!stack.length) return { inner: text.slice(openIndex + 1, i), end: i }
    }
  }
  return null
}

const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g
/** 按顶层逗号切分（跳过嵌套括号内的逗号）。 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * 从解构模式里取**绑定名**：只取键位上的名字，**默认值表达式里的标识符不算声明**。
 * 反例（2026-09-14 实测的误报）：`const { now = () => Date.now(), wait = (ms) => new Promise(…) } = deps`
 * 若整段括号文本都当声明，`Date`/`Promise`/`setTimeout` 就变成"本模块声明"，
 * 于是别的模块用 `Date.now()` 会被误报成"跨模块漏 import"。
 */
function destructuredNames(pattern, out = new Set()) {
  for (const rawPart of splitTopLevel(pattern)) {
    let part = rawPart.trim()
    if (!part) continue
    part = part.split('=')[0].trim() // 丢掉默认值表达式
    if (part.startsWith('...')) part = part.slice(3).trim()
    if (/^[{[]/.test(part)) {
      const b = balanced(part, 0)
      if (b) destructuredNames(b.inner, out)
      continue
    }
    const target = part.includes(':') ? part.split(':').pop().trim() : part
    if (isIdent(target)) out.add(target)
  }
  return out
}

/** 形参名：同样只取绑定名（默认值里的标识符不算声明）。 */
function paramNames(inner, out = new Set()) {
  for (const rawPart of splitTopLevel(String(inner || ''))) {
    let part = rawPart.trim()
    if (!part) continue
    part = part.split('=')[0].trim()
    if (part.startsWith('...')) part = part.slice(3).trim()
    if (/^[{[]/.test(part)) {
      const b = balanced(part, 0)
      if (b) destructuredNames(b.inner, out)
      continue
    }
    const target = part.includes(':') ? part.split(':').pop().trim() : part
    if (isIdent(target)) out.add(target)
  }
  return out
}

function declaredNames(text) {
  // import 必须从**原文**解析：codeOnly 会把模块路径的字符串也抹掉
  const out = importedNames(text)
  const code = codeOnly(text)
  for (const line of code.split('\n')) {
    const m = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/)
    if (m) out.add(m[1] || m[2])
  }
  // 形参 / 箭头参数 / catch 参数也是声明（否则 versionOf(name) 会撞上别处的同名顶层声明）
  // 都在 codeOnly 之后的文本上做严格配对，且只取绑定名（默认值里的标识符不算声明）
  for (const m of code.matchAll(/\bfunction\s*[A-Za-z_$]?[\w$]*\s*\(/g)) {
    const b = balanced(code, m.index + m[0].length - 1)
    if (b) paramNames(b.inner, out)
  }
  for (const m of code.matchAll(/\bcatch\s*\(/g)) {
    const b = balanced(code, m.index + m[0].length - 1)
    if (b) paramNames(b.inner, out)
  }
  for (const m of code.matchAll(/\(/g)) {
    const b = balanced(code, m.index)
    if (b && /^\s*=>/.test(code.slice(b.end + 1))) paramNames(b.inner, out)
  }
  // 无括号单参箭头：v => …（此正则的第 2 组才是名字）
  for (const m of text.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) if (isIdent(m[2])) out.add(m[2])
  // 嵌套（缩进的）函数声明：组件内部的 function post(...) 也算本模块声明
  for (const m of code.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1])
  // 局部声明：任意位置的 const/let/var（含 for-of），否则 v/i/prev 这类会被误判为外部声明
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1])
  // 解构（含 for-of 与数组形式）：严格配对后只取绑定名（默认值里的 Date/Promise 等不算声明）
  for (const m of code.matchAll(/\b(?:const|let|var)\s*([{[])/g)) {
    const b = balanced(code, m.index + m[0].length - 1)
    if (b) destructuredNames(b.inner, out)
  }
  return out
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

const files = walk(CLIENT)
const ownerOf = new Map()
const perFile = new Map()
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const decls = declaredNames(text)
  perFile.set(file, { decls })
  for (const n of decls) {
    if (!ownerOf.has(n)) ownerOf.set(n, new Set())
    ownerOf.get(n).add(rel(file))
  }
}

const failures = []
/** --debug <名字>：打印检查器对该名字在每处出现文件里的判定状态（定位漏报用）。 */
const debugAt = process.argv.indexOf('--debug')
const debugName = debugAt >= 0 ? process.argv[debugAt + 1] : null
if (debugName) {
  const name = debugName
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  /** 逐条规则复算，指出「谁把它当成了声明」——漏报定位的关键 */
  const ruleHits = (file, text) => {
    const code = codeOnly(text)
    const hits = []
    for (const m of text.matchAll(IMPORTS_RE)) if (String(m[1]).includes(name)) hits.push('import 子句')
    const declLine = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${esc}|^(?:export\\s+)?(?:const|let|var)\\s+${esc}`)
    if (code.split('\n').some((l) => declLine.test(l))) hits.push('顶层声明行')
    if (new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${esc}`, 'm').test(code)) hits.push('嵌套函数声明')
    if (new RegExp(`\\b(?:const|let|var)\\s+${esc}\\b`).test(code)) hits.push('局部声明')
    for (const m of code.matchAll(/\b(?:const|let|var)\s*([{[])/g)) {
      const b = balanced(code, m.index + m[0].length - 1)
      if (b && new RegExp(`\\b${esc}\\b`).test(b.inner)) hits.push(`解构（跨 ${b.inner.split('\n').length} 行）`)
    }
    const paramInner = []
    for (const m of code.matchAll(/\bfunction\s*[A-Za-z_$]?[\w$]*\s*\(/g)) {
      const b = balanced(code, m.index + m[0].length - 1)
      if (b) paramInner.push(b.inner)
    }
    for (const m of code.matchAll(/\bcatch\s*\(/g)) {
      const b = balanced(code, m.index + m[0].length - 1)
      if (b) paramInner.push(b.inner)
    }
    for (const m of code.matchAll(/\(/g)) {
      const b = balanced(code, m.index)
      if (b && /^\s*=>/.test(code.slice(b.end + 1))) paramInner.push(b.inner)
    }
    for (const inner of paramInner) {
      if (new RegExp(`\\b${esc}\\b`).test(inner)) hits.push(`形参位置（跨 ${inner.split('\n').length} 行）`)
    }
    for (const m of text.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) if (m[2] === name) hits.push('无括号箭头参数')
    return hits
  }
  for (const [file, { decls }] of perFile) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes(name)) continue
    const code = codeOnly(text).replace(/[A-Za-z_$][\w$]*\s*:/g, ' ')
    const used = new Set([...code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[2]))
    const owners = [...(ownerOf.get(name) || [])]
    const foreign = owners.filter((o) => o !== rel(file))
    console.log(`DEBUG ${rel(file)}: 原文出现=${(text.match(new RegExp(name, 'g')) || []).length} 判定为已声明=${decls.has(name)} 判定为被使用=${used.has(name)} 声明于其他模块=${foreign.length ? foreign.join(',') : '（无）'}`)
    console.log(`      被当成声明的规则：${ruleHits(file, text).join(' / ') || '（无）'}`)
  }
  process.exit(0)
}
for (const [file, { decls }] of perFile) {
  const code = codeOnly(fs.readFileSync(file, 'utf8')).replace(/[A-Za-z_$][\w$]*\s*:/g, ' ') // 去掉对象键
  const used = new Set([...code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[2]))
  for (const u of used) {
    if (!isIdent(u) || decls.has(u)) continue
    const owners = ownerOf.get(u)
    if (!owners) continue
    const others = [...owners].filter((o) => o !== rel(file))
    if (others.length) failures.push(`${rel(file)} 使用了 ${u}，但它声明于 ${others[0]} 且本模块未 import`)
  }
}

for (const f of failures) console.log('FAIL R7 ' + f)
if (!failures.length) console.log(`PASS R7 ${files.length} 个客户端模块无跨模块漏 import`)
console.log(failures.length ? `WRITING_IMPORTS_FAIL ${failures.length} 项` : 'WRITING_IMPORTS_OK')
process.exit(failures.length ? 1 : 0)
