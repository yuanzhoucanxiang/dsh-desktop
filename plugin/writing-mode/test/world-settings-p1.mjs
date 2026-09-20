/**
 * P1: schema2 / setting / idempotency / projection / migration.
 * node plugin/writing-mode/test/world-settings-p1.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  emptyEtag,
  readMemory,
  applyMemoryOp,
  memoryApiPayload,
  getOperationReceipt,
  MEMORY_SCHEMA,
} from '../lib/project-memory.js'
import {
  renderSettingProjection,
  writeSettingProjection,
  hashText,
  PROJECTION_REL,
} from '../lib/setting-projection.js'
import {
  deriveSettingText,
  parseOrganizeResult,
  settingInjectUnit,
  rankWorldSettingIds,
  normalizeSetting,
} from '../src/shared/world-setting.js'

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ws-'))
const project = path.join(root, 'lib', 'Proj')
fs.mkdirSync(path.join(project, 'state'), { recursive: true })

const settingA = {
  type: 'world',
  title: '夜间航行',
  conclusion: '雾季入夜后港口停止民船出航。',
  explanation: '雾季能见度差，民船无强制导航设备。救援船例外见边界。',
  boundaries: '救援船获得许可后可以出航。',
  tags: ['港口', '雾季'],
  sources: [{ sessionId: 's1', messageId: 'm1', role: 'author', excerpt: '讨论夜航', snapshotHash: 'h1' }],
}

ok('derive text includes boundary', deriveSettingText(settingA).includes('边界/例外：救援船'))
ok('inject unit omits explanation', !settingInjectUnit({ id: 'x', kind: 'fact', status: 'confirmed', setting: settingA })?.text?.includes('能见度'))

// empty etag protocol → first write creates schema 2
const opId = 'op-create-1'
const reqHash = 'hash-1'
const r1 = applyMemoryOp(project, {
  op: 'confirm-setting',
  baseRevision: 0,
  baseEtag: emptyEtag(),
  item: { kind: 'fact', setting: settingA },
  actor: 'author',
  operationId: opId,
  requestHash: reqHash,
  clientSchemaVersion: 2,
})
ok('confirm creates item', r1.memory.items.length === 1 && r1.memory.items[0].status === 'confirmed')
ok('schema is 2', r1.memory.schemaVersion === MEMORY_SCHEMA)
ok('text derived', r1.memory.items[0].text.includes('雾季入夜'))
ok('projection pending', r1.memory.projection.status === 'pending')
ok('receipt recorded', r1.receipt?.operationId === opId)

// idempotent replay
const r2 = applyMemoryOp(project, {
  op: 'confirm-setting',
  baseRevision: 0,
  baseEtag: emptyEtag(),
  item: { kind: 'fact', setting: settingA },
  operationId: opId,
  requestHash: reqHash,
  clientSchemaVersion: 2,
})
ok('replay returns receipt no new item', r2.replay === true && r2.memory.items.length === 1)

// same opId different payload → 409
let conflict = null
try {
  applyMemoryOp(project, {
    op: 'confirm-setting',
    baseRevision: r1.memory.revision,
    baseEtag: r1.etag,
    item: { kind: 'fact', setting: { ...settingA, conclusion: '改了' } },
    operationId: opId,
    requestHash: 'other-hash',
    clientSchemaVersion: 2,
  })
} catch (e) {
  conflict = e
}
ok('operation-conflict', conflict?.code === 'operation-conflict', conflict?.code)

// old client cannot strip setting
let upgrade = null
try {
  applyMemoryOp(project, {
    op: 'update',
    baseRevision: r1.memory.revision,
    baseEtag: r1.etag,
    id: r1.memory.items[0].id,
    item: { text: '抹掉' },
  })
} catch (e) {
  upgrade = e
}
ok('upgrade-required for legacy update on setting', upgrade?.code === 'upgrade-required', upgrade?.code)

// Editing a confirmed item must not demote its live version.
let demotion
try {
  applyMemoryOp(project, { op: 'save-setting-candidate', baseRevision: r1.memory.revision, baseEtag: r1.etag, id: r1.memory.items[0].id, item: { setting: settingA }, operationId: 'demote', clientSchemaVersion: 2 })
} catch (err) { demotion = err }
ok('confirmed revision stays live until author confirms', demotion?.code === 'confirmed-edit-requires-confirmation' && readMemory(project).memory.items[0].status === 'confirmed')
const r3 = readMemory(project)

// confirm edit again
const r4 = applyMemoryOp(project, {
  op: 'confirm-setting',
  baseRevision: r3.memory.revision,
  baseEtag: r3.etag,
  id: r3.memory.items[0].id,
  item: { setting: { ...settingA, conclusion: '修订中的结论。' } },
  actor: 'author',
  operationId: 'op-confirm-2',
  requestHash: 'hash-c2',
  clientSchemaVersion: 2,
})
ok('reconfirm', r4.memory.items[0].status === 'confirmed' && r4.memory.items[0].text.includes('修订中的结论'))

// projection render + write
const content = renderSettingProjection(r4.memory.items, { sourceRevision: r4.memory.revision, generatedAt: 'T' })
ok('projection markdown has title', content.includes('## 夜间航行') && content.includes('修订中的结论'))
ok('projection has managed note', content.includes('由已确认设定生成'))
const written = writeSettingProjection(project, content, { managedHash: null, sourceRevision: r4.memory.revision })
ok('projection file written', fs.existsSync(path.join(project, PROJECTION_REL)) && written.hash === hashText(content))

// author manuscript conflict
const manual = path.join(project, 'bible', '手稿冲突.md')
fs.mkdirSync(path.dirname(manual), { recursive: true })
// simulate author file at projection path without managed note
const projAbs = path.join(project, PROJECTION_REL)
fs.writeFileSync(projAbs, '# 我的手写世界观\n绝不能被覆盖\n', 'utf8')
let pconf = null
try {
  writeSettingProjection(project, content, { managedHash: null })
} catch (e) {
  pconf = e
}
ok('projection-conflict on author manuscript', pconf?.code === 'projection-conflict', pconf?.code)

// restore managed projection via known hash
const authorHash = hashText(fs.readFileSync(projAbs, 'utf8'))
// managedHash matches author file? we treat as external edit conflict
let pconf2 = null
try {
  writeSettingProjection(project, content, { managedHash: hashText('# 旧受管\n') })
} catch (e) {
  pconf2 = e
}
ok('external edit conflict when hash differs', pconf2?.code === 'projection-conflict', pconf2?.code)
void authorHash
void manual

// rewrite properly with managed hash of current author file → still conflict (not managed content)
// write when managedHash equals current file hash → allowed replace
const r5 = writeSettingProjection(project, content, { managedHash: hashText(fs.readFileSync(projAbs, 'utf8')), sourceRevision: r4.memory.revision })
ok('managed replace works', r5.hash === hashText(content) && fs.readFileSync(projAbs, 'utf8').includes('修订中的结论'))

// host flow: mark projection synced in memory
const r5m = applyMemoryOp(project, {
  op: 'update-projection',
  baseRevision: r4.memory.revision,
  baseEtag: r4.etag,
  projection: {
    path: PROJECTION_REL,
    status: 'synced',
    managedHash: r5.hash,
    sourceRevision: r4.memory.revision,
    lastError: null,
  },
})
ok('projection meta synced', r5m.memory.projection.status === 'synced' && r5m.memory.projection.managedHash === r5.hash)

// memory-api payload
const api = memoryApiPayload(project)
ok('api capabilities', api.capabilities?.worldSettings === true && api.schemaVersion === 2)
ok('api projection synced hash', api.projection.managedHash === r5.hash)

// operation query
const receipt = getOperationReceipt(readMemory(project).memory, opId)
ok('get receipt', receipt?.itemId === r1.memory.items[0].id)

// schema1 migration
const p2 = path.join(root, 'lib', 'OldProj')
fs.mkdirSync(path.join(p2, 'state'), { recursive: true })
const schema1 = {
  schemaVersion: 1,
  revision: 3,
  projectKey: p2,
  items: [
    {
      id: 'old-1',
      kind: 'preference',
      status: 'confirmed',
      text: '喜欢短句',
      source: { kind: 'author' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  changes: [],
}
fs.writeFileSync(path.join(p2, 'state', 'writing-memory.json'), JSON.stringify(schema1, null, 2))
const before = readMemory(p2)
ok('schema1 read ok', before.memory.schemaVersion === 1 && before.memory.items[0].text === '喜欢短句')
const mig = applyMemoryOp(p2, {
  op: 'add',
  baseRevision: before.memory.revision,
  baseEtag: before.etag,
  item: { kind: 'fact', status: 'proposed', text: '迁移后新增' },
  actor: 'author',
})
ok('migrated to schema2 on write', mig.memory.schemaVersion === 2)
ok('legacy item preserved', mig.memory.items.some((it) => it.id === 'old-1' && it.text === '喜欢短句'))
ok('backup exists', fs.readdirSync(path.join(p2, 'state', 'backups')).length >= 1)

// organize parse allowlist
const org = parseOrganizeResult({
  schemaVersion: 1,
  confirmed: true,
  targetPath: 'C:/evil',
  settings: [
    { title: 'A', conclusion: 'B', explanation: '长说明可以', mark: 'suggestion' },
    { title: '', conclusion: '' },
  ],
})
ok('parse keeps valid settings', org.ok && org.settings.length === 1 && org.settings[0].title === 'A')
ok('parse rejects empty title', org.rejected.length === 1)
ok('parse ignores model authority', org.ignoredAuthority === true)

// rank
const items = [
  { id: 'b', kind: 'fact', status: 'confirmed', setting: { type: 'world', title: '港口', conclusion: 'x', tags: ['雾季'] } },
  { id: 'a', kind: 'fact', status: 'confirmed', setting: { type: 'world', title: '无关', conclusion: 'y', tags: [] } },
]
const ranked = rankWorldSettingIds(items, '关于港口和雾季的讨论')
ok('rank puts tag match first', ranked[0]?.id === 'b', JSON.stringify(ranked))

// long explanation allowed (not hard 2-4 sentences)
let longOk = true
try {
  normalizeSetting({ type: 'world', title: 'T', conclusion: 'C', explanation: '一。'.repeat(50) })
} catch {
  longOk = false
}
ok('long explanation allowed', longOk)

// capacity 413
let tooLong = null
try {
  normalizeSetting({ type: 'world', title: 'T', conclusion: 'C', explanation: 'x'.repeat(20000) })
} catch (e) {
  tooLong = e
}
ok('413 setting-too-long', tooLong?.code === 'setting-too-long' && tooLong.status === 413, tooLong?.code)

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
