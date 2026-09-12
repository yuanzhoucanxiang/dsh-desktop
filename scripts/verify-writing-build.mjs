/**
 * Verify committed client.js matches a rebuild WITHOUT overwriting.
 * Stale product → exit 1. Determinism: build twice to temp, compare.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const committed = path.join(root, 'plugin/writing-mode/client.js')
const before = fs.readFileSync(committed)

function buildOnce(outPath) {
  // Patch build script to accept WM_BUILD_OUT via env
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-writing-client.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, WM_BUILD_OUT: outPath },
  })
  if (r.status !== 0) {
    console.error(r.stdout || '')
    console.error(r.stderr || '')
    throw new Error('build-writing-client failed')
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-verify-build-'))
const out1 = path.join(tmp, 'client1.js')
const out2 = path.join(tmp, 'client2.js')
try {
  buildOnce(out1)
  buildOnce(out2)
  const a = fs.readFileSync(out1)
  const b = fs.readFileSync(out2)
  if (!a.equals(b)) {
    console.error('FAIL build not deterministic')
    process.exit(1)
  }
  const after = fs.readFileSync(committed)
  if (!a.equals(after)) {
    console.error('FAIL client.js is stale vs src — run npm run build:writing (verify does NOT overwrite)')
    console.error(`committed ${after.length} bytes, rebuilt ${a.length} bytes`)
    process.exit(1)
  }
  // ensure we did not touch committed
  if (!before.equals(fs.readFileSync(committed))) {
    console.error('FAIL verify mutated client.js')
    process.exit(1)
  }
  console.log('PASS client.js matches src (no overwrite)')
  const check = spawnSync(process.execPath, ['--check', committed], { encoding: 'utf8' })
  if (check.status !== 0) {
    console.error('FAIL node --check', check.stderr)
    process.exit(1)
  }
  console.log('PASS node --check client.js')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
