// 复核者的 UI 负向探针（真实 client.js + React + host）：node 直跑 electron CLI。
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(ROOT, 'node_modules', 'electron', 'cli.js')
const script = path.join(ROOT, 'docs/audits/writing-architecture/2026-09-14/v2-review/ui-probes.cjs')
const r = spawnSync(process.execPath, [cli, script], { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...process.env } })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split(String.fromCharCode(10)).filter((l) => l.includes('"id"') || l.includes('FAIL')).join(String.fromCharCode(10)))
const failed = /"status":"FAIL"/.test(out)
console.log(failed ? 'verify-writing-review-probes: FAIL' : 'verify-writing-review-probes: PASS（4 项 UI 负向探针全过）')
process.exit(failed || r.status !== 0 ? 1 : 0)