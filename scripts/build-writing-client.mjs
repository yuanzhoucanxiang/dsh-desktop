/**
 * Build plugin/writing-mode/client.js from src/ with esbuild (real module bundling).
 *
 * - Entry: plugin/writing-mode/src/client/entry.js (ESM; imports ../shared/* and features)
 * - react / react/jsx-runtime stay external: the ModuleLoader factory's `require`
 *   resolves the host React — never bundle a second copy.
 * - Output: CJS bundle wrapped as window.__ModuleLoader__.load({id, factory}).
 * - Deterministic: same input → byte-identical output (no timestamps, no absolute paths).
 *   Two consecutive builds must match; scripts/verify-writing-build.mjs enforces this.
 *
 * Env: WM_BUILD_OUT=<path>  write elsewhere (verify:writing-build uses this; it never overwrites)
 * Generated product — edit src/, then: npm run build:writing
 */
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const ENTRY = path.join(root, 'plugin/writing-mode/src/client/entry.js')
const DEFAULT_OUT = path.join(root, 'plugin/writing-mode/client.js')
const PLUGIN_ID = '@dsh-local/writing-mode'

const banner = `/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/writing-mode/src/client/entry.js (+ ../shared, features/…)
 * Build:  node scripts/build-writing-client.mjs   (or npm run build:writing)
 * Bundle: esbuild (CJS) wrapped as window.__ModuleLoader__.load factory body
 */
`

export async function buildWritingClient(outFile) {
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
  // The parser is bundled into the single published client. Carry the notices
  // of exactly those packages whose sources esbuild included, in stable order.
  const notices = new Map()
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.replace(/\\/g, '/').includes('node_modules/')) continue
    let dir = path.dirname(path.resolve(root, input))
    while (dir !== root && dir !== path.dirname(dir)) {
      const metadata = path.join(dir, 'package.json')
      if (fs.existsSync(metadata)) {
        const pkg = JSON.parse(fs.readFileSync(metadata, 'utf8'))
        const key = `${pkg.name}@${pkg.version}`
        if (!notices.has(key)) {
          const license = fs.readdirSync(dir).sort().find(name => /^licen[cs]e(?:\.md|\.txt)?$/i.test(name))
          if (!license) throw new Error(`Missing bundled license: ${key}`)
          notices.set(key, fs.readFileSync(path.join(dir, license), 'utf8').replace(/\r\n/g, '\n').trim())
        }
        break
      }
      dir = path.dirname(dir)
    }
  }
  const attribution = [...notices].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, text]) =>
    `/*! Bundled dependency: ${name}\n${text.replace(/\*\//g, '* /')}\n*/\n`).join('')
  const factory =
    banner +
    attribution +
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
  const target = outFile || process.env.WM_BUILD_OUT
    ? path.resolve(outFile || process.env.WM_BUILD_OUT)
    : DEFAULT_OUT
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, factory, 'utf8')
  return { target, bytes: Buffer.byteLength(factory), lines: factory.split('\n').length }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const { target, bytes, lines } = await buildWritingClient()
  console.log(`built ${path.relative(root, target)} (${bytes} bytes, ${lines} lines)`)
}
