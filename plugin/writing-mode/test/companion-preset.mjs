// 写作伙伴 preset 自举（A 方案）单测：
//   1. lib/companion-preset.js 导出齐全（id/name/description/plugins/PRESET）
//   2. 行为：临时 DSH_HOME 下调 ensureCompanionPreset() —— preset.yml 内容 == 模块 metadata，
//      agent.cordis.yml 字节 == lib/companion.cordis.yml，重复调用幂等（不覆盖已有文件）
//   3. 漂移门禁：scripts/sync-companion-preset.mjs 的 buildModuleText() 必须逐字节等于
//      已提交的 lib/companion-preset.js（改了 yml 必须重跑 sync，否则这里红）
//   4. 行内容：每行有 string id/name、无 __jsExpr 残留、平台开关行在 win32 求值正确
//
// 用法：node plugin/writing-mode/test/companion-preset.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(here, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-preset-'))
process.env.DSH_HOME = path.join(temp, 'home')

const preset = await import('../lib/companion-preset.js')
const { ensureCompanionPreset } = await import('../lib/store.js')
const sync = await import('../../../scripts/sync-companion-preset.mjs')

let pass = 0
const ok = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}

console.log('--- 模块导出')

ok('导出齐全且 id/name/description 为字符串', () => {
  assert.equal(typeof preset.COMPANION_PRESET_ID, 'string')
  assert.equal(typeof preset.COMPANION_PRESET_NAME, 'string')
  assert.equal(typeof preset.COMPANION_PRESET_DESCRIPTION, 'string')
  assert.ok(Array.isArray(preset.COMPANION_PRESET_PLUGINS))
  assert.equal(preset.COMPANION_PRESET.id, preset.COMPANION_PRESET_ID)
  assert.equal(preset.COMPANION_PRESET.name, preset.COMPANION_PRESET_NAME)
  assert.equal(preset.COMPANION_PRESET.description, preset.COMPANION_PRESET_DESCRIPTION)
  assert.equal(preset.COMPANION_PRESET.plugins, preset.COMPANION_PRESET_PLUGINS)
})

console.log('--- 行为：ensureCompanionPreset 落盘')

ok('临时 DSH_HOME 落盘：preset.yml == 模块 metadata，agent.cordis.yml == lib yml', () => {
  const id = ensureCompanionPreset()
  assert.equal(id, preset.COMPANION_PRESET_ID)
  const dir = path.join(process.env.DSH_HOME, '.agent-presets', id)
  const meta = fs.readFileSync(path.join(dir, 'preset.yml'), 'utf8')
  assert.equal(meta, `name: ${preset.COMPANION_PRESET_NAME}\ndescription: ${preset.COMPANION_PRESET_DESCRIPTION}\n`)
  const expected = fs.readFileSync(path.join(pluginRoot, 'lib', 'companion.cordis.yml'), 'utf8')
  assert.equal(fs.readFileSync(path.join(dir, 'agent.cordis.yml'), 'utf8'), expected)
})

ok('重复调用幂等：不覆盖用户已改的文件', () => {
  const dir = path.join(process.env.DSH_HOME, '.agent-presets', preset.COMPANION_PRESET_ID)
  fs.writeFileSync(path.join(dir, 'preset.yml'), 'name: 用户改过\n')
  ensureCompanionPreset()
  assert.equal(fs.readFileSync(path.join(dir, 'preset.yml'), 'utf8'), 'name: 用户改过\n')
})

console.log('--- 漂移门禁')

ok('buildModuleText() 逐字节等于已提交的 lib/companion-preset.js', () => {
  const committed = fs.readFileSync(path.join(pluginRoot, 'lib', 'companion-preset.js'), 'utf8')
  assert.equal(sync.buildModuleText(), committed,
    'lib/companion.cordis.yml 变了但没重跑 scripts/sync-companion-preset.mjs')
})

console.log('--- 行内容')

ok('每行有 string id/name，无 __jsExpr 残留', () => {
  assert.ok(preset.COMPANION_PRESET_PLUGINS.length >= 10, 'preset 行数异常少，疑似生成损坏')
  for (const row of preset.COMPANION_PRESET_PLUGINS) {
    assert.equal(typeof row.id, 'string', `行缺 id: ${JSON.stringify(row).slice(0, 80)}`)
    assert.equal(typeof row.name, 'string', `行缺 name: ${row.id}`)
    assert.ok(!JSON.stringify(row).includes('__jsExpr'), `行含未求值的 __jsExpr: ${row.id}`)
  }
})

ok('平台开关行求值正确（win32: bash 禁 / pwsh 启）', () => {
  if (process.platform !== 'win32') return
  const bash = preset.COMPANION_PRESET_PLUGINS.find(r => r.id === 'tool-bash')
  const pwsh = preset.COMPANION_PRESET_PLUGINS.find(r => r.id === 'tool-pwsh')
  assert.equal(bash.disabled, true)
  assert.equal(pwsh.disabled, false)
})

console.log(`companion-preset: ${pass} passed${process.exitCode ? ' (有失败)' : ''}`)
