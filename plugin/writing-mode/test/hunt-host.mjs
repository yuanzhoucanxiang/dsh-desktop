/**
 * Active vulnerability hunt for writing-mode host (not a product PASS suite).
 * node plugin/writing-mode/test/hunt-host.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hunt-'))
process.env.DSH_HOME = path.join(root, 'home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })

const store = await import('../lib/store.js')
const mem = await import('../lib/project-memory.js')
const draft = await import('../lib/draft-checkpoints.js')
const { listTemplates, renderTemplate } = await import('../lib/templates.js')

let pass = 0
let fail = 0
const found = []
const ok = (name, cond, note = '') => {
  if (cond) {
    pass++
    console.log('PASS', name, note)
  } else {
    fail++
    found.push(name + (note ? ' :: ' + note : ''))
    console.log('FAIL', name, note)
  }
}

const lib = path.join(root, 'lib')
fs.mkdirSync(lib, { recursive: true })
store.writeConfig({ roots: [{ path: lib, label: 'L', default: true }], activeRoot: lib, prefs: { ...store.DEFAULT_PREFS } })
const roots = store.effectiveRoots(store.readConfig())

// --- H1: resolveUnderRoots rejects `..` and relative ---
ok('reject relative path', store.resolveUnderRoots('foo/bar.md', roots) === null)
ok('reject empty', store.resolveUnderRoots('', roots) === null)
ok('reject parent escape', store.resolveUnderRoots(path.join(lib, '..', 'outside.txt'), roots) === null)

// --- H2: junction / file symlink escape ---
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hunt-out-'))
const proj = path.join(lib, 'P1')
fs.mkdirSync(proj, { recursive: true })
fs.writeFileSync(path.join(proj, 'project.md'), '# p1\n')
const secret = path.join(outside, 'secret.md')
fs.writeFileSync(secret, 'SECRET_ESCAPE')
const link = path.join(proj, 'linked.md')
try {
  fs.symlinkSync(secret, link)
  const t = store.resolveUnderRoots(link, roots)
  ok('file symlink escape rejected', t === null, JSON.stringify(t))
} catch (e) {
  ok('file symlink setup', true, e.code || '')
}

// --- H3: create-project must refuse non-empty dir without project.md ---
const half = path.join(lib, 'HalfProj')
fs.mkdirSync(path.join(half, 'bible'), { recursive: true })
fs.writeFileSync(path.join(half, 'bible', 'characters.md'), 'PRECIOUS_CHAR')
const h3 = store.prepareProjectTarget(lib, 'HalfProj', roots)
ok('H3 refuse non-empty without project.md', h3.ok === false && h3.error === 'directory-not-empty', JSON.stringify(h3))
ok(
  'H3 precious file intact',
  fs.readFileSync(path.join(half, 'bible', 'characters.md'), 'utf8') === 'PRECIOUS_CHAR'
)

// --- H4: title `.` / `..` must not land on library root or parent ---
const h4dot = store.prepareProjectTarget(lib, '.', roots)
ok('H4 reject title .', h4dot.ok === false && h4dot.error === 'invalid-project-name', JSON.stringify(h4dot))
const h4dots = store.prepareProjectTarget(lib, '..', roots)
ok('H4 reject title ..', h4dots.ok === false, JSON.stringify(h4dots))
ok('H4 safeProjectDirName null for .', store.safeProjectDirName('.') === null)
ok('H4 safeProjectDirName null for ..', store.safeProjectDirName('..') === null)
ok('H4 safeProjectDirName null for ...', store.safeProjectDirName('...') === null)
ok('H4 safeProjectDirName null for CON', store.safeProjectDirName('CON') === null)
ok('H4 join(..) rejected by roots', store.resolveUnderRoots(path.join(lib, '..'), roots) === null)
ok(
  'H4 library root itself not a project target',
  store.prepareProjectTarget(lib, '  ..  ', roots).ok === false
)

// --- H5: draft empty project shared bucket ---
draft.writeCheckpoint('E:/nonexistent-project', 'wA', { text: 'A-win', baseRev: 0 })
const b = draft.readCheckpoint('E:/nonexistent-project', 'wB')
ok('H5 different windowId isolated', b === null)

// --- H6: draft path not under roots still stored by key ---
// host validates non-empty project path; unit API does not — document as host-only gate
draft.writeCheckpoint('C:/evil', 'w', { text: 'x', baseRev: 0 })
ok('H6 draft store is keyed only (host must gate)', draft.readCheckpoint('C:/evil', 'w')?.text === 'x')

// --- H7: memory text / source size ---
const long = 'x'.repeat(5000)
let big = null
try {
  mem.applyMemoryOp(proj, {
    op: 'add',
    baseRevision: 0,
    baseEtag: mem.emptyEtag(),
    item: { kind: 'fact', status: 'proposed', text: long },
  })
} catch (e) {
  big = e
}
ok('H7 oversized memory text rejected', big?.message === 'text-too-long', big?.message)

// --- H8: template rel must be safe (renderTemplate, not listTemplates) ---
let badRel = false
const relNotes = []
for (const t of listTemplates()) {
  const rendered = renderTemplate(t.id, 'HuntTitle', 'p')
  for (const f of rendered.files || []) {
    if (!store.isSafeTemplateRel(f.rel)) {
      badRel = true
      relNotes.push(`${t.id}:${f.rel}`)
    }
    if (String(f.rel || '').includes('..')) badRel = true
  }
}
ok('H8 template rel has no .. / unsafe', !badRel, relNotes.join(','))

// --- H9: happy path still works ---
const good = store.prepareProjectTarget(lib, '正常项目', roots)
ok('H9 prepare allows empty/new name', good.ok === true, JSON.stringify(good.error || good.dirName))
if (good.ok) {
  fs.mkdirSync(good.target.abs, { recursive: true })
  const emptyDir = store.prepareProjectTarget(lib, '正常项目', roots)
  ok('H9 empty dir still allowed for scaffold', emptyDir.ok === true, JSON.stringify(emptyDir))
  fs.writeFileSync(path.join(good.target.abs, 'project.md'), '# x\n')
  const again = store.prepareProjectTarget(lib, '正常项目', roots)
  ok('H9 existing project.md → project-exists', again.ok === false && again.error === 'project-exists', JSON.stringify(again))
}

fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(outside, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  console.log('FINDINGS:')
  for (const f of found) console.log(' -', f)
}
process.exit(fail ? 1 : 0)
