'use strict'

/**
 * shell 引号处理（零 Electron 依赖，可单测）。
 *
 * 为什么单独成模块：`notifyCommand` 钩子用 `spawn(cmd, { shell: true })` 执行，
 * 命令串里的 `{cwd}` / `{workspace}` 占位符会被替换成工作区路径。原来直接拼裸路径，
 * 路径里的 `& | > < ^ "` 会被 cmd.exe 当命令分隔符——实测工作区名为
 * `ws & node s3-payload.js` 时，钩子命令 `echo hook {cwd}` 会真的执行 `&` 后面的载荷。
 * 这既是安全问题（路径可由「设置工作目录」选定，也可来自 DSH_DESKTOP_CWD 环境变量），
 * 也是正确性问题（含 `&` 的合法路径会让钩子静默跑错命令）。
 *
 * 分寸：只含安全字符时**原样返回**，保证既有钩子命令逐字节不变、不引入回归。
 */

/** Windows 下需要加引号的字符（cmd.exe 元字符 + 空白 + 百分号变量展开）。 */
const WIN_UNSAFE = /[&|<>^"%\s]/
/** POSIX sh 下可裸写的字符集；其余一律单引号包裹。 */
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

/**
 * 按目标平台给一个**路径值**加 shell 引号。
 * @param {string} value
 * @param {{win?: boolean}} [opts] 便于在 Windows 上单测 POSIX 分支
 * @returns {string}
 */
function shellQuotePath(value, opts = {}) {
  const s = String(value ?? '')
  const win = opts.win !== undefined ? Boolean(opts.win) : process.platform === 'win32'
  if (win) {
    // cmd.exe：双引号包裹，内部双引号按 "" 逸出
    return WIN_UNSAFE.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  if (POSIX_SAFE.test(s)) return s
  // POSIX sh：单引号包裹，内部单引号用 '\'' 逸出
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * 替换钩子命令里的占位符。路径类占位符一律经 shellQuotePath；
 * `{files}` 强制成整数（它本来就是计数，不该成为注入面）。
 */
function expandNotifyCommand(raw, { files = 0, cwd = '' } = {}, opts = {}) {
  const quoted = shellQuotePath(cwd, opts)
  return String(raw ?? '')
    .replaceAll('{files}', String(Number(files) || 0))
    .replaceAll('{cwd}', quoted)
    .replaceAll('{workspace}', quoted)
}

module.exports = { shellQuotePath, expandNotifyCommand }
