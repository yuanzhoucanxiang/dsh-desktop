// 写作模式发布一致性验收（方案 P1-② / P4 / B07 判据）：
//   1. 静态：runtime-manifest.json 的发布集合 ↔ package.json 里 electron-builder 的 filter
//      （清单加了文件却忘了打包 filter，是这类项目最典型的漏发事故）
//   2. 安装包：manifest ↔ 已构建的 resources/plugin/writing-mode（--package 给出，未给则 NOT_RUN）
//   3. profile：manifest ↔ 已种入的 profile 副本（显式 --profile 才判定；默认只提示）
//   4. 门禁（B01/B07）：主进程依赖闭包必须被 build.files 覆盖；给出 --package 时**真的读 app.asar**
//      校验每个本地 require 都在包里，并核对 extraResources 资源完整（runtime/插件/内置插件树）
//
// 用法：
//   node scripts/verify-writing-package.mjs
//   node scripts/verify-writing-package.mjs --package "<解包目录>" [--profile "<插件目录>"] [--json]
// 只读：不写任何文件，退出码 0=PASS / 1=FAIL。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { publishSet, compareTrees } from '../lib/plugin-sync.js'

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
    path.join(input, 'win-unpacked', 'resources', 'plugin', 'writing-mode'),
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
  const home = process.env.DSH_DESKTOP_HOME || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', 'node_modules', '@dsh-local', 'writing-mode')
}

/** 极简 glob：支持精确名、dir/*、**、!取反（够用即可，不引第三方依赖）。 */
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

/**
 * 主进程依赖闭包：从 main.js/preload.js 出发，把本地相对 require 全部收齐（含 lib 内部互相 require）。
 * B01 的教训：main.js 新 require 了 lib/plugin-sync.js，但 build.files 没跟上 → 新包启动即
 * "Cannot find module"，而 dev 跑得一切正常。这个闭包就是那道门禁的判据。
 */
function localRequireClosure(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    let text
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    } catch {
      continue
    }
    seen.add(rel)
    for (const m of text.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel.split(path.sep).join('/')), m[1]))
      const hit = [base, `${base}.js`, `${base}.json`, `${base}/index.js`].find((c) => fs.existsSync(path.join(ROOT, c)))
      if (hit) queue.push(hit)
    }
  }
  return [...seen].sort()
}

/** electron-builder 的 files 通配 → 正则（支持 *、**、!取反；不引第三方依赖）。 */
function globToRegExp(pat) {
  let rx = ''
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i]
    if (ch === '*') {
      if (pat[i + 1] === '*') {
        rx += '.*'
        i++
      } else {
        rx += '[^/]*'
      }
    } else if ('.+^$()|[]{}'.includes(ch)) {
      rx += `\\${ch}`
    } else {
      rx += ch
    }
  }
  return new RegExp(`^${rx}$`)
}

function matchesFilesPatterns(rel, patterns) {
  const posix = rel.split(path.sep).join('/')
  let matched = false
  for (const rule of patterns) {
    const negate = rule.startsWith('!')
    const pat = negate ? rule.slice(1) : rule
    if (globToRegExp(pat).test(posix)) matched = !negate
  }
  return matched
}

/** 极简 asar 读取：pickle 头 + JSON 头（零依赖，够列文件与取内容）。
 *  头部布局随 asar/electron-builder 版本略有差异，这里在缓冲区里定位第一个 '{'，
 *  再按**第一个 NUL** 截断（头部按 4 字节对齐补 NUL，JSON 本身不含 NUL），稳。 */
function readAsar(asarPath) {
  const buf = fs.readFileSync(asarPath)
  const headerSize = buf.readUInt32LE(4)
  if (!Number.isInteger(headerSize) || headerSize <= 0 || headerSize > 64 * 1024 * 1024) {
    throw new Error(`asar 头长度异常：${headerSize}`)
  }
  const start = buf.indexOf(0x7b, 0) // 第一个 '{'
  if (start < 0) throw new Error('asar 头里找不到 JSON 起点')
  const end = buf.indexOf(0x00, start)
  const jsonText = buf.slice(start, end > start ? end : start + headerSize).toString('utf8')
  const header = JSON.parse(jsonText)
  const baseOffset = start + jsonText.length + ((4 - (Buffer.byteLength(jsonText) % 4)) % 4)
  {
    const out = []
    const walk = (node, prefix) => {
      for (const [name, val] of Object.entries(node.files || {})) {
        const rel = prefix ? `${prefix}/${name}` : name
        if (val.files) walk(val, rel)
        else out.push({ rel, size: val.size, offset: Number(val.offset) })
      }
    }
    walk(header, '')
    return {
      list: () => out.map((e) => e.rel),
      read: (rel) => {
        const hit = out.find((e) => e.rel === rel)
        if (!hit) return null
        return buf.slice(baseOffset + hit.offset, baseOffset + hit.offset + hit.size)
      },
    }
  }
}

