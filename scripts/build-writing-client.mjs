/**
 * Build plugin/writing-mode/client.js from src/ sources.
 * - src/shared/editor-session.js is inlined as the only createEditorSession
 * - src/client/entry.js is the ModuleLoader factory body (react stays external)
 * Generated product — edit src/, then: npm run build:writing
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

let entry = read('plugin/writing-mode/src/client/entry.js')
const shared = read('plugin/writing-mode/src/shared/editor-session.js')
const sharedBody = shared
  .replace(/^[\s\S]*?export function createEditorSession/, 'function createEditorSession')
  .replace(/\nexport /g, '\n')

const ctxSrc = read('plugin/writing-mode/src/shared/context-builder.js')
const ctxBody = ctxSrc
  .replace(/^[\s\S]*?export function buildPreparedTurn/, 'function buildPreparedTurn')
  .split('export function memoryHint')[0]
  .replace(/^function buildPreparedTurn[\s\S]*?function memoryHint[\s\S]*$/m, '')

// rebuild cleanly: just take both exported functions as local
const ctxClean = [
  ctxSrc.match(/export function buildPreparedTurn[\s\S]*?(?=\nexport function memoryHint)/)?.[0] || '',
  ctxSrc.match(/export function memoryHint[\s\S]*$/)?.[0] || '',
]
  .join('\n')
  .replace(/export function/g, 'function')

const anchor = '    // createEditorSession comes from src/shared/editor-session.js (build inlines it)\n'
if (!entry.includes(anchor)) {
  console.error('entry.js missing editor-session anchor')
  process.exit(1)
}
entry = entry.replace(
  anchor,
  sharedBody.trimEnd() + '\n' + ctxClean.trimEnd() + '\n' + anchor
)

const banner = `/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/writing-mode/src/client/entry.js + src/shared/editor-session.js
 * Build:  node scripts/build-writing-client.mjs   (or npm run build:writing)
 * Bundle: window.__ModuleLoader__.load factory body
 */
`
const factory = `${banner}window.__ModuleLoader__.load({
  id: "@dsh-local/writing-mode",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
${entry}
    return module.exports
  },
})
`

const outFile = path.join(root, 'plugin/writing-mode/client.js')
fs.writeFileSync(outFile, factory, 'utf8')
console.log(`built ${path.relative(root, outFile)} (${factory.length} bytes, ${factory.split('\n').length} lines)`)
