'use strict'
// 审阅桥插件：订阅内核会话事件，把文件修改工具调用实时写入 NDJSON 流，
// 供外壳的"修改审阅"侧边栏消费。内核源码零修改，仅作为桌面实例的一个插件行挂载。
const fs = require('node:fs')

module.exports = {
  apply(ctx, config) {
    const outPath = config.out || ''
    if (!outPath) {
      console.log('[review-bridge] no out path configured')
      return
    }
    const FILE_TOOLS = new Set(['edit', 'write', 'str_replace_editor'])
    // 模型参数可能是对象或 JSON 字符串（tool/call 事件存的是原始形态）
    const parseArgs = (raw) => {
      if (raw && typeof raw === 'object') return raw
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch {}
      }
      return {}
    }
    let stream
    const ensureStream = () => {
      if (!stream) stream = fs.createWriteStream(outPath, { flags: 'a' })
    }
    const emit = (obj) => {
      try {
        ensureStream()
        stream.write(JSON.stringify(obj) + '\n')
      } catch {}
    }
    ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/call') {
        const d = event.data || {}
        if (FILE_TOOLS.has(d.name)) {
          const a = parseArgs(d.arguments)
          emit({
            kind: 'tool-call',
            ts: event.time,
            seq: event.seq,
            session: session ? session.id : null,
            turn: d.turn,
            step: d.step,
            callId: d.callId,
            name: d.name,
            file: a.file_path || a.path || null,
            old: a.old_string ?? null,
            new: a.new_string ?? a.content ?? null,
          })
        }
      } else if (event.type === 'turn/end') {
        emit({
          kind: 'turn-end',
          ts: event.time,
          session: session ? session.id : null,
          turn: (event.data || {}).turn,
        })
      }
    })
    ctx.on('dispose', () => {
      try {
        if (stream) stream.end()
      } catch {}
    })
    console.log('[review-bridge] loaded, out=' + outPath)
  },
}
