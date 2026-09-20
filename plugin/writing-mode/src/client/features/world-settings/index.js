/** World settings: explicit author actions, durable window drafts, authoritative receipts. */
import * as react from 'react'
import { api } from '../../services/writing-api.js'
import { parseOrganizeResult, stableStringify } from '../../../shared/world-setting.js'
import { snapshotHash } from '../../services/world-organizer.js'

const h = react.createElement
export function newOperationId() { return crypto.randomUUID() }
export async function requestHashOf(payload) { return snapshotHash(stableStringify(payload)) }
export function extractSettingsFromAssistantText(text) {
  const raw = String(text || '')
  const fence = raw.match(/```json\s*([\s\S]*?)```/i)
  const parsed = parseOrganizeResult(fence ? fence[1] : raw)
  return parsed.ok ? parsed : { ...parsed, raw }
}
export { extractSettingsFromAssistantText as extractWorldSettings }

function blankDraft(setting = {}) { return { id: newOperationId(), title: '', conclusion: '', explanation: '', boundaries: '', tags: [], sources: [], ...setting, dirty: true } }
function storageKey(path) { return 'dsh-world-drafts-v1:' + path }
function restore(path) {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(path)) || 'null')
    if (value?.version === 1 && Array.isArray(value.drafts)) return value
  } catch {}
  return { version: 1, drafts: [], rawReply: '', extra: '', interrupted: false }
}
function settingOf(d) {
  return { type: 'world', title: d.title, conclusion: d.conclusion, explanation: d.explanation || '', boundaries: d.boundaries || '', tags: d.tags || [], sources: d.sources || [] }
}

export function WorldSettingCard({ draft, onChange, onSaveCandidate, onConfirm, onDiscard, busy, notice }) {
  const fields = [['title', '标题'], ['conclusion', '结论'], ['explanation', '说明（可选）'], ['boundaries', '边界 / 例外（可选）']]
  return h('div', { className: 'dshWmWorldCard' },
    h('strong', null, draft.savedId ? '设定修订' : '设定候选'),
    h('p', null, draft.modelMark === 'open' ? '仍待讨论，确认前请核对。' : draft.modelMark === 'suggestion' ? '助手建议，尚未由作者确认。' : '尚待作者确认。'),
    ...fields.map(([key, title]) => h('label', { key }, title,
      h(key === 'title' ? 'input' : 'textarea', { 'data-world-field': key, value: draft[key] || '', rows: key === 'explanation' ? 4 : 2, disabled: busy || Boolean(draft.pendingOperation), onChange: e => onChange({ ...draft, [key]: e.target.value, dirty: true }) }))),
    h('details', null, h('summary', null, `来源 ${draft.sources?.length || 0} 条`), ...(draft.sources || []).map((s, i) => h('div', { key: i },
      h('small', null, `${s.role || '未知'} · ${s.sessionId || '来源不可用'} / ${s.messageId || '来源不可用'}`), h('pre', null, s.excerpt || '')))),
    notice ? h('p', { role: 'status' }, notice) : null,
    h('div', { className: 'dshWmWorldOps' },
      h('button', { type: 'button', disabled: busy || !!draft.pendingOperation || !draft.title?.trim() || !draft.conclusion?.trim(), onClick: onConfirm }, draft.savedId ? '确认修改' : '确认设定'),
      h('button', { type: 'button', disabled: busy || !!draft.pendingOperation || draft.savedStatus === 'confirmed' || !draft.title?.trim() || !draft.conclusion?.trim(), onClick: onSaveCandidate }, '存为候选'),
      h('button', { type: 'button', disabled: busy || !!draft.pendingOperation, onClick: onDiscard }, '关闭本地编辑')))
}

