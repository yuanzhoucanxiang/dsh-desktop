import path from 'node:path'
import { runDemo } from '../lib/pipeline.mjs'

/** 兼容旧入口：node scripts/run-demo.mjs [--project ...] [--out ...] [--skip-render] [--skip-encode] */
const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

try {
  const result = await runDemo({
    projectDir: path.resolve(arg('project', 'fixtures/boutique')),
    outDir: path.resolve(arg('out', 'demo-out')),
    skipRender: args.includes('--skip-render'),
    skipEncode: args.includes('--skip-encode'),
  })
  if (result.stage === 'validate') {
    console.error(`[previz] schema invalid (${result.errors.length} errors)`)
    for (const e of result.errors.slice(0, 20)) console.error(`  ${e.path}: ${e.message}`)
    process.exit(1)
  }
  const qc = result.qc
  if (!qc.ok) {
    console.error(`[previz] QC FAILED (${qc.errors.length} errors)`)
    for (const e of qc.errors.slice(0, 20)) console.error(`  ${e.path}: ${e.message}`)
    process.exit(1)
  }
  console.log(`[previz] QC OK · shots=${qc.stats.shots} frames=${qc.stats.frames}`)
  for (const w of qc.warnings) console.warn(`  WARN ${w.path}: ${w.message}`)
  console.log(`[previz] out: ${result.outDir}`)
} catch (err) {
  console.error(`[previz] ${err?.message || err}`)
  process.exit(1)
}
