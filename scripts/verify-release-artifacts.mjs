/**
 * 发布产物与更新源一致性校验（U3 / U4）。
 *
 * 为什么要这道闸：`release.ps1` 在未认证分支会把 `gh release upload` 命令**打印出来让人手工执行**，
 * 而它上传的 `dist\latest.yml` 是 electron-updater 唯一信任的清单。dist/ 里堆着十几个历史安装包
 * （本轮实测 20 个 exe、22 个 blockmap、3.9GB），一旦 latest.yml 与本轮产物脱节，
 * 发上去的就是"指向旧版本 + 旧 sha512"的清单 → 全量用户被降级，或更新检查 404。
 * build.ps1 正常流程会重新生成 latest.yml，所以这是"流程被绕过/中断"时的隐患——
 * 但 build.ps1 自己的注释已经写过同类教训（陈旧产物冒充本轮成功），值得用代码钉住。
 *
 * 同时校验 GitHub owner/repo 的多处硬编码是否一致：它散落在 package.json build.publish、
 * main.js DEFAULT_UPDATE_REPO、build.ps1 生成的 app-update.yml、release.ps1、install-update.ps1，
 * 改任一处都不会有别的检查报错，漂移后应用会去**另一个仓库**查更新。
 *
 * 用法：
 *   node scripts/verify-release-artifacts.mjs                 # 校验 dist/ 与源码一致性
 *   node scripts/verify-release-artifacts.mjs --dir <解包目录> # 顺带校验 app-update.yml
 *   node scripts/verify-release-artifacts.mjs --allow-stale    # 只警告版本落后，不失败（开发态用）
 * 只读：不写任何文件。exit 0 = PASS。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const ALLOW_STALE = args.includes('--allow-stale')
const unpackedDir = flag('--dir')

const failures = []
const warnings = []
function check(name, ok, detail) {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`)
}
function warn(name, detail) {
  warnings.push(name)
  console.log(`WARN ${name}${detail ? '  [' + detail + ']' : ''}`)
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const pkg = JSON.parse(read('package.json'))
const distDir = path.join(ROOT, 'dist')

/* ── 1. owner/repo 的多处硬编码必须一致（U3） ─────────────────────────────── */
function ownerRepoFrom() {
  const out = {}
  const pub = pkg.build && pkg.build.publish
  if (pub && pub.owner && pub.repo) out['package.json build.publish'] = `${pub.owner}/${pub.repo}`

  const m = /const DEFAULT_UPDATE_REPO = '([^']+)'/.exec(read('main.js'))
  if (m) out['main.js DEFAULT_UPDATE_REPO'] = m[1]

  // build.ps1：可能是手写 heredoc，也可能已改为从 package.json 派生
  const bps = read('build.ps1')
  const derives = /build\.publish|\$pubRepo/.test(bps)
  const bo = /owner:\s*([A-Za-z0-9_.-]+)/.exec(bps)
  const br = /repo:\s*([A-Za-z0-9_.-]+)/.exec(bps)
  if (derives) out['build.ps1 app-update.yml'] = '(派生自 package.json build.publish)'
  else if (bo && br) out['build.ps1 app-update.yml'] = `${bo[1]}/${br[1]}`

  const rps = read('release.ps1')
  const ro = /\$owner = '([^']+)'/.exec(rps)
  const rr = /\$repo = '([^']+)'/.exec(rps)
  if (ro && rr) out['release.ps1 $owner/$repo'] = `${ro[1]}/${rr[1]}`

  const ips = read('install-update.ps1')
  const ir = /\$REPO\s+= '([^']+)'/.exec(ips)
  if (ir) out['install-update.ps1 $REPO'] = ir[1]

  // 打包产物里真正生效的那一份
  if (unpackedDir) {
    const y = path.join(unpackedDir, 'resources', 'app-update.yml')
    if (fs.existsSync(y)) {
      const text = fs.readFileSync(y, 'utf8')
      const o = /^owner:\s*(.+)$/m.exec(text)
      const r = /^repo:\s*(.+)$/m.exec(text)
      if (o && r) out['解包产物 resources/app-update.yml'] = `${o[1].trim()}/${r[1].trim()}`
    }
  }
  return out
}

