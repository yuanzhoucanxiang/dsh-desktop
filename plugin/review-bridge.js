'use strict'
// 审阅桥插件：订阅内核会话事件，把会话级文件改动实时写入 NDJSON 流，
// 供外壳"修改审阅"侧边栏消费；并提供 /api/review-bridge/revert 端点，
// 对单条改动（edit / write / str_replace_editor）做精确逆序回退（Codex 式 Undo）。
// 内核源码零修改，仅作为桌面实例的一个插件行挂载。
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const FILE_TOOLS = new Set(['edit', 'write', 'str_replace_editor'])

/* ── 纯函数区（可单测） ─────────────────────────────────────────────── */

// 模型参数可能是对象或 JSON 字符串（tool/call 事件存的是原始形态）
function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch {}
  }
  return {}
}

// user/message 事件的纯文本内容
function eventText(event) {
  const content = event && event.data && event.data.content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n')
}

// 单条 tool/result 事件的渲染文本（text 与 tool-result 块都取）
function resultTextOf(event) {
  const content = event && event.data && event.data.message && event.data.message.content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const b of content) {
    if (b && b.type === 'text') out += b.text || ''
    else if (b && b.type === 'tool-result' && Array.isArray(b.content)) {
      for (const inner of b.content) if (inner && inner.type === 'text') out += inner.text || ''
    }
  }
  return out
}

// 某次 tool/call 之后对应 tool/result 的渲染文本（按 callId 匹配，容忍并行乱序）
function resultTextAfter(events, callSeq) {
  const call = events[callSeq]
  const callId = call && call.data && call.data.callId
  for (let j = callSeq + 1; j < events.length && j < callSeq + 200; j++) {
    const e = events[j]
    if (e.type === 'tool/result') {
      const message = e.data && e.data.message
      if (callId !== undefined && message && message.source && message.source.callId !== callId) continue
      return resultTextOf(e)
    }
    if (e.type === 'assistant/message') break
  }
  return ''
}

// 从 read 工具结果重建完整文件内容；覆盖不全时返回 null
function parseReadText(text) {
  const m = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/.exec(text || '')
  if (!m) return null
  const body = m[1]
  const lines = []
  for (const raw of body.split('\n')) {
    const lm = /^(\d+): (.*)$/.exec(raw)
    if (lm) lines.push({ n: Number(lm[1]), text: lm[2] })
  }
  if (lines.length === 0) return null
  const totalM = /\(End of file - total (\d+) lines\)/.exec(body)
  const total = totalM ? Number(totalM[1]) : null
  if (total === null || lines[0].n !== 1 || lines[lines.length - 1].n !== total || lines.length !== total) return null
  const byNumber = new Map(lines.map((l) => [l.n, l.text]))
  const out = []
  for (let n = 1; n <= total; n++) {
    const t = byNumber.get(n)
    if (t === undefined) return null
    out.push(t)
  }
  return out.join('\n')
}

function resolveAbs(cwd, filePath) {
  return cwd ? path.resolve(cwd, filePath) : path.resolve(filePath)
}

function keyOf(abs) {
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

// 改动前最近一次完整文件状态（优先完整 read 结果，其次先前的 write 内容）
function stateBeforeMutation(events, cwd, abs, mutationSeq) {
  const targetKey = keyOf(abs)
  for (let i = mutationSeq - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'tool/call') continue
    const name = e.data && e.data.name
    const args = parseArgs(e.data && e.data.arguments)
    if (name !== 'read' && name !== 'write') continue
    let fp = args.file_path
    if (typeof fp !== 'string' && name === 'str_replace_editor') fp = args.path
    if (typeof fp !== 'string') continue
    if (keyOf(resolveAbs(cwd, fp)) !== targetKey) continue
    if (name === 'read') {
      const restored = parseReadText(resultTextAfter(events, i))
      if (restored !== null) return { kind: 'content', content: restored }
    } else if (typeof args.content === 'string') {
      return { kind: 'content', content: args.content }
    }
  }
  return { kind: 'unknown' }
}

