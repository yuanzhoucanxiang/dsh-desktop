/**
 * verify-writing-imports —— 客户端"跨模块漏 import"检查（R7）。
 *
 * 为什么需要：node 侧回归跑的是 host（lib/），客户端 bundle 只有 Electron E2E 才真正执行；
 * 拆分搬迁后"忘了补 import"会让某个名字在运行期变成未定义全局，构建与 node 测试都发现不了。
 * 规则：某模块用到一个名字，该名字在**另一个客户端模块**里被声明/导入，却没在本模块声明或
 * 导入 → 报错。只对"别处确实有同名声明"的名字报错，浏览器全局与拼写错误不在此列。
 *
 * 用法：node scripts/verify-writing-imports.mjs   （并入 npm run verify:writing-architecture）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const SRC = path.join(root, 'plugin/writing-mode/src')
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
function importedNames(text) {
  const out = new Set()
  for (const m of text.matchAll(IMPORTS_RE)) {
    const clause = m[1]
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
  // 注意：必须用原文（codeOnly 会把 import 的模块路径也抹掉，且箭头参数形态多样）
  const paramSources = [
    ...text.matchAll(/function\s*[A-Za-z_$]?[\w$]*\s*\(([^)]*)\)/g),
    ...text.matchAll(/\(([^)]*)\)\s*=>/g),
    ...text.matchAll(/\bcatch\s*\(([^)]*)\)/g),
  ]
  for (const m of paramSources) {
    for (const tok of String(m[1] || '').matchAll(/[A-Za-z_$][\w$]*/g)) if (isIdent(tok[0])) out.add(tok[0])
  }
  // 无括号单参箭头：v => …（此正则的第 2 组才是名字）
  for (const m of text.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) if (isIdent(m[2])) out.add(m[2])
  // 嵌套（缩进的）函数声明：组件内部的 function post(...) 也算本模块声明
  for (const m of code.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1])
  // 局部声明：任意位置的 const/let/var（含 for-of、解构），否则 v/i/prev 这类会被误判为外部声明
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1])
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const tok of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) if (isIdent(tok[0])) out.add(tok[0])
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const tok of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) if (isIdent(tok[0])) out.add(tok[0])
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