export function WorldSettingsPanel({ path, selectedMessages, onClearSelection, onStatus, onRequestOrganize, onChanged }) {
  const [local, setLocal] = react.useState(() => restore(path))
  const localRef = react.useRef(local)
  const [data, setData] = react.useState(null)
  const dataRef = react.useRef(null)
  const [active, setActive] = react.useState(0)
  const [phase, setPhase] = react.useState('idle')
  const [note, setNote] = react.useState(() => local.interrupted ? '上次整理等待已中断，请先查看完整会话；不会自动重发。' : '')
  const [storageError, setStorageError] = react.useState('')
  const [conflict, setConflict] = react.useState(null)
  const [projection, setProjection] = react.useState(null)
  const [historyId, setHistoryId] = react.useState(null)
  const alive = react.useRef(true)
  const busy = react.useRef(false)
  const generation = react.useRef(0)
  const controller = react.useRef(null)
  const writeLocal = (next, required = false) => {
    localRef.current = next
    if (alive.current) setLocal(next)
    try { sessionStorage.setItem(storageKey(path), JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('本窗口草稿未能缓存，请复制保留后再离开。'); if (required) throw new Error('无法持久化操作编号，本次未发送保存请求') }
  }
  const patchLocal = patch => writeLocal({ ...localRef.current, ...patch })
  const updateDraft = (id, fn, required = false) => writeLocal({ ...localRef.current, drafts: localRef.current.drafts.map(d => d.id === id ? fn(d) : d) }, required)
  const adopt = result => { dataRef.current = result; if (alive.current) setData(result) }
  const refresh = async () => {
    const seq = ++generation.current
    const result = await api('memory', undefined, { path })
    if (!result?.ok) throw new Error(result?.error || '读取设定失败')
    if (alive.current && seq === generation.current) adopt(result)
    return result
  }
  react.useEffect(() => {
    alive.current = true
    void refresh().catch(err => { if (alive.current) setNote(err.message) })
    return () => { alive.current = false; generation.current++; controller.current?.abort() }
  }, [path])
  react.useEffect(() => {
    const protect = e => { if (storageError) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [storageError])
  const changeDraft = next => updateDraft(next.id, () => next)
  const openItem = (it, snapshot = null) => {
    const source = snapshot || it
    const d = blankDraft({ ...source.setting, savedId: it.id, savedStatus: it.status, openedItemRevision: it.itemRevision, dirty: Boolean(snapshot), source: source.source })
    patchLocal({ drafts: [...localRef.current.drafts, d] }); setActive(localRef.current.drafts.length - 1)
  }
  const syncProjection = async (preserve = false) => {
    const current = await refresh()
    const result = await api('setting-projection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, baseRevision: current.memory.revision, baseEtag: current.etag, preserve, expectedFileHash: preserve ? projection?.hash : undefined }) })
    if (!result.ok) { await refresh(); throw new Error(`设定已保存，可读稿待同步：${result.error}`) }
    adopt(result); setProjection(null)
    return result
  }
  const requestSave = async (draft, op, retry = false) => {
    if (busy.current || conflict) return
    busy.current = true; setPhase('saving'); setNote('正在保存…')
    try {
      if (!dataRef.current) await refresh()
      let pending = draft.pendingOperation
      if (!pending) {
        if (retry) throw new Error('没有待重试操作')
        // A draft opened against another revision must be reviewed explicitly before overwrite.
        const remote = dataRef.current.memory.items.find(it => it.id === draft.savedId)
        if (remote && draft.openedItemRevision != null && remote.itemRevision !== draft.openedItemRevision) {
          setConflict({ draftId: draft.id, remote }); throw new Error('远端设定已更新；请先比较当前修订与远端')
        }
        const request = { path, op, baseRevision: dataRef.current.memory.revision, baseEtag: dataRef.current.etag, id: draft.savedId || undefined, item: op === 'retract-setting' ? undefined : { kind: 'fact', setting: settingOf(draft), source: draft.source }, actor: 'author', clientSchemaVersion: 2, operationId: newOperationId() }
        request.requestHash = await requestHashOf({ op, id: request.id || null, item: request.item || null, actor: request.actor })
        pending = { request }
        updateDraft(draft.id, d => ({ ...d, pendingOperation: pending }), true) // before dispatch, survives missing response
      }
      const result = await api('memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.request) })
      if (!alive.current) return
      if (!result?.ok) {
        if (result?.error === 'invalid-response') throw new Error('无法确认保存结果，请重试同一操作')
        updateDraft(draft.id, d => ({ ...d, pendingOperation: null }))
        if (['revision-conflict', 'etag-conflict', 'operation-conflict'].includes(result.error)) {
          const current = await refresh()
          setConflict({ draftId: draft.id, remote: current.memory.items.find(it => it.id === draft.savedId) || null })
        }
        throw new Error('保存失败，编辑已保留：' + result.error)
      }
      if (!result.receipt?.itemId) throw new Error('缺少保存收据，请重试同一操作核对')
      adopt(result)
      const saved = result.memory.items.find(it => it.id === result.receipt.itemId)
      updateDraft(draft.id, d => ({ ...d, pendingOperation: null, savedId: result.receipt.itemId, savedStatus: saved?.status, openedItemRevision: saved?.itemRevision, dirty: false }))
      setNote(pending.request.op === 'save-setting-candidate' ? '候选已保存，可稍后打开确认' : '设定已保存')
      onChanged?.(); onStatus?.({ phase: 'saved', receipt: result.receipt })
      if (pending.request.op !== 'save-setting-candidate') {
        try { const projected = await syncProjection(); setNote(projected.preservedPath ? `手稿副本已保留：${projected.preservedPath}；可读稿已同步` : '设定已保存，可读稿已同步') }
        catch (err) { setNote(err.message) }
      }
    } catch (err) { if (alive.current) setNote(err.message || String(err)) }
    finally { busy.current = false; if (alive.current) setPhase('idle') }
  }
  const organize = async () => {
    if (busy.current) return
    busy.current = true; setPhase('organizing'); controller.current = new AbortController()
    try {
      writeLocal({ ...localRef.current, interrupted: true }, true)
      setNote('正在整理所选讨论；普通输入与引用保持不变。')
      const result = await onRequestOrganize(localRef.current.extra, controller.current.signal)
      if (!alive.current || controller.current.signal.aborted) return
      const parsed = extractSettingsFromAssistantText(result.text)
      const drafts = parsed.ok ? parsed.settings.map(s => blankDraft({ ...s, sources: result.sources, source: { kind: 'assistant', sessionId: result.sessionId, messageId: result.messageId } })) : []
      patchLocal({ drafts: [...localRef.current.drafts, ...drafts], rawReply: result.text, interrupted: false })
      if (drafts.length) setActive(localRef.current.drafts.length - drafts.length)
      setNote(parsed.ok ? `新增 ${drafts.length} 条候选；${parsed.rejected?.length || 0} 条格式不符，原文已保留。` : '无法解析整理结果；原文已保留，可手动新建设定。')
    } catch (err) { if (alive.current) setNote(err.message || String(err)) }
    finally { busy.current = false; if (alive.current) setPhase('idle') }
  }
  const runProjection = async preserve => {
    if (busy.current) return
    busy.current = true; setPhase('saving'); setNote('正在同步可读稿…')
    try { const r = await syncProjection(preserve); setNote(r.preservedPath ? `已保留手稿副本：${r.preservedPath}；整理稿已重建` : '可读稿已同步') }
    catch (err) { setNote(err.message) } finally { busy.current = false; setPhase('idle') }
  }
  const draft = local.drafts[active] || local.drafts[0]
  const worldItems = (data?.memory?.items || []).filter(it => it.setting?.type === 'world')
  const histories = (data?.memory?.changes || []).filter(c => c.id === historyId).slice().reverse()
  return h('section', { className: 'dshWmWorldPanel', 'data-world-panel': '' },
    h('h3', null, '世界观整理'),
    h('p', null, `已选消息 ${selectedMessages?.length || 0} · 设定 ${worldItems.length}`),
    h('details', null, h('summary', null, '查看整理范围'), ...(selectedMessages || []).map(m => h('pre', { key: m.id }, `${m.role}：${m.text}`))),
    h('label', null, '补充要求', h('input', { value: local.extra, onChange: e => patchLocal({ extra: e.target.value }) })),
    h('button', { disabled: phase !== 'idle' || !selectedMessages?.length, onClick: organize }, '整理为设定'),
    h('button', { disabled: phase !== 'idle', onClick: onClearSelection }, '清除选择'),
    h('button', { disabled: phase !== 'idle', onClick: () => { patchLocal({ drafts: [...localRef.current.drafts, blankDraft()] }); setActive(localRef.current.drafts.length - 1) } }, '手动新建设定'),
    phase === 'organizing' ? h('button', { onClick: () => controller.current?.abort() }, '停止等待') : null,
    h('p', { role: 'status', 'data-world-notice': '' }, note), storageError ? h('p', { role: 'alert' }, storageError) : null,
    h('button', { disabled: phase !== 'idle', onClick: () => void refresh().catch(err => setNote(err.message)) }, '重新读取设定'),
    local.rawReply ? h('details', null, h('summary', null, '整理原文'), h('pre', null, local.rawReply)) : null,
    h('div', null, ...local.drafts.map((d, i) => h('button', { key: d.id, onClick: () => setActive(i) }, `${d.title || '未命名'}${d.dirty ? ' · 本地编辑' : ''}`))),
    draft ? h(WorldSettingCard, { draft, busy: phase !== 'idle' || !!conflict, onChange: changeDraft,
      onSaveCandidate: () => void requestSave(draft, 'save-setting-candidate'), onConfirm: () => void requestSave(draft, 'confirm-setting'),
      onDiscard: () => { if (draft.dirty && !window.confirm('关闭这份本地编辑？已保存的设定不会删除。')) return; patchLocal({ drafts: localRef.current.drafts.filter(d => d.id !== draft.id) }); setActive(0) },
      notice: draft.pendingOperation ? '结果待核对；重试会使用原操作编号，不重复新增。' : '本窗口编辑已缓存；确认后才更新项目设定。' }) : null,
    draft?.pendingOperation ? h('button', { disabled: phase !== 'idle', onClick: () => void requestSave(draft, null, true) }, '核对并重试保存') : null,
    conflict ? h('div', { role: 'alert' }, h('strong', null, '保存冲突：本地编辑保留'), h('pre', null, JSON.stringify(conflict.remote?.setting || {}, null, 2)),
      h('button', { onClick: () => { const d = localRef.current.drafts.find(x => x.id === conflict.draftId); if (d) updateDraft(d.id, x => ({ ...x, openedItemRevision: conflict.remote?.itemRevision, pendingOperation: null })); setConflict(null); setNote('已采用最新基线；请核对后再次确认保存。') } }, '已比较，保留本地修订'),
      h('button', { onClick: () => setConflict(null) }, '暂不保存')) : null,
    data?.memory?.projection && data.memory.projection.status !== 'idle' ? h('div', { className: 'dshWmWorldProjection' },
      h('p', null, data?.memory?.projection?.status === 'synced' ? '可读稿已同步' : `可读稿待同步：${data?.memory?.projection?.lastError || 'pending'}`),
      h('button', { disabled: phase !== 'idle', onClick: () => void runProjection(false) }, '重试同步可读稿'),
      h('button', { onClick: () => void api('setting-projection', undefined, { path }).then(r => r.ok ? setProjection(r) : setNote(r.error)).catch(err => setNote(err.message)) }, '查看可读稿差异')) : null,
    projection ? h('div', null, h('h4', null, '磁盘原文'), h('pre', null, projection.content), h('h4', null, '将生成的内容'), h('pre', null, projection.proposed),
      projection.exists ? h('button', { disabled: phase !== 'idle', onClick: () => void runProjection(true) }, '保留手稿副本并重建整理稿') : null) : null,
    h('h4', null, '已保存设定'), ...worldItems.map(it => h('article', { key: it.id, 'data-world-item': it.id },
      h('strong', null, it.setting.title), h('span', null, ` · ${it.status} · 修订 ${it.itemRevision}`), h('p', null, it.setting.conclusion),
      h('button', { disabled: phase !== 'idle', onClick: () => openItem(it) }, it.status === 'proposed' ? '打开候选' : '编辑设定'),
      h('button', { onClick: () => setHistoryId(it.id) }, '设定历史'),
      h('button', { disabled: phase !== 'idle' || it.status === 'retracted', onClick: () => { const d = blankDraft({ ...it.setting, savedId: it.id, savedStatus: it.status, openedItemRevision: it.itemRevision }); patchLocal({ drafts: [...localRef.current.drafts, d] }); setActive(localRef.current.drafts.length - 1); void requestSave(d, 'retract-setting') } }, '撤回设定'))),
    historyId ? h('div', null, h('h4', null, '历史内容（恢复将创建新修订）'), ...histories.map((c, i) => h('div', { key: i }, h('small', null, `${c.at} · ${c.actor} · ${c.op}`), h('pre', null, JSON.stringify(c.before?.setting || c.after?.setting || {}, null, 2)),
      h('button', { disabled: phase !== 'idle', onClick: () => { const it = worldItems.find(x => x.id === historyId); if (it) openItem(it, c.before?.setting ? c.before : c.after) } }, '载入这版为修订稿')))) : null)
}