const repos = ownerRepoFrom()
const concrete = Object.entries(repos).filter(([, v]) => !String(v).startsWith('('))
const uniqRepos = [...new Set(concrete.map(([, v]) => v))]
for (const [k, v] of Object.entries(repos)) console.log(`  · ${k} = ${v}`)
check('U3 GitHub owner/repo 各处硬编码一致（>=4 处参与比对）',
  concrete.length >= 4 && uniqRepos.length === 1,
  `参与比对 ${concrete.length} 处，去重取值 ${JSON.stringify(uniqRepos)}`)

/* ── 2. latest.yml ↔ package.json ↔ 安装包 ↔ blockmap（U4） ───────────────── */
const ymlPath = path.join(distDir, 'latest.yml')
if (!fs.existsSync(ymlPath)) {
  warn('dist/latest.yml 不存在', '尚未构建，或构建输出在工作区外；发布前必须先生成')
} else {
  const yml = fs.readFileSync(ymlPath, 'utf8')
  const yVersion = (/^version:\s*(.+)$/m.exec(yml) || [])[1]
  const yPath = (/^path:\s*(.+)$/m.exec(yml) || [])[1]
  const yUrl = (/^\s+-\s*url:\s*(.+)$/m.exec(yml) || [])[1]
  const ySha = (/^sha512:\s*(.+)$/m.exec(yml) || [])[1]
  const ySize = Number((/^\s+size:\s*(\d+)\s*$/m.exec(yml) || [])[1] || 0)

  const version = yVersion ? yVersion.trim() : null
  check('U4 latest.yml 的 version 与 package.json 一致',
    version === pkg.version || ALLOW_STALE,
    `latest.yml=${version} package.json=${pkg.version}${version !== pkg.version ? '（陈旧清单：发上去会让用户被指向旧版本）' : ''}`)

  const expectedName = `dsh-desktop-${pkg.version}-setup.exe`
  // 版本陈旧与 path/url 指向旧包是**同一个症状**，--allow-stale 对两者一致放行
  check('U4 latest.yml 的 path/url 指向本轮版本的安装包',
    (Boolean(yPath) && yPath.trim() === expectedName && Boolean(yUrl) && yUrl.trim() === expectedName) || ALLOW_STALE,
    `path=${yPath} url=${yUrl} 期望=${expectedName}`)

  const exe = yPath ? path.join(distDir, yPath.trim()) : null
  const exeExists = Boolean(exe) && fs.existsSync(exe)
  check('U4 latest.yml 指向的安装包确实存在', exeExists, exe || '(无 path)')

  if (exeExists) {
    const buf = fs.readFileSync(exe)
    const sha = crypto.createHash('sha512').update(buf).digest('base64')
    check('U4 latest.yml 的 sha512 与安装包实算一致', ySha && ySha.trim() === sha,
      `清单=${ySha ? ySha.trim().slice(0, 24) + '…' : '(无)'} 实算=${sha.slice(0, 24)}…`)
    check('U4 latest.yml 的 size 与安装包实际字节一致', ySize === buf.length, `清单=${ySize} 实际=${buf.length}`)
    const bm = exe + '.blockmap'
    check('U4 安装包的 .blockmap 存在（electron-updater 差分/校验要用）', fs.existsSync(bm), bm)
  }

  // dist/ 卫生：孤儿 blockmap 与遗留 .tmp 输出目录（陈旧产物冒充本轮产物的温床）
  const entries = fs.readdirSync(distDir, { withFileTypes: true })
  const exes = entries.filter((e) => e.isFile() && /-setup\.exe$/.test(e.name)).map((e) => e.name)
  const orphanBlockmaps = entries
    .filter((e) => e.isFile() && /\.blockmap$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => !exes.includes(n.replace(/\.blockmap$/, '')))
  const leftoverTmp = entries.filter((e) => e.isDirectory() && /\.tmp$/.test(e.name)).map((e) => e.name)
  const staleExes = exes.filter((n) => !n.includes(`-${pkg.version}-`))
  if (orphanBlockmaps.length) warn('dist/ 存在孤儿 blockmap（无对应安装包）', orphanBlockmaps.join(', '))
  if (leftoverTmp.length) warn('dist/ 存在遗留的 .tmp 输出目录（上次构建被中断）', leftoverTmp.join(', '))
  if (staleExes.length) {
    warn(`dist/ 堆积 ${staleExes.length} 个非本轮版本的历史安装包`,
      `本轮期望 ${expectedName}；历史包会让"按 mtime 挑最新"的脚本装错版本（见 U1）`)
  }
  // 卫生问题只警告不失败：历史遗留的孤儿 blockmap 不会让本轮发布出错，
  // 把它当硬门禁会让 `npm run dist` 在一个无关的陈旧文件上挂掉。
}

