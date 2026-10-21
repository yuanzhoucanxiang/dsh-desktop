/**
 * Build plugin/previz/client.js from src/ with esbuild.
 *
 * - Entry: plugin/previz/src/client/entry.js
 * - react 保持 external（ModuleLoader 解析宿主 React，绝不打第二份）
 * - Output: CJS bundle wrapped as window.__ModuleLoader__.load({id, factory})
 * - Deterministic: same input → byte-identical output.
 *
 * Env: PV_BUILD_OUT=<path> write elsewhere (verify uses this; never overwrites repo output)
 */
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const ENTRY = path.join(root, 'plugin/previz/src/client/entry.js')
const DEFAULT_OUT = path.join(root, 'plugin/previz/client.js')
const PLUGIN_ID = '@dsh-local/previz'

const banner = `/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/previz/src/client/entry.js (+ ./PrevizPanel.js, ./PrevizEntry.js, ./PrevizOverlay.js, ./mode.js, ./store.js, ./api.js)
 * Build:  node scripts/build-previz-client.mjs   (or npm run build:previz)
 * Bundle: esbuild (CJS) wrapped as window.__ModuleLoader__.load factory body
 */
`

export async function buildPrevizClient(outFile) {
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
    throw new Error(`previz client 不应打包任何 node_modules 依赖，实际打包了：${bundled.join(', ')}`)
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
  const target = outFile || process.env.PV_BUILD_OUT
    ? path.resolve(outFile || process.env.PV_BUILD_OUT)
    : DEFAULT_OUT
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, factory, 'utf8')
  return { target, bytes: Buffer.byteLength(factory), lines: factory.split('\n').length }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const { target, bytes, lines } = await buildPrevizClient()
  console.log(`built ${path.relative(root, target)} (${bytes} bytes, ${lines} lines)`)
}