function resolveAsar(input) {
  if (!input) return null
  const candidates = [
    path.join(input, 'resources', 'app.asar'),
    path.join(input, 'win-unpacked', 'resources', 'app.asar'),
    input.endsWith('app.asar') ? input : null,
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
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

// 2. 主进程依赖闭包 ↔ build.files（静态，无需构建）
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const patterns = pkg.build?.files || []
  const closure = localRequireClosure(['main.js', 'preload.js'])
  const uncovered = closure.filter((rel) => !matchesFilesPatterns(rel, patterns))
  const missingOnDisk = closure.filter((rel) => !fs.existsSync(path.join(ROOT, rel)))
  const ok = uncovered.length === 0 && missingOnDisk.length === 0
  record('main-deps', '主进程依赖闭包被 build.files 覆盖', ok ? 'PASS' : 'FAIL',
    ok
      ? `${closure.length} 个本地模块全部会被打进包（含 lib 内部依赖）`
      : `漏打：${uncovered.join(', ') || '无'}；磁盘缺失：${missingOnDisk.join(', ') || '无'}`)
}

// 3. 解包产物实检（给出 --package 时）：app.asar 内主进程依赖 + extraResources 资源完整
{
  const input = flag('--package')
  const asarPath = resolveAsar(input)
  if (!input) {
    record('asar', '解包产物实检（app.asar + 资源）', 'NOT_RUN', '未提供 --package（构建后带路径重跑）')
  } else if (!asarPath) {
    record('asar', '解包产物实检（app.asar + 资源）', 'FAIL', `在 --package 下找不到 resources/app.asar：${input}`)
  } else {
    const asar = readAsar(asarPath)
    const closure = localRequireClosure(['main.js', 'preload.js'])
    const listed = new Set(asar.list().map((x) => x.split(path.sep).join('/')))
    const absent = closure.filter((rel) => !listed.has(rel.split(path.sep).join('/')))
    record('asar', 'app.asar 内主进程依赖齐全', absent.length === 0 ? 'PASS' : 'FAIL',
      absent.length ? `缺：${absent.join(', ')}` : `${closure.length} 个本地模块都在 app.asar 内`)

    const mainInAsar = asar.read('main.js')?.toString('utf8') || ''
    const repoLeak = /E:\\+Deepseek/.test(mainInAsar)
    record('asar-no-repo-dep', '包内主进程不依赖源码目录（A02）', repoLeak ? 'FAIL' : 'PASS',
      repoLeak ? 'main.js 里出现仓库绝对路径' : '未发现仓库路径引用')

    // asar 就在 <解包根>/resources/app.asar 里，所以资源根就是它所在目录（别再拼一层 resources）
    const resRoot = path.dirname(asarPath)
    const needPlugin = ['plugin/writing-mode/package.json', 'plugin/writing-mode/client.js', 'plugin/writing-mode/runtime-manifest.json']
    const missPlugin = needPlugin.filter((rel) => !fs.existsSync(path.join(resRoot, rel)))
    const needOthers = ['runtime.tar.gz', 'runtime-marker.json', 'builtin-plugins/manifest.json']
    const missOthers = needOthers.filter((rel) => !fs.existsSync(path.join(resRoot, rel)))
    const resOk = missPlugin.length === 0 && missOthers.length === 0
    record('resources', 'extraResources 资源完整（插件 + 运行时 + 内置插件树）', resOk ? 'PASS' : 'FAIL',
      resOk ? '写作模式插件、runtime.tar.gz、runtime-marker.json、builtin-plugins 均在' : `缺：${[...missPlugin, ...missOthers].join(', ')}`)

    const pluginDir = resolvePackagePluginDir(input)
    if (pluginDir) {
      const c = compareTrees(SRC, pluginDir)
      const detail = c.ok
        ? `全部 ${c.same.length} 个文件一致（${pluginDir}）`
        : `缺失：${c.missing.map((m) => m.rel).join(', ') || '无'}；内容不一致：${c.drift.map((d) => `${d.rel}(${d.srcHash}→${d.destHash})`).join(', ') || '无'}`
      record('package', 'manifest ↔ 安装包产物', c.ok ? 'PASS' : 'FAIL', detail)
    } else {
      record('package', 'manifest ↔ 安装包产物', 'FAIL', `在 --package 下找不到 plugin/writing-mode：${input}`)
    }
  }
}

// 4. profile（只在显式 --profile 时判定；默认查真机 ~/.dsh 但只作提示）
//    为什么默认不判失败：profile 是**这台机器的运行态**（应用没重启就还是上一版），
//    不是仓库属性；把它当门禁会让"随时可跑的回归入口"变成红。打包/升级验收请显式传 --profile。
{
  const explicit = Boolean(flag('--profile'))
  const dir = flag('--profile') || defaultProfileDir()
  if (!fs.existsSync(dir)) {
    record('profile', 'manifest ↔ profile 已种入副本', explicit ? 'FAIL' : 'NOT_RUN', `不存在：${dir}（该机尚未种入写作模式）`)
  } else {
    const c = compareTrees(SRC, dir)
    const detail = c.ok
      ? `全部 ${c.same.length} 个文件一致（${dir}）`
      : `缺失：${c.missing.map((m) => m.rel).join(', ') || '无'}；内容不一致：${c.drift.map((d) => `${d.rel}(${d.srcHash}→${d.destHash})`).join(', ') || '无'}（应用下次启动会自动换成当版）`
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
