/**
 * Build plugin/workbench/client.js from src/ with esbuild.
 *
 * - Entry: plugin/workbench/src/client/entry.js（ESM；imports ./registry.js 等）
 * - react / react/jsx-runtime 保持 external：ModuleLoader 工厂的 `require` 解析宿主 React，
 *   绝不打进第二份（与 build-writing-client.mjs 同规矩）。
 * - Output: CJS bundle wrapped as window.__ModuleLoader__.load({id, factory})。
 * - 确定性：同输入 → 逐字节同输出（无时间戳、无绝对路径）；verify-workbench-build.mjs 守这条。
 *
 * Env: WB_BUILD_OUT=<path> 写到别处（verify:workbench-build 用，绝不覆盖仓库产物）
 * 生成物 — 改 src/，然后 npm run build:workbench
 */
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const ENTRY = path.join(root, 'plugin/workbench/src/client/entry.js')
const DEFAULT_OUT = path.join(root, 'plugin/workbench/client.js')
const PLUGIN_ID = '@dsh-local/workbench'

const banner = `/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/workbench/src/client/entry.js (+ ./registry.js, ./Entry.js, ./Chrome.js, ./Settings.js)
 * Build:  node scripts/build-workbench-client.mjs   (or npm run build:workbench)
 * Bundle: esbuild (CJS) wrapped as window.__ModuleLoader__.load factory body
 */
`

export async function buildWorkbenchClient(outFile) {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    metafile: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react/jsx-runtime'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    absWorkingDir: root,
  })
  const code = result.outputFiles[0].text.replace(/\n*$/, '\n')
  const bundled = Object.keys(result.metafile.inputs).filter((input) => input.replace(/\\/g, '/').includes('node_modules/'))
  if (bundled.length) {
    throw new Error(`workbench client 不应打包任何 node_modules 依赖，实际打包了：${bundled.join(', ')}`)
  }
  const factory =
    banner +
    'window.__ModuleLoader__.load({\n' +
    `  id: ${JSON.stringify(PLUGIN_ID)},\n` +
    '  factory: (require) => {\n' +
    '    var module = { exports: {} }\n' +
    '    var exports = module.exports\n' +
    '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })\n' +
    code +
    '    return module.exports\n' +
    '  },\n' +
    '})\n'
  const target = outFile || process.env.WB_BUILD_OUT
    ? path.resolve(outFile || process.env.WB_BUILD_OUT)
    : DEFAULT_OUT
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, factory, 'utf8')
  return { target, bytes: Buffer.byteLength(factory), lines: factory.split('\n').length }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const { target, bytes, lines } = await buildWorkbenchClient()
  console.log(`built ${path.relative(root, target)} (${bytes} bytes, ${lines} lines)`)
}
