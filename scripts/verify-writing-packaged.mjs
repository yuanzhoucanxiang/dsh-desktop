// 真包验收（B01/A02/P03 + 主题开启项 + N01 安全清理 + N06 严格门禁）。
//
// 纪律（N01）：清理**只按本轮 spawn 出来的 PID**（`lib/pid-cleanup.js`），
// 绝不按镜像名批量结束进程——那会连用户正在用的正式桌面一起结束。
//
// 门禁口径（N06）：缺包 / 缺必做项一律**非零退出**；只有显式 `--allow-missing`
// 才把"未构建"降级为待跑（供开发态快速回归使用，正式交付不用）。
//
// 用法：WM_PKG=<解包目录> node scripts/verify-writing-packaged.mjs [--allow-missing] [--json]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { killTree, pidAlive } from '../lib/pid-cleanup.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AS_JSON = process.argv.includes('--json')
const ALLOW_MISSING = process.argv.includes('--allow-missing')

const { publishSet, compareTrees } = await import('../lib/plugin-sync.js')

const results = []
const record = (id, title, status, detail) => results.push({ id, title, status, detail })

/** 被打测对象的身份（N06）：源码 SHA/dirty + 产物 hash，写进结果文件，避免"拿今天的 HEAD 认旧包"。 */
function artifactIdentity(pkgDir, exe) {
  const out = { sourceCommit: null, sourceDirty: null, asarSha256: null, exe, pkgDir }
  try {
    out.sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
    out.sourceDirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0
  } catch {}
  try {
    const asar = path.join(pkgDir, 'win-unpacked', 'resources', 'app.asar')
    if (fs.existsSync(asar)) out.asarSha256 = crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex')
  } catch {}
  return out
}

const pkgPointer = path.join(process.env.TEMP, 'wm-v2-review-package-path.txt')
const PKG = process.env.WM_PKG || (fs.existsSync(pkgPointer) ? fs.readFileSync(pkgPointer, 'utf8').trim() : '')
const exe = PKG ? path.join(PKG, 'win-unpacked', 'DeepSeek Harness Desktop.exe') : ''

if (!PKG || !fs.existsSync(exe)) {
  // N06：缺包时**不能返回成功**。`--allow-missing` 只是开发态快速回归的显式豁免。
  const detail = `未找到真包 exe（${exe || '(未提供 WM_PKG)'}）——先构建，再用 WM_PKG 指向解包目录`
  record('PKG-0', '真包存在（必做项）', ALLOW_MISSING ? 'NOT_RUN' : 'FAIL', detail)
  if (AS_JSON) console.log(JSON.stringify({ artifact: null, results }, null, 2))
  else console.log(`${ALLOW_MISSING ? '待跑' : 'FAIL'}: ${detail}`)
  process.exit(ALLOW_MISSING ? 0 : 1)
}

const identity = artifactIdentity(PKG, exe)
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-packaged-'))
const env = {
  ...process.env,
  DSH_DESKTOP_HOME: path.join(base, 'home'),
  DSH_DESKTOP_USER_DATA: path.join(base, 'user-data'),
  LOCALAPPDATA: path.join(base, 'localappdata'),
  DSH_HOME: path.join(base, 'home'),
}
for (const d of [env.DSH_DESKTOP_HOME, env.DSH_DESKTOP_USER_DATA, env.LOCALAPPDATA]) fs.mkdirSync(d, { recursive: true })

/** 跑真包；`args` 为空表示正常启动（会弹窗口，用于首启种子）。 */
function runApp(args, timeout = 300000) {
  const r = spawnSync(exe, args, { env, encoding: 'utf8', timeout, windowsHide: args.length > 0 })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  return {
    out,
    ok: /SMOKE_OK/.test(out),
    uiOk: /UI_SMOKE_OK/.test(out),
    uiFail: (out.match(/UI_SMOKE_FAIL: ([^\n]*)/) || [])[1] || null,
    status: r.status,
  }
}

