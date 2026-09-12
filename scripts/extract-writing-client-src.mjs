import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcPath = path.join(root, 'plugin/writing-mode/client.js')
const src = fs.readFileSync(srcPath, 'utf8')
const lines = src.split(/\r?\n/)

const startIdx = lines.findIndex((l) => l.includes('Object.defineProperty(exports, Symbol.toStringTag'))
let endIdx = -1
for (let i = lines.length - 1; i > 0; i--) {
  if (lines[i].includes('return module.exports') && i > startIdx) {
    endIdx = i
    break
  }
}
if (startIdx < 0 || endIdx < 0) {
  console.error('markers not found', { startIdx, endIdx })
  process.exit(1)
}
const body = lines.slice(startIdx + 1, endIdx).join('\n')
const outDir = path.join(root, 'plugin/writing-mode/src/client')
fs.mkdirSync(outDir, { recursive: true })
const header = [
  '/**',
  ' * Source: ModuleLoader factory body (extracted).',
  ' * Build wraps this in window.__ModuleLoader__.load({ factory }).',
  ' * react / react/jsx-runtime come from factory require — not bundled.',
  ' */',
  '/* eslint-disable */',
  '',
].join('\n')
fs.writeFileSync(path.join(outDir, 'entry.js'), header + body + '\n')
console.log('entry.js lines', body.split('\n').length, 'from', startIdx + 2, 'to', endIdx)

fs.mkdirSync(path.join(root, 'plugin/writing-mode/src/shared'), { recursive: true })
fs.copyFileSync(
  path.join(root, 'plugin/writing-mode/lib/editor-session.js'),
  path.join(root, 'plugin/writing-mode/src/shared/editor-session.js')
)
console.log('shared/editor-session.js copied')
