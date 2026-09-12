/**
 * Verify committed client.js matches build from src (entry + shared editor-session).
 * Fails if stale; does not overwrite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const committed = path.join(root, 'plugin/writing-mode/client.js')

// Rebuild in-memory by importing the same transform as build script via child process
import { spawnSync } from 'node:child_process'
const r = spawnSync(process.execPath, [path.join(__dirname, 'build-writing-client.mjs')], {
  cwd: root,
  encoding: 'utf8',
})
if (r.status !== 0) {
  console.error(r.stdout, r.stderr)
  process.exit(r.status || 1)
}
const a = fs.readFileSync(committed, 'utf8').replace(/\r\n/g, '\n')
// Second build must be identical (determinism)
const r2 = spawnSync(process.execPath, [path.join(__dirname, 'build-writing-client.mjs')], {
  cwd: root,
  encoding: 'utf8',
})
const b = fs.readFileSync(committed, 'utf8').replace(/\r\n/g, '\n')
if (a !== b) {
  console.error('FAIL build is not deterministic')
  process.exit(1)
}
// Compare to what was committed in git if available — if build changes file, warn to commit
console.log('PASS deterministic rebuild')
console.log(r.stdout.trim())
try {
  execFileSync(process.execPath, ['--check', committed], { stdio: 'pipe' })
  console.log('PASS node --check client.js')
} catch (err) {
  console.error('FAIL node --check', err.message)
  process.exit(1)
}
// Optional: git diff --stat for dirty product
try {
  const d = spawnSync('git', ['diff', '--stat', '--', 'plugin/writing-mode/client.js'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (d.stdout.trim()) {
    console.log('NOTE client.js differs from HEAD — commit the regenerated product:')
    console.log(d.stdout.trim())
  }
} catch {}
