/**
 * 会话式编辑器：修订号、保存队列、切换防串、草稿备份。
 * 与 client.js 内联实现保持同一契约（client 因 ModuleLoader 无法 import 本文件）。
 * 可单测：plugin/writing-mode/test/p1-regression.mjs
 */
export function createEditorSession(io, recovered) {
  let state = {
    path: null,
    content: '',
    revision: null,
    edit: 0,
    dirty: false,
    status: 'idle',
    error: '',
    loading: false,
  }
  let generation = 0
  let saving = null
  let creating = false
  const listeners = new Set()
  const notify = (patch) => {
    state = { ...state, ...patch }
    try {
      io.backup?.(
        state.dirty
          ? { path: state.path, content: state.content, revision: state.revision }
          : recovered || null
      )
    } catch {
      state = { ...state, error: '恢复草稿暂存失败，请保存后再退出。' }
    }
    for (const fn of listeners) fn(state)
  }
  const errorText = (err) => {
    const code = err?.message || String(err)
    return code === 'document-conflict'
      ? '文件已在别处修改。当前文字已保留，请另存新版后再比较。'
      : code === 'revision-required'
        ? '读写协议已更新，请刷新页面后重新打开文稿。'
        : code === 'historical-version'
          ? '这是历史稿，请另存新版。'
          : `操作失败，当前文字已保留：${code}`
  }
  async function result(promise) {
    const data = await promise
    if (!data?.ok || !data.doc) throw new Error(data?.error || 'invalid-response')
    return data.doc
  }
  const adopt = (doc) =>
    notify({
      path: doc.path,
      content: doc.content,
      revision: doc.revision,
      edit: state.edit + 1,
      dirty: false,
      status: 'idle',
      loading: false,
      error: '',
    })
  const session = {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    change(value) {
      if (state.loading || !state.path) return
      notify({
        content: typeof value === 'function' ? value(state.content) : value,
        edit: state.edit + 1,
        dirty: true,
        status: 'idle',
        error: '',
      })
    },
    async flush() {
      if (saving) {
        const ok = await saving
        return ok ? session.flush() : false
      }
      if (!state.dirty || !state.path) return true
      const snapshot = state
      notify({ status: 'saving', error: '' })
      saving = (async () => {
        try {
          const doc = await result(
            io.save({ path: snapshot.path, content: snapshot.content, revision: snapshot.revision })
          )
          const dirty = state.edit !== snapshot.edit
          notify({ revision: doc.revision, dirty, status: dirty ? 'idle' : 'saved' })
          io.saved?.(doc)
          return true
        } catch (err) {
          notify({ status: 'error', error: errorText(err) })
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
      if (!(await session.flush())) {
        if (token === generation) notify({ loading: false })
        return false
      }
      if (token !== generation) return false
      try {
        const doc = await result(io.read(target))
        if (token !== generation) return false
        adopt(doc)
        if (recovered?.path === doc.path) {
          const draft = recovered
          recovered = null
          if (draft.content !== doc.content)
            notify({
              content: draft.content,
              revision: draft.revision,
              dirty: true,
              edit: state.edit + 1,
              status: 'error',
              error: '已恢复未保存文字。请保存；如原文件已变化，请另存新版。',
            })
        }
        return true
      } catch (err) {
        if (token === generation) {
          if (!state.path && recovered?.path === target) {
            notify({ path: target, content: recovered.content, revision: recovered.revision, dirty: true })
            recovered = null
          }
          notify({ loading: false, status: 'error', error: errorText(err) })
        }
        return false
      }
    },
    async create(root, title) {
      if (creating) return false
      const token = ++generation
      notify({ loading: true })
      if (!(await session.flush())) {
        if (token === generation) notify({ loading: false })
        return false
      }
      if (token !== generation) return false
      creating = true
      try {
        const doc = await result(
          io.save({ root, title, content: '# ' + title + '\n\n', revision: null })
        )
        io.saved?.(doc)
        if (token !== generation) return false
        adopt(doc)
        return true
      } catch (err) {
        if (token === generation) notify({ loading: false, status: 'error', error: errorText(err) })
        return false
      } finally {
        creating = false
      }
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
      } catch (err) {
        notify({ loading: false, status: 'error', error: errorText(err) })
        return false
      } finally {
        creating = false
      }
    },
    async close() {
      if (creating) return false
      ++generation
      notify({ loading: true })
      const ok = await session.flush()
      notify({ loading: false })
      return ok
    },
  }
  return session
}
