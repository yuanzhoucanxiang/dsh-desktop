/**
 * lib/hotkey.js 的单元测试（全局热键 accelerator 校验）。
 *
 * 重点不是"能解析"，而是**该拒的必须拒**：注册的是系统级热键，
 * 裸键会劫持整个键盘，Control+字母会 shadow 掉所有应用的复制/保存/撤销。
 * 这两类是 Electron 不会替你挡的自我伤害。
 *
 * 跑法：node lib/hotkey.test.js   （npm run hotkey-test）
 */
'use strict'

const { normalizeAccelerator, explainAcceleratorError, PRESETS } = require('./hotkey.js')

let pass = 0
const failures = []
function check(name, ok, detail) {
  if (ok) pass++
  else failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''}`)
}

/** 断言通过并规范化到期望值。 */
function accepts(name, input, expected) {
  const r = normalizeAccelerator(input)
  check(name, r.ok === true && r.accelerator === expected, JSON.stringify(r))
}

/** 断言被拒且错误码正确。 */
function rejects(name, input, code) {
  const r = normalizeAccelerator(input)
  check(name, r.ok === false && r.error === code && r.accelerator === '', JSON.stringify(r))
}

/* ── 合法输入 ───────────────────────────────────────────────────────────── */
accepts('默认热键原样通过', 'Control+Alt+D', 'Control+Alt+D')
accepts('大小写与别名规范化（ctrl → Control，d → D）', 'ctrl+alt+d', 'Control+Alt+D')
accepts('Cmd 别名规范化为 Command', 'Cmd+Alt+K', 'Alt+Command+K')
accepts('CommandOrControl 保留（按 MOD_ORDER 排在 Alt 之后）', 'CommandOrControl+Alt+K', 'Alt+CommandOrControl+K')
accepts('Option 别名规范化为 Alt', 'Control+Option+H', 'Control+Alt+H')
accepts('修饰键输出顺序固定（乱序输入也规范化）', 'Alt+Shift+Control+F2', 'Control+Alt+Shift+F2')
accepts('F 键小写规范化', 'control+alt+f1', 'Control+Alt+F1')
accepts('F24 是上界内合法主键', 'Control+Alt+F24', 'Control+Alt+F24')
accepts('命名键 Space 合法', 'Control+Alt+Space', 'Control+Alt+Space')
accepts('命名键大小写不敏感', 'control+alt+pageup', 'Control+Alt+PageUp')
accepts('媒体键合法（只需一个修饰键）', 'Control+MediaPlayPause', 'Control+MediaPlayPause')
accepts('Super + 字母合法', 'Super+D', 'Super+D')
accepts('Alt + 数字合法', 'Control+Alt+5', 'Control+Alt+5')
accepts('数字键盘键规范化', 'Control+Alt+numpad3', 'Control+Alt+num3')
accepts('前后空白被吃掉', '  Control+Alt+D  ', 'Control+Alt+D')
accepts('重复修饰键去重', 'Control+Ctrl+Alt+D', 'Control+Alt+D')

const changedFlag = normalizeAccelerator('ctrl+alt+d')
check('规范化后 changed=true（面板可提示"已按标准写法保存"）', changedFlag.ok === true && changedFlag.changed === true)
const unchangedFlag = normalizeAccelerator('Control+Alt+D')
check('已是标准写法时 changed=false', unchangedFlag.ok === true && unchangedFlag.changed === false)

/* ── 必须拒绝：裸键会劫持整个键盘 ──────────────────────────────────────── */
rejects('裸字母键被拒（否则系统里再也打不出 D）', 'D', 'missing-modifier')
rejects('裸 F 键也被拒（保持一致口径）', 'F13', 'missing-modifier')
rejects('裸命名键被拒', 'Space', 'missing-modifier')

/* ── 必须拒绝：Control+字母会 shadow 全系统的编辑快捷键 ────────────────── */
rejects('Control+C 被拒（会让所有应用无法复制）', 'Control+C', 'letter-needs-alt-or-super')
rejects('Control+S 被拒（会让所有应用无法保存）', 'Control+S', 'letter-needs-alt-or-super')
rejects('Control+Z 被拒（会让所有应用无法撤销）', 'Control+Z', 'letter-needs-alt-or-super')
rejects('Control+Shift+D 被拒（只有 Control/Shift 不够）', 'Control+Shift+D', 'letter-needs-alt-or-super')
rejects('Control+数字同样被拒', 'Control+1', 'letter-needs-alt-or-super')
rejects('Shift+字母被拒（无任何 Alt/Super）', 'Shift+A', 'letter-needs-alt-or-super')
accepts('Control+F1 放行（F 键不是编辑快捷键，无 shadow 风险）', 'Control+F1', 'Control+F1')

/* ── 必须拒绝：格式与注入 ──────────────────────────────────────────────── */
rejects('只有修饰键、没有主键', 'Control+Alt', 'missing-key')
rejects('空片段（连续加号）', 'Control++Alt+D', 'empty-segment')
rejects('尾随加号', 'Control+Alt+D+', 'empty-segment')
rejects('两个主键', 'Control+Alt+D+F', 'multiple-keys')
rejects('无法识别的主键', 'Control+Alt+Frobnicate', 'unknown-key')
rejects('F25 超出 F1–F24', 'Control+Alt+F25', 'unknown-key')
rejects('F0 非法', 'Control+Alt+F0', 'unknown-key')
rejects('空串', '', 'empty')
rejects('只有空白', '   ', 'empty')
rejects('null 不炸', null, 'empty')
rejects('undefined 不炸', undefined, 'empty')
rejects('数字类型不炸（转成字串后先撞“无修饰键”）', 12345, 'missing-modifier')
rejects('换行注入被拒（这个串会进 settings.json / 日志 / 菜单标签）', 'Control+Alt+D\nX', 'illegal-char')
rejects('回车注入被拒', 'Control+Alt+D\rX', 'illegal-char')
rejects('引号注入被拒', 'Control+Alt+"D"', 'illegal-char')
rejects('尖括号注入被拒（面板会把它塞进 DOM 文本）', 'Control+Alt+<b>', 'illegal-char')
rejects('NUL 被拒', 'Control+Alt+D\u0000', 'illegal-char')
rejects('DEL(0x7f) 被拒', 'Control+Alt+D\u007f', 'illegal-char')
rejects('超长被拒', 'Control+Alt+' + 'D'.repeat(80), 'too-long')

/* ── 错误文案：每个错误码都得有给人看的话 ──────────────────────────────── */
const CODES = [
  'empty', 'too-long', 'illegal-char', 'empty-segment', 'multiple-keys',
  'missing-key', 'missing-modifier', 'letter-needs-alt-or-super', 'unknown-key',
]
for (const code of CODES) {
  const text = explainAcceleratorError(code)
  check(`错误文案 ${code} 非空且不是原始码`, typeof text === 'string' && text.length >= 4 && text !== code, text)
}
check('未知错误码有兜底文案', /热键无效/.test(explainAcceleratorError('something-else')))
check('缺失错误码有兜底文案', /热键无效/.test(explainAcceleratorError(undefined)))
check('裸键与 Control+字母的文案说清了后果（不只是"无效"）',
  /劫持/.test(explainAcceleratorError('missing-modifier'))
    && /复制|保存|撤销/.test(explainAcceleratorError('letter-needs-alt-or-super')))

/* ── 面板候选必须自己就合法（否则会给出一点就报错的按钮）──────────────── */
check('PRESETS 非空', Array.isArray(PRESETS) && PRESETS.length >= 3, String(PRESETS && PRESETS.length))
for (const p of PRESETS) {
  const r = normalizeAccelerator(p.accelerator)
  check(`预设 ${p.accelerator} 自身合法且已规范化`, r.ok === true && r.accelerator === p.accelerator && r.changed === false, JSON.stringify(r))
  check(`预设 ${p.accelerator} 有给人看的标签`, typeof p.label === 'string' && p.label.length > 0)
}

console.log('')
console.log(failures.length ? 'HOTKEY_FAIL ' + failures.join(' | ') : `HOTKEY_OK ${pass} passed, 0 failed`)
process.exit(failures.length === 0 ? 0 : 1)