/* ── 2b. updaterCacheDirName 也散在多处，必须一致 ─────────────────────────── */
{
  const fromBuild = /updaterCacheDirName:\s*([A-Za-z0-9_.-]+)/.exec(read('build.ps1'))
  const fromInstall = /Join-Path \$env:LOCALAPPDATA '([A-Za-z0-9_.-]+)'/.exec(read('install-update.ps1'))
  const fromMain = /path\.join\(process\.env\.LOCALAPPDATA, '([A-Za-z0-9_.-]+)'\)/.exec(read('main.js'))
  const vals = {
    'build.ps1 app-update.yml': fromBuild ? fromBuild[1] : null,
    'install-update.ps1 Get-UpdaterCacheDir': fromInstall ? fromInstall[1] : null,
    'main.js killStaleUpdaterInstallers': fromMain ? fromMain[1] : null,
  }
  const uniq = [...new Set(Object.values(vals).filter(Boolean))]
  check('更新器缓存目录名在三处一致（不一致会漏杀僵尸安装器 / 清错缓存）',
    uniq.length === 1 && Object.values(vals).every(Boolean), JSON.stringify(vals))
}

/* ── 3. install-update.ps1 的选包判据（U1） ──────────────────────────────── */
{
  const ps = read('install-update.ps1')
  const byMtime = /Sort-Object LastWriteTime -Descending \| Select-Object -First 1/.test(ps)
  const byVersion = /Compare-PackageVersion/.test(ps) && /Get-PackageVersion/.test(ps)
  const hashCheck = /Get-FileHash|sha512|latest\.yml/i.test(ps)
  const downgradeGuard = /-Force|AllowOlder|older than installed/i.test(ps)
  check('U1 install-update.ps1 按版本（而非 mtime）挑安装包', !byMtime || byVersion,
    `按 mtime=${byMtime} 按版本=${byVersion}`)
  check('U1 install-update.ps1 校验安装包完整性（sha512 / latest.yml）', hashCheck, `命中=${hashCheck}`)
  check('U1 install-update.ps1 有降级防护（需显式 -Force 才装旧版）', downgradeGuard, `命中=${downgradeGuard}`)

  // U6（复核裁决 6）：-Download 自动路径必须从**同一个 Release** 取清单并校验。
  // “自动下载就跳过校验”不算闭环：%TEMP% 里可能早就摆着一份无关的 latest.yml，
  // 拿陈旧清单去校新包比不校更糟；而缺清单时应该**拒绝自动安装**，
  // 而不是提示一句“skipping hash verification”就继续装。
  const sameReleaseManifest = /\$ymlAsset/.test(ps) && /Test-InstallerManifest \$out/.test(ps)
  const refusesNoManifest = /cannot verify a downloaded installer without its manifest/.test(ps)
  const perReleaseDir = /dsh-update-/.test(ps)
  const tagCrossCheck = /does not match installer version/.test(ps)
  check('U6 -Download 从同一 Release 取 latest.yml 并校验（缺清单即拒绝自动安装）',
    sameReleaseManifest && refusesNoManifest && perReleaseDir && tagCrossCheck,
    `同源清单=${sameReleaseManifest} 缺清单拒绝=${refusesNoManifest} 每版本独立下载目录=${perReleaseDir} tag与版本交叉校验=${tagCrossCheck}`)
}