function fileOfArgs(name, args) {
  let fp = args.file_path
  if (typeof fp !== 'string' && name === 'str_replace_editor') fp = args.path
  return typeof fp === 'string' && fp !== '' ? fp : null
}

// 单条改动回退（在真实文件系统上执行逆操作）
async function reverseChange(events, cwd, callSeq, call) {
  const name = call && call.data && call.data.name
  const args = parseArgs(call && call.data && call.data.arguments)
  const fp = fileOfArgs(name, args)
  if (!fp) return { ok: false, error: '无法确定文件路径' }
  const abs = resolveAbs(cwd, fp)
  if (name === 'edit') {
    const newStr = args.new_string
    const oldStr = args.old_string
    if (typeof newStr !== 'string' || newStr === '') return { ok: false, error: '缺少 new_string，无法回退' }
    const current = await fsp.readFile(abs, 'utf8')
    if (current.includes(newStr)) {
      const next = args.replace_all === true ? current.split(newStr).join(oldStr || '') : current.replace(newStr, oldStr || '')
      await fsp.writeFile(abs, next, 'utf8')
      return { ok: true, file: fp }
    }
    if (typeof oldStr === 'string' && current.includes(oldStr)) return { ok: true, file: fp, note: '已是回退后状态' }
    return { ok: false, error: '文件当前内容与记录不一致（可能被后续改动覆盖），无法安全回退' }
  }
  if (name === 'str_replace_editor') {
    const cmd = args.command
    if (cmd !== 'str_replace' || typeof args.new_str !== 'string' || args.new_str === '') {
      return { ok: false, error: `仅支持回退 str_replace 操作（当前为 ${cmd || '未知'}）` }
    }
    const current = await fsp.readFile(abs, 'utf8')
    if (current.includes(args.new_str)) {
      await fsp.writeFile(abs, current.split(args.new_str).join(args.old_str || ''), 'utf8')
      return { ok: true, file: fp }
    }
    if (typeof args.old_str === 'string' && current.includes(args.old_str)) return { ok: true, file: fp, note: '已是回退后状态' }
    return { ok: false, error: '文件当前内容与记录不一致（可能被后续改动覆盖），无法安全回退' }
  }
  if (name === 'write') {
    const rendered = resultTextAfter(events, callSeq)
    if (/Created file/.test(rendered)) {
      try { await fsp.unlink(abs) } catch (err) { if (!err || err.code !== 'ENOENT') throw err }
      return { ok: true, file: fp, note: '已删除该次写入创建的文件' }
    }
    const pre = stateBeforeMutation(events, cwd, abs, callSeq)
    if (pre.kind !== 'content') return { ok: false, error: '写入前的文件状态无法从会话日志重建（缺少完整读取记录）' }
    await fsp.writeFile(abs, pre.content, 'utf8')
    return { ok: true, file: fp }
  }
  return { ok: false, error: `不支持回退的工具：${name}` }
}

/* ── 插件主体 ────────────────────────────────────────────────────────── */

