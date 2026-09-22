/**
 * 全局热键（Electron accelerator）的校验与规范化。零 Electron 依赖，可单测。
 *
 * 为什么要单独成模块并**严格校验**：`globalShortcut.register()` 接受任意 accelerator，
 * 而它注册的是**系统级**热键。两类输入会造成真实的自我伤害，且 Electron 不会替你挡：
 *
 *   1. **无修饰键的裸键**（如 `D`）——注册成功后整个系统里再按 D 都不会输入字母，
 *      而是唤起本应用。等于把键盘劫持了，而且用户很难想到是这里造成的。
 *   2. **只用 Control(+Shift) + 字母/数字**（如 `Control+C` / `Control+S` / `Control+Z`）——
 *      会 shadow 掉所有应用的复制/保存/撤销。同样是全局性的、难排查的故障。
 *
 * 规则（宁可严一点，因为出错代价是全局的）：
 *   - 必须至少有一个修饰键；
 *   - 主键是字母或数字时，修饰键里必须含 Alt 或 Super/Command/CommandOrControl；
 *   - 主键是 F1–F24 或命名键（Home/Space/MediaPlayPause…）时，任意修饰键组合均可；
 *   - 一律规范化成 Electron 的标准写法（修饰键固定顺序、字母大写、F 键大写 F）。
 *
 * 设置面板只把校验通过的值写进 settings.json；主进程启动时也会再校验一次
 * （settings.json 可能被手工改成任意内容）。
 */

// CommonJS：本模块被 main.js（CJS）require，与 lib/shell-quote.js / lib/git-review.js 同口径。
// build.files 里的 "lib/*.js" 会把它打进 app.asar；verify-writing-package 的主进程依赖闭包检查会盯住这一点。

/** Electron 认可的修饰键别名 → 规范名。 */
const MODIFIERS = {
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
}

/** 修饰键的规范输出顺序（与 Electron 文档示例一致）。 */
const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super', 'Command', 'CommandOrControl']

/** 主键白名单：命名键。单字母与数字另行用正则放行。 */
const NAMED_KEYS = new Set([
  'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock',
  'Backspace', 'Delete', 'Insert', 'Escape',
  'VolumeUp', 'VolumeDown', 'VolumeMute',
  'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause',
  'PrintScreen',
  'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown',
])

/** 面板里给出的候选（都满足下面的规则，且实测不易与常见应用撞车）。 */
const PRESETS = [
  { accelerator: 'Control+Alt+D', label: 'Control + Alt + D（默认）' },
  { accelerator: 'Control+Alt+H', label: 'Control + Alt + H' },
  { accelerator: 'Control+Alt+K', label: 'Control + Alt + K' },
  { accelerator: 'Control+Alt+F1', label: 'Control + Alt + F1' },
]

const MAX_LEN = 64

function fail(error) {
  return { ok: false, error, accelerator: '' }
}

/** 主键是否属于"字母或数字"（这类键必须带 Alt/Super 才安全）。 */
function isLetterOrDigit(key) {
  return /^[A-Z0-9]$/.test(key)
}

/**
 * 校验并规范化一个 accelerator。
 * @param {string} raw 用户输入或 settings.json 里的值
 * @returns {{ok:true, accelerator:string, changed:boolean}|{ok:false, error:string, accelerator:''}}
 *   `changed` 表示规范化后的写法与输入不同（例如 `ctrl+alt+d` → `Control+Alt+D`）。
 */
function normalizeAccelerator(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return fail('empty')
  if (s.length > MAX_LEN) return fail('too-long')
  // 控制字符/换行/引号一律拒绝：这个串会进 settings.json、日志与菜单标签
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f"'<>]/.test(s)) return fail('illegal-char')

  const parts = s.split('+').map((p) => p.trim())
  if (parts.some((p) => !p)) return fail('empty-segment')

  const mods = []
  let key = ''
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (MODIFIERS[lower]) {
      const canonical = MODIFIERS[lower]
      if (!mods.includes(canonical)) mods.push(canonical)
      continue
    }
    if (key) return fail('multiple-keys') // 已经有一个主键了，第二个一定是写错
    key = part
  }

  if (!key) return fail('missing-key')
  if (!mods.length) return fail('missing-modifier')

  // 主键规范化
  let canonicalKey = key
  if (/^[A-Za-z]$/.test(key)) canonicalKey = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) canonicalKey = key
  else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) canonicalKey = 'F' + Number(key.slice(1))
  else if (/^(num[0-9]|numpad[0-9])$/i.test(key)) canonicalKey = 'num' + key.replace(/^[A-Za-z]+/, '')
  else {
    const named = [...NAMED_KEYS].find((k) => k.toLowerCase() === key.toLowerCase())
    if (!named) return fail('unknown-key')
    canonicalKey = named
  }

  // 规则 1：字母/数字主键必须带 Alt 或 Super/Command，否则会 shadow 掉
  // Control+C / Control+S / Control+Z 这类全系统都在用的编辑快捷键。
  if (isLetterOrDigit(canonicalKey)) {
    const hasAltOrSuper = mods.some((m) => m === 'Alt' || m === 'Super' || m === 'Command' || m === 'CommandOrControl')
    if (!hasAltOrSuper) return fail('letter-needs-alt-or-super')
  }

  const orderedMods = MOD_ORDER.filter((m) => mods.includes(m))
  const accelerator = [...orderedMods, canonicalKey].join('+')
  return { ok: true, accelerator, changed: accelerator !== s }
}

/** 把校验错误码翻成给人看的话（面板与托盘共用，避免各写一份文案）。 */
function explainAcceleratorError(error) {
  switch (error) {
    case 'empty': return '热键为空'
    case 'too-long': return `热键过长（上限 ${MAX_LEN} 字符）`
    case 'illegal-char': return '热键含非法字符（控制字符、引号或尖括号）'
    case 'empty-segment': return '热键格式不对：出现了空的片段（例如连续的 +）'
    case 'multiple-keys': return '热键只能有一个主键（例如 Control+Alt+D，而不是 Control+D+F）'
    case 'missing-key': return '热键缺少主键（只有修饰键）'
    case 'missing-modifier':
      return '热键必须至少带一个修饰键。裸键（例如 D）会在整个系统里劫持那个按键，已拒绝。'
    case 'letter-needs-alt-or-super':
      return '字母/数字主键必须搭配 Alt 或 Super/Command。只用 Control（例如 Control+C、Control+S）会让所有应用的复制/保存/撤销失效，已拒绝。'
    case 'unknown-key': return '无法识别的主键（可用：字母、数字、F1–F24、Home/End/PageUp/PageDown/方向键/Space/Tab/Media* 等）'
    default: return `热键无效：${error || '未知原因'}`
  }
}

module.exports = { normalizeAccelerator, explainAcceleratorError, PRESETS, MODIFIERS, NAMED_KEYS }
