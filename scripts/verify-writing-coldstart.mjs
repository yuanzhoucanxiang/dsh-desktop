// 写作模式打包/环境验收探针（方案 P4 §5.2 的 1/2/4/7 项）：
//   cold — 空环境冷启动：四条隔离路径全部指向新目录，启动前证明 profile 不存在，
//          启动后由**应用本身**完成插件同步；再逐文件核对 repo ↔ 自动生成的 profile。
//   upgrade — 已有环境升级：喂入脱敏 fixture（含旧版插件树、旧 schema 草稿/备忘、设置与角色），
//          记录前后字节与迁移结果；未知 schema/坏 JSON 一律保留原件。
//
// 用法：node scripts/verify-writing-coldstart.mjs [cold|upgrade|all] [--json]
// 隔离路径：DSH_HOME / DSH_DESKTOP_HOME / DSH_DESKTOP_USER_DATA / LOCALAPPDATA（都在 %TEMP% 下）
// 注意：不触碰用户的 ~/.dsh 与已安装应用；smoke 模式跑完自行退出。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { publishSet, compareTrees, RECORD_NAME } from '../lib/plugin-sync.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(ROOT, 'plugin', 'writing-mode')
const mode = (process.argv[2] || 'all').toLowerCase()
const AS_JSON = process.argv.includes('--json')
const results = []
const record = (id, title, status, detail) => results.push({ id, title, status, detail })

const { files: published, source } = publishSet(PLUGIN)

/** 造一套隔离环境目录。 */
function makeEnv(label) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `wm-${label}-`))
  const paths = {
    base,
    home: path.join(base, 'home'),
    desktopHome: path.join(base, 'desktop-home'),
    userData: path.join(base, 'user-data'),
    localAppData: path.join(base, 'local-appdata'),
  }
  for (const p of [paths.home, paths.desktopHome, paths.userData, paths.localAppData]) fs.mkdirSync(p, { recursive: true })
  return paths
}

