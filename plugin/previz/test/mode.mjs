import assert from 'node:assert/strict'
import { registerPrevizMode } from '../src/client/mode.js'

let descriptor = null
const workbench = {
  registerMode: (d) => {
    descriptor = d
    return () => {}
  },
}
const dispose = registerPrevizMode(workbench)
assert.equal(typeof dispose, 'function')
assert.equal(descriptor.id, 'previz')
assert.equal(descriptor.label(), '预演')
assert.equal(descriptor.order, 40)
assert.equal(descriptor.mount, 'overlay')
assert.equal(typeof descriptor.runtime.probe, 'function')
assert.equal(typeof descriptor.runtime.start, 'function')
assert.equal(typeof descriptor.runtime.subscribe, 'function')
assert.equal(typeof descriptor.jobs.list, 'function')
assert.equal(typeof descriptor.jobs.cancel, 'function')
assert.equal(typeof descriptor.jobs.subscribe, 'function')
assert.equal(typeof descriptor.artifacts.list, 'function')
assert.equal(typeof descriptor.artifacts.open, 'function')
assert.ok(descriptor.splice && descriptor.splice.view, 'splice.view 应在')
assert.equal(descriptor.splice.width, 960)
assert.ok(descriptor.tile && descriptor.tile.view, 'tile.view 应在')
const ctx = descriptor.context.get()
assert.equal(ctx.kind, 'previz')
assert.equal(ctx.project, 'boutique')
console.log('PREVIZ_MODE_OK descriptor 字段齐全（runtime/jobs/artifacts/splice/tile/context）')
