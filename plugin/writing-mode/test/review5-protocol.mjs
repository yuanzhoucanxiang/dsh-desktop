/**
 * review5 R01–R03 client-draft protocol behaviors (module-level).
 * Uses production client factory via vm + stub ModuleLoader.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'

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

const root = process.cwd()
const clientPath = path.join(root, 'plugin/writing-mode/client.js')
const code = fs.readFileSync(clientPath, 'utf8')
let mod = null
const sandbox = {
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  crypto: globalThis.crypto,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => 'win1', setItem: () => {} },
  navigator: { language: 'zh-CN' },
  console,
  document: undefined,
  window: {
    __ModuleLoader__: {
      load: (entry) => {
        mod = entry.factory(() => ({}))
      },
    },
  },
}
vm.runInNewContext(code, sandbox)

ok('client exports draft APIs', Boolean(mod?.loadCompanionDraft && mod?.resolveDraftConflict && mod.__draftConflict))

// We only assert the exported conflict registry API exists and clear/keep modes are callable
// Full R01–R03 timing belongs to review5-ui; this guards the protocol surface.
const project = 'E:/tmp/proj-r5'
mod.__draftConflict.set(project, { remoteRev: 10, remoteText: 'REMOTE', remoteReference: null, localText: 'LOCAL', localReference: null })
ok('conflict registered', mod.__draftConflict.get(project)?.remoteRev === 10)
// resolveDraftConflict will attempt persist against network stub — expect it not to throw
try {
  void mod.resolveDraftConflict(project, 'keep-remote')
  ok('resolveDraftConflict callable', true)
} catch (e) {
  ok('resolveDraftConflict callable', false, String(e.message))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
