/**
 * Host half of @dsh-local/writing-mode.
 *
 * 职责：
 *  1. fenced API：文档库 CRUD（~/dsh-writing/*.md，loopback only）；
 *  2. AI 辅助端点：有 dsh-llm 时走当前会话同款 Provider，否则 501 由 client 降级；
 *  3. 设置命名空间（可选，settings 缺席时 API 只读默认）。
 *
 * UI 全在 client.js（shell.overlay 全屏写作工作台）。内核零修改。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'writing-mode'
export const inject = []

const API = '/api/writing-mode'
const DOCS_DIR_NAME = 'dsh-writing'

/** 文档库落点：用户主目录 ~/dsh-writing（不绑 DSH_HOME，方便备份/同步）。 */
function docsDir() {
  const dir = path.join(os.homedir(), DOCS_DIR_NAME)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function isLoopbackRequest(req) {
  const addr = String(req?.socket?.remoteAddress ?? '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function writeJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += String(chunk)
      if (data.length > 2e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/** id → 安全文件名（只允许 [a-zA-Z0-9_-]，最长 80）。 */
function safeId(raw) {
  const id = String(raw ?? '').trim()
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null
  return id
}

function listDocs() {
  const dir = docsDir()
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue
    const id = ent.name.slice(0, -3)
    const full = path.join(dir, ent.name)
    try {
      const st = fs.statSync(full)
      const text = fs.readFileSync(full, 'utf8')
      const title = (text.match(/^#\s+(.+)$/m) || [, id])[1].trim()
      out.push({
        id,
        title,
        bytes: st.size,
        mtime: st.mtimeMs,
        chars: text.length,
      })
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

function newId() {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function readDoc(id) {
  const full = path.join(docsDir(), `${id}.md`)
  try {
    const text = fs.readFileSync(full, 'utf8')
    const st = fs.statSync(full)
    return { id, content: text, mtime: st.mtimeMs, chars: text.length }
  } catch {
    return null
  }
}

function writeDoc({ id, title, content }) {
  const dir = docsDir()
  const existing = safeId(id)
  const docId = existing || newId()
  const full = path.join(dir, `${docId}.md`)
  let body = String(content ?? '')
  if (title && !/^#\s+/m.test(body.slice(0, 80))) {
    body = `# ${title}\n\n${body.replace(/^#\s+.*\n?/, '')}`
  }
  fs.writeFileSync(full, body, 'utf8')
  return { id: docId, content: body, mtime: Date.now(), chars: body.length }
}

function deleteDoc(id) {
  const full = path.join(docsDir(), `${id}.md`)
  try {
    fs.rmSync(full, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * AI 辅助：优先注入 llm 服务调用当前 Provider；缺席时返回 501。
 * 载荷只发选区/文档片段 + 指令，不带整份会话历史（隐私与体积）。
 */
async function assist(ctx, body) {
  const c = ctx
  const face = c.llm || (typeof c.get === 'function' ? c.get('llm') : undefined)
  if (!face || typeof face.stream !== 'function') {
    return { ok: false, status: 501, error: 'llm-unavailable' }
  }
  const action = String(body.action || 'polish')
  const text = String(body.text || '').slice(0, 12000)
  const instruction =
    body.instruction ||
    ({
      polish: '润色下列文本：保持原意与篇幅量级，提升可读性与节奏，不要编造事实。',
      continue: '续写下列文本：风格一致，自然衔接，续写 150–300 字，不要重复已有句子。',
      outline: '为下列文本生成简洁大纲（Markdown 列表，层级不超过三级）。',
      compress: '压缩下列文本到约一半长度，保留关键论点与结论。',
      expand: '扩写下列文本：补足论证与例子，篇幅约 1.5–2 倍，保持语气。',
    }[action] || '改进下列文本。')

  const prompt = `${instruction}\n\n---\n${text}\n---\n\n只输出处理后的正文，不要解释。`
  try {
    let out = ''
    // 宽松服务面：内核 llm.stream 形状随版本微调，逐字段兜底
    const stream = face.stream({ messages: [{ role: 'user', content: prompt }] })
    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        const piece =
          typeof chunk === 'string'
            ? chunk
            : chunk?.delta ?? chunk?.text ?? chunk?.content ?? ''
        out += piece
        if (out.length > 20000) break
      }
    } else if (stream && typeof stream.then === 'function') {
      const r = await stream
      out = typeof r === 'string' ? r : r?.text ?? r?.content ?? ''
    }
    if (!out.trim()) return { ok: false, status: 502, error: 'empty-completion' }
    return { ok: true, status: 200, result: out.trim() }
  } catch (err) {
    return { ok: false, status: 502, error: String(err?.message || err) }
  }
}

export function apply(ctx) {
  const c = ctx
  ctx.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: API,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''

        if (req.method === 'GET' && (route === 'list' || route === '')) {
          writeJson(res, 200, { ok: true, docs: listDocs(), dir: docsDir() })
          return
        }
        if (req.method === 'GET' && route === 'get') {
          const id = safeId(url.searchParams.get('id'))
          if (!id) {
            writeJson(res, 400, { ok: false, error: 'bad-id' })
            return
          }
          const doc = readDoc(id)
          if (!doc) {
            writeJson(res, 404, { ok: false, error: 'not-found' })
            return
          }
          writeJson(res, 200, { ok: true, doc })
          return
        }
        if (req.method === 'POST' && route === 'save') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            const doc = writeDoc(parsed)
            writeJson(res, 200, { ok: true, doc })
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }
        if (req.method === 'POST' && route === 'delete') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const id = safeId(parsed?.id)
          if (!id) {
            writeJson(res, 400, { ok: false, error: 'bad-id' })
            return
          }
          writeJson(res, 200, { ok: deleteDoc(id) })
          return
        }
        if (req.method === 'POST' && route === 'assist') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const r = await assist(ctx, parsed)
          writeJson(res, r.status, r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error })
          return
        }
        writeJson(res, 404, { ok: false, error: 'unknown-route' })
      },
    })
  )
}
