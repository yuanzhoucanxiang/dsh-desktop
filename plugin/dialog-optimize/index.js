/**
 * Host half of the local 对话框优化 (dialog-optimize) extension. All UI logic
 * lives in the browser (client.js). The host half:
 *
 * 1. Is a valid, mountable Cordis plugin so the composition row activates.
 * 2. Strips legacy prototype <style> tags (dsh-sticky-think and diagnostic
 *    markers) whose taps lingered in the live webserver from earlier
 *    experiments — Cordis v4 has no 'dispose' event, so those transforms can
 *    only be neutralized by a later tap, never unregistered mid-process.
 * 3. Serves the in-place conversation-recall endpoint POST
 *    /api/dialog-optimize/recall:
 *    - resolves the target user message from its chat flow key,
 *    - computes the rollback boundary (the last completed turn before the
 *      message),
 *    - plans / applies file rollback for every file the agent changed after
 *      that boundary (reverse-order exact revert: edits swap back, writes
 *      restore the recorded pre-state, agent-created files are deleted),
 *    - appends an empty assistant/message replacement event that shadows the
 *      recalled message and the whole tail on the MODEL surface (the client
 *      hides the same range in the view), so the conversation simply
 *      continues in place — no new session, no context pollution.
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dialog-optimize'
export const inject = ['webServer', 'sessions', 'sessionQuery', 'sessionPersistence']

const RECALL_PATH = '/api/dialog-optimize/recall'
/** Tool names whose args/results mutate files. */
const MUTATION_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
/** Events that can join the model-visible surface (replaceable range nodes). */
const SURFACE_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])
/**
 * Context-key kind prefixes that can carry a user-sent message id. Every
 * user-sent message (user / steering / context UI kinds) shares the
 * `input-message` definition kind, so its flow key is "14:input-message<uuid>".
 */
const KEY_KINDS = ['input-message', 'user', 'steering', 'context']

function stripLegacy(html) {
  return html.replace(/<style[^>]*data-(?:dsh-sticky-think|patch-canary|dsh-collapse-host)[^>]*>[\s\S]*?<\/style>/g, '')
}

/** Parse a conversationContextKey like "14:input-message<uuid>" into kind + id. */
function parseFlowKey(key) {
  if (typeof key !== 'string') return null
  const m = /^\d+:(.+)$/.exec(key)
  if (!m) return null
  const rest = m[1]
  for (const kind of KEY_KINDS) {
    if (rest.startsWith(kind)) return { kind, id: rest.slice(kind.length) }
  }
  return null
}

/** Concatenated text blocks of a user/message event. */
function eventText(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('\n')
}

function resolveAbs(cwd, filePath) {
  return cwd ? path.resolve(cwd, filePath) : path.resolve(filePath)
}

function keyOf(abs) {
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

function parseArgs(event) {
  try {
    const args = JSON.parse(event.data?.arguments ?? '{}')
    return args && typeof args === 'object' ? args : null
  } catch {
    return null
  }
}

/** Rendered text of the tool/result event that belongs to a tool/call (matched by callId). */
function resultTextAfter(events, callSeq) {
  const call = events[callSeq]
  const callId = call?.data?.callId
  // batched tool calls append several tool/call events before any result, so
  // keep scanning across them; results for a step always land before the next
  // assistant message
  for (let j = callSeq + 1; j < events.length && j < callSeq + 200; j++) {
    const e = events[j]
    if (e.type === 'tool/result') {
      const message = e.data?.message
      // parallel tool calls may complete out of order — match the callId
      if (callId !== void 0 && message?.source?.callId !== callId) continue
      const content = message?.content
      if (Array.isArray(content)) {
        let out = ''
        for (const b of content) {
          if (b && b.type === 'text') out += b.text ?? ''
          else if (b && b.type === 'tool-result' && Array.isArray(b.content)) {
            for (const inner of b.content) {
              if (inner && inner.type === 'text') out += inner.text ?? ''
            }
          }
        }
        return out
      }
      return ''
    }
    if (e.type === 'assistant/message') break
  }
  return ''
}

/**
 * Reconstruct a complete file from a full `read` tool result:
 *   <path>…</path><type>file</type><content>\n1: line\n…\n(End of file - total N lines)\n</content>
 * Returns null unless the read covered the whole file.
 */
function parseReadText(text) {
  const m = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/.exec(text ?? '')
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
    const text = byNumber.get(n)
    if (text === undefined) return null
    out.push(text)
  }
  return out.join('\n')
}

/**
 * Full file state right before a mutation: the nearest prior full `read`
 * result, or the nearest prior `write`'s argument content. Anything else
 * (edits, partial reads) does not expose the whole file, so keep walking back.
 */
