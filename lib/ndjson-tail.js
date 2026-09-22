'use strict'

/**
 * NDJSON 尾部读取（零 Electron 依赖，可单测）。
 *
 * 为什么需要：审阅侧栏的数据源是 review-bridge 写的 `review-events.ndjson`，
 * 里面每条 write 的 tool-call 都带 `new: <整个文件内容>`，会话期间单调增长
 * （只在内核启动时清一次）。原来 `readSessionChanges` 每次刷新都整份 readFileSync +
 * 逐行 JSON.parse + 全量过 IPC：实测 20 次 400KB 写入 = 7.8MB 流，每次刷新搬 7.8MB
 * （主进程与渲染侧双份内存），长会话 + 大文件的 agent 工作能把面板拖到卡顿乃至 OOM。
 *
 * 尾部截断是安全的：逐条回退**不依赖**这份流（review-bridge 用自己内存里的
 * session events 按 callId 查），流只用于展示，而展示关心的恰恰是最近的改动。
 * 截断时回 `truncated: true`，由 UI 如实告知，绝不静默假装完整。
 */

const fs = require('node:fs')

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 2000

/**
 * 读取 NDJSON 文件的尾部并解析。
 * @param {string} file
 * @param {{maxBytes?: number, maxEntries?: number}} [opts]
 * @returns {{ok:boolean, entries:Array, truncated:boolean, streamBytes:number, readBytes:number, error?:string}}
 */
function readNdjsonTail(file, opts = {}) {
  const maxBytes = Number.isFinite(Number(opts.maxBytes)) ? Number(opts.maxBytes) : DEFAULT_MAX_BYTES
  const maxEntries = Number.isFinite(Number(opts.maxEntries)) ? Number(opts.maxEntries) : DEFAULT_MAX_ENTRIES
  try {
    const stat = fs.statSync(file)
    const readLen = Math.min(stat.size, maxBytes)
    let text = ''
    if (readLen > 0) {
      const buf = Buffer.alloc(readLen)
      const fd = fs.openSync(file, 'r')
      let got = 0
      try {
        got = fs.readSync(fd, buf, 0, readLen, stat.size - readLen)
      } finally {
        fs.closeSync(fd)
      }
      text = buf.subarray(0, Math.max(0, got)).toString('utf8')
    }
    const byteCut = readLen < stat.size
    // 从中间起读时第一行必然是残行（还可能把一个多字节字符切半），整行丢掉
    if (byteCut) {
      const nl = text.indexOf('\n')
      text = nl < 0 ? '' : text.slice(nl + 1)
    }
    const lines = text.split('\n').filter(Boolean)
    const entryCut = lines.length > maxEntries
    const kept = entryCut ? lines.slice(-maxEntries) : lines
    const entries = []
    for (const line of kept) {
      try {
        const parsed = JSON.parse(line)
        if (parsed) entries.push(parsed)
      } catch {
        // 尾部正在被追加时最后一行可能半截；跳过，下次刷新自然补上
      }
    }
    return {
      ok: true,
      entries,
      truncated: byteCut || entryCut,
      streamBytes: stat.size,
      readBytes: readLen,
    }
  } catch (err) {
    return { ok: false, entries: [], truncated: false, streamBytes: 0, readBytes: 0, error: err && err.message ? err.message : String(err) }
  }
}

module.exports = { readNdjsonTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES }
