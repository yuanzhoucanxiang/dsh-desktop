/**
 * Stage C/D/E unit tests: project-memory, draft-checkpoints, context-builder.
 * node plugin/writing-mode/test/architecture-cde.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMemory, applyMemoryOp, injectableItems } from '../lib/project-memory.js'
import { readCheckpoint, writeCheckpoint, listCheckpoints } from '../lib/draft-checkpoints.js'
import { buildPreparedTurn, memoryHint } from '../src/shared/context-builder.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('PASS', name, extra)
  } else {
    fail++
    console.log('FAIL', name, extra)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cde-'))
const proj = path.join(tmp, 'demo')
fs.mkdirSync(path.join(proj, 'state'), { recursive: true })
fs.writeFileSync(path.join(proj, 'project.md'), '# demo\n')
process.env.DSH_HOME = path.join(tmp, 'home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })

/* Memory add → confirm → retract */
{
  const r1 = applyMemoryOp(proj, {
    op: 'add',
    item: { kind: 'fact', status: 'proposed', text: '她收到信后没有拆开。', source: { kind: 'assistant' } },
  })
  ok('memory add proposed', r1.memory.items.length === 1 && r1.memory.items[0].status === 'proposed')
  ok('proposed not injectable', injectableItems(r1.memory).length === 0)

  const id = r1.memory.items[0].id
  const r2 = applyMemoryOp(proj, {
    op: 'update',
    id,
    baseEtag: r1.etag,
    item: { status: 'confirmed' },
  })
  ok('confirm with etag', r2.memory.items[0].status === 'confirmed')
  ok('confirmed injectable', injectableItems(r2.memory).length === 1)

  let conflict = null
  try {
    applyMemoryOp(proj, { op: 'retract', id, baseEtag: r1.etag })
  } catch (e) {
    conflict = e
  }
  ok('stale etag conflicts', conflict?.message === 'etag-conflict', conflict?.message)

  const r3 = applyMemoryOp(proj, { op: 'retract', id, baseEtag: r2.etag })
  ok('retract', r3.memory.items[0].status === 'retracted')
  ok('retracted not injectable', injectableItems(r3.memory).length === 0)

  const bad = (() => {
    try {
      applyMemoryOp(proj, {
        op: 'add',
        item: { kind: 'fact', status: 'proposed', text: 'x' },
        baseEtag: 'deadbeef',
      })
      return null
    } catch (e) {
      return e
    }
  })()
  ok('bad etag rejected', bad?.message === 'etag-conflict', bad?.message)

  // After data exists, mutating without optimistic token must fail
  const noTok = (() => {
    try {
      applyMemoryOp(proj, { op: 'add', item: { kind: 'fact', status: 'proposed', text: 'no-token' } })
      return null
    } catch (e) {
      return e
    }
  })()
  ok('revision required when file non-empty', noTok?.message === 'revision-required', noTok?.message)
}

/* Draft checkpoints */
{
  writeCheckpoint(proj, 'w1', { text: 'hello draft', reference: { label: '选区', text: 'sel' } })
  const c = readCheckpoint(proj, 'w1')
  ok('draft roundtrip', c?.text === 'hello draft' && c.reference.text === 'sel')
  writeCheckpoint(proj, 'w1', { text: '', reference: null })
  ok('draft cleared', readCheckpoint(proj, 'w1') === null)
  writeCheckpoint(proj, 'w1', { text: 'again' })
  ok('list includes draft', listCheckpoints(proj).length >= 1)
}

/* Context builder */
{
  const prepared = buildPreparedTurn({
    message: '我们聊聊林野。',
    reference: { label: '选区', text: '他站在雨里' },
    memoryItems: [
      { id: '1', kind: 'fact', status: 'confirmed', text: '林野能看见倒计时' },
      { id: '2', kind: 'fact', status: 'proposed', text: '不应出现' },
      { id: '3', kind: 'preference', status: 'confirmed', text: '短句' },
    ],
    budget: 6000,
    projectKey: 'demo',
  })
  ok('prepared frozen', Object.isFrozen(prepared))
  ok('includes confirmed fact', prepared.body.includes('林野能看见倒计时'))
  ok('includes preference', prepared.body.includes('短句'))
  ok('excludes proposed', !prepared.body.includes('不应出现'))
  ok('includes reference', prepared.body.includes('他站在雨里'))
  ok('includes message', prepared.body.includes('我们聊聊林野'))
  ok('hint counts 2', memoryHint([
    { status: 'confirmed', kind: 'fact' },
    { status: 'confirmed', kind: 'preference' },
    { status: 'proposed', kind: 'fact' },
  ]) === '参考项目备忘 · 2 条')

  // budget forces omission
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    kind: 'fact',
    status: 'confirmed',
    text: '很长很长的设定句子'.repeat(20) + i,
  }))
  const tight = buildPreparedTurn({ message: 'hi', memoryItems: many, budget: 200 })
  ok('budget omits items', tight.omittedCount > 0 && tight.body.length < 2000, String(tight.omittedCount))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
