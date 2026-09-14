// 外壳 UI 冒烟（含**主题开启/恢复**联动）——隔离运行，不碰用户正在用的实例。
// 方案 v1 的 A03/主题项要求："模式开关、重进、卸载/重载"与"主题开启和恢复两种行为"。
// 开发态没有安装包里的内置插件树，所以这里用**生产种子模块**（lib/builtin-seed.js +
// dist/builtin-plugins）把 palis 主题等内置插件种进隔离 profile，再落"作者已选 palis"的设置。
// 另外给真包留了 PM_UI_EXE：直接对解包产物跑同一套断言。
//
// 用法：node scripts/verify-ui-smoke.mjs           （开发态，隔离四路径）
//      WM_UI_EXE=<解包目录> node scripts/verify-ui-smoke.mjs  （真包）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ui-smoke-'))
const env = {
  ...process.env,
  DSH_DESKTOP_HOME: path.join(base, 'home'),
  DSH_DESKTOP_USER_DATA: path.join(base, 'user-data'),
  LOCALAPPDATA: path.join(base, 'localappdata'),
  DSH_HOME: path.join(base, 'home'),
}
for (const d of [env.DSH_DESKTOP_HOME, env.DSH_DESKTOP_USER_DATA, env.LOCALAPPDATA]) fs.mkdirSync(d, { recursive: true })

const exe = process.env.WM_UI_EXE ? path.join(process.env.WM_UI_EXE, 'win-unpacked', 'DeepSeek Harness Desktop.exe') : null
const useExe = Boolean(exe && fs.existsSync(exe))
const cli = path.join(ROOT, 'node_modules', 'electron', 'cli.js')
const spawnApp = (args) =>
  useExe
    ? spawnSync(exe, args, { env, encoding: 'utf8', timeout: 300000 })
    : spawnSync(process.execPath, [cli, '.', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 300000 })

// 1) 先跑一次 --smoke：让内核把 profile 初始化出来（种子要求 profile 清单存在）
const boot = spawnApp(['--smoke'])
const bootOk = /SMOKE_OK/.test(`${boot.stdout || ''}${boot.stderr || ''}`)

// 2) 用生产种子模块种入内置插件（开发态需要；真包正常启动也会自己做这件事）
let seedNote = ''
try {
  const seedDir = useExe
    ? path.join(process.env.WM_UI_EXE, 'win-unpacked', 'resources', 'builtin-plugins')
    : path.join(ROOT, 'dist', 'builtin-plugins')
  const profileDir = path.join(env.DSH_HOME, 'profiles', 'web')
  const stampPath = path.join(env.DSH_DESKTOP_USER_DATA, 'builtin-plugins-seeded.json')
  const { runSeed, needsSeed } = await import('../lib/builtin-seed.js')
  if (fs.existsSync(seedDir) && fs.existsSync(path.join(profileDir, 'package.json')) && needsSeed({ seedDir, profileDir, stampPath })) {
    const r = runSeed({ seedDir, profileDir, stampPath })
    seedNote = r.ok ? `已种入：${(r.addedPlugins || []).join(', ') || '(零改动)'}` : `种子失败：${r.error}`
  } else {
    seedNote = fs.existsSync(seedDir) ? '无需种子（stamp 已存在或 profile 未就绪）' : `内置插件树缺失：${seedDir}`
  }
} catch (err) {
  seedNote = '种子异常：' + (err?.message || err)
}

// 3) 落"作者已选 palis"，再跑两次 --ui-smoke（开启 × 恢复）
fs.writeFileSync(path.join(env.DSH_DESKTOP_USER_DATA, 'settings.json'), JSON.stringify({ theme: 'palis' }, null, 2))
const runs = [spawnApp(['--ui-smoke']), spawnApp(['--ui-smoke'])]
const outs = runs.map((r) => `${r.stdout || ''}${r.stderr || ''}`)
const okBoth = outs.every((o) => /UI_SMOKE_OK/.test(o))
const firstFail = outs.map((o) => (o.match(/UI_SMOKE_FAIL: ([^\n]*)/) || [])[1]).find(Boolean) || ''

console.log(`启动=${useExe ? exe : '开发态 electron .'}  首启就绪=${bootOk ? 'SMOKE_OK' : 'FAIL'}  种子=${seedNote}`)
console.log(`隔离路径：${base}`)
console.log(okBoth ? 'verify-ui-smoke: PASS（主题开启 × 恢复两次均 UI_SMOKE_OK）' : `verify-ui-smoke: FAIL — ${firstFail}`)
try {
  fs.rmSync(base, { recursive: true, force: true })
} catch {}
process.exit(okBoth ? 0 : 1)
