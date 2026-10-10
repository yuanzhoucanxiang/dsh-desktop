/**
 * 实时文本体检路由（2026-10-10）：`route=health`。
 *
 * 两个来源，同一套纯函数（lib/writing-state.js；host 运行时不依赖 src/，所以
 * 权威实现在 lib 侧，客户端 bundle 相对 import 同一份，避免两套漂移）：
 *   POST { text }        —— 编辑器里**尚未保存**的正文（实时体检的正确入口）
 *   GET/POST { path }    —— 库内某篇文稿（读盘后体检，供状态条/伙伴上下文用）
 *
 * 只读：不写任何文件、不改任何状态。
 */
import fs from 'node:fs'
import { writeJson } from '../http.js'
import { targetUnder } from './helpers.js'
import { textHealth } from '../writing-state.js'

/** 只读体检：text 优先，否则按库内路径读盘。 */
export async function getHealth({ req, res, cfg, url, route }) {
  let body = null
  if (req.method === 'POST') {
    const chunks = []
    let bytes = 0
    await new Promise((resolve) => {
      req.on('data', (c) => {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf8')
        bytes += buf.length
        if (bytes <= 1024 * 1024) chunks.push(buf)
      })
      req.on('end', resolve)
      req.on('aborted', resolve)
      req.on('error', resolve)
    })
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      writeJson(res, 400, { ok: false, error: 'invalid-json' })
      return
    }
  }
  const rawPath = String((body && body.path) || url.searchParams.get('path') || '')
  const inline = body && typeof body.text === 'string' ? body.text : null

  let text = inline
  let file = null
  if (text === null) {
    if (!rawPath) {
      writeJson(res, 400, { ok: false, error: 'text-or-path-required' })
      return
    }
    // 库内路径：targetUnder 负责越界判定（自己回 400 path-outside-roots）
    // 注意 resolveUnderRoots 返回的是 { abs, root, rel }，不是字符串——读盘要用 .abs。
    const target = targetUnder({ res, cfg }, rawPath)
    if (target === null) return
    try {
      text = fs.readFileSync(target.abs, 'utf8')
      file = target.abs
    } catch (err) {
      writeJson(res, 404, { ok: false, error: String(err?.code || err?.message || err) })
      return
    }
  }

  const opts = {}
  const maxSentence = Number((body && body.maxSentence) || url.searchParams.get('maxSentence'))
  const maxParagraph = Number((body && body.maxParagraph) || url.searchParams.get('maxParagraph'))
  if (Number.isFinite(maxSentence) && maxSentence > 0) opts.maxSentence = maxSentence
  if (Number.isFinite(maxParagraph) && maxParagraph > 0) opts.maxParagraph = maxParagraph

  writeJson(res, 200, { ok: true, route, file, health: textHealth(text, opts) })
}
