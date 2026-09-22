/**
 * 打包 / 更新供应链 hunt 探针（2026-09-21）· U1–U4
 *
 * **全程只读**：不构建、不安装、不上传、不改 dist/、不结束任何进程。
 * 手段是「复刻脚本里的判据，喂真实仓库状态，看它会做出什么选择」——
 * 这样能在不真的降级/不真的发布的前提下证明缺陷成立。
 *
 * REPRODUCED = 缺陷已复现。跑法：node docs/audits/release-chain-hardening/2026-09-21/hunt-release.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const results = []
function finding(id, title, reproduced, evidence) {
  results.push({ id, title, reproduced })
  console.log(`${reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED'} ${id} ${title}`)
  for (const line of evidence) console.log(`    ${line}`)
}

/** 从 dsh-desktop-<ver>-setup.exe 里解析版本；解析不出返回 null。 */
function versionOf(name) {
  const m = /^dsh-desktop-(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)-setup\.exe$/.exec(name)
  return m ? m[1] : null
}
/** 粗粒度 semver 比较（够用：本项目全是 x.y.z 数字）。a>b 返回 1。 */
function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

const pkg = JSON.parse(src('package.json'))
const distDir = path.join(ROOT, 'dist')

/* ─────────────────────────────────────────────────────────────
 * U1 · install-update.ps1 无参数时按 LastWriteTime 挑安装包，可能静默装旧版
 *      （降级），且不校验 sha512；而 dist/ 里堆着十几个历史安装包
 * ───────────────────────────────────────────────────────────── */
{
  const ps = src('install-update.ps1')
  // 复刻 Resolve-Installer 的搜索目录与排序判据
  const dirs = [path.join(os.homedir(), 'Downloads'), ROOT, path.join(ROOT, 'dist')]
    .filter((d) => { try { return fs.statSync(d).isDirectory() } catch { return false } })
  const cand = []
  for (const d of dirs) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isFile()) continue
      if (!/^dsh-desktop-.*-setup\.exe$/.test(e.name)) continue
      const full = path.join(d, e.name)
      cand.push({ full, name: e.name, dir: d, mtime: fs.statSync(full).mtimeMs, version: versionOf(e.name) })
    }
  }
  // 脚本的判据：Sort-Object LastWriteTime -Descending | Select-Object -First 1
  const byMtime = [...cand].sort((a, b) => b.mtime - a.mtime)
  const picked = byMtime[0]
  // 正确判据应是：按版本降序
  const byVersion = [...cand].filter((c) => c.version).sort((a, b) => cmpVer(b.version, a.version))
  const newestVersion = byVersion[0]

  const usesMtime = /Sort-Object LastWriteTime -Descending \| Select-Object -First 1/.test(ps)
  const verifiesHash = /sha512|Get-FileHash|latest\.yml/.test(ps)
  const guardsDowngrade = /(-lt|older|downgrade|Force)/i.test(ps) && /DisplayVersion/.test(ps)

  const wouldDowngrade = Boolean(picked && newestVersion && picked.version && cmpVer(picked.version, newestVersion.version) < 0)
  const staleVsPkg = Boolean(picked && picked.version && cmpVer(picked.version, pkg.version) < 0)

  finding(
    'U1',
    'install-update.ps1 无参数时按 mtime 挑安装包（不是按版本），可能静默装旧版；且不校验 sha512',
    usesMtime && !verifiesHash && (wouldDowngrade || staleVsPkg),
    [
      `脚本判据：Sort-Object LastWriteTime -Descending | Select-Object -First 1 → 命中=${usesMtime}`,
      `脚本里有无 sha512 / Get-FileHash / latest.yml 校验 → ${verifiesHash}`,
      `搜索目录 = ${JSON.stringify(dirs)}`,
      `候选安装包 ${cand.length} 个；按 mtime 会挑中 = ${picked ? picked.name + '（版本 ' + picked.version + '，mtime ' + new Date(picked.mtime).toISOString().slice(0, 19) + '）' : '无'}`,
      `按版本应挑中 = ${newestVersion ? newestVersion.name + '（版本 ' + newestVersion.version + '）' : '无'}`,
      `package.json 版本 = ${pkg.version}`,
      `按 mtime 挑中的是否比现有最新候选旧 = ${wouldDowngrade}；是否比 package.json 旧 = ${staleVsPkg}`,
      '后果：脚本会先强杀正在运行的桌面与内核，再静默 /S 装上一个**旧版**，事后只在"版本没变"时才给 WARNING，降级不报',
      '注：Release 里本来就带 latest.yml（electron-updater 用它验 sha512），完整性数据是现成的，脚本没用',
    ]
  )
}

