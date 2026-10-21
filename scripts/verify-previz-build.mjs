/** 构建一致性：同输入 → 与仓库 client.js 逐字节一致。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildPrevizClient } from './build-previz-client.mjs'

const repo = path.resolve('plugin/previz/client.js')
const out = path.join(os.tmpdir(), `dsh-previz-build-${process.pid}.js`)
const result = await buildPrevizClient(out)
const a = fs.readFileSync(out)
const b = fs.readFileSync(repo)
assert.equal(a.length, b.length, `size mismatch: built ${a.length} vs repo ${b.length}`)
assert.ok(a.equals(b), 'built client.js is not byte-identical to repo client.js')
console.log(`PREVIZ_BUILD_OK (${result.bytes} bytes, 逐字节一致)`)
