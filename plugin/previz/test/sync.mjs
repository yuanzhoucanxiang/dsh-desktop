/**
 * 发布一致性：按 runtime-manifest 把 plugin/previz 同步到临时 profile，确认引擎文件齐全、
 * 同步后的 host 入口能 import（不会因为漏文件在桌面壳里启动失败）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { syncPluginDir } = require('../../../lib/plugin-sync.js')

const root = path.resolve('plugin/previz')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-previz-sync-'))
const dest = path.join(temp, '@dsh-local', 'previz')

try {
  const r = syncPluginDir({ srcDir: root, destDir: dest, trustedRoot: temp })
  assert.equal(r.errors.length, 0, `sync errors: ${r.errors.join('; ')}`)
  assert.ok(fs.existsSync(path.join(dest, 'index.js')), 'index.js 应同步')
  assert.ok(fs.existsSync(path.join(dest, 'client.js')), 'client.js 应同步')
  assert.ok(fs.existsSync(path.join(dest, 'engine/scripts/run-demo.mjs')), 'engine/scripts/run-demo.mjs 应同步')
  assert.ok(fs.existsSync(path.join(dest, 'engine/blender/previz_build.py')), 'engine/blender 应同步')
  assert.ok(fs.existsSync(path.join(dest, 'engine/fixtures/boutique/shots.json')), 'fixtures 应同步')

  const mod = await import(pathToFileURL(path.join(dest, 'index.js')).href)
  assert.equal(typeof mod.probeRuntime, 'function')
  assert.equal(mod.API, '/api/previz')
  assert.ok(String(mod.ENGINE).endsWith(path.join('@dsh-local', 'previz', 'engine')), 'ENGINE 应指向同步后的 engine')
  console.log(`PREVIZ_SYNC_OK copied=${r.copied.length + r.updated.length} dest=${path.basename(dest)}`)
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
