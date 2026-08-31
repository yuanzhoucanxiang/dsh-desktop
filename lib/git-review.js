'use strict'

/**
 * 改动审阅的 git 层（纯 Node，不依赖 Electron）—— 单独成模块的理由：
 *   1. 可以用普通 node 跑单元测试（真仓库、真 git、毫秒级），不必起 Electron
 *   2. 逐 hunk 操作的补丁是在这里"重新从 git 读、现切现用"的，
 *      渲染侧只传 {文件, 第几块}，不传补丁文本 —— 避免拿旧补丁打到新文件上
 *   3. 万一以后要把审阅做成内核插件（生态原生路线），这一层可以整块搬走
 *
 * 约定：所有写操作都返回 { ok, error? }，错误信息带 git 的 stderr，能直接给用户看。
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const MAX_BUFFER = 64 * 1024 * 1024

/**
 * @param {() => string} getCwd 返回当前工作目录（外壳里就是 kernelCwd）
 */
function createGitReview(getCwd) {
  /** 跑 git：区分成功/失败，失败带 stderr（写操作必须能解释为什么失败）。 */
  function run(args, input) {
    try {
      const out = execFileSync('git', args, {
        cwd: getCwd(),
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        input,
      })
      return { ok: true, out: out || '' }
    } catch (err) {
      const msg = [err && err.stderr, err && err.stdout, err && err.message]
        .filter(Boolean).join('\n').trim()
      return { ok: false, out: '', error: msg || 'git 执行失败' }
    }
  }

  /** 只读场景的便捷版：失败返回 ''。 */
  const read = (args) => {
    const r = run(args)
    return r.ok ? r.out : ''
  }

  function isRepo() {
    return read(['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  }

  function init() {
    if (isRepo()) return { ok: true, already: true }
    const r = run(['init', '-q'])
    return { ok: r.ok, already: false, error: r.error }
  }

  /** 解析 git status --porcelain=v1：XY <path>（重命名取箭头右侧）。 */
  function parseStatus(out) {
    const files = []
    for (const line of String(out).split(/\r?\n/)) {
      if (!line) continue
      const xy = line.slice(0, 2)
      const rest = line.slice(3)
      const p = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest
      files.push({ status: xy, path: p.replace(/^"|"$/g, '') })
    }
    return files
  }

  /**
   * 把 `git diff [--cached] -- <file>` 拆成 { header, hunks[] }。
   * header = 第一个 @@ 之前的所有行（diff --git / index / --- / +++ / new file mode …）
   */
  function splitDiff(text) {
    const lines = String(text).split('\n')
    const first = lines.findIndex((l) => l.startsWith('@@'))
    if (first < 0) return { header: [], hunks: [] }
    const header = lines.slice(0, first)
    const hunks = []
    let cur = null
    for (let i = first; i < lines.length; i++) {
      const l = lines[i]
      if (l.startsWith('@@')) {
        if (cur) hunks.push(cur)
        cur = [l]
        continue
      }
      if (!cur) continue
      if (l.startsWith('diff --git ')) break // 只处理单文件的 diff
      cur.push(l)
    }
    if (cur) hunks.push(cur)
    return { header, hunks }
  }

  function countHunks(text) {
    return text ? splitDiff(text).hunks.length : 0
  }

  /** 现读现切：拼出只含第 idx 块的合法补丁。 */
  function hunkPatch(file, idx, staged) {
    const text = read(['diff', ...(staged ? ['--cached'] : []), '--', file])
    if (!text.trim()) return { ok: false, error: '这个文件已经没有对应的改动了（可能刚被处理过，刷新看看）' }
    const { header, hunks } = splitDiff(text)
    if (!hunks.length) return { ok: false, error: '这处改动无法按块处理（二进制文件或仅模式变更）' }
    if (!(idx >= 0 && idx < hunks.length)) {
      return { ok: false, error: `块序号越界：共 ${hunks.length} 块，收到 ${idx}` }
    }
    const patch = [...header, ...hunks[idx]].join('\n')
    return { ok: true, patch: patch.endsWith('\n') ? patch : patch + '\n', total: hunks.length }
  }

  function apply(args, patch) {
    const r = run(['apply', ...args, '-'], patch)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  /* ── 写操作 ─────────────────────────────────────────────────────────────── */

  /** 暂存：整文件（hunk 为 null）或某一块。 */
  function stage(file, hunk) {
    if (!file) return { ok: false, error: '缺少文件路径' }
    if (hunk === null || hunk === undefined) {
      const r = run(['add', '--', file])
      return r.ok ? { ok: true } : { ok: false, error: r.error }
    }
    const p = hunkPatch(file, hunk, false)
    if (!p.ok) return p
    return apply(['--cached'], p.patch)
  }

  /** 取消暂存：整文件用 reset（兼容老 git），单块用反向 apply 到索引。 */
  function unstage(file, hunk) {
    if (!file) return { ok: false, error: '缺少文件路径' }
    if (hunk === null || hunk === undefined) {
      const r = run(['reset', '-q', 'HEAD', '--', file])
      if (r.ok) return { ok: true }
      // 仓库还没有任何提交时没有 HEAD，用 rm --cached 退回未跟踪
      const r2 = run(['rm', '--cached', '-q', '--', file])
      return r2.ok ? { ok: true } : { ok: false, error: r.error }
    }
    const p = hunkPatch(file, hunk, true)
    if (!p.ok) return p
    return apply(['--cached', '--reverse'], p.patch)
  }

  /** 丢弃工作区的某一块改动（破坏性：调用方必须先让用户确认）。 */
  function revertHunk(file, hunk) {
    if (!file) return { ok: false, error: '缺少文件路径' }
    const p = hunkPatch(file, hunk, false)
    if (!p.ok) return p
    return apply(['--reverse'], p.patch)
  }

  /** 丢弃整个文件的改动（未跟踪文件 = 直接删）（破坏性）。 */
  function revertFile(file, untracked) {
    if (!file) return { ok: false, error: '缺少文件路径' }
    if (untracked) {
      // 外壳闸门传来的是绝对路径（workspacePath 已解析）：path.join 遇绝对路径
      // 不重置（拼成 cwd\<abs> 的畸形路径），必须按"绝对就用绝对、相对才拼 cwd"
      const target = path.isAbsolute(file) ? file : path.join(getCwd(), file)
      try {
        fs.rmSync(target, { force: true, recursive: false })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    }
    const staged = run(['reset', '-q', 'HEAD', '--', file])
    void staged // 先退索引再回工作区；没有 HEAD 时忽略失败
    const r = run(['checkout', '--', file])
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  function commit(message) {
    const msg = String(message || '').trim()
    if (!msg) return { ok: false, error: '提交信息不能为空' }
    const staged = read(['diff', '--cached', '--name-only']).trim()
    if (!staged) return { ok: false, error: '暂存区是空的：先把要提交的改动加进暂存区' }
    const r = run(['commit', '-m', msg])
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, hash: read(['rev-parse', '--short', 'HEAD']).trim(), out: r.out.trim() }
  }

  function push() {
    if (!read(['remote']).trim()) return { ok: false, error: '这个仓库没有配置远端（remote），无法推送' }
    const branch = read(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    const hasUpstream = run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).ok
    const args = hasUpstream ? ['push'] : ['push', '-u', 'origin', branch]
    const r = run(args)
    return r.ok ? { ok: true, out: (r.out || '').trim(), branch } : { ok: false, error: r.error }
  }

  /* ── 只读汇总 ───────────────────────────────────────────────────────────── */

  /**
   * 审阅面板的数据源。为兼容既有 UI 保留 files[].diff（未暂存+已暂存拼接），
   * 同时给出分开的 diffUnstaged / diffStaged 与各自的块数。
   */
  function changes() {
    const workspace = getCwd()
    if (!isRepo()) return { isGit: false, workspace, files: [] }
    const files = parseStatus(read(['status', '--porcelain=v1'])).map((f) => {
      const untracked = f.status === '??'
      const unstaged = untracked ? '' : read(['diff', '--', f.path])
      const staged = untracked ? '' : read(['diff', '--cached', '--', f.path])
      return {
        path: f.path,
        status: f.status,
        untracked,
        indexState: f.status[0],
        workState: f.status[1],
        diff: unstaged + (staged && staged !== unstaged ? staged : ''),
        diffUnstaged: unstaged,
        diffStaged: staged,
        hunksUnstaged: countHunks(unstaged),
        hunksStaged: countHunks(staged),
      }
    })
    return {
      isGit: true,
      workspace,
      branch: read(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
      hasRemote: !!read(['remote']).trim(),
      stagedCount: files.filter((f) => f.diffStaged).length,
      files,
    }
  }

  return {
    isRepo, init, changes, parseStatus, splitDiff, countHunks, hunkPatch,
    stage, unstage, revertHunk, revertFile, commit, push,
  }
}

module.exports = { createGitReview }
