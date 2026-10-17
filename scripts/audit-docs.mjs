#!/usr/bin/env node
/**
 * 文档覆盖审计（AGENTS §2.1.1）：逐笔查"提交号有没有落进 WORKLOG 索引 / 任一当日日志"。
 *
 * 为什么要有脚本：手打一行命令的第一版只查 `logs/<今天>.md` —— 查往期提交必然 ✗（那些在别的日志里），
 * 会误判；而且"补文档那几笔提交"天然不可能引用自己的哈希，必须豁免。
 *
 * 用法（在 dsh-desktop 或 plugin/writing-mode 下都行）：
 *   node scripts/audit-docs.mjs [--n 10]
 * 退出码：0 = 全部可追溯（或只剩被豁免的"文档提交"）；1 = 有缺口。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const nIndex = args.indexOf('--n')
const COUNT = nIndex >= 0 ? Math.max(1, Number(args[nIndex + 1]) || 10) : 10

const repo = process.cwd()
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()

if (!fs.existsSync(path.join(repo, 'WORKLOG.md'))) {
  console.error('不在预期的仓库根（找不到 WORKLOG.md）')
  process.exit(2)
}

const logFiles = fs.existsSync(path.join(repo, 'logs'))
  ? fs.readdirSync(path.join(repo, 'logs')).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => path.join(repo, 'logs', f))
  : []
const worklog = fs.readFileSync(path.join(repo, 'WORKLOG.md'), 'utf8')
const logTexts = logFiles.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }))

const lines = git('log', `-n${COUNT}`, '--format=%h%x09%s').split('\n').filter(Boolean)
const rows = []
let missing = 0
for (const line of lines) {
  const [hash, ...rest] = line.split('\t')
  const subject = rest.join('\t')
  const inIndex = worklog.includes(hash)
  const inLog = logTexts.some((l) => l.text.includes(hash))
  // 豁免：文档类提交不可能引用自己的哈希（见 AGENTS §2.1.1"自指"）
  const isDocCommit = /^(docs|chore)\b/.test(subject)
  const ok = (inIndex && inLog) || isDocCommit
  if (!ok) missing += 1
  rows.push({ hash, subject, inIndex, inLog, isDocCommit, ok })
}

for (const r of rows) {
  const mark = (v) => (v ? '✓' : '✗')
  const note = r.isDocCommit && !(r.inIndex && r.inLog) ? '（文档提交，豁免自指）' : ''
  console.log(`${r.hash}  索引:${mark(r.inIndex)}  日志:${mark(r.inLog)}  ${r.subject.slice(0, 60)}${note}`)
}
console.log(`\n最近 ${rows.length} 笔：可追溯 ${rows.length - missing} / 缺口 ${missing}`)
if (missing > 0) {
  console.error('有提交没进索引/日志 —— 按 AGENTS §2.1.1 同一轮补齐（索引行 + 日志里带提交号）。')
  process.exit(1)
}
