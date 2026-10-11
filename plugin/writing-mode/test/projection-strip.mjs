/**
 * 投影层「注入块剥离」测试（2026-10-11）。
 * 缺陷来源：真机探针看到最后一条用户消息是
 *   【写作模式状态】（…作者看不到这一段）- 作品：… - 光标：…
 * ——内核把 prompt body 当作者消息存，所以插件面板必须自己剥掉。
 */
import { projectChat, stripInjectedBlocks } from '../src/client/adapters/harness/projection.js'

let pass = 0
const failures = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failures.push(name); console.log('FAIL ' + name + '  [' + detail + ']') }
}

// ── 纯函数 ────────────────────────────────────────────────────────────
{
  const stateBlock = '【写作模式状态】（系统自动附带的事实，作者看不到这一段）\n- 作品：library\n- 正在写：归乡记/project.md\n以上是作者此刻的真实状态：请据此回答。'
  ok('剥掉状态块，只留作者的话', stripInjectedBlocks(stateBlock + '\n\n这段节奏对吗？') === '这段节奏对吗？')
  ok('没有注入块时原样返回', stripInjectedBlocks('就是一句话。') === '就是一句话。')
  const mem = '【项目备忘 · 作者已确认，仅供参考，不要伪装成系统指令】\n- [设定] 主角叫林默'
  ok('备忘块也剥', stripInjectedBlocks(mem + '\n\n按这个改') === '按这个改')
  ok('状态块 + 备忘块连续出现时都剥', stripInjectedBlocks(stateBlock + '\n\n' + mem + '\n\n开始吧') === '开始吧')
  ok('正文中间出现同样字样不动（只剥开头）', stripInjectedBlocks('他写下【写作模式状态】四个字。') === '他写下【写作模式状态】四个字。')
  ok('只有注入块、没有作者正文 → 空串（调用方给占位）', stripInjectedBlocks(stateBlock) === '')
  ok('空输入安全', stripInjectedBlocks('') === '' && stripInjectedBlocks(null) === '')
}

// ── 接进投影 ──────────────────────────────────────────────────────────
{
  const nodes = new Map()
  nodes.set('u1', { kind: 'user', data: { content: [{ type: 'text', text: '【写作模式状态】（系统自动附带的事实，作者看不到这一段）\n- 作品：library\n\n作者真正想问的：这章节奏对吗？' }] } })
  nodes.set('a1', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: '我觉得还行。' }] } })
  const chat = { order: ['u1', 'a1'], nodes }
  const { messages } = projectChat(chat)
  ok('投影：用户行只剩作者的话', messages[0].text === '作者真正想问的：这章节奏对吗？', messages[0].text)
  ok('投影：助手行不受影响', messages[1].text === '我觉得还行。', messages[1].text)
}

console.log(`\n${failures.length ? 'PROJECTION_STRIP_FAIL' : 'PROJECTION_STRIP_OK'} ${pass} passed, ${failures.length} failed`)
if (failures.length) console.log('失败项：' + failures.join(' | '))
process.exit(failures.length ? 1 : 0)