/* ─────────────────────────────────────────────────────────────
 * U2 · killStaleUpdaterInstallers 把目录路径拼进 PowerShell 单引号串
 * ───────────────────────────────────────────────────────────── */
{
  const main = src('main.js')
  const i = main.indexOf('function killStaleUpdaterInstallers()')
  const body = i >= 0 ? main.slice(i, i + 900) : ''
  const interpolates = /StartsWith\('" \+ dir \+ "'/.test(body)
  const escapes = /replace\(/.test(body) && /''/.test(body)
  const usesSpawnShell = /spawnSync\('powershell'/.test(body)
  // 构造一个含单引号的 LOCALAPPDATA，看拼出来的 PS 会不会跑偏
  const evilDir = "C:\\Users\\o'brien\\AppData\\Local\\dsh-desktop-updater"
  const psCmd = "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('" + evilDir + "', 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  const breaksOut = (psCmd.match(/'/g) || []).length % 2 === 1 || psCmd.includes("o'brien\\AppData\\Local\\dsh-desktop-updater', 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process")

  finding(
    'U2',
    'killStaleUpdaterInstallers 把 LOCALAPPDATA 派生的路径直接拼进 PowerShell 单引号串（含单引号即可越出字符串）',
    interpolates && !escapes && usesSpawnShell,
    [
      `拼串方式命中（StartsWith('" + dir + "'）= ${interpolates}`,
      `有无对单引号做 '' 逸出 = ${escapes}`,
      `经 spawnSync('powershell', ['-NoProfile','-Command', ps]) 执行 = ${usesSpawnShell}`,
      `含单引号的路径示例 = ${evilDir}`,
      `拼出的命令串单引号数 = ${(psCmd.match(/'/g) || []).length}（奇数=字符串未闭合，后续内容会被当代码解析）`,
      '实际可控性有限：LOCALAPPDATA 由启动外壳的父进程环境决定，普通用户机器上是固定路径；',
      '但这是"把外部字符串拼进 shell"的典型形态，且旁边就是一条 Stop-Process -Force 管道，逸出即提权到杀进程',
      '修法：单引号按 PowerShell 规则 doubling（\' → \'\'），或干脆用 $env: 传值不做字符串拼接',
    ]
  )
}

/* ─────────────────────────────────────────────────────────────
 * U3 · owner/repo 在三处各自硬编码，无一致性校验
 * ───────────────────────────────────────────────────────────── */
{
  const main = src('main.js')
  const buildPs = src('build.ps1')
  const releasePs = src('release.ps1')
  const installPs = src('install-update.ps1')

  const grab = (re, s) => { const m = re.exec(s); return m ? m[1] : null }
  const fromPkg = pkg.build && pkg.build.publish ? `${pkg.build.publish.owner}/${pkg.build.publish.repo}` : null
  const fromMain = grab(/const DEFAULT_UPDATE_REPO = '([^']+)'/, main)
  const fromBuild = (() => {
    const o = grab(/owner:\s*([A-Za-z0-9_.-]+)/, buildPs)
    const r = grab(/repo:\s*([A-Za-z0-9_.-]+)/, buildPs)
    return o && r ? `${o}/${r}` : null
  })()
  const fromRelease = (() => {
    const o = grab(/\$owner = '([^']+)'/, releasePs)
    const r = grab(/\$repo = '([^']+)'/, releasePs)
    return o && r ? `${o}/${r}` : null
  })()
  const fromInstall = grab(/\$REPO\s+= '([^']+)'/, installPs)

  const all = { 'package.json build.publish': fromPkg, 'main.js DEFAULT_UPDATE_REPO': fromMain, 'build.ps1 app-update.yml': fromBuild, 'release.ps1 $owner/$repo': fromRelease, 'install-update.ps1 $REPO': fromInstall }
  const uniq = [...new Set(Object.values(all).filter(Boolean))]

  // 修复后的判据：① build.ps1 不再硬编码而是从 package.json 派生；
  // ② 存在一个真跑的一致性闸门，且已接进构建与发布两条路径。
  const verifier = 'scripts/verify-release-artifacts.mjs'
  const hasVerifier = fs.existsSync(path.join(ROOT, verifier))
  const verifierChecksRepo = hasVerifier && /owner\/repo 各处硬编码一致/.test(src(verifier))
  const wiredIntoBuild = /verify-release-artifacts\.mjs/.test(src('build.ps1'))
  const wiredIntoRelease = /verify-release-artifacts\.mjs/.test(src('release.ps1'))
  const buildDerives = /build\.publish|\$pubRepo/.test(src('build.ps1'))
  const guarded = hasVerifier && verifierChecksRepo && wiredIntoBuild && wiredIntoRelease && buildDerives

  finding(
    'U3',
    'GitHub owner/repo 在多处各自硬编码，无任何一致性校验（漂移后应用会去别的仓库查更新）',
    uniq.length > 1 || !guarded,
    [
      ...Object.entries(all).map(([k, v]) => `${k} = ${v}`),
      `去重后取值 = ${JSON.stringify(uniq)}（多于 1 个即已漂移）`,
      `build.ps1 是否改为从 package.json build.publish 派生（而不是手写 heredoc）= ${buildDerives}`,
      `一致性闸门 ${verifier} 存在=${hasVerifier} 且真的比对 owner/repo=${verifierChecksRepo}`,
      `已接进 build.ps1=${wiredIntoBuild}、release.ps1=${wiredIntoRelease}`,
      '另：updaterCacheDirName 也同样散在三处（build.ps1 / install-update.ps1 / main.js），同一道闸门一并校验',
      '历史状态：五处取值完全一致但**纯凭巧合**——改任一处都不会有任何检查报错；',
      '而 build.ps1 的 app-update.yml 是手写 heredoc，electron-builder 的 --dir + --prepackaged 两步流程不会自动生成它，所以它不会跟着 package.json 走',
    ]
  )
}