module.exports = {
  inject: ['webServer', 'sessions'],
  apply(ctx, config) {
    const outPath = config.out || ''
    let stream
    const ensureStream = () => {
      if (!stream) stream = fs.createWriteStream(outPath, { flags: 'a' })
    }
    const emit = (obj) => {
      try {
        if (!outPath) return
        ensureStream()
        stream.write(JSON.stringify(obj) + '\n')
      } catch {}
    }

    // 事件订阅：提问文字 / 文件工具调用 / 工具结果 / 轮次边界
    let currentTurn = null
    ctx.on('session/event', (session, event) => {
      const d = event.data || {}
      const sid = session ? session.id : null
      if (event.type === 'turn/start') {
        currentTurn = d.turn
      } else if (event.type === 'turn/end') {
        currentTurn = null
        emit({ kind: 'turn-end', ts: event.time, seq: event.seq, session: sid, turn: d.turn })
      } else if (event.type === 'user/message') {
        const text = eventText(event)
        if (text) {
          emit({
            kind: 'prompt',
            ts: event.time,
            seq: event.seq,
            session: sid,
            turn: d.turn !== undefined && d.turn !== null ? d.turn : currentTurn,
            text,
          })
        }
      } else if (event.type === 'tool/call') {
        if (!FILE_TOOLS.has(d.name)) return
        const a = parseArgs(d.arguments)
        const name = d.name
        emit({
          kind: 'tool-call',
          ts: event.time,
          seq: event.seq,
          session: sid,
          turn: d.turn,
          step: d.step,
          callId: d.callId,
          name,
          file: fileOfArgs(name, a),
          old: (a.old_string !== undefined ? a.old_string : a.old_str) ?? null,
          new: (a.new_string !== undefined ? a.new_string : (a.new_str !== undefined ? a.new_str : a.content)) ?? null,
          replaceAll: a.replace_all === true,
          command: typeof a.command === 'string' ? a.command : null,
        })
      } else if (event.type === 'tool/result') {
        const callId = d.message && d.message.source && d.message.source.callId
        if (!callId) return
        const txt = resultTextOf(event)
        emit({
          kind: 'tool-result',
          ts: event.time,
          seq: event.seq,
          session: sid,
          callId,
          created: /Created file/.test(txt),
          failed: /^(Error|Failed)/.test(txt),
        })
      }
    })
    ctx.on('dispose', () => {
      try {
        if (stream) stream.end()
      } catch {}
    })

    // 回退端点：对单条改动做精确逆操作（Codex 式 Undo）
    const handleRevert = async (body) => {
      const sessionId = body && body.sessionId
      const callId = body && body.callId
      if (typeof sessionId !== 'string' || typeof callId !== 'string') {
        return { ok: false, status: 400, error: '缺少 sessionId / callId' }
      }
      const live = ctx.sessions.get(sessionId)
      if (live === undefined) {
        return { ok: false, status: 409, error: '该会话未打开，无法回退（可改用 Git 工作区视图还原）' }
      }
      const events = live.events
      // 会话运行中禁止回退
      for (let i = events.length - 1; i >= 0; i--) {
        const type = events[i].type
        if (type === 'turn/end') break
        if (type === 'turn/start') return { ok: false, status: 409, error: '会话正在运行中，请等待本轮完成' }
      }
      let callSeq = -1
      let call = null
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e.type === 'tool/call' && e.data && e.data.callId === callId) {
          callSeq = i
          call = e
          break
        }
      }
      if (call === null) return { ok: false, status: 404, error: '未找到该改动记录' }
      const cwd = live.header && live.header.cwd
      try {
        const result = await reverseChange(events, cwd, callSeq, call)
        if (!result.ok) return { ok: false, status: 409, error: result.error, file: result.file }
        emit({ kind: 'revert', ts: Date.now(), session: sessionId, callId, file: result.file, ok: true, note: result.note || null })
        return { ok: true, status: 200, file: result.file, note: result.note || null }
      } catch (err) {
        emit({ kind: 'revert', ts: Date.now(), session: sessionId, callId, ok: false, error: err && err.message ? err.message : String(err) })
        return { ok: false, status: 500, error: err && err.message ? err.message : String(err) }
      }
    }

    ctx.webServer.register({
      kind: 'exact',
      path: '/api/review-bridge/revert',
      handler: async (req, res) => {
        let body = {}
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } catch {}
        const out = await handleRevert(body)
        res.writeHead(out.status || 500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(out))
      },
    })

    if (outPath) console.log('[review-bridge] loaded, out=' + outPath)
  },
  // 供单元测试直接调用纯函数
  __test: { parseArgs, eventText, resultTextOf, resultTextAfter, parseReadText, stateBeforeMutation, reverseChange, fileOfArgs },
}
