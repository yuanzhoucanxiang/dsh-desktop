// R7（跨模块漏 import 检查）的**自身敏感性自检**。
//
// 为什么需要：R7 曾经静默漏报过一次——parameters 正则用 [^)]* 跨行匹配，把一段 JSX
// 用法当成箭头形参，于是未 import 的 `WritingCompanion` 被判成"本模块已声明"，
// 构建与 node 测试全绿、只有 Electron E2E 才炸（见 logs/2026-09-14.md）。
// 结论：一个只会说 PASS 的检查器不可信，得定期证明它**真的会报错**。
//
// 做法：把 src/client 复制到临时目录 → 逐个注入"漏 import" → 期望 R7 失败并点名该名字；
//       另外跑一次未注入的阴性对照，期望 PASS（防止修出误报）。
//
// 用法：node scripts/verify-writing-imports.selftest.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECKER = path.join(ROOT, 'scripts', 'verify-writing-imports.mjs')
const REAL_SRC = path.join(ROOT, 'plugin', 'writing-mode', 'src')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-selftest-'))
const src = path.join(temp, 'src')
fs.cpSync(REAL_SRC, src, { recursive: true })

/** 被测的注入点：文件 + 要摘掉的名字 + 期望被点名的依据（R7 输出里应出现名字与文件）。 */
const mutations = [
  { label: '主应用漏 import 组件（历史漏报现场）', file: 'client/app/WritingModeApp.js', name: 'WritingCompanion' },
  { label: '记忆 feature 漏 import 服务模块', file: 'client/features/memory/index.js', name: 'api' },
  { label: 'companion feature 从多名 import 里漏一个（最隐蔽的形态）', file: 'client/features/companion/index.js', name: 'getDraftStatus' },
]

/** 把某文件里对 name 的命名导入摘掉（多名时只摘该名字，单名时整行删掉）。 */
function injectMissingImport(original, name) {
  const lines = original.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^import\s/.test(line)) continue
    if (!new RegExp(`\\b${name}\\b`).test(line)) continue
    const braces = line.match(/\{([^}]*)\}/)
    if (!braces) return null
    const names = braces[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (!names.includes(name)) return null
    const rest = names.filter((n) => n !== name)
    if (!rest.length) {
      lines.splice(i, 1)
      return lines.join('\n')
    }
    lines[i] = line.replace(braces[0], `{ ${rest.join(', ')} }`)
    return lines.join('\n')
  }
  return null
}

function runChecker() {
  const r = spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DSH_WRITING_SRC: src },
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  return { ok: r.status === 0, out }
}

let passed = 0
let failed = 0
const report = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? '\n      ' + detail : ''}`)
  ok ? passed++ : failed++
}

// 阴性对照：未注入时必须是 PASS（否则说明检查器本身有误报）
{
  const r = runChecker()
  report('阴性对照：未注入漏 import 时 PASS', r.ok, r.ok ? '' : r.out.trim())
}

for (const m of mutations) {
  const abs = path.join(src, m.file)
  const original = fs.readFileSync(abs, 'utf8')
  const mutated = injectMissingImport(original, m.name)
  if (mutated === null) {
    report(`注入「${m.label}」`, false, `在 ${m.file} 里找不到含 ${m.name} 的命名导入`)
    continue
  }
  fs.writeFileSync(abs, mutated)
  const r = runChecker()
  const flagged = !r.ok && r.out.includes(m.name) && r.out.includes(m.file.replace(/^client\//, ''))
  report(`注入「${m.label}」时 R7 报错并点名 ${m.name}`, flagged,
    flagged ? '' : `R7 输出：${r.out.trim().split('\n').slice(0, 3).join(' | ')}`)
  fs.writeFileSync(abs, original)
}

// 复原后必须回到 PASS（证明上面每处注入都被清干净了）
{
  const r = runChecker()
  report('复原后 PASS', r.ok, r.ok ? '' : r.out.trim())
}

fs.rmSync(temp, { recursive: true, force: true })
console.log(`\nR7 自检：${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
