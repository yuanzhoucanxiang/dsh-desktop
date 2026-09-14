// 原 review9 的 32 条正向 UI 时序基线（保留原断言，只更新入口/结果路径）。
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(ROOT, 'node_modules', 'electron', 'cli.js')
const script = path.join(ROOT, 'docs/audits/writing-architecture/2026-09-14/v2-review/baseline-ui.cjs')
const r = spawnSync(process.execPath, [cli, script], { cwd: ROOT, encoding: 'utf8', timeout: 900000, env: { ...process.env } })
const out = (r.stdout || '') + (r.stderr || '')
const tail = out.split(String.fromCharCode(10)).slice(-6).join(String.fromCharCode(10))
console.log(tail)
console.log(r.status === 0 ? 'verify-writing-baseline-ui: PASS（原 32 条正向时序）' : 'verify-writing-baseline-ui: FAIL（exit=' + r.status + '）')
process.exit(r.status === 0 ? 0 : 1)