/* ── 4. main.js 不得把外部字符串裸拼进 PowerShell（U2） ──────────────────── */
{
  const main = read('main.js')
  const i = main.indexOf('function killStaleUpdaterInstallers()')
  const body = i >= 0 ? main.slice(i, i + 1000) : ''
  const interpolates = /StartsWith\('" \+ dir \+ "'/.test(body)
  const escapes = /replace\(/.test(body) && /''/.test(body)
  const usesEnv = /\$env:/.test(body)
  check('U2 killStaleUpdaterInstallers 不裸拼路径进 PowerShell（转义或改用 $env:）',
    body.length > 0 && (!interpolates || escapes || usesEnv),
    `裸拼=${interpolates} 单引号逸出=${escapes} 改用 $env:=${usesEnv}`)
}

/* ── 5. 发布路径上的 .ps1 必须是 ASCII-only（U5） ─────────────────────
 * build.ps1 / install-update.ps1 / release.ps1 各自的头部都明文要求 ASCII-only，
 * 并记下过真实事故（"This actually bit us: adding Chinese comments here produced
 * 'Unexpected token' and the build died"）。原因：Windows PowerShell 5.1 把无 BOM 的
 * .ps1 当 ANSI/GBK 读，非 ASCII 字节会解成双字节字符并吞掉行尾。但 build.ps1 自己
 * 就已经违反了两行（v0.1.31 引入），只是碰巧没炸。现在用代码钉住，不再靠运气。
 */
{
  const psFiles = ['build.ps1', 'release.ps1', 'install-update.ps1', 'prepare-runtime.ps1']
  for (const rel of psFiles) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) { warn(`${rel} 不存在`, '跳过'); continue }
    const buf = fs.readFileSync(abs)
    const bad = []
    for (let i = 0; i < buf.length; i++) if (buf[i] > 127) bad.push(i)
    check(`U5 ${rel} 不含非 ASCII 字节（PS 5.1 无 BOM 时按 ANSI/GBK 读）`,
      bad.length === 0,
      bad.length ? `首个偏移 ${bad[0]}，共 ${bad.length} 个非 ASCII 字节` : '全 ASCII')
  }
  // 语法解析只在 Windows 上做（这几个脚本本就是 Windows 专用，且需要 powershell 在位）
  if (process.platform === 'win32') {
    const { spawnSync } = await import('node:child_process')
    for (const rel of ['build.ps1', 'release.ps1', 'install-update.ps1', 'prepare-runtime.ps1']) {
      const abs = path.join(ROOT, rel)
      if (!fs.existsSync(abs)) continue
      const ps = `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${abs.replace(/'/g, "''")}',[ref]$null,[ref]$e);if($e){$e|ForEach-Object{"L$($_.Extent.StartLineNumber): $($_.Message)"};exit 1}else{exit 0}`
      const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
      check(`U5 ${rel} 能被 PowerShell 解析器解析（不执行）`, r.status === 0,
        String(r.stdout || r.stderr || '').trim().split('\n').slice(0, 3).join(' | '))
    }
  }
}

console.log('')
if (warnings.length) console.log(`警告 ${warnings.length} 项：${warnings.join(' | ')}`)
console.log(failures.length ? 'RELEASE_ARTIFACTS_FAIL ' + failures.join(' | ') : 'RELEASE_ARTIFACTS_OK')
process.exit(failures.length === 0 ? 0 : 1)
