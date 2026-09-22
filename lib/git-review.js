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
  /** 跑 git：区分成功/失败，失败带 stderr（写操作必须能解释为什么失败）。
   *
   *  G1：统一带 `-c core.quotepath=false`。git 默认会把非 ASCII 路径转成
   *  "\344\270\226..." 八进制转义，而本文件只脱了引号、没解码——于是中文文件名
   *  在审阅面板里 diff 空白、块数 0、暂存按钮不出现（本项目默认库根就是中文路径，
   *  写作模式投影生成的正是 bible/世界观整理.md）。 */
  function run(args, input) {
    try {
      const out = execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
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

  /**
   * 解析 `git status --porcelain=v1 -z`：NUL 分隔，字段内不再引号转义。
   *
   * G1：不再靠「脱引号」猜测路径——原始字节就是真实路径，中文/空格/引号全对。
   * G3：重命名靠 XY 状态位 + 紧随其后的第二个 NUL 字段识别，而不是在路径里找 ' -> '
   *     （文件名本身包含 ' -> ' 时旧写法会把路径切成不存在的目标；macOS 上可构造）。
   * 兼容：如果调用方传的是不带 -z 的文本（行分隔、可能带引号），退到按行解析并做
   *     C 风格反转义，保证单独调用 parseStatus 的旧用法不会静默给出错路径。
   */
  function parseStatus(out) {
    const text = String(out)
    const files = []
    if (text.includes('\0')) {
      const parts = text.split('\0')
      for (let i = 0; i < parts.length; i++) {
        const rec = parts[i]
        if (!rec || rec.length < 4) continue
        const xy = rec.slice(0, 2)
        const p = rec.slice(3)
        const row = { status: xy, path: p }
        if (xy[0] === 'R' || xy[0] === 'C') {
          row.origPath = parts[i + 1] || ''
          i++ // 消费掉原路径字段
        }
        files.push(row)
      }
      return files
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      const xy = line.slice(0, 2)
      const rest = line.slice(3)
      const isRename = xy[0] === 'R' || xy[0] === 'C'
      const p = isRename && rest.includes(' -> ') ? rest.split(' -> ')[1] : rest
      const row = { status: xy, path: unquoteGitPath(p) }
      if (isRename && rest.includes(' -> ')) row.origPath = unquoteGitPath(rest.split(' -> ')[0])
      files.push(row)
    }
    return files
  }

  /**
   * git 的 C 风格引号路径："bible/\344\270\226.md" → bible/世.md（仅非 -z 兼容路径使用）。
   *
   * 坑：八进制转义是 **UTF-8 字节**而不是码点。一个汉字会拆成三个 \NNN，
   * 必须先把字节收集起来再整体解码；逐转义用 String.fromCharCode 会得到
   * "ä¸\x96" 这种拉丁文碎片（回归测试已钉死这一点）。
   */
  function unquoteGitPath(p) {
    const s = String(p)
    if (!s.startsWith('"') || !s.endsWith('"')) return s
    const inner = s.slice(1, -1)
    const SIMPLE = { '\\': 0x5c, '"': 0x22, n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c, v: 0x0b }
    const bytes = []
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]
      if (ch !== '\\') {
        for (const b of Buffer.from(ch, 'utf8')) bytes.push(b)
        continue
      }
      const next = inner[i + 1]
      if (next === undefined) break
      if (/^[0-7]$/.test(next)) {
        let oct = ''
        let j = i + 1
        while (j < inner.length && oct.length < 3 && /^[0-7]$/.test(inner[j])) { oct += inner[j]; j++ }
        bytes.push(parseInt(oct, 8) & 0xff)
        i = j - 1
        continue
      }
      const simple = SIMPLE[next]
      if (simple !== undefined) {
        bytes.push(simple)
        i++
        continue
      }
      for (const b of Buffer.from(next, 'utf8')) bytes.push(b)
      i++
    }
    return Buffer.from(bytes).toString('utf8')
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
    // 外壳闸门传来的是绝对路径（workspacePath 已解析）：path.join 遇绝对路径
    // 不重置（拼成 cwd\<abs> 的畸形路径），必须按"绝对就用绝对、相对才拼 cwd"
    const target = path.isAbsolute(file) ? file : path.join(getCwd(), file)
    if (untracked) {
      // G2：删除必须**先确认目标存在且是文件、删完再复核已消失**。
      // 旧写法用 rmSync(force:true)，ENOENT 被 force 吞掉 → 路径不对也返回 ok:true，
      // UI 报「已删除」而文件原封不动（配 G1 的转义路径就是活生生的假成功）。
      let st
      try {
        st = fs.lstatSync(target)
      } catch (err) {
        return { ok: false, error: err.code === 'ENOENT' ? '这个文件已经不在了（可能刚被处理过，刷新看看）' : err.message }
      }
      if (st.isDirectory()) {
        return { ok: false, error: '这是一个目录：请逐个处理里面的文件，或用「全部丢弃」' }
      }
      try {
        fs.rmSync(target, { force: false, recursive: false })
      } catch (err) {
        return { ok: false, error: err.message }
      }
      if (fs.existsSync(target)) return { ok: false, error: '删除后文件仍然存在，未当作成功' }
      return { ok: true }
    }
    const staged = run(['reset', '-q', 'HEAD', '--', file])
    void staged // 先退索引再回工作区；没有 HEAD 时忽略失败
    const r = run(['checkout', '--', file])
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  /** 暂存全部未提交改动（含未跟踪；可逆，调用方无需确认）。 */
  function stageAll() {
    if (!isRepo()) return { ok: false, error: '当前目录不是 git 仓库' }
    const r = run(['add', '-A'])
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  /**
   * 丢弃全部未提交改动（破坏性：调用方必须先让用户确认）。
   * 跟踪文件 checkout 还原；未跟踪文件 clean 删除。分两步并报告各自结果。
   */
  function revertAll() {
    if (!isRepo()) return { ok: false, error: '当前目录不是 git 仓库' }
    const reset = run(['reset', '-q', 'HEAD'])
    void reset // 无 HEAD 的空仓库忽略
    const tracked = run(['checkout', '--', '.'])
    const clean = run(['clean', '-fd'])
    if (!tracked.ok) return { ok: false, error: tracked.error }
    if (!clean.ok) return { ok: true, note: `已还原跟踪文件，但清理未跟踪文件失败：${clean.error}` }
    return { ok: true }
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
    // -z：路径不转义（G1）；--untracked-files=all：新目录不再折叠成一行 `dir/`（G4）——
    // 折叠时目录内的新文件在面板里全部不可见，而 revertFile 对目录又必然失败
    // （recursive:false），形成「单个删不掉、全部丢弃却能删」的矛盾。
    const files = parseStatus(read(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).map((f) => {
      const untracked = f.status === '??'
      const unstaged = untracked ? '' : read(['diff', '--', f.path])
      const staged = untracked ? '' : read(['diff', '--cached', '--', f.path])
      return {
        path: f.path,
        origPath: f.origPath || null,
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
    isRepo, init, changes, parseStatus, unquoteGitPath, splitDiff, countHunks, hunkPatch,
    stage, unstage, stageAll, revertHunk, revertFile, revertAll, commit, push,
  }
}

module.exports = { createGitReview }
