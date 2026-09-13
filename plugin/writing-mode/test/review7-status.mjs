/**
 * V01: draft save status must be observable without callbacks.
 * node plugin/writing-mode/test/review7-status.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

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

const code = fs.readFileSync(path.join(process.cwd(), 'plugin/writing-mode/client.js'), 'utf8')
let mod = null
let nextDraftResponse = { ok: true, checkpoint: { rev: 1 } }
const sandbox = {
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  crypto: globalThis.crypto,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => 'w', setItem: () => {} },
  navigator: { language: 'zh-CN' },
  console,
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => nextDraftResponse,
  }),
  window: { __ModuleLoader__: { load: (e) => { mod = e.factory(() => ({})) } } },
}
vm.runInNewContext(code, sandbox)

const project = 'P1'
let events = []
mod.subscribeDraftStatus(() => events.push(mod.getDraftStatus(project).phase))

// prepare cache as dirty local
mod.__draftDirty.set(project, true)
mod.__draftConflict.set(project, null) // ensure no conflict? delete
mod.__draftConflict.delete(project)

// simulate companionDrafts via persist payload: we need text in cache — use apply path
// persist reads companionDrafts; seed via resolve keep-remote style not available
// Use persistCompanionDraft after setting cache through exported maps is not enough.
// Instead call persist after a keep-remote adopt.
mod.__draftConflict.set(project, {
  remoteStatus: 'valid',
  remoteRev: 3,
  remoteText: 'OK',
  remoteReference: null,
  localText: 'LOCAL',
  localReference: null,
})
await mod.resolveDraftConflict(project, 'keep-remote', {})
ok('status after keep-remote', mod.getDraftStatus(project).phase === 'saved', JSON.stringify(mod.getDraftStatus(project)))

// network error path
nextDraftResponse = null
const origFetch = sandbox.fetch
sandbox.fetch = async () => {
  throw new Error('net down')
}
// trigger another save by marking dirty through persist
mod.__draftDirty.set(project, true)
const r = await mod.persistCompanionDraft(project)
ok('network save fails visible', r?.ok === false && r?.error === 'network', JSON.stringify(r))
ok('status phase error', mod.getDraftStatus(project).phase === 'error', JSON.stringify(mod.getDraftStatus(project)))
ok('status has message', String(mod.getDraftStatus(project).error || '').length > 0)
ok('dirty kept on failure', mod.__draftDirty.get(project) === true)

// 413 path
sandbox.fetch = async () => ({
  ok: true,
  status: 413,
  json: async () => ({ ok: false, error: 'draft-too-large' }),
})
const r2 = await mod.persistCompanionDraft(project)
ok('413 visible', r2?.ok === false && String(mod.getDraftStatus(project).error).includes('过长'), JSON.stringify(mod.getDraftStatus(project)))
ok('subscribers notified', events.includes('error') || events.includes('saved'), events.join(','))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
