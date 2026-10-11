/**
 * 构建确定性门禁：把 client.js 重新构建到临时文件，与仓库里的产物**逐字节**比对。
 * 同输入必须同输出（esbuild 配置里没有时间戳/绝对路径），否则说明有人手改了产物
 * 或构建环境漂移——两者都该拦下来。
 *
 * 跑法：node scripts/verify-workbench-build.mjs   （npm run verify:workbench-build）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkbenchClient } from './build-workbench-client.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const committed = path.join(root, 'plugin/workbench/client.js')

const failures = []
function check(name, ok, detail = '') {
  if (ok) return
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

check('产物存在', fs.existsSync(committed), committed)
if (fs.existsSync(committed)) {
  const text = fs.readFileSync(committed, 'utf8')
  check('产物是 ModuleLoader 工厂体', text.includes('window.__ModuleLoader__.load('))
  check('产物 id 正确', text.includes('"@dsh-local/workbench"'))
  check('产物是生成物（带 GENERATED 头）', text.includes('GENERATED FILE'))
  check('产物没有打包 node_modules', !/Bundled dependency:/.test(text))
  check('产物没有绝对路径泄漏', !/E:\\\\Deepseek harness/.test(text))
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workbench-build-'))
const out = path.join(tempDir, 'client.js')
const { bytes } = await buildWorkbenchClient(out)
const fresh = fs.readFileSync(out, 'utf8')
const current = fs.existsSync(committed) ? fs.readFileSync(committed, 'utf8') : ''
check('重建结果与仓库产物逐字节一致', fresh === current, `fresh=${bytes}B committed=${Buffer.byteLength(current)}B（改过 src/ 后请跑 npm run build:workbench）`)

fs.rmSync(tempDir, { recursive: true, force: true })

if (failures.length) {
  console.error('WORKBENCH_BUILD_FAIL')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`WORKBENCH_BUILD_OK (${bytes} bytes, 逐字节一致)`)