function stateBeforeMutation(events, cwd, abs, mutationSeq) {
  const targetKey = keyOf(abs)
  for (let i = mutationSeq - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'tool/call') continue
    const name = e.data?.name
    const args = parseArgs(e)
    if (!args) continue
    let fp = args.file_path
    if (typeof fp !== 'string' && name === 'str_replace_editor') fp = args.path
    if (typeof fp !== 'string') continue
    if (keyOf(resolveAbs(cwd, fp)) !== targetKey) continue
    if (name === 'read') {
      const restored = parseReadText(resultTextAfter(events, i))
      if (restored !== null) return { kind: 'content', content: restored }
    } else if (name === 'write' && typeof args.content === 'string') {
      return { kind: 'content', content: args.content }
    }
  }
  return { kind: 'unknown' }
}

/**
 * Files mutated after the boundary, each with its ordered mutation list.
 * A path whose FIRST post-boundary mutation is a "Created file" write did not
 * exist at the boundary → roll back by deleting it. For every other path the
 * mutations are reverted in REVERSE order: edits restore exactly by swapping
 * new_string → old_string on the current file (no full read needed), writes
 * restore from the state recorded before them.
 */
function scanFileMutations(events, cwd, boundary) {
  const byKey = new Map()
  for (let i = boundary + 1; i < events.length; i++) {
    const e = events[i]
    if (e.type !== 'tool/call') continue
    const name = e.data?.name
    if (!MUTATION_TOOLS.has(name)) continue
    const args = parseArgs(e)
    if (!args) continue
    let filePath = args.file_path
    if (typeof filePath !== 'string' && name === 'str_replace_editor') filePath = args.path
    if (typeof filePath !== 'string' || filePath === '') continue
    const abs = resolveAbs(cwd, filePath)
    const k = keyOf(abs)
    let rec = byKey.get(k)
    if (rec === void 0) {
      const rendered = resultTextAfter(events, i)
      const created = name === 'write' && /Created file/.test(rendered)
      rec = { abs, display: filePath, created, mutations: [] }
      byKey.set(k, rec)
    }
    rec.mutations.push({ seq: e.seq, name, args })
  }
  return byKey
}

function findLiveSessionEvent(ctx, id) {
  for (const session of ctx.sessions.list()) {
    const events = session.events
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      if (e.type === 'user/message' && String(e.data?.id) === id) return { sessionId: session.id, events, header: session.header, event: e }
    }
  }
  return null
}

