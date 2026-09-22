/**
 * git 审阅层 hunt 探针（2026-09-21）· 真仓库真 git，全部在 %TEMP% 隔离目录。
 * 不碰用户工作区、不启动 Electron、不结束任何进程。
 *
 * REPRODUCED = 缺陷已复现。
 *
 * ⚠ 本文件是 **G1–G4 的原始复现取证**，不是回归门禁；修复后重跑应全部 NOT_REPRODUCED。
 * 永久正向门禁在 lib/git-review.test.js（G1–G4 共 14 项断言）。
 * 跑法：node docs/audits/writing-hardening/2026-09-21/hunt-git.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const { createGitReview } = require(path.join(ROOT, 'lib/git-review.js'))

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-git-hunt-'))
const repo = path.join(temp, 'repo')
fs.mkdirSync(repo, { recursive: true })

const git = (args, opts = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, ...opts })
git(['init', '-q'])
git(['config', 'user.email', 'probe@example.invalid'])
git(['config', 'user.name', 'probe'])
git(['config', 'core.autocrlf', 'false'])

const results = []
function finding(id, title, reproduced, evidence) {
  results.push({ id, title, reproduced })
  console.log(`${reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED'} ${id} ${title}`)
  for (const line of evidence) console.log(`    ${line}`)
}

// ── 素材：ASCII 对照组 + 中文名（跟踪态有改动 / 未跟踪态） ──
const asciiName = 'bible/plain.md'
const cnName = 'bible/世界观整理.md'          // 写作模式投影真实生成的文件名
const cnUntracked = 'draft/第一章 夜航.md'     // 中文 + 空格（位于全新未跟踪目录，会被折叠）
fs.mkdirSync(path.join(repo, 'bible'), { recursive: true })
fs.mkdirSync(path.join(repo, 'draft'), { recursive: true })
fs.writeFileSync(path.join(repo, asciiName), 'line1\nline2\n')
fs.writeFileSync(path.join(repo, cnName), 'line1\nline2\n')
git(['add', '--', asciiName, cnName])
git(['commit', '-q', '-m', 'init'])
// 改一行，制造未暂存改动
fs.writeFileSync(path.join(repo, asciiName), 'line1\nline2-CHANGED\n')
fs.writeFileSync(path.join(repo, cnName), 'line1\nline2-CHANGED\n')
// 未跟踪新文件
fs.writeFileSync(path.join(repo, cnUntracked), '新章节正文\n')
fs.writeFileSync(path.join(repo, 'bible/ascii-untracked.md'), 'new\n')

const quotepath = (() => { try { return git(['config', '--get', 'core.quotepath']).trim() || '(未设置)' } catch { return '(未设置 → git 默认 true)' } })()
const rawStatus = git(['status', '--porcelain=v1'])

const review = createGitReview(() => repo)
const changes = review.changes()
const byPath = new Map(changes.files.map((f) => [f.path, f]))

const cnRow = changes.files.find((f) => f.path.includes('世界') || f.path.includes('\\3'))
const asciiRow = byPath.get(asciiName)

console.log('--- 原始 git status ---')
for (const l of rawStatus.split('\n')) if (l.trim()) console.log('    ' + l)
console.log('--- parseStatus 解析结果 ---')
for (const f of changes.files) console.log(`    path=${JSON.stringify(f.path)} untracked=${f.untracked} hunksUnstaged=${f.hunksUnstaged} diffLen=${(f.diffUnstaged || '').length}`)

// ─────────────────────────────────────────────────────────────
// G1 · core.quotepath 默认开启 → 非 ASCII 路径以八进制转义返回，parseStatus 只脱引号不解码
// ─────────────────────────────────────────────────────────────
const cnPathIsEscaped = Boolean(cnRow) && !cnRow.path.includes('世界') && /\\\d{3}/.test(cnRow.path)
const cnDiffEmpty = Boolean(cnRow) && (cnRow.diffUnstaged || '').length === 0 && cnRow.hunksUnstaged === 0
const asciiDiffOk = Boolean(asciiRow) && (asciiRow.diffUnstaged || '').length > 0 && asciiRow.hunksUnstaged === 1

finding(
  'G1',
  '审阅面板对中文文件名解析错误：路径显示为八进制转义、diff 空白、块数为 0（ASCII 文件正常）',
  cnPathIsEscaped && cnDiffEmpty && asciiDiffOk,
  [
    `core.quotepath = ${quotepath}`,
    `中文名跟踪文件 → 面板 path=${JSON.stringify(cnRow?.path)} hunksUnstaged=${cnRow?.hunksUnstaged} diffUnstaged.length=${(cnRow?.diffUnstaged || '').length}`,
    `ASCII 对照组   → 面板 path=${JSON.stringify(asciiRow?.path)} hunksUnstaged=${asciiRow?.hunksUnstaged} diffUnstaged.length=${(asciiRow?.diffUnstaged || '').length}`,
    `parseStatus 只做 p.replace(/^"|"$/g,'')，未做八进制解码（git-review.js:65）`,
    `preload.js:1158 的暂存按钮条件是 f.untracked || f.diffUnstaged → 中文名跟踪文件两个都不成立，按钮根本不出现`,
    '直接影响：写作模式投影生成的 bible/世界观整理.md 在审阅面板里既看不到改动也无法暂存',
  ]
)

// ─────────────────────────────────────────────────────────────
// G2 · 拿着转义路径回传主进程：删除未跟踪文件报成功而文件仍在
//      场景：新中文文件放在**已被跟踪的目录**里 → git 会逐文件报 ??（不折叠成目录）
// ─────────────────────────────────────────────────────────────
const cnUntrackedInTrackedDir = 'bible/新章节.md'
fs.writeFileSync(path.join(repo, cnUntrackedInTrackedDir), '新章节正文\n')
const rows2 = review.changes().files
const cnUnRow = rows2.find((f) => f.untracked && /\\\d{3}/.test(f.path))
const absEscaped = path.resolve(repo, String(cnUnRow?.path || ''))

const stageRes = review.stage(absEscaped, null)
const realAbs = path.join(repo, cnUntrackedInTrackedDir)
const before = fs.existsSync(realAbs)
const revertRes = review.revertFile(absEscaped, true)   // main.js:2317 → { ok: revertFile(fp, !!untracked).ok }
const after = fs.existsSync(realAbs)

// 对照组：ASCII 未跟踪文件走同一条路径能真删
fs.writeFileSync(path.join(repo, 'bible/ascii-untracked2.md'), 'new\n')
const asciiAbs = path.resolve(repo, 'bible/ascii-untracked2.md')
const revertAscii = review.revertFile(asciiAbs, true)
const asciiGone = !fs.existsSync(asciiAbs)

finding(
  'G2',
  '对中文未跟踪文件点「删除」：rmSync(force) 吞掉 ENOENT → 返回 ok:true，UI 报成功但文件原封不动',
  Boolean(cnUnRow) && revertRes.ok === true && before && after && asciiGone,
  [
    `真实文件 = ${cnUntrackedInTrackedDir}（放在已跟踪目录内，git 逐文件上报）`,
    `面板 path = ${JSON.stringify(cnUnRow?.path)} untracked=${cnUnRow?.untracked} → 按钮文案为「删除」`,
    `stage(转义绝对路径) → ok=${stageRes.ok} error=${JSON.stringify((stageRes.error || '').split('\n')[0])}`,
    `revertFile(转义绝对路径, untracked=true) → ok=${revertRes.ok}（force:true 让 ENOENT 不算失败）`,
    `真实文件删除前存在=${before} 删除后仍存在=${after}`,
    `ASCII 对照组 revertFile → ok=${revertAscii.ok} 文件已消失=${asciiGone}`,
    '这是本项目反复踩过的「失败也报成功」类型（见 WORKLOG 2026-08-21 修掉的两个历史测试）',
  ]
)

// ─────────────────────────────────────────────────────────────
// G4 · 未跟踪目录被折叠成一行 `dir/`：目录下新文件无法逐个审阅/删除
// ─────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(repo, '新作品', 'draft'), { recursive: true })
fs.writeFileSync(path.join(repo, '新作品', 'project.md'), '# 新作品\n')
fs.writeFileSync(path.join(repo, '新作品', 'draft', '第一章.md'), '正文\n')
const dirRow = review.changes().files.find((f) => f.untracked && f.path.endsWith('/'))
let dirDelete = null
if (dirRow) dirDelete = review.revertFile(path.resolve(repo, dirRow.path), true)
finding(
  'G4',
  'changes() 用 git status --porcelain=v1（无 -uall），新建目录折叠成一行 `dir/`：目录内所有新文件在面板里不可见、删除按钮必然报错',
  Boolean(dirRow) && dirDelete?.ok === false,
  [
    `面板行 = ${JSON.stringify(dirRow?.path)} untracked=${dirRow?.untracked}（目录内 2 个文件全部不可见）`,
    `对它点「删除」→ revertFile → ok=${dirDelete?.ok} error=${JSON.stringify((dirDelete?.error || '').split('\n')[0])}`,
    'rmSync 用 recursive:false，遇到目录必然失败；而 revertAll 走 git clean -fd 却能删 → 单个删不掉、全删能删',
    'git-review.js:225 read([status,--porcelain=v1]) 缺 -uall / --untracked-files=all',
  ]
)

// ─────────────────────────────────────────────────────────────
// G3 · 重命名解析（' -> ' 切分）：正常路径可用；*nix 上路径本身含 ' -> ' 会错位
//      （Windows 文件名禁止 '>'，故本机不可达；macOS 构建已发布，同源代码）
// ─────────────────────────────────────────────────────────────
const rnSrc = 'bible/renamed-src.md'
const rnDst = 'bible/renamed-dst.md'
fs.writeFileSync(path.join(repo, rnSrc), 'aaaaaaaa\nbbbbbbbb\ncccccccc\ndddddddd\n')
git(['add', '--', rnSrc])
git(['commit', '-q', '-m', 'add rename source'])
git(['mv', rnSrc, rnDst])
fs.writeFileSync(path.join(repo, rnDst), 'aaaaaaaa\nbbbbbbbb\ncccccccc\nCHANGED\n')
const rnRow = review.changes().files.find((f) => f.path.includes('renamed-dst'))
// 缺陷本体：非重命名行（XY 不含 R/C）的路径里带 ' -> ' 时被当成重命名切分。
// 修复后应按 XY 状态位判定，路径原样保留 → 本项转 NOT_REPRODUCED。
const legacyRow = review.parseStatus(' M draft/a -> b.md\n')[0]
const splitWrongly = Boolean(legacyRow) && legacyRow.path !== 'draft/a -> b.md'
finding(
  'G3',
  "parseStatus 把非重命名行里含 ' -> ' 的路径误切（应按 porcelain 的 R/C 状态位判重命名）",
  splitWrongly,
  [
    `重命名行（-z）解析结果 = path=${JSON.stringify(rnRow?.path)} origPath=${JSON.stringify(rnRow?.origPath)} status=${JSON.stringify(rnRow?.status)}`,
    `兼容分支对 ' M draft/a -> b.md' 的解析 = ${JSON.stringify(legacyRow)}`,
    `路径被误切 = ${splitWrongly}`,
    "旧写法：const p = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest（不看 XY）",
    "Windows 文件名禁止 '>'，本机只能用兼容分支取证；macOS dmg 已发布且共用同一份 lib/git-review.js",
  ]
)

console.log('\n=== 汇总 ===')
console.log(`隔离目录：${temp}`)
console.log(`复现 ${results.filter((r) => r.reproduced).length} / ${results.length}`)
for (const r of results) console.log(`  ${r.reproduced ? '[REPRODUCED]' : '[  clean   ]'} ${r.id} ${r.title}`)
console.log('GIT_HUNT_DONE')
