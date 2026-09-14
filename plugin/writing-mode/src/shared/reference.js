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
/** 是否具备完整身份（缺任何一项都不能据"空==空"判等）。 */
export function hasReferenceIdentity(r) {
  if (!r) return false
  if (!r.path || r.revision == null) return false
  const sel = r.selection
  if (!sel || !Number.isInteger(sel.start) || !Number.isInteger(sel.end)) return false
  return true
}

/**
 * 结构相等：只比身份字段。
 * B08：任一方缺身份（旧 checkpoint 的 {label,text}）时**不能**把缺失当成"都空所以相等"——
 * 那会让两段不同的旧引用被判成同一份，进而"发送后清理引用"清错对象。
 * 旧格式一律保守比较**完整快照**（label + 正文），此时只有真正同源的引用才算同一份。
 */
export function sameReference(a, b) {
  if (!a || !b) return !a && !b
  if (!hasReferenceIdentity(a) || !hasReferenceIdentity(b)) {
    return String(a.label ?? '') === String(b.label ?? '') && String(a.text ?? '') === String(b.text ?? '')
  }
  const sel = (r) => `${r.selection.start}-${r.selection.end}`
  return (
    String(a.path) === String(b.path) &&
    String(a.revision) === String(b.revision) &&
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