/** Fallback for closed sessions: read the persisted log and search it. */
async function findPersistedSessionEvent(ctx, id) {
  // enumerate through the RAW persistence list. sessionQuery.listSessions()
  // can throw "session source headers conflict" when a live session id
  // collides with a persisted one (auto-minted session-N counters reset on
  // restart), which would silently break every recall.
  let headers = []
  try {
    headers = await ctx.sessionPersistence.list()
  } catch {
    return null
  }
  for (const header of headers) {
    const sid = header?.id
    if (!sid) continue
    // live sessions were already searched by findLiveSessionEvent
    if (ctx.sessions.get(sid) !== void 0) continue
    let snapshot
    try {
      snapshot = await ctx.sessionQuery.readSession(sid)
    } catch {
      continue
    }
    const events = snapshot.events
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      if (e.type === 'user/message' && String(e.data?.id) === id) {
        return { sessionId: sid, events, header: snapshot.session, event: e }
      }
    }
  }
  return null
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function handleRecall(ctx, body) {
  const parsed = parseFlowKey(body?.key)
  if (!parsed) return { ok: false, status: 400, error: '无效的消息标识' }
  let found = findLiveSessionEvent(ctx, parsed.id)
  if (found === null) {
    found = await findPersistedSessionEvent(ctx, parsed.id)
  }
  if (!found) return { ok: false, status: 404, error: '未找到对应消息' }
  const { sessionId, events, header, event } = found
  const cwd = header?.cwd
  // every user-sent message is recallable — including subagent relays
  // (source.kind "coordinator"/"parent"); only plugin-injected content such as
  // compaction checkpoints is excluded
  if (event.data?.source?.kind === 'plugin') return { ok: false, status: 400, error: '该内容不是用户消息，无法撤回' }
  const seq = event.seq
  // rollback boundary = the last completed turn before the message; -1 means
  // everything the session ever changed is rolled back (first-message recall)
  let boundary = -1
  for (let i = seq - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') {
      boundary = events[i].seq
      break
    }
  }
  const text = eventText(event)
  const mutations = scanFileMutations(events, cwd, boundary)
  const files = [...mutations.values()].map((rec) => ({
    path: rec.display,
    action: rec.created ? 'delete' : 'restore',
    note: rec.created
      ? '该文件由撤回点之后的 AI 创建，将删除'
      : '恢复为撤回点之前的内容（逆序精确回退）'
  }))
  if (body?.confirm !== true) {
    return { ok: true, status: 200, text, boundary, files }
  }
  // ---- confirm: in-place recall needs the session live in this process ----
  const live = ctx.sessions.get(sessionId)
  if (live === void 0) {
    return { ok: false, status: 409, error: '该会话未打开，无法原地撤回（请先在页面中打开它）' }
  }
  const liveEvents = live.events
  // guard: an open (running) turn must not be shadowed mid-flight
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    const type = liveEvents[i].type
    if (type === 'turn/end') break
    if (type === 'turn/start') {
      return { ok: false, status: 409, error: '会话正在运行中，请等待本轮完成后撤回' }
    }
  }
  if (seq >= liveEvents.length) {
    return { ok: false, status: 409, error: '该消息不在当前会话中，无法原地撤回' }
  }
  // ---- then roll back files ----
  const applied = []
  const errors = []
  for (const rec of mutations.values()) {
    try {
      if (rec.created) {
        try {
          await fsp.unlink(rec.abs)
        } catch (err) {
          if (err?.code !== 'ENOENT') throw err
        }
        applied.push({ path: rec.display, action: 'delete' })
        continue
      }
      // revert mutations in REVERSE order — every later edit is undone first,
      // so the current file always contains the text the next edit wrote
      let ok = true
      for (let m = rec.mutations.length - 1; m >= 0 && ok; m--) {
        const mut = rec.mutations[m]
        if (mut.name === 'write') {
          const pre = stateBeforeMutation(events, cwd, rec.abs, mut.seq)
          if (pre.kind !== 'content') {
            errors.push(`${rec.display}: 写入前的状态无法从日志重建（缺少完整读取记录）`)
            ok = false
            break
          }
          await fsp.writeFile(rec.abs, pre.content, 'utf8')
        } else if (mut.name === 'edit') {
          const current = await fsp.readFile(rec.abs, 'utf8')
          const newStr = mut.args.new_string
          const oldStr = mut.args.old_string
          if (typeof newStr === 'string' && newStr !== '' && current.includes(newStr)) {
            const next = mut.args.replace_all === true
              ? current.split(newStr).join(oldStr ?? '')
              : current.replace(newStr, oldStr ?? '')
            await fsp.writeFile(rec.abs, next, 'utf8')
          } else if (typeof oldStr === 'string' && current.includes(oldStr)) {
            // already in the pre-edit state (idempotent re-run)
          } else {
            errors.push(`${rec.display}: 反向回退失败（当前文件与日志记录不一致）`)
            ok = false
          }
        } else {
          // str_replace_editor: only "str_replace" can be reverted exactly
          const cmd = mut.args.command
          if (cmd === 'str_replace' && typeof mut.args.new_str === 'string' && mut.args.new_str !== '') {
            const current = await fsp.readFile(rec.abs, 'utf8')
            if (current.includes(mut.args.new_str)) {
              await fsp.writeFile(rec.abs, current.split(mut.args.new_str).join(mut.args.old_str ?? ''), 'utf8')
            } else {
              errors.push(`${rec.display}: 反向回退失败（str_replace 目标不存在）`)
              ok = false
            }
          } else {
            errors.push(`${rec.display}: 无法回退 str_replace_editor 的 ${cmd ?? '未知'} 操作`)
            ok = false
          }
        }
      }
      if (ok) applied.push({ path: rec.display, action: 'restore' })
    } catch (err) {
      errors.push(`${rec.display}: ${err?.message ?? String(err)}`)
    }
  }
  // ---- in-place recall: shadow [recalled message .. last surface node] ----
  // A replacement `assistant/message` with EMPTY content renders nothing (the
  // client projection only builds assistant-step nodes from append-origin
  // messages) and derives no model message, so the whole tail disappears from
  // the CURRENT conversation and the session simply continues from here.
  let end = -1
  const shadowed = []
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    const e = liveEvents[i]
    if (SURFACE_TYPES.has(e.type)) {
      if (end < 0) end = e.seq
      if (e.seq >= seq) shadowed.push(e.seq)
    }
  }
  if (end < 0 || shadowed.length === 0) {
    return { ok: false, status: 409, error: '未找到可遮蔽的对话内容', files: applied, errors }
  }
  try {
    live.append('assistant/message', {
      turn: liveEvents[liveEvents.length - 1]?.data?.turn ?? 0,
      step: 0,
      message: {
        id: 'recall-' + randomUUID(),
        role: 'assistant',
        content: [],
        // the persisted-log re-validation requires a model source; without it
        // the session file becomes unreadable ("message has invalid source")
        source: { kind: 'model', provider: 'recall', model: 'recall' }
      }
    }, {
      surfaceOp: { op: 'replace', start: seq, end },
      sourceEventSeqs: shadowed
    })
  } catch (err) {
    return { ok: false, status: 500, error: `原地撤回失败：${err?.message ?? String(err)}`, files: applied, errors }
  }
  return { ok: true, status: 200, inPlace: true, text, files: applied, errors }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(stripLegacy), 'dialog-optimize: legacy style cleanup tap')
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: RECALL_PATH,
        handler: async (req, res) => {
          try {
            const body = JSON.parse((await readBody(req)) || '{}')
            const out = await handleRecall(ctx, body)
            writeJson(res, out.status ?? 500, out)
          } catch (err) {
            writeJson(res, 500, { ok: false, error: err?.message ?? String(err) })
          }
        }
      }),
    'dialog-optimize: recall route'
  )
}
