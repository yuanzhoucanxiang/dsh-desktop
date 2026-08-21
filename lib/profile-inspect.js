'use strict'

/**
 * Profile 插件体检（纯只读、零 Electron 依赖，可用普通 node 直接跑/测）。
 *
 * 背景：外壳历史上踩过的三类"内容更新"事故（logs/2026-08-22.md ㉒㉓）——
 *   · bundles 数组重写时丢条目        → 插件静默消失（not-in-bundles）
 *   · pnpm 跨盘 link 被相对化打成悬空  → 内核 cannot resolve profile bundle 退出（dangling-link）
 *   · 插件缺 dsh.bundle 声明          → 内核加载即崩（no-dsh-bundle）
 * 本模块把这三类（连同隔离名单、bundle/依赖一致性）统一为一次本地只读扫描；
 * 网络侧的更新检测（npm registry 比对）放在外壳 main.js，不在这里。
 */

const fs = require('node:fs')
const path = require('node:path')

/** 体检问题码 → 用户可读说明。渲染端直接展示 label。 */
const PROBLEM_LABELS = {
  'missing-entry': '未安装（node_modules 缺条目）',
  'dangling-link': '链接悬空：指向的目标不存在',
  'not-in-bundles': '已安装但未启用（不在 bundles 列表，不会加载）',
  'no-dsh-bundle': '缺 dsh.bundle 声明（在启用列表里，内核会启动失败）',
  unreadable: '已安装但读不到它的 package.json',
  quarantined: '已被自动隔离（内核曾因它启动失败，可一键恢复）',
  'bundle-without-dep': '在启用列表但 dependencies 未声明',
}

function readJsonStripBom(file) {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, ''))
}

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** 这个包"长得像不像 DSH 插件"：有 dsh.bundle 或 dsh.client 声明才算，
 *  免得 profile 里装个普通工具库也被报"未启用"。 */
function looksLikeDshPlugin(pkg, name) {
  if (pkg && pkg.dsh && (pkg.dsh.bundle || pkg.dsh.client)) return true
  return /^dsh-/i.test(name) || /(^|\/)dsh-/i.test(name)
}

/**
 * 体检一个 profile 目录（默认按 manifest 同级的 node_modules 解析）。
 * @param {object} opts
 * @param {string} opts.manifestPath   profile 的 package.json 绝对路径
 * @param {string} [opts.nodeModulesDir] 覆盖 node_modules 位置（测试用）
 * @param {Array}  [opts.quarantined]  隔离名单（disabled-bundles.json 内容或名字数组）
 * @param {Set}    [opts.coreBundles]  内核自带 bundle（不算用户插件）
 * @returns {{ok:boolean,error:string,items:Array,problems:Array}}
 */
function inspectProfile(opts) {
  const o = opts || {}
  const manifestPath = o.manifestPath
  const nodeModulesDir = o.nodeModulesDir || path.join(path.dirname(manifestPath), 'node_modules')
  const quarantinedNames = new Set((o.quarantined || []).map((e) => (typeof e === 'string' ? e : e.name)))
  const coreBundles = o.coreBundles || new Set()

  const report = { ok: false, error: '', items: [], problems: [] }
  let manifest
  try {
    manifest = readJsonStripBom(manifestPath)
  } catch (err) {
    report.error = `无法读取 profile 清单：${err && err.message ? err.message : String(err)}`
    return report
  }
  const deps = (manifest && manifest.dependencies) || {}
  const bundles = (manifest && manifest.dsh && manifest.dsh.profile && Array.isArray(manifest.dsh.profile.bundles))
    ? manifest.dsh.profile.bundles
    : []
  const problems = []
  const addProblem = (name, code, detail) =>
    problems.push({ name, code, label: PROBLEM_LABELS[code] || code, detail: detail || '' })

  for (const [name, spec] of Object.entries(deps)) {
    const item = {
      name,
      spec,
      source: /^link:/i.test(spec) ? 'link' : 'registry',
      version: '',
      linkTarget: '',
      inBundles: bundles.includes(name),
      problems: [],
    }
    const entry = path.join(nodeModulesDir, name)
    const lstat = safe(() => fs.lstatSync(entry), null)
    if (!lstat) {
      item.problems.push('missing-entry')
      addProblem(name, 'missing-entry')
      report.items.push(item)
      continue
    }

    // statSync 穿透 junction/symlink：悬空链接在这里表现为"不可达"
    const entryReachable = safe(() => !!fs.statSync(entry), false)
    const pkg = entryReachable ? safe(() => readJsonStripBom(path.join(entry, 'package.json')), null) : null

    if (!entryReachable) {
      const target = safe(() => fs.readlinkSync(entry), '')
      item.problems.push('dangling-link')
      addProblem(name, 'dangling-link', target ? `node_modules 条目指向 ${target}` : 'node_modules 条目不可达')
    } else if (!pkg) {
      item.problems.push('unreadable')
      addProblem(name, 'unreadable')
    } else {
      item.version = pkg.version || ''
      if (pkg.name) item.name = pkg.name
      if (item.inBundles && !(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch)) {
        item.problems.push('no-dsh-bundle')
        addProblem(name, 'no-dsh-bundle')
      }
    }

    if (item.source === 'link') {
      item.linkTarget = spec.replace(/^link:/i, '')
      // 依赖声明的目标本身也要存在：junction 修好后 spec 仍可能指向别处
      if (!safe(() => fs.statSync(item.linkTarget), false)) {
        if (!item.problems.includes('dangling-link')) item.problems.push('dangling-link')
        addProblem(name, 'dangling-link', `依赖声明指向 ${item.linkTarget}`)
      }
    }

    if (!item.inBundles && looksLikeDshPlugin(pkg, name) && !item.problems.includes('missing-entry')) {
      item.problems.push('not-in-bundles')
      addProblem(name, 'not-in-bundles')
    }
    if (quarantinedNames.has(name)) {
      item.problems.push('quarantined')
      addProblem(name, 'quarantined')
    }
    report.items.push(item)
  }

  // 反向一致性：bundles 里有、dependencies 里没有（内核自带 bundle 除外）
  for (const b of bundles) {
    if (!deps[b] && !coreBundles.has(b)) addProblem(b, 'bundle-without-dep')
  }

  report.problems = problems
  report.ok = !report.error && problems.length === 0
  return report
}

/** 轻量语义化版本比较：返回 1 / 0 / -1。预发布段只按"有无"粗分（无预发布 > 有）。 */
function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
    if (!m) return null
    return { num: [+m[1], +m[2], +m[3]], pre: m[4] || '' }
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa.num[i] !== pb.num[i]) return pa.num[i] > pb.num[i] ? 1 : -1
  }
  if (!pa.pre && !pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre === pb.pre ? 0 : pa.pre > pb.pre ? 1 : -1
}

module.exports = { inspectProfile, compareVersions, PROBLEM_LABELS, readJsonStripBom }
