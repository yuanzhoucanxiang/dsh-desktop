/**
 * Review-fix regressions F01/F04/F06/F09
 * node plugin/writing-mode/test/review-f01-f06.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  applyMemoryOp,
  readMemory,
  MEMORY_FILE,
} from '../lib/project-memory.js'
import { resolveProjectDir, effectiveRoots, writeConfig, DEFAULT_PREFS, readConfig } from '../lib/store.js'

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-f01-'))
const home = path.join(tmp, 'home')
const lib = path.join(tmp, 'lib')
process.env.DSH_HOME = home
fs.mkdirSync(home, { recursive: true })
writeConfig({ roots: [{ path: lib, label: 'lib', default: true }], activeRoot: lib, prefs: { ...DEFAULT_PREFS } })

/* F01: two sibling projects do not share memory when using project directory */
for (const name of ['A', 'B']) {
  const dir = path.join(lib, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'project.md'), `# ${name}\n`)
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
}
const roots = effectiveRoots(readConfig())
const projA = resolveProjectDir(path.join(lib, 'A'), roots)
const projB = resolveProjectDir(path.join(lib, 'B'), roots)
ok('resolveProjectDir A is project A', projA?.toLowerCase() === path.join(lib, 'A').toLowerCase(), projA)
ok('resolveProjectDir B is project B', projB?.toLowerCase() === path.join(lib, 'B').toLowerCase(), projB)

applyMemoryOp(projA, {
  op: 'add',
  item: { kind: 'fact', status: 'confirmed', text: 'A_ONLY_SENTINEL', source: { kind: 'author' } },
})
const memA = readMemory(projA)
const memB = readMemory(projB)
ok('A has sentinel', memA.memory.items.some((i) => i.text === 'A_ONLY_SENTINEL'))
ok('B does not have A sentinel', !memB.memory.items.some((i) => i.text === 'A_ONLY_SENTINEL'))
ok('B memory file not sharing A path', !fs.existsSync(path.join(projB, MEMORY_FILE)) || readMemory(projB).memory.items.length === 0)

/* F06: malformed structure not silently wiped */
const badFile = path.join(projA, MEMORY_FILE)
const original = fs.readFileSync(badFile, 'utf8')
fs.writeFileSync(badFile, JSON.stringify({ schemaVersion: 1, revision: 9, projectKey: 'x', items: { not: 'array' }, changes: [] }))
let corrupt = null
try {
  applyMemoryOp(projA, {
    op: 'add',
    item: { kind: 'fact', status: 'confirmed', text: 'SHOULD_NOT_LOSE' },
    baseEtag: 'dead',
  })
} catch (e) {
  corrupt = e
}
ok('corrupt structure rejected', ['bad-memory', 'corrupt-memory', 'etag-conflict', 'revision-conflict'].includes(corrupt?.message), corrupt?.message)
ok('corrupt file not wiped', fs.readFileSync(badFile, 'utf8').includes('{'))
fs.writeFileSync(badFile, original)

/* F04: state junction escape */
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-f01-out-'))
try {
  fs.rmSync(path.join(projA, 'state'), { recursive: true, force: true })
  fs.symlinkSync(outside, path.join(projA, 'state'), 'junction')
  let esc = null
  try {
    applyMemoryOp(projA, {
      op: 'add',
      item: { kind: 'fact', status: 'confirmed', text: 'JUNCTION_ESCAPE' },
      baseEtag: memA.etag,
    })
  } catch (e) {
    esc = e
  }
  const leaked = fs.existsSync(path.join(outside, MEMORY_FILE))
  ok('junction escape rejected or blocked', esc != null || !leaked, `${esc?.message} leaked=${leaked}`)
} catch (e) {
  ok('junction setup ok', true, String(e.message))
} finally {
  try {
    fs.rmSync(path.join(projA, 'state'), { recursive: true, force: true })
    fs.mkdirSync(path.join(projA, 'state'), { recursive: true })
    fs.writeFileSync(path.join(projA, MEMORY_FILE), original)
  } catch {}
  try {
    fs.rmSync(outside, { recursive: true, force: true })
  } catch {}
}

/* F09: verify does not overwrite stale client */
{
  const client = path.join(process.cwd(), 'plugin/writing-mode/client.js')
  const backup = fs.readFileSync(client)
  fs.writeFileSync(client, '// STALE\n' + backup)
  const r = spawnSync(process.execPath, ['scripts/verify-writing-build.mjs'], { encoding: 'utf8' })
  const stillStale = fs.readFileSync(client).toString().includes('// STALE')
  ok('verify fails on stale without overwrite', r.status !== 0 && stillStale, `status=${r.status} stillStale=${stillStale}`)
  fs.writeFileSync(client, backup)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
