/**
 * 写作台里的提问卡（2026-10-10）。
 *
 * 此前模型提问在写作台里只是一行折叠的「工具活动」+ 原始 JSON：作者既看不到问题、也点不了选项，
 * 而模型那边正阻塞等着回答。这张卡把问题和选项直接画出来。
 *
 * 作答边界（内核 user-questions 契约）：前台还开着的那次提问由内核的等待请求结算，客户端替不了它
 * ——那时只能去完整会话作答；已转为 continued 的提问才能从 Remote 作答。所以提交失败不是崩溃，
 * 而是给出一条明确的出路。
 *
 * 约定：本仓库用 react/jsx-runtime 的手写形式，jsxs(type, props, key) 的第三个参数是 **key**，
 * children 一律写在 props 里。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { buildAnswer, hasAnyAnswer, answerFailureText } from './questions.js'

export function QuestionCard({ ask, onAnswer, onFull }) {
  const [picks, setPicks] = react.useState({})
  const [busy, setBusy] = react.useState(false)
  const [note, setNote] = react.useState('')
  const [done, setDone] = react.useState(false)
  // 丙+（2026-10-11）：已记下、等着补交的答案批次（见 submit 与下面的重试效应）。
  const [queued, setQueued] = react.useState(null)

  const setPick = (qid, next) => setPicks((cur) => ({ ...cur, [qid]: { ...(cur[qid] || {}), ...next } }))
  const toggleOption = (q, label) => {
    const cur = picks[q.id] || {}
    const selected = Array.isArray(cur.selected) ? cur.selected : []
    const next = q.multiSelect
      ? selected.includes(label)
        ? selected.filter((s) => s !== label)
        : [...selected, label]
      : selected.includes(label)
        ? []
        : [label]
    setPick(q.id, { selected: next })
  }

  async function submit() {
    if (busy || done || !hasAnyAnswer(ask.questions, picks)) return
    setBusy(true)
    setNote('')
    const batch = buildAnswer(ask.questions, picks)
    const res = await onAnswer(ask.callId, batch)
    setBusy(false)
    if (res && res.ok) {
      setDone(true)
      return
    }
    // 定时模式下，前台等待还开着时内核**拒收**（只有那次等待中的请求能结算它）——这不是失败，
    // 是"还没轮到我们"。记下这一批，等它转为可作答后自动补交，作者不必再点一次。
    if (res && (res.code === 'not-answerable' || res.code === 'answer-failed')) {
      setQueued(batch)
      setNote('已记下；内核还在前台等它，转为可作答后我会自动提交。')
      return
    }
    setNote(answerFailureText(res && res.code))
  }

  // 补交：每 3 秒试一次，上限 45 次（135 秒 > 提问的 60 秒时限，留足余量）。
  react.useEffect(() => {
    if (!queued || done) return undefined
    let stopped = false
    let timer = null
    let tries = 0
    const tick = async () => {
      tries += 1
      const res = await onAnswer(ask.callId, queued)
      if (stopped) return
      if (res && res.ok) {
        setDone(true)
        setQueued(null)
        setNote('')
        return
      }
      if (tries >= 45) {
        setQueued(null)
        setNote('内核这次没有把它交给我作答，去完整会话处理。')
        return
      }
      timer = setTimeout(tick, 3000)
    }
    timer = setTimeout(tick, 3000)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [queued, done, ask.callId, onAnswer])

  const questionBlocks = ask.questions.map((q) => {
    const pick = picks[q.id] || {}
    const selected = Array.isArray(pick.selected) ? pick.selected : []
    const optionButtons = q.options.map((o) => {
      const on = selected.includes(o.label)
      return jsx.jsxs('button', {
        type: 'button',
        className: 'dshWmAskOpt' + (on ? ' is-on' : ''),
        'aria-pressed': on ? 'true' : 'false',
        'data-wm-ask-opt': o.label,
        title: o.description || '',
        disabled: done,
        onClick: () => toggleOption(q, o.label),
        children: [
          jsx.jsx('span', { className: 'dshWmAskOptLabel', children: o.label }, 'l'),
          o.description ? jsx.jsx('span', { className: 'dshWmAskOptDesc', children: o.description }, 'd') : null,
        ],
      }, q.id + ':' + o.label)
    })
    return jsx.jsxs('div', {
      className: 'dshWmAskQ',
      children: [
        q.header ? jsx.jsx('span', { className: 'dshWmAskHeader', children: q.header }, 'h') : null,
        jsx.jsx('div', { className: 'dshWmAskText', children: q.question }, 't'),
        q.detail ? jsx.jsx('div', { className: 'dshWmAskDetail', children: q.detail }, 'x') : null,
        optionButtons.length ? jsx.jsx('div', { className: 'dshWmAskOpts', children: optionButtons }, 'o') : null,
        jsx.jsx('input', {
          type: 'text',
          className: 'dshWmAskCustom',
          'data-wm-ask-custom': q.id,
          placeholder: optionButtons.length ? '也可以直接写你的回答' : '写下你的回答',
          value: pick.custom || '',
          disabled: done,
          onChange: (e) => setPick(q.id, { custom: e.target.value }),
        }, 'c'),
      ],
    }, q.id)
  })

  return jsx.jsxs('div', {
    className: 'dshWmAsk' + (done ? ' is-done' : ''),
    'data-wm-ask': ask.callId || '1',
    children: [
      jsx.jsx('div', { className: 'dshWmAskHead', children: done ? '已作答' : queued ? '已记下，等内核把它交给我' : '写作伙伴想请你确认' }, 'hd'),
      ...questionBlocks,
      jsx.jsxs('div', {
        className: 'dshWmAskFoot',
        children: [
          jsx.jsx('button', {
            type: 'button',
            className: 'dshWmBtn is-primary',
            'data-wm-ask-submit': '1',
            disabled: done || busy || !hasAnyAnswer(ask.questions, picks),
            onClick: () => void submit(),
            children: done ? '已提交' : busy ? '提交中…' : '提交回答',
          }, 'sub'),
          jsx.jsx('button', {
            type: 'button',
            className: 'dshWmQuiet',
            'data-wm-ask-full': '1',
            onClick: () => { if (onFull) onFull() },
            children: '在完整会话中处理 ↗',
          }, 'full'),
        ],
      }, 'ft'),
      note ? jsx.jsx('div', { className: 'dshWmAskNote', role: 'alert', children: note }, 'nt') : null,
    ],
  })
}