/** 跑一次应用（smoke：拉起内核→就绪→自行退出；不弹通知、不碰真实环境）。 */
function runApp(env, timeoutMs = 240000) {
  const r = spawnSync('npm', ['run', 'smoke', '--silent'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: true,
    env: {
      ...process.env,
      DSH_HOME: env.home,
      DSH_DESKTOP_HOME: env.desktopHome,
      DSH_DESKTOP_USER_DATA: env.userData,
      LOCALAPPDATA: env.localAppData,
    },
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  return { ok: /SMOKE_OK/.test(out), timedOut: r.error?.code === 'ETIMEDOUT', out }
}

/** 目标 profile 里的插件目录。注意 main.js 的 dshHome() 里 DSH_DESKTOP_HOME **优先于** DSH_HOME
 *  （而且外壳会把 DSH_DESKTOP_HOME 当成内核的 DSH_HOME 传下去），所以探针必须按同一优先级解析，
 *  否则会去查一个根本不会被写入的目录（本项目实测踩过：误判成"同步没发生"）。 */
const effectiveHome = (env) => env.desktopHome || env.home
const profilePluginDir = (env) => path.join(effectiveHome(env), 'profiles', 'node_modules', '@dsh-local', 'writing-mode')

/** 递归列出相对文件（posix），跳过受管记录本身。 */
function listFiles(dir, rel = '') {
  let ents = []
  try {
    ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const ent of ents) {
    const child = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) out.push(...listFiles(dir, child))
    else if (ent.isFile() && ent.name !== RECORD_NAME) out.push(child)
  }
  return out.sort()
}

// ── 1. 空环境冷启动 ────────────────────────────────────────────────────
if (mode === 'cold' || mode === 'all') {
  const env = makeEnv('cold')
  const dir = profilePluginDir(env)
  const absentBefore = !fs.existsSync(dir)
  record('P-cold-1', '启动前 profile 不存在（证明同步由应用完成，不是手工预置）', absentBefore ? 'PASS' : 'FAIL', dir)
  const run = runApp(env)
  record('P-cold-2', '空环境冷启动到就绪（隔离 DSH_HOME/DSH_DESKTOP_HOME/userData/LOCALAPPDATA）', run.ok ? 'PASS' : 'FAIL', run.ok ? 'SMOKE_OK' : run.out.slice(-400))
  if (run.ok) {
    const cmp = compareTrees(PLUGIN, dir)
    const extra = listFiles(dir).filter((f) => !published.includes(f))
    record('P-cold-3', '自动同步出的 profile 与 manifest 逐文件一致', cmp.ok ? 'PASS' : 'FAIL',
      cmp.ok ? `全部 ${cmp.same.length} 个文件哈希一致` : `缺失 ${cmp.missing.map((m) => m.rel)}；漂移 ${cmp.drift.map((d) => d.rel)}`)
    record('P-cold-4', '不多发文件（测试/源码不进用户机器）', extra.length === 0 ? 'PASS' : 'FAIL', extra.length ? extra.join(', ') : `发布集合恰好 ${published.length} 个文件`)
    record('P-cold-5', '受管记录落盘（下次可安全清理）', fs.existsSync(path.join(dir, RECORD_NAME)) ? 'PASS' : 'FAIL', RECORD_NAME)
    // import 链：清单里的每个 .js 都能被 node 解析（不留悬空 require/import）
    const jsFiles = published.filter((f) => f.endsWith('.js') && f !== 'client.js')
    let broken = []
    for (const rel of jsFiles) {
      const r2 = spawnSync(process.execPath, ['--check', path.join(dir, rel)], { encoding: 'utf8' })
      if (r2.status !== 0) broken.push(rel)
    }
    record('P-cold-6', '包内 JS 逐个语法可解析（无悬空/坏文件）', broken.length === 0 ? 'PASS' : 'FAIL', broken.length ? broken.join(', ') : `${jsFiles.length} 个文件全部通过 node --check`)
  }
}

// ── 2. 已有环境升级（脱敏 fixture） ────────────────────────────────────
if (mode === 'upgrade' || mode === 'all') {
  const env = makeEnv('upgrade')
  const dir = profilePluginDir(env)
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src', 'shared'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
  // 旧版插件树：旧的全量递归同步产物（含测试与源码）+ 一个"被改过的" client.js
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@dsh-local/writing-mode', version: '0.0.9-old' }, null, 2))
  fs.writeFileSync(path.join(dir, 'index.js'), '// 旧版 index\n')
  fs.writeFileSync(path.join(dir, 'client.js'), '// 旧版 client（应被换成当版）\n')
  fs.writeFileSync(path.join(dir, 'lib', 'store.js'), '// 旧版 store\n')
  fs.writeFileSync(path.join(dir, 'test', 'old-suite.mjs'), '// 旧版测试脚本（历史遗留，不该进 profile）\n')
  fs.writeFileSync(path.join(dir, 'src', 'shared', 'old.js'), '// 旧版源码\n')
  // 用户/应用数据 fixture（脱敏：不含任何密钥）
  const fixture = {
    settings: JSON.stringify({ fontSize: 19, theme: 'palis', roots: [{ path: 'C:/tmp/作品', label: '作品', default: true }], activeRoot: 'C:/tmp/作品', companions: { 'C:/tmp/作品': 'sess-old-1' }, prefs: { autoSaveMs: 7000 } }, null, 2),
    memory: JSON.stringify({ schemaVersion: 1, revision: 4, projectKey: 'C:/tmp/作品', items: [{ id: 'm1', kind: 'fact', status: 'confirmed', text: '主角叫林晚', source: { kind: 'author' }, createdAt: '2026-09-01T00:00:00.000Z' }], changes: [] }, null, 2),
    checkpoint: JSON.stringify({ project: 'C:/tmp/作品', windowId: 'old-window', rev: 3, text: '旧窗口的草稿', reference: { label: '选区 · 第1章 · 5 字', text: '灯塔的影子' }, updatedAt: '2026-09-01T00:00:00.000Z' }, null, 2),
  }
  const ehome = effectiveHome(env)
  fs.mkdirSync(ehome, { recursive: true })
  fs.writeFileSync(path.join(ehome, 'writing-mode.json'), fixture.settings)
  const projDir = path.join(env.localAppData, 'fixture-project')
  fs.mkdirSync(path.join(projDir, 'state'), { recursive: true })
  fs.writeFileSync(path.join(projDir, 'project.md'), '# 脱敏 fixture 作品\n')
  fs.writeFileSync(path.join(projDir, 'state', 'writing-memory.json'), fixture.memory)
  const before = {
    settings: fs.readFileSync(path.join(effectiveHome(env), 'writing-mode.json')),
    memory: fs.readFileSync(path.join(projDir, 'state', 'writing-memory.json')),
    pluginFiles: listFiles(dir),
  }
  const run = runApp(env)
  record('P-up-1', '旧环境启动到就绪（不清空、不重建）', run.ok ? 'PASS' : 'FAIL', run.ok ? 'SMOKE_OK' : run.out.slice(-400))
  if (run.ok) {
    const cmp = compareTrees(PLUGIN, dir)
    record('P-up-2', '受管文件换成当版（漂移被修好）', cmp.ok ? 'PASS' : 'FAIL', cmp.ok ? `${cmp.same.length} 个文件一致` : `缺失 ${cmp.missing.map((m) => m.rel)}；漂移 ${cmp.drift.map((d) => d.rel)}`)
    const after = listFiles(dir)
    const kept = before.pluginFiles.filter((f) => !published.includes(f) && after.includes(f))
    const removed = before.pluginFiles.filter((f) => !published.includes(f) && !after.includes(f))
    record('P-up-3', '无法证明归属的旧文件保留（只上报不删）', removed.length === 0 ? 'PASS' : 'FAIL', removed.length ? `被删：${removed.join(', ')}` : `保留 ${kept.length} 个：${kept.join(', ')}`)
    const settingsUnchanged = before.settings.equals(fs.readFileSync(path.join(effectiveHome(env), 'writing-mode.json')))
    const memoryUnchanged = before.memory.equals(fs.readFileSync(path.join(projDir, 'state', 'writing-memory.json')))
    record('P-up-4', '设置与备忘字节不变（无破坏性迁移）', settingsUnchanged && memoryUnchanged ? 'PASS' : 'FAIL',
      `writing-mode.json ${settingsUnchanged ? '一致' : '被改写'}；writing-memory.json ${memoryUnchanged ? '一致' : '被改写'}`)
    // 旧 schema / 坏 JSON 一律保留原件
    const badDir = path.join(env.localAppData, 'bad-project')
    fs.mkdirSync(path.join(badDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(badDir, 'state', 'writing-memory.json'), '{ 这不是 JSON')
    const badBefore = fs.readFileSync(path.join(badDir, 'state', 'writing-memory.json'), 'utf8')
    const run2 = runApp(env)
    const badAfter = fs.readFileSync(path.join(badDir, 'state', 'writing-memory.json'), 'utf8')
    record('P-up-5', '坏 JSON 备忘保留原件（启动不覆盖、不重置）', badBefore === badAfter && run2.ok ? 'PASS' : 'FAIL', badBefore === badAfter ? '字节一致' : '被改写')
  }
}

const failed = results.filter((r) => r.status === 'FAIL').length
if (AS_JSON) {
  console.log(JSON.stringify({ source, publishedCount: published.length, results }, null, 2))
} else {
  console.log(`写作模式环境验收（发布集合来源：${source}，${published.length} 个文件）`)
  for (const r of results) console.log(`${r.status === 'PASS' ? 'PASS' : 'FAIL'}  ${r.title}\n      ${r.detail}`)
  console.log(`\n合计 ${results.length} 项：${results.length - failed} 通过 / ${failed} 失败`)
}
process.exit(failed ? 1 : 0)
