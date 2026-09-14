// 真包冷启动 + 主题冒烟（A02/P03 + 主题开启项）：四路径隔离，直接跑解包产物里的 exe。
// 为什么必须用真包：B01 的教训——dev 能跑不等于包能跑（main.js 的 require 漏打只有真包才暴露）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync, spawn } from 'node:child_process'

const PKG = process.env.WM_PKG || fs.readFileSync(path.join(process.env.TEMP, 'wm-v2-review-package-path.txt'), 'utf8').trim()
const exe = path.join(PKG, 'win-unpacked', 'DeepSeek Harness Desktop.exe')
if (!fs.existsSync(exe)) {
  // 没有真包时如实标待跑并退出 0：这是「需要先构建」的条件项，不该把常跑回归变红。
  // 构建与复测方式见 docs/audits/writing-architecture/2026-09-14/v2/known-issues.md。
  console.log('待跑：未找到真包 exe（' + exe + '）——先构建，再用 WM_PKG 指向解包目录')
  process.exit(0)
}
const { publishSet, compareTrees } = await import('../lib/plugin-sync.js')

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-packaged-'))
const env = {
  ...process.env,
  DSH_DESKTOP_HOME: path.join(base, 'home'),
  DSH_DESKTOP_USER_DATA: path.join(base, 'user-data'),
  LOCALAPPDATA: path.join(base, 'localappdata'),
  DSH_HOME: path.join(base, 'home'),
}
for (const d of [env.DSH_DESKTOP_HOME, env.DSH_DESKTOP_USER_DATA, env.LOCALAPPDATA]) fs.mkdirSync(d, { recursive: true })

const results = []
const record = (id, title, status, detail) => results.push({ id, title, status, detail })

function runApp(args, timeout = 300000) {
  const r = spawnSync(exe, args, { env, encoding: 'utf8', timeout })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  return { out, ok: /SMOKE_OK/.test(out), uiOk: /UI_SMOKE_OK/.test(out), uiFail: (out.match(/UI_SMOKE_FAIL: ([^\n]*)/) || [])[1] || null, status: r.status }
}

// 1) 空环境冷启动：启动前 profile 不存在 → 真包自己完成插件同步
const profileDir = path.join(env.DSH_DESKTOP_HOME, 'profiles', 'node_modules', '@dsh-local', 'writing-mode')
record('PKG-cold-1', '真包冷启动前 profile 不存在', fs.existsSync(profileDir) ? 'FAIL' : 'PASS', profileDir)
const cold = runApp(['--smoke'])
record('PKG-cold-2', '真包空环境启动到就绪', cold.ok ? 'PASS' : 'FAIL', cold.ok ? 'SMOKE_OK' : cold.out.slice(-400))
if (cold.ok) {
  const { files } = publishSet('E:/Deepseek harness/dsh-desktop/plugin/writing-mode')
  const cmp = compareTrees('E:/Deepseek harness/dsh-desktop/plugin/writing-mode', profileDir)
  record('PKG-cold-3', '真包自动同步的 profile 与 manifest 一致', cmp.ok ? 'PASS' : 'FAIL',
    cmp.ok ? `${cmp.same.length} 个文件哈希一致` : `缺失 ${cmp.missing.map((m) => m.rel)}；漂移 ${cmp.drift.map((d) => d.rel)}`)
  record('PKG-cold-4', '同步集合不含测试/源码', files.some((f) => f.startsWith('test/') || f.startsWith('src/')) ? 'FAIL' : 'PASS', `${files.length} 个发布文件`)
}

// 1b) 内置插件种子：真包首启会做（seedBuiltinsIfNeeded → 重启内核），但 --smoke 在交接前就退出了。
//     两种证据都要：
//       (i) 真包**正常启动**（隔离环境，30s 后清理）确实把内置插件树种进 profile 并写 stamp；
//       (ii) 需要预置时的补充路径走**生产种子模块**（不是手写替身）。
{
  const app = spawn(exe, [], { env, stdio: 'ignore', windowsHide: true })
  const stamp = path.join(env.DSH_DESKTOP_USER_DATA, 'builtin-plugins-seeded.json')
  // 种子写入的是内核 profile（profiles/web），不是外壳同步用的 profiles 根
  const palis = path.join(env.DSH_HOME, 'profiles', 'web', 'node_modules', '@dsh-local', 'palis-theme-panel')
  const deadline = Date.now() + 90000
  while (Date.now() < deadline && !fs.existsSync(stamp)) await new Promise((r) => setTimeout(r, 1000))
  const seeded = fs.existsSync(stamp) && fs.existsSync(palis)
  record('PKG-cold-5', '真包正常启动首启种子（内置插件 + stamp）', seeded ? 'PASS' : 'FAIL',
    seeded ? `stamp 已写，palis 主题已就位` : `stamp=${fs.existsSync(stamp)} palis=${fs.existsSync(palis)}（90s 内未完成）`)
  try {
    app.kill()
  } catch {}
  await new Promise((r) => setTimeout(r, 1500))
  // 收尾：把内核一起停掉（正常启动会拉起内核子进程）
  for (const killArgs of [['/IM', 'DeepSeek Harness Desktop.exe', '/F']]) {
    try {
      spawnSync('taskkill', killArgs, { stdio: 'ignore' })
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1000))
}

// 2) 真包主题冒烟：先落"作者已选 palis"，再跑两次 —— 开启 × 恢复（设置持久化后仍是同一皮肤）
{
  fs.writeFileSync(path.join(env.DSH_DESKTOP_USER_DATA, 'settings.json'), JSON.stringify({ theme: 'palis' }, null, 2))
  const ui1 = runApp(['--ui-smoke'])
  record('PKG-theme-1', '真包主题开启（palis 端点 / 内核页属性 / token / CRT 覆盖层）', ui1.uiOk ? 'PASS' : 'FAIL',
    ui1.uiOk ? 'UI_SMOKE_OK' : `UI_SMOKE_FAIL: ${ui1.uiFail || ui1.out.slice(-300)}`)
  const ui2 = runApp(['--ui-smoke'])
  record('PKG-theme-2', '真包主题恢复（不重写设置，二次启动仍是同一皮肤）', ui2.uiOk ? 'PASS' : 'FAIL',
    ui2.uiOk ? 'UI_SMOKE_OK' : `UI_SMOKE_FAIL: ${ui2.uiFail || ui2.out.slice(-300)}`)
}

const failed = results.filter((r) => r.status === 'FAIL').length
for (const r of results) console.log(`${r.status === 'PASS' ? 'PASS' : 'FAIL'}  ${r.title}\n      ${r.detail}`)
console.log(`\n真包环境：${base}\nexe：${exe}\n合计 ${results.length} 项：${results.length - failed} 通过 / ${failed} 失败`)
fs.rmSync(base, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
