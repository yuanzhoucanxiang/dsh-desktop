/**
 * P1b/P4: context-builder + world setting injection (pure).
 * node plugin/writing-mode/test/world-settings-context.mjs
 */
import {
  buildPreparedTurn,
  selectMemory,
  memoryHint,
} from '../src/shared/context-builder.js'
import { settingInjectUnit } from '../src/shared/world-setting.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('PASS', name, extra)
  } else {
    fail++
    console.log('FAIL', name, extra)
  }
}

const world = {
  id: 'w-harbor',
  kind: 'fact',
  status: 'confirmed',
  text: '雾季入夜后港口停止民船出航。\n边界/例外：救援船获得许可后可以出航。',
  setting: {
    type: 'world',
    title: '夜间航行',
    conclusion: '雾季入夜后港口停止民船出航。',
    explanation: '很长的说明不应进入默认注入。',
    boundaries: '救援船获得许可后可以出航。',
    tags: ['港口', '雾季'],
  },
}
const world2 = {
  id: 'w-other',
  kind: 'fact',
  status: 'confirmed',
  text: '另一条设定。',
  setting: { type: 'world', title: '无关设定', conclusion: '另一条设定。', explanation: 'x', boundaries: '', tags: [] },
}
const pref = {
  id: 'p1',
  kind: 'preference',
  status: 'confirmed',
  text: '喜欢短句',
}
const proposed = {
  id: 'c1',
  kind: 'fact',
  status: 'proposed',
  text: '候选不进',
  setting: { type: 'world', title: '候选', conclusion: '候选不进', explanation: '', boundaries: '', tags: [] },
}

ok('settingInjectUnit no explanation', !settingInjectUnit(world)?.text?.includes('说明'))

const sel = selectMemory([world2, world, pref, proposed], [], 6000, [], '港口雾季夜航')
ok('confirmed world included', sel.selected.some((s) => s.id === 'w-harbor'))
ok('uses derived text with boundary', sel.selected.find((s) => s.id === 'w-harbor')?.text.includes('边界/例外'))
ok('does not include explanation', !JSON.stringify(sel.selected).includes('不应进入默认注入'))
ok('world match ranks before unrelated', sel.selected.findIndex((s) => s.id === 'w-harbor') < sel.selected.findIndex((s) => s.id === 'w-other'))
ok('proposed excluded', !sel.selected.some((s) => s.id === 'c1'))
ok('preference still there', sel.selected.some((s) => s.id === 'p1'))

const turn = buildPreparedTurn({
  projectKey: 'P',
  operationId: 'op',
  message: '关于港口雾季的讨论',
  memoryItems: [world2, world, pref, proposed],
  memoryRevision: 1,
  memoryEtag: 'e',
})
ok('body has world title', turn.body.includes('夜间航行'))
ok('body omits explanation', !turn.body.includes('不应进入默认注入'))
ok('frozen schema3', turn.schemaVersion === 3 && Object.isFrozen(turn) && Object.isFrozen(turn.selectedMemory[0]))
ok('hint counts confirmed only', memoryHint([world, world2, pref, proposed]) === '参考项目备忘 · 3 条')

const excluded = selectMemory([world, pref], [], 6000, ['w-harbor'], '港口')
ok('author exclude wins', !excluded.selected.some((s) => s.id === 'w-harbor') && excluded.omissions.some((o) => o.id === 'w-harbor' && o.reason === 'excluded-by-author'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
