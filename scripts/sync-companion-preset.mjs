#!/usr/bin/env node
/**
 * 由 plugin/writing-mode/lib/companion.cordis.yml 生成 lib/companion-preset.js。
 *
 * 单一事实源 = yml（0.1.1 的 ~/.dsh/.agent-presets 目录扫描仍吃它）；
 * 0.1.7 内核不再扫描该目录，preset 需向 agentPresets 注册表编程注册，
 * 本模块就是注册用的行表。`!!js` 表达式转为加载时求值的活表达式
 * （与 cordis-plugin-loader 的插值语义一致：加载即对当前平台求值一次）。
 *
 * 用法：node scripts/sync-companion-preset.mjs        # 重写 lib/companion-preset.js
 * 漂移门禁：plugin/writing-mode/test/companion-preset.mjs（调用 buildModuleText 对比）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const YML = path.join(repo, 'plugin/writing-mode/lib/companion.cordis.yml')
const OUT = path.join(repo, 'plugin/writing-mode/lib/companion-preset.js')

export const PRESET_ID = 'writing-companion'
export const PRESET_NAME = '写作伙伴'
export const PRESET_DESCRIPTION = '与作者持续交流，按需使用工具与项目资料。'

/** `!!js` → 哨兵对象（序列化时还原为活表达式）。 */
const JsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: data => ({ __jsExpr: String(data) }),
})
const SCHEMA = (yaml.DEFAULT_SCHEMA || yaml.DEFAULT).extend([JsExprType])

export function parseRows(ymlText = fs.readFileSync(YML, 'utf8')) {
  const rows = yaml.load(ymlText, { schema: SCHEMA })
  if (!Array.isArray(rows) || !rows.length) throw new Error('companion.cordis.yml 不是非空行表')
  return rows
}

function isIdent(key) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) }

function emit(value, level) {
  const pad = '  '.repeat(level)
  const padIn = '  '.repeat(level + 1)
  if (value && typeof value === 'object' && '__jsExpr' in value) return String(value.__jsExpr)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return '[\n' + value.map(item => padIn + emit(item, level + 1)).join(',\n') + '\n' + pad + ']'
  }
  const keys = Object.keys(value)
  if (!keys.length) return '{}'
  return '{\n' + keys.map(k => padIn + (isIdent(k) ? k : JSON.stringify(k)) + ': ' + emit(value[k], level + 1)).join(',\n') + '\n' + pad + '}'
}

export function buildModuleText() {
  const rows = parseRows()
  return `/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/writing-mode/lib/companion.cordis.yml（单一事实源）
 * Regen:  node scripts/sync-companion-preset.mjs
 * 漂移门禁: plugin/writing-mode/test/companion-preset.mjs
 *
 * 0.1.7 内核不再扫描 ~/.dsh/.agent-presets：preset 改为向 agentPresets 注册表
 * 编程注册（host index.js 的 ensurePresetRegistered）。yml 里的 \`!!js\` 在此
 * 是加载时求值的活表达式，语义与 cordis-plugin-loader 一致。
 */
export const COMPANION_PRESET_ID = ${JSON.stringify(PRESET_ID)}
export const COMPANION_PRESET_NAME = ${JSON.stringify(PRESET_NAME)}
export const COMPANION_PRESET_DESCRIPTION = ${JSON.stringify(PRESET_DESCRIPTION)}

export const COMPANION_PRESET_PLUGINS = ${emit(rows, 0)}

export const COMPANION_PRESET = {
  id: COMPANION_PRESET_ID,
  name: COMPANION_PRESET_NAME,
  description: COMPANION_PRESET_DESCRIPTION,
  plugins: COMPANION_PRESET_PLUGINS,
}
`
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  fs.writeFileSync(OUT, buildModuleText())
  console.log('companion-preset.js regenerated from', path.relative(repo, YML))
}