/* ─────────────────────────────────────────────────────────────
 * U4 · dist/latest.yml 可以与本轮产物脱节，而 release.ps1 上传前不校验
 * ───────────────────────────────────────────────────────────── */
{
  const ymlPath = path.join(distDir, 'latest.yml')
  const hasYml = fs.existsSync(ymlPath)
  const yml = hasYml ? fs.readFileSync(ymlPath, 'utf8') : ''
  const yVersion = (yml.match(/^version:\s*(.+)$/m) || [])[1]
  const yPath = (yml.match(/^path:\s*(.+)$/m) || [])[1]
  const ySha = (yml.match(/^sha512:\s*(.+)$/m) || [])[1]
  const ySize = Number((yml.match(/^\s+size:\s*(\d+)$/m) || [])[1] || 0)

  const targetExe = yPath ? path.join(distDir, yPath.trim()) : null
  const exeExists = targetExe ? fs.existsSync(targetExe) : false
  let shaMatches = null
  let sizeMatches = null
  if (exeExists && ySha) {
    const { createHash } = await import('node:crypto')
    const buf = fs.readFileSync(targetExe)
    shaMatches = createHash('sha512').update(buf).digest('base64') === ySha.trim()
    sizeMatches = buf.length === ySize
  }

  const releasePs = src('release.ps1')
  const buildPs = src('build.ps1')
  // 缺陷本体是「发布前没有任何一致性闸门」；dist/latest.yml 陈旧只是证明这个隐患是活的
  const guarded = /verify-release-artifacts\.mjs/.test(releasePs) && /verify-release-artifacts\.mjs/.test(buildPs)
  const uploadsWithoutCheck = /gh release upload \$tag .*--clobber \$a/.test(releasePs) && !guarded
  const staleVersion = Boolean(yVersion && yVersion.trim() !== pkg.version)

  // 顺带盘点 dist/ 的陈旧产物（只读）
  const all = fs.existsSync(distDir) ? fs.readdirSync(distDir, { withFileTypes: true }) : []
  const exes = all.filter((e) => e.isFile() && /-setup\.exe$/.test(e.name))
  const blockmaps = all.filter((e) => e.isFile() && /\.blockmap$/.test(e.name))
  const orphans = blockmaps.filter((b) => !exes.some((x) => x.name + '.blockmap' === b.name))
  const totalBytes = all.filter((e) => e.isFile()).reduce((n, e) => n + fs.statSync(path.join(distDir, e.name)).size, 0)
  const leftoverTmp = all.filter((e) => e.isDirectory() && /\.tmp$/.test(e.name)).map((e) => e.name)

  finding(
    'U4',
    'dist/latest.yml 可与本轮产物脱节（当前落后 4 个版本），而 release.ps1 上传前不做任何一致性校验',
    staleVersion && !guarded || (hasYml && (!exeExists || shaMatches === false || sizeMatches === false)) || (uploadsWithoutCheck && orphans.length > 0),
    [
      `package.json 版本 = ${pkg.version}`,
      `dist/latest.yml version = ${yVersion ? yVersion.trim() : '(无)'} → 与 package.json 不一致 = ${staleVersion}（这就是隐患活生生的证据）`,
      `latest.yml path = ${yPath || '(无)'}；该 exe 是否存在 = ${exeExists}`,
      exeExists ? `sha512 与该 exe 实算一致 = ${shaMatches}；size 一致 = ${sizeMatches}（清单自身自洽，只是版本陈旧）` : '（exe 不在，无法核对哈希）',
      `build.ps1 / release.ps1 是否接了一致性闸门（verify-release-artifacts.mjs）= ${guarded}`,
      `dist/ 盘点：安装包 ${exes.length} 个、blockmap ${blockmaps.length} 个、孤儿 blockmap ${orphans.length} 个（${orphans.map((o) => o.name).join(', ') || '无'}）`,
      `遗留的 .tmp 输出目录 = ${JSON.stringify(leftoverTmp)}；dist/ 合计 ${(totalBytes / 1048576).toFixed(0)} MB`,
      '风险路径：release.ps1 在未认证分支会把 gh release upload 命令**打印出来让人手工执行**；',
      '          此时若 latest.yml 是陈旧的，就会把指向旧版本的清单发上去 → 全量用户被降级或更新检查 404',
    ]
  )
}

console.log('\n=== 汇总 ===')
console.log(`复现 ${results.filter((r) => r.reproduced).length} / ${results.length}`)
for (const r of results) console.log(`  ${r.reproduced ? '[REPRODUCED]' : '[  clean   ]'} ${r.id} ${r.title}`)
console.log('RELEASE_HUNT_DONE（本探针全程只读，未改动 dist/ 或任何产物）')
