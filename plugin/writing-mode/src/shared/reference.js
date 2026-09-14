/**
 * 稿件引用（方案 P3 §4.3）：来源字段与正文分开，身份用**结构相等**判定，不用正文拼接。
 *
 * 引用身份 = path + revision + selection{start,end} + snapshotFingerprint。
 *   - revision 是"取自哪一版源稿"；
 *   - snapshotFingerprint 标记"这段文字来自未保存的编辑器状态"（形如 unsaved:<len>:<hash>）；
 *   - label 只给人看，text 是正文——两者都不参与身份比较。
 *
 * 旧 checkpoint 里只有 { label, text } 的引用按原样兼容：**不猜测、不补造** revision/selection，
 * 缺的字段就是 null，界面按"来源不详"呈现。
 */

/** 32 位 FNV-1a：只要稳定、便宜即可（不用于安全用途）。 */
function hash32(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function contentFingerprint(text) {
  const body = String(text ?? '')
  return `${body.length}:${hash32(body)}`
}

/**
 * 构造一个新引用。excerpt 是**正文**；label/path/revision/selection 是来源。
 * dirty=true 表示正文取自编辑器未保存状态，会带上快照指纹。
 */
export function makeReference({ label, excerpt, path = null, revision = null, start = null, end = null, dirty = false, note = null }) {
  const selection = Number.isInteger(start) && Number.isInteger(end) && end > start ? { start, end } : null
  return Object.freeze({
    label: label || '稿件快照',
    text: String(excerpt ?? ''),
    path: path || null,
    revision: revision ?? null,
    selection,
    snapshotFingerprint: dirty ? `unsaved:${contentFingerprint(excerpt)}` : null,
    note: note || null,
  })
}

/** 结构相等：只比身份字段。任一字段缺失（null）按"不同"处理，避免把不同来源当成同一引用。 */
export function sameReference(a, b) {
  if (!a || !b) return !a && !b
  const sel = (r) => (r.selection ? `${r.selection.start}-${r.selection.end}` : 'none')
  return (
    String(a.path ?? '') === String(b.path ?? '') &&
    String(a.revision ?? '') === String(b.revision ?? '') &&
    sel(a) === sel(b) &&
    String(a.snapshotFingerprint ?? '') === String(b.snapshotFingerprint ?? '')
  )
}

/**
 * 引用是否来自旧快照。source 为 { path, revision } 或 null（源稿当前状态未知）。
 * 源稿没打开 / 路径不同 → 返回 'unknown'：**不谎报"最新"，也不谎报"过期"**。
 */
export function referenceStatus(reference, source) {
  if (!reference?.text) return 'empty'
  if (reference.snapshotFingerprint) return 'unsaved'
  if (!source || !source.path || !reference.path) return 'unknown'
  if (String(source.path) !== String(reference.path)) return 'unknown'
  if (reference.revision == null || source.revision == null) return 'unknown'
  return String(source.revision) === String(reference.revision) ? 'current' : 'stale'
}

/** 把旧 checkpoint 的 {label,text} 引用规范成新结构（缺的来源字段保持 null，不编造）。 */
export function normalizeReference(raw) {
  if (!raw || !raw.text) return null
  if (raw.path !== undefined || raw.revision !== undefined || raw.selection !== undefined) return raw
  return Object.freeze({
    label: raw.label || '稿件快照',
    text: String(raw.text),
    path: null,
    revision: null,
    selection: null,
    snapshotFingerprint: raw.snapshotFingerprint || null,
    note: raw.note || null,
    legacy: true,
  })
}
