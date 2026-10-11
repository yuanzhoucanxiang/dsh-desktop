/**
 * 提问卡纯函数层回归（2026-10-10）。
 *
 * 覆盖：从工具调用里认出 ask_user_question、解析问题清单、把答案拼成内核要的形状。
 * 边界与内核契约一致（dsh-user-questions / dsh-tool-ask-user）：
 *   - 每题在答案批次里恰好出现一次，未作答的保留成 { id, selected: [] }；
 *   - 单选时 custom 顶替所选（selected 清空）；多选时 custom 是补充；
 *   - 模型参数用 snake_case（multi_select），内核事件用 camelCase（multiSelect）——两个都收；
 *   - 流式 delta 期间的半截 JSON 必须安静地返回 null（不能抛，也不能画半张卡）。
 */
import assert from 'node:assert/strict'

const q = await import('../src/client/features/companion/questions.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

const ARGS = JSON.stringify({
  questions: [
    {
      id: 'cleanup',
      header: 'Confirm',
      question: 'Proceed with the destructive cleanup?',
      options: [
        { label: 'Yes, delete them (Recommended)', description: 'Removes the three stale files.' },
        { label: 'No, keep them', description: 'Aborts the cleanup.' },
      ],
    },
    { id: 'tone', question: 'Which tone?', multi_select: true, options: [{ label: '冷峻' }, { label: '温和' }] },
  ],
})

/* ── parseQuestions ─────────────────────────────────────── */

const parsed = q.parseQuestions(ARGS)
ok(Array.isArray(parsed) && parsed.length === 2, '两条问题都解析出来')
ok(parsed[0].id === 'cleanup' && parsed[0].header === 'Confirm', 'id 与 header 保留')
ok(parsed[0].options.length === 2 && parsed[0].options[0].description === 'Removes the three stale files.', '选项与说明保留')
ok(parsed[0].multiSelect === false, '缺 multi_select 视为单选')
ok(parsed[1].multiSelect === true, 'snake_case multi_select 认出来')
ok(parsed[1].options[0].description === '', '选项缺说明给空串（不产生 undefined）')

ok(q.parseQuestions('{"questions":[{"id":"a","question":"b"') === null, '半截 JSON（流式中途）安静返回 null')
ok(q.parseQuestions('') === null, '空参数返回 null')
ok(q.parseQuestions('{"other":1}') === null, '没有 questions 数组返回 null')
ok(q.parseQuestions('{"questions":[{"question":"缺 id"},{"id":"x"}]}') === null, '字段不全的条目被丢弃，全丢则 null')
ok(q.parseQuestions('{"questions":[{"id":"x","question":"q","options":[{"nope":1},{"label":"好"}]}]}')[0].options.length === 1, '坏选项被过滤')

/* ── toolCallOf / askCallOf ─────────────────────────────── */

const row = { kind: 'detail', text: '工具活动', tool: { name: 'ask_user_question', callId: 'call-1', argsRaw: ARGS, phase: 'start', isError: false } }
const ask = q.askCallOf(row)
ok(ask && ask.callId === 'call-1' && ask.questions.length === 2, 'ask_user_question 被认出并带上 callId')

ok(q.askCallOf({ kind: 'detail', tool: { name: 'read', callId: 'c', argsRaw: '{"file_path":"a.md"}' } }) === null, '别的工具不误判成提问')
ok(q.askCallOf({ kind: 'detail', detail: { root: {} } }) === null, '没有 tool 字段的旧行安全返回 null')
ok(q.askCallOf({ kind: 'assistant', text: 'hi' }) === null, '普通消息行返回 null')
ok(q.askCallOf({ kind: 'detail', tool: { name: 'ask_user_question', callId: 'c', argsRaw: '{"questions":[]}' } }) === null, '空问题清单不画卡')

/* ── buildAnswer ────────────────────────────────────────── */

const single = q.parseQuestions(JSON.stringify({ questions: [{ id: 'a', question: 'q', options: [{ label: 'A' }, { label: 'B' }] }] }))
const multi = q.parseQuestions(JSON.stringify({ questions: [{ id: 'm', question: 'q', multi_select: true, options: [{ label: 'X' }, { label: 'Y' }] }] }))

const pickA = q.buildAnswer(single, { a: { selected: ['B'] } })
ok(pickA.answers.length === 1 && pickA.answers[0].id === 'a' && pickA.answers[0].selected[0] === 'B', '单选：所选标签进 selected')
ok(pickA.answers[0].custom === undefined, '单选：没写自定义就不带 custom 字段')

const pickCustom = q.buildAnswer(single, { a: { selected: ['B'], custom: '  都不对，改成 C  ' } })
ok(pickCustom.answers[0].custom === '都不对，改成 C', '单选：custom 去掉首尾空白')
ok(pickCustom.answers[0].selected.length === 0, '单选：custom 顶替所选（selected 清空，内核契约）')

const pickMulti = q.buildAnswer(multi, { m: { selected: ['X', 'Y'], custom: '再加一句' } })
ok(pickMulti.answers[0].selected.length === 2 && pickMulti.answers[0].custom === '再加一句', '多选：custom 是补充，不清空 selected')

const skipped = q.buildAnswer(parsed, {})
ok(skipped.answers.length === 2, '未作答时每题仍然出现一次（内核要求 id 恰好一次）')
ok(skipped.answers.every((a) => Array.isArray(a.selected) && a.selected.length === 0), '未作答的保留成空 selected（跳过语义）')
ok(q.buildAnswer(null, {}).answers.length === 0, '没有问题清单时给空批次，不抛')

ok(q.hasAnyAnswer(single, {}) === false, '全空 = 没答')
ok(q.hasAnyAnswer(single, { a: { custom: '  ' } }) === false, '只有空白自定义 = 没答')
ok(q.hasAnyAnswer(single, { a: { selected: ['A'] } }) === true, '选了选项 = 答了')

/* ── answerFailureText ──────────────────────────────────── */

ok(q.answerFailureText('not-answerable').includes('完整会话'), '不可作答 → 指向完整会话')
ok(q.answerFailureText('answer-unavailable').includes('完整会话'), '没有作答通道 → 指向完整会话')
ok(q.answerFailureText('').includes('完整会话'), '未知失败也指向完整会话（不假装成功）')
ok(q.answerFailureText('REPLY_QUEUED').includes('已经提交'), '已排队 → 说明在等模型接上')

console.log(`WRITING_QUESTIONS_OK ${passed}/${passed}`)
