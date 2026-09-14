// 写作模式发布一致性验收（方案 P1-② / P4 判据）：
//   1. 静态：runtime-manifest.json 的发布集合 ↔ package.json 里 electron-builder 的 filter
//      （清单加了文件却忘了打包 filter，是这类项目最典型的漏发事故）
//   2. 安装包：manifest ↔ 已构建的 resources/plugin/writing-mode（--package 给出，未给则 NOT_RUN）
//   3. profile：manifest ↔ 已种入的 ~/.dsh/profiles/node_modules/@dsh-local/writing-mode
//
// 用法：
//   node scripts/verify-writing-package.mjs
//   node scripts/verify-writing-package.mjs --package "<解包目录或 resources 目录>" [--json]
//   node scripts/verify-writing-package.mjs --profile "<插件目录>" [--json]
// 只读：不写任何文件，退出码 0=PASS / 1=FAIL。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { publishSet } from '../lib/plugin-sync.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'plugin', 'writing-mode')
const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const AS_JSON = args.includes('--json')

const results = []
const record = (id, title, status, detail) => results.push({ id, title, status, detail })

/** 找到 --package 参数里的插件目录（接受：resources 根 / 解包 app 根 / 插件目录本身）。 */
function resolvePackagePluginDir(input) {
  if (!input) return null
  const candidates = [
    input,
    path.join(input, 'plugin', 'writing-mode'),
    path.join(input, 'resources', 'plugin', 'writing-mode'),
    path.join(input, 'Contents', 'Resources', 'plugin', 'writing-mode'),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'package.json'))) return c
    } catch {}
  }
  return null
}

function defaultProfileDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', 'node_modules', '@dsh-local', 'writing-mode')
}

/** 极简 glob：支持精确名、dir/*、!取反（够用即可，不引第三方依赖）。 */
function filterMatches(filter, rel) {
  let matched = false
  for (const rule of filter) {
    const negate = rule.startsWith('!')
    const pat = negate ? rule.slice(1) : rule
    const hit = pat.endsWith('/*')
      ? rel.startsWith(pat.slice(0, -1)) && !rel.slice(pat.length - 1).includes('/')
      : rel === pat
    if (hit) matched = !negate
  }
  return matched
}

/** 用 filter 扫真实目录，得到实际会被打进包的文件（不跑 electron-builder）。 */
function filesFromFilter(dir, filter, rel = '') {
  const out = []
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const child = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) out.push(...filesFromFilter(dir, filter, child))
    else if (ent.isFile() && filterMatches(filter, child)) out.push(child)
  }
  return out.sort()
}

const { source, files: wanted } = publishSet(SRC)

// 1. 静态：清单 ↔ 打包 filter
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const entry = (pkg.build?.extraResources || []).find((e) => e.from === 'plugin/writing-mode')
  if (!entry) {
    record('filter', '打包 filter 存在', 'FAIL', 'package.json build.extraResources 里找不到 plugin/writing-mode')
  } else {
    const packed = filesFromFilter(SRC, entry.filter)
    const missing = wanted.filter((f) => !packed.includes(f))
    const extra = packed.filter((f) => !wanted.includes(f))
    const ok = missing.length === 0 && extra.length === 0
    record('filter', 'manifest ↔ 打包 filter 逐文件一致', ok ? 'PASS' : 'FAIL',
      ok ? `${source} 发布集合 ${wanted.length} 个文件，filter 展开后完全一致`
        : `漏打（filter 没覆盖）：${missing.join(', ') || '无'}；多打（清单外）：${extra.join(', ') || '无'}`)
  }
}

// 2. 安装包产物（可选）
{
  const dir = resolvePackagePluginDir(flag('--package'))
  if (!flag('--package')) {
    record('package', 'manifest ↔ 安装包产物', 'NOT_RUN', '未提供 --package（构建后带路径重跑）')
  } else if (!dir) {
    record('package', 'manifest ↔ 安装包产物', 'FAIL', `--package 下找不到 plugin/writing-mode：${flag('--package')}`)
  } else {
    const { compareTrees } = await import('../lib/plugin-sync.js')
    const c = compareTrees(SRC, dir)
    const detail = c.ok
      ? `全部 ${c.same.length} 个文件一致（${dir}）`
      : `缺失：${c.missing.map((m) => m.rel).join(', ') || '无'}；内容不一致：${c.drift.map((d) => `${d.rel}(${d.srcHash}→${d.destHash})`).join(', ') || '无'}`
    record('package', 'manifest ↔ 安装包产物', c.ok ? 'PASS' : 'FAIL', detail)
  }
}

// 3. profile（只在显式 --profile 时判定；默认查真机 ~/.dsh 但只作提示）
//    为什么默认不判失败：profile 是**这台机器的运行态**（应用没重启就还是上一版），
//    不是仓库属性；把它当门禁会让"随时可跑的回归入口"变成红。打包/升级验收请显式传 --profile。
{
  const explicit = Boolean(flag('--profile'))
  const dir = flag('--profile') || defaultProfileDir()
  if (!fs.existsSync(dir)) {
    record('profile', 'manifest ↔ profile 已种入副本', explicit ? 'FAIL' : 'NOT_RUN',
      `不存在：${dir}（该机尚未种入写作模式）`)
  } else {
    const { compareTrees } = await import('../lib/plugin-sync.js')
    const c = compareTrees(SRC, dir)
    const detail = c.ok
      ? `全部 ${c.same.length} 个文件一致（${dir}）`
      : `缺失：${c.missing.map((m) => m.rel).join(', ') || '无'}；内容不一致：${c.drift.map((d) => `${d.rel}(${d.srcHash}→${d.destHash})`).join(', ') || '无'}（应用下次启动会自动换成当版）`
    // 非受管的历史遗留文件不判失败：外壳只在能证明归属时才清理，这里只如实上报
    const extraNote = c.extra.length ? `；另有 ${c.extra.length} 个非发布集合文件（历史遗留/用户添加，保留）：${c.extra.map((e) => e.rel).join(', ')}` : ''
    record('profile', 'manifest ↔ profile 已种入副本', c.ok ? 'PASS' : explicit ? 'FAIL' : 'NOT_RUN', detail + extraNote)
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ source, wanted, results }, null, 2))
} else {
  console.log(`写作模式发布一致性（发布集合来源：${source}，共 ${wanted.length} 个文件）`)
  for (const r of results) {
    const mark = r.status === 'PASS' ? 'PASS ' : r.status === 'FAIL' ? 'FAIL ' : '待跑 '
    console.log(`${mark} ${r.title}\n      ${r.detail}`)
  }
  const failed = results.filter((r) => r.status === 'FAIL').length
  const notRun = results.filter((r) => r.status === 'NOT_RUN').length
  console.log(`\n合计 ${results.length} 项：${results.length - failed - notRun} 通过 / ${failed} 失败 / ${notRun} 待跑`)
}
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0)
