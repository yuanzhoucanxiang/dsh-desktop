'use strict'

/**
 * 内置插件「脆弱选择器」自检（普通 node 跑，秒级）：
 *   node plugin-selector-check.js                  → 查仓库内置运行时（runtime/）
 *   node plugin-selector-check.js --installed      → 查已安装应用的运行时
 *   node plugin-selector-check.js --runtime <dir>  → 查指定运行时
 *
 * 背景：内置插件 `plugin/dialog-optimize/client.js` 用 DOM 刮取实现折叠/导航/撤回，
 * 里面混着两类选择器：
 *   · 语义化 data 属性（`[data-chat-flow-key]` 等）—— 相对稳定
 *   · **编译后的 hash 类名**（`.gdEzaW_bubble`、`.p-xYUq_timeStart` …）—— 内核前端一改样式就变
 * 官方契约是 Slots（SKILL.md 明令禁止硬编码私有选择器），所以这套刮取属于"技术债"。
 * 在把它改成 Slots 之前，至少要让**债务爆掉的那一刻立刻可见**：本脚本从 client.js 里
 * 自动抽出所有选择器，逐个到内核运行时的前端 bundle 里找；找不到就 exit 1 并点名。
 *
 * 用法建议：`npm run dist` 打包前跑一次；升级内置内核（prepare:runtime）后必跑。
 */

const fs = require('node:fs')
const path = require('node:path')

const CLIENT = path.join(__dirname, 'plugin', 'dialog-optimize', 'client.js')
const PALIS_CLIENT = path.join(__dirname, 'plugin', 'palis-theme', 'client.js')
const argv = process.argv.slice(2)
const INSTALLED = argv.includes('--installed')
const explicit = (() => {
  const i = argv.indexOf('--runtime')
  return i >= 0 ? argv[i + 1] : ''
})()

function runtimeRoot() {
  if (explicit) return explicit
  if (INSTALLED) {
    const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
    return path.join(base, 'Programs', 'DeepSeek Harness Desktop', 'resources', 'runtime')
  }
  return path.join(__dirname, 'runtime')
}

/** 从插件客户端代码里抽出它依赖的选择器（hash 类名 + data 属性）。 */
function extractSelectors(src) {
  const hashed = new Set()
  const attrs = new Set()
  // .gdEzaW_bubble / .p-xYUq_timeStart / .Md3f7G_older 这类：前缀 4~10 位 + 下划线 + 驼峰名
  for (const m of src.matchAll(/["'.]([A-Za-z0-9][A-Za-z0-9-]{3,9}_[A-Za-z][A-Za-z0-9]*)\b/g)) {
    hashed.add(m[1])
  }
  for (const m of src.matchAll(/\[(data-[a-z-]+)[\]=]/g)) attrs.add(m[1])
  // 插件**自己写上去**的属性不是内核契约（例如它给自己的行打的 data-pinned），要剔掉，
  // 否则会误报成"内核选择器失效"。判据：代码里出现 setAttribute/removeAttribute 写过它。
  const selfWritten = new Set()
  for (const m of src.matchAll(/(?:set|remove)Attribute\(\s*["'](data-[a-z-]+)["']/g)) {
    selfWritten.add(m[1])
  }
  const own = /^(dsh|dshRecall|data-dsh|data-plugin)/
  const keep = (s) => !own.test(s) && !selfWritten.has(s)
  return {
    hashed: [...hashed].filter(keep).sort(),
    attrs: [...attrs].filter(keep).sort(),
    selfWritten: [...selfWritten].sort(),
  }
}

/** 在运行时目录里递归找哪些 .js/.css 文件包含给定字符串（命中一个就够）。 */
function findIn(root, needles) {
  const found = new Map(needles.map((n) => [n, '']))
  let left = needles.length
  const stack = [root]
  while (stack.length && left > 0) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!/\.(js|mjs|cjs|css)$/.test(e.name)) continue
      let text = ''
      try {
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const [needle, hit] of found) {
        if (hit) continue
        if (text.includes(needle)) {
          found.set(needle, path.relative(root, full))
          left--
        }
      }
      if (left === 0) break
    }
  }
  return found
}

const root = runtimeRoot()
if (!fs.existsSync(CLIENT)) {
  console.log(`FAIL 找不到插件客户端代码：${CLIENT}`)
  process.exit(1)
}
if (!fs.existsSync(root)) {
  console.log(`SKIP 运行时目录不存在（还没 prepare:runtime？）：${root}`)
  process.exit(0) // 没有运行时不算失败，避免在干净检出上误报
}

const src = fs.readFileSync(CLIENT, 'utf8')
const { hashed, attrs, selfWritten } = extractSelectors(src)
// palis-theme 的 client 用到的内核语义属性也纳入监控（它只用 data 属性，不依赖 hash 类名）
let palisAttrs = []
if (fs.existsSync(PALIS_CLIENT)) {
  const src2 = fs.readFileSync(PALIS_CLIENT, 'utf8')
  const e2 = extractSelectors(src2)
  palisAttrs = e2.attrs.filter((a) => !attrs.includes(a))
}
const needles = [...hashed, ...attrs, ...palisAttrs]
console.log(`运行时：${root}`)
console.log(`从 dialog-optimize 抽出 ${hashed.length} 个 hash 类名 + ${attrs.length} 个 data 属性`
  + `（另有 ${selfWritten.length} 个插件自己写的属性已排除：${selfWritten.join(', ') || '无'}）`)
if (palisAttrs.length) console.log(`从 palis-theme 抽出 ${palisAttrs.length} 个内核语义属性（只做样式增强）：${palisAttrs.join(', ')}`)

const found = findIn(root, needles)
const dead = []
for (const n of needles) {
  const where = found.get(n)
  const kind = hashed.includes(n) ? 'hash类名' : 'data属性'
  if (where) {
    console.log(`PASS [${kind}] ${n}  → ${where}`)
  } else {
    console.log(`FAIL [${kind}] ${n}  → 内核前端里已找不到`)
    dead.push(n)
  }
}

if (dead.length) {
  console.log('')
  console.log('SELECTOR_CHECK_FAIL 失效选择器：' + dead.join(', '))
  console.log('说明：内置插件依赖的内核属性变了 —— dialog-optimize 的功能（折叠/导航/撤回）或 palis-theme')
  console.log('的样式增强会静默失效。处理：dialog-optimize 优先改走官方 Slots；palis-theme 的增强是"存在才')
  process.exit(1)
}
console.log('')
console.log('SELECTOR_CHECK_OK 全部选择器在当前内核里仍然存在')
process.exit(0)
