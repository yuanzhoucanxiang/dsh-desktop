'use strict'

/**
 * Electron 门禁的环境前置体检。
 *
 * ## 为什么需要（2026-11-20 实测两条门禁同时假红）
 *
 * 本仓库的 Electron 门禁是 `electron.exe scripts/xxx.cjs` **直接**跑的。
 * 若环境里带着 `ELECTRON_RUN_AS_NODE=1`（部分 IDE / 终端 / agent 运行器会设它），
 * electron.exe 会退化成**纯 Node**：`require('electron')` 返回的是可执行文件路径字符串，
 * 于是门禁里那句 `const { app } = require('electron')` 得到 `app === undefined`，
 * 实际报错是：
 *
 *   TypeError: Cannot read properties of undefined (reading 'setPath')
 *       at Object.<anonymous> (.../verify-workbench-writing-integration.cjs:23:5)
 *
 * 这条错误**完全没提环境变量**，看起来像门禁坏了/回归了 —— 实测为此白查一轮。
 *
 * ## 用法
 *
 * 每个 Electron 门禁在文件最前面（早于任何 `app.*` 使用）加一行：
 *
 *   require('./lib/electron-gate.cjs').assertElectronGate()
 *
 * 正常环境：静态返回，几乎零成本。
 * 环境不对：打印可执行的修法并 `exit 78`（EX_CONFIG），与业务断言失败区分开。
 */

/** 是不是以 Electron 主进程身份在跑（含 app 对象）。 */
function isElectronMain() {
  let electron
  try {
    electron = require('electron')
  } catch {
    return false
  }
  // 纯 Node 模式下 `require('electron')` 返回的是字符串路径
  if (typeof electron === 'string' || !electron) return false
  return Boolean(electron.app)
}

/** 环境不对时给出修法并退出；对就什么都不做。 */
function assertElectronGate() {
  if (isElectronMain()) return
  const raw = process.env.ELECTRON_RUN_AS_NODE
  const where = process.env.DSH_GATE_NAME || process.argv[1] || '(unknown script)'
  const lines = [
    '',
    '  [环境] 这个门禁必须以 Electron 主进程运行，但当前进程不是。',
    `  [环境] 脚本：${where}`,
  ]
  if (raw) {
    lines.push(
      `  [环境] 检测到 ELECTRON_RUN_AS_NODE=${raw} —— 它让 electron.exe 退化成纯 Node`,
      '         （于是 require("electron").app 是 undefined，报的却是 setPath 之类）',
    )
  } else {
    lines.push('  [环境] 没有拿到 electron 的 app 对象（可能不是用 electron.exe 启动的）')
  }
  lines.push(
    '  [修法] PowerShell：  Remove-Item Env:ELECTRON_RUN_AS_NODE',
    '         bash/zsh：    unset ELECTRON_RUN_AS_NODE',
    '         或者改用：    npm run <对应的 verify:* 脚本>',
    '',
  )
  console.error(lines.join('\n'))
  process.exit(78)
}

module.exports = { assertElectronGate, isElectronMain }
