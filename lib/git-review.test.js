'use strict'

/**
 * 改动审阅 git 层的单元测试（普通 node 跑，秒级）：
 *   node lib/git-review.test.js       → 打印每项 PASS/FAIL，exit 0 = 通过
 * 在系统临时目录里建真仓库、跑真 git，测完删干净；不碰用户仓库、不起 Electron。
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createGitReview } = require('./git-review')

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`)
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gitrev-'))
const g = createGitReview(() => repo)
const sh = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
const write = (p, s) => fs.writeFileSync(path.join(repo, p), s)
const readFile = (p) => fs.readFileSync(path.join(repo, p), 'utf8')

try {
  /* ── 准备：一个有 10 行的文件，先提交打底 ─────────────────────────────── */
  sh(['init', '-q'])
  sh(['config', 'user.email', 't@t'])
  sh(['config', 'user.name', 'tester'])
  sh(['config', 'commit.gpgsign', 'false'])
  const base = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  write('a.txt', base)
  sh(['add', 'a.txt'])
  sh(['commit', '-q', '-m', 'base'])

  check('isRepo() 认得仓库', g.isRepo() === true)
  check('非仓库目录返回 isGit:false', createGitReview(() => os.tmpdir()).changes().isGit === false)

  /* ── 造两处相距很远的改动 → 应该切成 2 个 hunk ─────────────────────────── */
  const edited = base.replace('line 1', 'LINE ONE').replace('line 12', 'LINE TWELVE')
  write('a.txt', edited)
  write('new.txt', 'brand new\n') // 未跟踪文件

  let c = g.changes()
  check('changes() 列出两个文件', c.files.length === 2, c.files.map((f) => f.path).join(','))
  const a = c.files.find((f) => f.path === 'a.txt')
  const n = c.files.find((f) => f.path === 'new.txt')
  check('未跟踪文件被标记', !!n && n.untracked === true)
  check('a.txt 切出 2 个未暂存 hunk', a.hunksUnstaged === 2, `hunks=${a.hunksUnstaged}`)
  check('a.txt 还没有已暂存内容', a.hunksStaged === 0)
  check('changes() 带分支名', !!c.branch, c.branch)

  /* ── 逐 hunk 暂存：只暂存第 0 块 ───────────────────────────────────────── */
  const p0 = g.hunkPatch('a.txt', 0, false)
  check('hunkPatch 生成合法补丁头', p0.ok && /^diff --git /.test(p0.patch) && p0.patch.includes('@@'),
    p0.ok ? p0.patch.split('\n')[0] : p0.error)
  check('hunkPatch 越界会报错', g.hunkPatch('a.txt', 9, false).ok === false)

  check('stage(第0块) 成功', g.stage('a.txt', 0).ok === true)
  c = g.changes()
  const a2 = c.files.find((f) => f.path === 'a.txt')
  check('暂存后：已暂存 1 块 / 未暂存 1 块',
    a2.hunksStaged === 1 && a2.hunksUnstaged === 1,
    `staged=${a2.hunksStaged} unstaged=${a2.hunksUnstaged}`)
  check('暂存的是第 1 行那块', a2.diffStaged.includes('LINE ONE') && !a2.diffStaged.includes('LINE TWELVE'))
  check('工作区文件未被改动', readFile('a.txt') === edited)
  check('stagedCount 统计正确', c.stagedCount === 1, String(c.stagedCount))

  /* ── 取消暂存（逐块 → 回到全未暂存） ──────────────────────────────────── */
  check('unstage(第0块) 成功', g.unstage('a.txt', 0).ok === true)
  const a3 = g.changes().files.find((f) => f.path === 'a.txt')
  check('取消暂存后：已暂存 0 块 / 未暂存 2 块',
    a3.hunksStaged === 0 && a3.hunksUnstaged === 2,
    `staged=${a3.hunksStaged} unstaged=${a3.hunksUnstaged}`)
  check('取消暂存不动工作区', readFile('a.txt') === edited)

  /* ── 逐 hunk 丢弃：只丢第 1 块（末尾那处），第 0 块必须留着 ───────────── */
  check('revertHunk(第1块) 成功', g.revertHunk('a.txt', 1).ok === true)
  const after = readFile('a.txt')
  check('第 1 块被丢弃（line 12 复原）', after.includes('line 12') && !after.includes('LINE TWELVE'))
  check('第 0 块仍在（LINE ONE 保留）', after.includes('LINE ONE'), '这是"逐块"的关键：不能把整文件都还原了')

  /* ── 提交：空暂存区要拒绝，提交后工作区干净 ────────────────────────────── */
  check('空暂存区拒绝提交', g.commit('nope').ok === false)
  check('空提交信息被拒绝', g.commit('   ').ok === false)
  check('stage 整文件成功', g.stage('a.txt', null).ok === true)
  const cm = g.commit('feat: 逐块暂存后提交')
  check('commit 成功并返回短 hash', cm.ok === true && /^[0-9a-f]{6,}$/.test(cm.hash || ''), cm.ok ? cm.hash : cm.error)
  check('提交后 a.txt 不再出现在改动里',
    !g.changes().files.some((f) => f.path === 'a.txt'),
    g.changes().files.map((f) => f.path).join(','))

  /* ── 未跟踪文件：暂存 → 取消暂存 → 丢弃（删除） ────────────────────────── */
  check('stage 未跟踪文件成功', g.stage('new.txt', null).ok === true)
  check('暂存后仍被列出', g.changes().files.some((f) => f.path === 'new.txt'))
  check('unstage 未跟踪文件成功', g.unstage('new.txt', null).ok === true)
  check('revertFile(未跟踪) 删掉文件', g.revertFile('new.txt', true).ok === true
    && !fs.existsSync(path.join(repo, 'new.txt')))

  /* ── 无远端时推送要给出人话错误 ────────────────────────────────────────── */
  const ps = g.push()
  check('没有远端时 push 明确报错', ps.ok === false && /远端|remote/.test(ps.error || ''), ps.error)

  /* ── 已删除文件也要能审阅/暂存 ─────────────────────────────────────────── */
  fs.rmSync(path.join(repo, 'a.txt'))
  const del = g.changes().files.find((f) => f.path === 'a.txt')
  check('删除也算改动并有 diff', !!del && del.diffUnstaged.includes('@@'), del ? del.status : 'missing')
  check('stage 删除操作成功', g.stage('a.txt', null).ok === true)
  check('删除进入暂存区', (g.changes().files.find((f) => f.path === 'a.txt') || {}).hunksStaged >= 1)
} catch (err) {
  check('测试自身未抛异常', false, err && err.stack ? err.stack : String(err))
} finally {
  try {
    fs.rmSync(repo, { recursive: true, force: true })
  } catch {}
}

console.log(failures.length ? 'GIT_REVIEW_FAIL ' + failures.join(' | ') : 'GIT_REVIEW_OK')
process.exit(failures.length === 0 ? 0 : 1)
