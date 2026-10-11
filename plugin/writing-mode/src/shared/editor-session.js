/**
 * Pure editor session controller (no DOM/fs). Single production implementation.
 * Inlined into client.js by scripts/build-writing-client.mjs.
 */
export function createEditorSession(io, recovered) {
  let state = { path: null, content: '', revision: null, edit: 0, dirty: false, status: 'idle', error: '', errorCode: '', loading: false }
  let generation = 0
  let saving = null
  let creating = false
  const listeners = new Set()
  const notify = (patch) => {
    state = { ...state, ...patch }
    try { io.backup?.(state.dirty ? { path: state.path, content: state.content, revision: state.revision } : recovered || null) }
    catch { state = { ...state, error: '恢复草稿暂存失败，请保存后再退出。' } }
    for (const fn of listeners) fn(state)
  }
  const errorText = (err) => {
    const code = err?.message || String(err)
    return code === 'document-conflict' ? '文件已在别处修改。当前文字已保留，请另存新版后再比较。'
      : code === 'revision-required' ? '读写协议已更新，请刷新页面后重新打开文稿。'
      : code === 'historical-version' ? '这是历史稿，请另存新版。'
      : code === 'path-outside-roots' ? '这篇文稿不在当前作品库里（可能刚切换了库）。未保存的文字不会丢——把它的文件夹加回库，或切回原来的库即可继续。'
      : code === 'no-root' ? '还没有作品库。先在库面板里添加一个写作文件夹。'
      : code === 'bad-path' ? '这个文件路径无效。'
      : code.startsWith('ENOENT') ? '文件已被移动或删除。当前文字已保留，可另存新版。'
      : `操作失败，当前文字已保留：${code}`
  }
  const errorCodeOf = (err) => {
    const code = err?.message || String(err)
    return code.startsWith('ENOENT') ? 'file-gone' : code
  }
  async function result(promise) {
    const data = await promise
    if (!data?.ok || !data.doc) throw new Error(data?.error || 'invalid-response')
    return data.doc
  }
  const adopt = (doc) => notify({ path: doc.path, content: doc.content, revision: doc.revision, edit: state.edit + 1, dirty: false, status: 'idle', loading: false, error: '', errorCode: '' })
  const session = {
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    change(value) {
      if (state.loading || !state.path) return
      notify({ content: typeof value === 'function' ? value(state.content) : value, edit: state.edit + 1, dirty: true, status: 'idle', error: '', errorCode: '' })
},
    async refresh() {
      if (!state.path || state.loading || saving || creating) return false
      const snapshot = state
      const token = generation
      try {
        const doc = await result(io.read(snapshot.path))
        if (token !== generation || state.revision !== snapshot.revision || state.edit !== snapshot.edit || saving || creating) return false
        if (doc.revision === state.revision) return true
        if (state.dirty) notify({ status: 'error', error: '文件已在别处修改。当前输入已保留，请另存新版后比较。', errorCode: 'document-conflict' })
        else adopt(doc)
        return true
      } catch { return false }
    },
    async flush() {
      if (saving) { const ok = await saving; return ok ? session.flush() : false }
      if (!state.dirty || !state.path) return true
      const snapshot = state
      notify({ status: 'saving', error: '', errorCode: '' })
      saving = (async () => {
        try {
          const doc = await result(io.save({ path: snapshot.path, content: snapshot.content, revision: snapshot.revision }))
          const dirty = state.edit !== snapshot.edit
          notify({ revision: doc.revision, dirty, status: dirty ? 'idle' : 'saved' })
          io.saved?.(doc)
          return true
        } catch (err) {
          notify({ status: 'error', error: errorText(err), errorCode: errorCodeOf(err) })
          return false
        }
      })()
      const ok = await saving
      saving = null
      return ok && state.dirty ? session.flush() : ok
    },
    async open(target) {
      if (creating) return false
      if (!target || (state.path === target && !state.error)) return true
      const token = ++generation
      notify({ loading: true })
      if (!await session.flush()) { if (token === generation) notify({ loading: false }); return false }
      if (token !== generation) return false
      try {
        const doc = await result(io.read(target))
        if (token !== generation) return false
        adopt(doc)
        if (recovered?.path === doc.path) {
          const draft = recovered
          recovered = null
          if (draft.content !== doc.content) notify({ content: draft.content, revision: draft.revision, dirty: true, edit: state.edit + 1, status: 'error', error: '已恢复未保存文字。请保存；如原文件已变化，请另存新版。', errorCode: '' })
        }
        return true
      } catch (err) {
        if (token === generation) {
          // A removed/moved original must not erase its recovered buffer.
          if (!state.path && recovered?.path === target) {
            notify({ path: target, content: recovered.content, revision: recovered.revision, dirty: true })
            recovered = null
          }
          notify({ loading: false, status: 'error', error: errorText(err), errorCode: errorCodeOf(err) })
        }
        return false
      }
    },
    // 出界文稿的逃生口（2026-10-10 第八轮）：切库后打开的文稿 read/save 全必败，
    // 错误条上每个按钮都是死路。park 把未保存文字移交 recovered 通道（下次该文件
    // 可打开时自动恢复），会话清回空页——不丢字，也不再用必败状态占着写作台。
    park() {
      if (saving || creating) return false
      generation++
      if (state.dirty && state.path) recovered = { path: state.path, content: state.content, revision: state.revision }
      notify({ path: null, content: '', revision: null, dirty: false, status: 'idle', error: '', errorCode: '', loading: false })
      return true
    },
    async create(root, title) {
      if (creating) return false
      const token = ++generation
      notify({ loading: true })
      if (!await session.flush()) { if (token === generation) notify({ loading: false }); return false }
      if (token !== generation) return false
      creating = true
      try {
        const doc = await result(io.save({ root, title, content: '# ' + title + '\n\n', revision: null }))
        io.saved?.(doc)
        if (token !== generation) return false
        adopt(doc)
        return true
      } catch (err) { if (token === generation) notify({ loading: false, status: 'error', error: errorText(err), errorCode: errorCodeOf(err) }); return false }
      finally { creating = false }
    },
    async version() {
      if (!state.path || state.loading) return false
      creating = true
      ++generation
      notify({ loading: true })
      if (saving) await saving
      const snapshot = state
      try {
        const doc = await result(io.version({ path: snapshot.path, content: snapshot.content }))
        adopt(doc)
        io.saved?.(doc)
        return true
      } catch (err) { notify({ loading: false, status: 'error', error: errorText(err), errorCode: errorCodeOf(err) }); return false }
      finally { creating = false }
    },
    async close() {
      if (creating) return false
      ++generation // invalidate a pending file read
      notify({ loading: true })
      const ok = await session.flush()
      notify({ loading: false })
      return ok
    },
  }
  return session
}
