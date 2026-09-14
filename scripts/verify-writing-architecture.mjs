/**
 * verify:writing-architecture —— 写作模式的依赖边界与受管运行时清单检查。
 *
 * 方案依据：writing-mode-next-execution-v2.md §2.3/§2.4 与 §5.1。
 * 规则（只做可静态判定的事，不做"行数替代约束"）：
 *   R1 客户端源码不得引入 Node 内置（客户端是浏览器侧）
 *   R2 src/shared/**（共享控制器与纯函数）不得依赖 React / DOM / 适配器 / 服务
 *   R3 src/client/adapters/**（唯一 native 接触面）不得 import React / JSX / 组件 / 样式
 *   R4 所有相对 import 必须解析到真实文件（不留悬空）
 *   R5 运行时清单：清单内文件存在；lib/*.js 除显式排除项外必须全部列入；
 *      不得把 src/** 或测试专用 re-export 当作运行时依赖
 *   R6 入口不得再持有整段样式（CSS 数组）或草稿保存队列
 *
 * 用法：node scripts/verify-writing-architecture.mjs   （npm run verify:writing-architecture）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PLUG = path.join(root, 'plugin/writing-mode')
const SRC = path.join(PLUG, 'src')

const failures = []
const notes = []
const pass = (m) => console.log('PASS ' + m)
const fail = (m) => { failures.push(m); console.log('FAIL ' + m) }
const note = (m) => { notes.push(m); console.log('NOTE ' + m) }

/** 递归收集 .js（src 下） */
function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkJs(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

const rel = (p) => path.relative(root, p).split(path.sep).join('/')
const srcFiles = walkJs(SRC)

/** 去掉注释与字符串字面量，避免把文档/错误码当代码判断 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/gm
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
const importsOf = (text) => [...text.matchAll(IMPORT_RE), ...text.matchAll(REQUIRE_RE)].map((m) => m[1])

const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'child_process', 'url', 'node:fs', 'node:path', 'node:os', 'node:child_process', 'node:url', 'node:module', 'node:crypto'])
const isNodeImport = (spec) => NODE_BUILTINS.has(spec) || spec.startsWith('node:')

// ── R1 / R4：逐文件扫 ────────────────────────────────────────────────
let r1bad = 0
let r4bad = 0
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8')
  for (const spec of importsOf(text)) {
    if (isNodeImport(spec)) { fail(`R1 ${rel(file)} 引入 Node 内置：${spec}`); r1bad++ }
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec)
      if (!fs.existsSync(target)) { fail(`R4 ${rel(file)} 的相对 import 悬空：${spec}`); r4bad++ }
    }
  }
}
if (r1bad === 0) pass('R1 客户端源码无 Node 内置依赖')
if (r4bad === 0) pass(`R4 ${srcFiles.length} 个源文件的相对 import 全部可解析`)

// ── R2：shared 不得依赖 React / DOM / 适配器 / 服务 ───────────────────
const sharedFiles = srcFiles.filter((f) => rel(f).includes('/src/shared/'))
const DOM_TOKENS = /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|XMLHttpRequest|fetch)\b/
let r2bad = 0
for (const file of sharedFiles) {
  const code = codeOnly(fs.readFileSync(file, 'utf8'))
  for (const spec of importsOf(code)) {
    if (/^react(\/jsx-runtime)?$/.test(spec) || spec.includes('adapters/') || spec.includes('services/') || spec.includes('features/')) {
      fail(`R2 ${rel(file)} 共享模块不得依赖：${spec}`); r2bad++
    }
  }
  const hit = code.match(DOM_TOKENS)
  if (hit) { fail(`R2 ${rel(file)} 共享模块引用了浏览器全局：${hit[0]}`); r2bad++ }
}
if (r2bad === 0) pass(`R2 shared 模块（${sharedFiles.length} 个）不依赖 React/DOM/适配器/服务`)

// ── R3：adapters 不得 import React / JSX / 组件 / 样式 ────────────────
const adapterFiles = srcFiles.filter((f) => rel(f).includes('/src/client/adapters/'))
let r3bad = 0
for (const file of adapterFiles) {
  const code = codeOnly(fs.readFileSync(file, 'utf8'))
  for (const spec of importsOf(code)) {
    if (/^react(\/jsx-runtime)?$/.test(spec) || /(features|app|styles)\//.test(spec)) {
      fail(`R3 ${rel(file)} 适配器不得 import：${spec}`); r3bad++
    }
  }
  if (/\bjsx\.(jsx|jsxs)\s*\(|\breact\.(useState|useEffect|useRef|createElement)\s*\(/.test(code)) {
    fail(`R3 ${rel(file)} 适配器含 JSX/组件代码`); r3bad++
  }
}
if (r3bad === 0) pass(`R3 adapters 模块（${adapterFiles.length} 个）不含 React/JSX/组件/样式依赖`)

// ── R5：运行时清单 ───────────────────────────────────────────────────
const manifestPath = path.join(PLUG, 'runtime-manifest.json')
if (!fs.existsSync(manifestPath)) {
  fail('R5 缺少 runtime-manifest.json')
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const listed = [...(manifest.entry || []), ...(manifest.files || [])]
  const excluded = new Set(manifest.exclude || [])
  const missing = listed.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length) fail(`R5 清单内文件不存在：${missing.join(', ')}`)
  else pass(`R5 清单 ${listed.length} 个运行时文件均存在`)

  for (const p of listed) {
    if (p.includes('/src/')) fail(`R5 清单包含源码文件（运行时不依赖 src）：${p}`)
    if (excluded.has(p)) fail(`R5 清单同时列入又被排除：${p}`)
  }
  for (const e of excluded) {
    if (!fs.existsSync(path.join(root, e))) note(`R5 排除项不存在（可清理）：${e}`)
  }

  const libJs = fs.readdirSync(path.join(PLUG, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `plugin/writing-mode/lib/${f}`)
  const unlisted = libJs.filter((p) => !listed.includes(p) && !excluded.has(p))
  if (unlisted.length) fail(`R5 lib 下未列入清单且未排除：${unlisted.join(', ')}`)
  else pass(`R5 lib 下 ${libJs.length} 个模块已全部登记（${excluded.size} 个测试专用排除）`)

  for (const need of ['plugin/writing-mode/index.js', 'plugin/writing-mode/client.js', 'plugin/writing-mode/package.json']) {
    if (!listed.includes(need)) fail(`R5 清单缺必需项：${need}`)
  }
}

// ── R6：入口不得再持有整段样式 / 草稿保存队列 ────────────────────────
const entryFile = path.join(SRC, 'client/entry.js')
const entryCode = codeOnly(fs.readFileSync(entryFile, 'utf8'))
if (/CSS\s*=\s*\[/.test(entryCode)) fail('R6 入口仍持有样式数组')
else pass('R6 入口不含样式数组（已移入 styles/）')
if (/\bdraftSaveQueue\b/.test(entryCode)) fail('R6 入口仍持有草稿保存队列')
else pass('R6 入口不含草稿保存队列（已移入 state/）')

console.log('')
if (notes.length) console.log(`（${notes.length} 条提示不影响通过）`)
console.log(failures.length ? `WRITING_ARCHITECTURE_FAIL ${failures.length} 项` : 'WRITING_ARCHITECTURE_OK')
process.exit(failures.length ? 1 : 0)
