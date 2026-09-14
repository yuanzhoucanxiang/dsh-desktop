// Read-only artifact and architecture evidence. Does not launch or alter installed apps.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const source = path.join(repo, 'plugin/writing-mode')
const packaged = path.join(os.tmpdir(), 'dsh-arch-accept-0138/win-unpacked/resources/plugin/writing-mode')
const profile = path.join(os.tmpdir(), 'dsh-arch-home/profiles/node_modules/@dsh-local/writing-mode')
process.env.DSH_HOME = path.join(os.tmpdir(), 'dsh-reassessment-readonly-home')
const sha = p => fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null
const files = ['package.json', 'index.js', 'client.js', 'CONTRACT.md', ...fs.readdirSync(path.join(source, 'lib')).map(f => 'lib/' + f)]
const comparison = files.map(file => {
  const sourceHash = sha(path.join(source, file)), packageHash = sha(path.join(packaged, file)), profileHash = sha(path.join(profile, file))
  return { file, sourceHash, packageHash, profileHash, packageMatches: packageHash === sourceHash, profileMatches: profileHash === sourceHash }
})
const entry = fs.readFileSync(path.join(source, 'src/client/entry.js'), 'utf8')
const { buildPreparedTurn } = await import(pathToFileURL(path.join(source, 'src/shared/context-builder.js')))
const prepared = buildPreparedTurn({ message: 'test', projectKey: 'fixture', memoryRevision: 7, memoryItems: [{ id: 'a', kind: 'fact', status: 'confirmed', text: 'test fact' }] })
let packageImport
try { await import(pathToFileURL(path.join(packaged, 'index.js'))); packageImport = { ok: true } }
catch (e) { packageImport = { ok: false, error: e.message } }
let asarMain
try {
  const require = createRequire(path.join(repo, 'package.json'))
  const asar = require('@electron/asar')
  const bytes = asar.extractFile(path.resolve(packaged, '../../app.asar'), 'main.js')
  asarMain = { matchesRepository: bytes.equals(fs.readFileSync(path.join(repo, 'main.js'))) }
} catch (e) { asarMain = { checked: false, error: e.message } }
const result = {
  head: '5a152dc', implementation: '1a67496',
  comparison, packageImport, asarMain,
  entryLines: entry.trimEnd().split(/\r?\n/).length,
  clientSourceFiles: fs.readdirSync(path.join(source, 'src/client')),
  preparedTurnKeys: Object.keys(prepared),
  suppliedMemoryRevisionPreserved: prepared.memoryRevision === 7,
  memoryHintCallInEntry: /\bmemoryHint\s*\(/.test(entry),
  note: 'Artifact bytes and importability only; not proof of packaged startup, offline operation, installer upgrade or live preview.'
}
fs.writeFileSync(path.join(here, 'reassessment-probes-results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ files: files.length, packageMatches: comparison.filter(x => x.packageMatches).length, profileMatches: comparison.filter(x => x.profileMatches).length, packageImport, asarMain, entryLines: result.entryLines, suppliedMemoryRevisionPreserved: result.suppliedMemoryRevisionPreserved, memoryHintCallInEntry: result.memoryHintCallInEntry }, null, 2))
