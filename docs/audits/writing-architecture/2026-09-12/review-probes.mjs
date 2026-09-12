// Independent review of cb99ae7. Reproduces defects; does not change production code.
// Run: node docs/audits/writing-architecture/2026-09-12/review-probes.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-review-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
const projectA = path.join(root, 'A'), projectB = path.join(root, 'B')
for (const p of [projectA, projectB]) {
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, 'project.md'), '# fixture')
  fs.writeFileSync(path.join(p, 'draft.md'), '# draft')
}
const load = p => import(pathToFileURL(path.join(repo, p)))
const store = await load('plugin/writing-mode/lib/store.js')
const memory = await load('plugin/writing-mode/lib/project-memory.js')
const drafts = await load('plugin/writing-mode/lib/draft-checkpoints.js')
const host = await load('plugin/writing-mode/index.js')
store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: store.DEFAULT_PREFS })
let handler
host.apply({ effect: f => f(), webServer: { register: r => { handler = r.handler } } })
const server = http.createServer((req, res) => handler(req, res).catch(e => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const request = async (route, args, post = false) => {
  const url = origin + '/api/writing-mode?' + new URLSearchParams({ route, ...(post ? {} : args) })
  const res = await fetch(url, post ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) } : undefined)
  return { status: res.status, data: await res.json() }
}
const results = []
async function probe(name, fn) {
  try { const evidence = await fn(); results.push({ name, reproduced: true, evidence }); console.log('REPRODUCED', name, JSON.stringify(evidence)) }
  catch (e) { results.push({ name, reproduced: false, error: e.stack }); console.error('NOT REPRODUCED', name, e) }
}
try {
  await probe('R1 project-directory UI path writes parent and leaks across siblings', async () => {
    const added = await request('memory', { path: projectA, op: 'add', item: { text: 'A_ONLY_SENTINEL', status: 'confirmed' } }, true)
    const b = await request('memory', { path: projectB })
    const aFile = await request('memory', { path: path.join(projectA, 'draft.md') })
    assert.equal(added.status, 200)
    assert.equal(added.data.project, root)
    assert.equal(b.data.memory.items[0].text, 'A_ONLY_SENTINEL')
    assert.equal(aFile.data.memory.items.length, 0)
    return { storedIn: added.data.project, siblingSees: b.data.memory.items[0].text, filePathItems: aFile.data.memory.items.length }
  })
  await probe('R2 generated context builder loses DEFAULT_BUDGET', async () => {
    let client
    const source = fs.readFileSync(path.join(repo, 'plugin/writing-mode/client.js'), 'utf8')
      .replace('exports.createEditorSession = createEditorSession', 'exports.createEditorSession = createEditorSession; exports.reviewPrepared = buildPreparedTurn')
    vm.runInNewContext(source, { window: { __ModuleLoader__: { load: m => { client = m.factory(() => ({})) } } }, localStorage: { getItem: () => null }, navigator: { language: 'zh-CN' }, console })
    let error
    try { client.reviewPrepared({ message: 'hi', memoryItems: [] }) } catch (e) { error = e.message }
    assert.match(error, /DEFAULT_BUDGET is not defined/)
    return { error }
  })
  await probe('R3 memory state junction writes outside configured root', async () => {
    const outside = path.join(temp, 'outside')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(projectA, 'state'), 'junction')
    const res = await request('memory', { path: path.join(projectA, 'draft.md'), op: 'add', item: { text: 'OUTSIDE_SENTINEL' } }, true)
    assert.equal(res.status, 200)
    assert.ok(fs.readFileSync(path.join(outside, 'writing-memory.json'), 'utf8').includes('OUTSIDE_SENTINEL'))
    return { status: res.status, outsideFile: path.join(outside, 'writing-memory.json') }
  })
  await probe('R4 update destroys historical text and source coordinates', async () => {
    const before = memory.applyMemoryOp(projectB, { op: 'add', item: { text: 'ORIGINAL_SENTINEL', source: { kind: 'assistant', sessionId: 's', messageId: 'm' } } })
    const after = memory.applyMemoryOp(projectB, { op: 'update', id: before.memory.items[0].id, baseEtag: before.etag, item: { text: 'REPLACEMENT' } })
    assert.equal(JSON.stringify(after.memory).includes('ORIGINAL_SENTINEL'), false)
    assert.equal(after.memory.items[0].source.sessionId, undefined)
    return { changes: after.memory.changes, retainedSource: after.memory.items[0].source }
  })
  await probe('R5 valid JSON with malformed items is silently replaced', async () => {
    const p = path.join(temp, 'malformed'); fs.mkdirSync(path.join(p, 'state'), { recursive: true })
    fs.writeFileSync(path.join(p, 'state/writing-memory.json'), JSON.stringify({ schemaVersion: 1, revision: 3, items: { important: 'OLD_DATA' }, changes: [] }))
    const after = memory.applyMemoryOp(p, { op: 'add', item: { text: 'new' } })
    assert.equal(JSON.stringify(after.memory).includes('OLD_DATA'), false)
    return { revision: after.memory.revision, items: after.memory.items }
  })
  await probe('R6 draft silently truncates explicit reference', async () => {
    const text = 'x'.repeat(80001)
    drafts.writeCheckpoint(projectB, 'w', { text: 'hi', reference: { text, revision: 'r1', selection: [0, 80001] } })
    const checkpoint = drafts.readCheckpoint(projectB, 'w')
    assert.equal(checkpoint.reference.text.length, 80000)
    assert.equal(checkpoint.reference.revision, undefined)
    return { inputLength: text.length, savedLength: checkpoint.reference.text.length, referenceKeys: Object.keys(checkpoint.reference) }
  })
  await probe('R7 build verifier repairs stale product and returns success', async () => {
    const target = path.join(temp, 'build-copy')
    for (const p of ['scripts/build-writing-client.mjs', 'scripts/verify-writing-build.mjs', 'plugin/writing-mode/src/client/entry.js', 'plugin/writing-mode/src/shared/editor-session.js', 'plugin/writing-mode/src/shared/context-builder.js', 'plugin/writing-mode/client.js']) {
      fs.mkdirSync(path.dirname(path.join(target, p)), { recursive: true })
      fs.copyFileSync(path.join(repo, p), path.join(target, p))
    }
    const output = path.join(target, 'plugin/writing-mode/client.js')
    fs.writeFileSync(output, '/* deliberately stale */')
    const r = spawnSync(process.execPath, [path.join(target, 'scripts/verify-writing-build.mjs')], { cwd: target, encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.notEqual(fs.readFileSync(output, 'utf8'), '/* deliberately stale */')
    assert.equal(fs.readFileSync(output, 'utf8'), fs.readFileSync(path.join(repo, 'plugin/writing-mode/client.js'), 'utf8'))
    return { exit: r.status, mutated: true, rebuiltMatchesReviewedProduct: true, stdout: r.stdout }
  })
  await probe('R8 two processes accept same etag and lose one edit', async () => {
    const p = path.join(temp, 'parallel'); fs.mkdirSync(path.join(p, 'state'), { recursive: true })
    const base = memory.applyMemoryOp(p, { op: 'add', item: { text: 'base' } })
    const worker = path.join(temp, 'worker.mjs')
    // Barrier holds both readers after reading the same bytes, before either writes.
    fs.writeFileSync(worker, `import fs from 'node:fs'; import path from 'node:path';
      import {applyMemoryOp} from ${JSON.stringify(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/project-memory.js')).href)};
      const [p,id,etag]=process.argv.slice(2); const read=fs.readFileSync;
      fs.readFileSync=function(file,...args){const result=read.call(this,file,...args);
        if(String(file)===path.join(p,'state/writing-memory.json')){
          fs.writeFileSync(path.join(p,id+'.ready'),'1'); const deadline=Date.now()+10000;
          while(!(fs.existsSync(path.join(p,'a.ready'))&&fs.existsSync(path.join(p,'b.ready')))){
            if(Date.now()>deadline)throw new Error('barrier-timeout'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
          }
        } return result;};
      const result=applyMemoryOp(p,{op:'add',baseRevision:1,baseEtag:etag,item:{text:id}}); console.log(JSON.stringify({revision:result.memory.revision}));`)
    const run = id => new Promise(resolve => {
      const child = spawn(process.execPath, [worker, p, id, base.etag]); let out = '', err = ''
      child.stdout.on('data', b => { out += b }); child.stderr.on('data', b => { err += b })
      child.on('close', code => resolve({ code, out, err }))
    })
    const workers = await Promise.all([run('a'), run('b')])
    assert.ok(workers.every(w => w.code === 0), JSON.stringify(workers))
    const final = memory.readMemory(p).memory
    assert.equal(final.items.length, 2)
    return { workers, finalRevision: final.revision, finalTexts: final.items.map(i => i.text) }
  })
} finally {
  await new Promise(resolve => server.close(resolve))
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ repo, reviewedCommit: 'cb99ae7', results }, null, 2))
  console.log('EVIDENCE', temp)
}
process.exitCode = results.some(r => !r.reproduced) ? 1 : 0