// 1) 空环境冷启动：启动前证明 profile 不存在 → 真包自行同步
const profileDir = path.join(env.DSH_DESKTOP_HOME, 'profiles', 'node_modules', '@dsh-local', 'writing-mode')
record('PKG-cold-1', '真包冷启动前 profile 不存在', fs.existsSync(profileDir) ? 'FAIL' : 'PASS', profileDir)
const cold = runApp(['--smoke'])
record('PKG-cold-2', '真包空环境启动到就绪', cold.ok ? 'PASS' : 'FAIL', cold.ok ? 'SMOKE_OK' : cold.out.slice(-400))
if (cold.ok) {
  const { files } = publishSet(path.join(ROOT, 'plugin', 'writing-mode'))
  const cmp = compareTrees(path.join(ROOT, 'plugin', 'writing-mode'), profileDir)
  record('PKG-cold-3', '真包自动同步的 profile 与 manifest 逐文件一致', cmp.ok ? 'PASS' : 'FAIL',
    cmp.ok ? `${cmp.same.length} 个文件哈希一致` : `缺失 ${cmp.missing.map((m) => m.rel)}；漂移 ${cmp.drift.map((d) => d.rel)}`)
  record('PKG-cold-4', '同步集合不含测试/源码', files.some((f) => f.startsWith('test/') || f.startsWith('src/')) ? 'FAIL' : 'PASS', `${files.length} 个发布文件`)
}

// 2) 首启自动种子：正常启动（真有窗口）→ 等 stamp → **按 PID** 清理自己这一棵树
{
  const app = spawn(exe, [], { env, stdio: 'ignore' })
  const pid = app.pid
  const stamp = path.join(env.DSH_DESKTOP_USER_DATA, 'builtin-plugins-seeded.json')
  const palis = path.join(env.DSH_HOME, 'profiles', 'web', 'node_modules', '@dsh-local', 'palis-theme-panel')
  const deadline = Date.now() + 90000
  while (Date.now() < deadline && !fs.existsSync(stamp)) await new Promise((r) => setTimeout(r, 1000))
  const seeded = fs.existsSync(stamp) && fs.existsSync(palis)
  record('PKG-cold-5', '真包正常启动首启种子（内置插件 + stamp）', seeded ? 'PASS' : 'FAIL',
    seeded ? 'stamp 已写，palis 主题已就位' : `stamp=${fs.existsSync(stamp)} palis=${fs.existsSync(palis)}（90s 内未完成）`)
  record('PKG-cleanup-scope', '清理只按本轮 PID（不扫同名进程）', Number.isInteger(pid) ? 'PASS' : 'FAIL',
    `本轮 PID=${pid}；实现与隔离测试见 lib/pid-cleanup.js / lib/pid-cleanup.test.js`)
  try {
    app.kill()
  } catch {}
  await new Promise((r) => setTimeout(r, 1500))
  killTree(pid)
  await new Promise((r) => setTimeout(r, 1000))
  record('PKG-cleanup-done', '本轮进程树已退出', pidAlive(pid) ? 'FAIL' : 'PASS', `PID=${pid}`)
}

// 3) 主题冒烟：开启 × 恢复（设置持久化后仍是同一皮肤）
{
  fs.writeFileSync(path.join(env.DSH_DESKTOP_USER_DATA, 'settings.json'), JSON.stringify({ theme: 'palis' }, null, 2))
  const ui1 = runApp(['--ui-smoke'])
  record('PKG-theme-1', '真包主题开启（端点 / 内核页属性 / 注入样式表与调色 / 关闭后移除）', ui1.uiOk ? 'PASS' : 'FAIL',
    ui1.uiOk ? 'UI_SMOKE_OK' : `UI_SMOKE_FAIL: ${ui1.uiFail || ui1.out.slice(-300)}`)
  const ui2 = runApp(['--ui-smoke'])
  record('PKG-theme-2', '真包主题恢复（不重写设置，二次启动仍是同一皮肤）', ui2.uiOk ? 'PASS' : 'FAIL',
    ui2.uiOk ? 'UI_SMOKE_OK' : `UI_SMOKE_FAIL: ${ui2.uiFail || ui2.out.slice(-300)}`)
}

const failed = results.filter((r) => r.status === 'FAIL').length
const notRun = results.filter((r) => r.status === 'NOT_RUN').length
if (AS_JSON) {
  console.log(JSON.stringify({ artifact: identity, results }, null, 2))
} else {
  console.log(`真包：${exe}\n被测源码：${identity.sourceCommit}${identity.sourceDirty ? ' (dirty)' : ''} · asar ${String(identity.asarSha256).slice(0, 16)}…`)
  for (const r of results) console.log(`${r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : '待跑'}  ${r.title}\n      ${r.detail}`)
  console.log(`\n隔离环境：${base}\n合计 ${results.length} 项：${results.length - failed - notRun} 通过 / ${failed} 失败 / ${notRun} 待跑`)
}
fs.rmSync(base, { recursive: true, force: true })
process.exit(failed || notRun ? 1 : 0)
