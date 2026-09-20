/**
 * 世界观设定纯函数（方案 writing-world-settings-v1 §4/§7）。
 * 无 IO / DOM / React；host 与 client 共用。
 */

export const SETTING_TYPE = 'world'
export const SETTING_TYPES = new Set([SETTING_TYPE])

/** 结构化文字合计（Unicode 码点）技术上限；超出返回 413，不静默截断。 */
export const MAX_SETTING_CHARS = 16000
export const MAX_SOURCE_EXCERPT_CHARS = 8000
export const MAX_SOURCES = 20
export const MAX_TAGS = 20

export function settingError(code, status = 400) {
  return Object.assign(new Error(code), { status, code })
}

export function codePointLength(text) {
  return [...String(text ?? '')].length
}

/** 稳定规范化：对象键排序后 JSON，用于 operationId 幂等 hash。 */
export function stableStringify(value) {
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(walk)
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k])
    return out
  }
  return JSON.stringify(walk(value))
}

export function normalizeSources(raw) {
  const list = Array.isArray(raw) ? raw : []
  if (list.length > MAX_SOURCES) throw settingError('sources-too-many', 413)
  let excerptChars = 0
  const out = list.map((s) => {
    const excerpt = String(s?.excerpt ?? '')
    excerptChars += codePointLength(excerpt)
    return {
      sessionId: s?.sessionId != null ? String(s.sessionId).slice(0, 160) : null,
      messageId: s?.messageId != null ? String(s.messageId).slice(0, 160) : null,
      role: s?.role === 'assistant' || s?.role === 'author' ? s.role : null,
      excerpt,
      snapshotHash: s?.snapshotHash != null ? String(s.snapshotHash).slice(0, 128) : null,
      unavailable: s?.unavailable === true,
    }
  })
  if (excerptChars > MAX_SOURCE_EXCERPT_CHARS) throw settingError('sources-too-long', 413)
  return out
}

/**
 * 规范化 setting 输入。title/conclusion 在确认时必由调用方再查空。
 * 说明允许任意长度（建议 2–4 句，非硬校验）。
 */
export function normalizeSetting(input, { requireTitleConclusion = false } = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const type = raw.type == null || raw.type === '' ? SETTING_TYPE : String(raw.type)
  if (!SETTING_TYPES.has(type)) throw settingError('bad-setting-type')
  const title = String(raw.title ?? '').trim()
  const conclusion = String(raw.conclusion ?? '').trim()
  const explanation = String(raw.explanation ?? '')
  const boundaries = String(raw.boundaries ?? '')
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS)
  const sources = normalizeSources(raw.sources)
  const chars =
    codePointLength(title) +
    codePointLength(conclusion) +
    codePointLength(explanation) +
    codePointLength(boundaries) +
    tags.reduce((n, t) => n + codePointLength(t), 0) +
    sources.reduce((n, s) => n + codePointLength(s.excerpt), 0)
  if (chars > MAX_SETTING_CHARS) throw settingError('setting-too-long', 413)
  if (requireTitleConclusion) {
    if (!title) throw settingError('empty-title')
    if (!conclusion) throw settingError('empty-conclusion')
  }
  const setting = { type, title, conclusion, explanation, boundaries, tags, sources }
  return { setting, chars }
}

/** host 从 setting 确定性派生 items[].text：结论 +（可选）边界。 */
export function deriveSettingText(setting) {
  const conclusion = String(setting?.conclusion ?? '').trim()
  const boundaries = String(setting?.boundaries ?? '').trim()
  if (!conclusion) return ''
  return boundaries ? `${conclusion}\n边界/例外：${boundaries}` : conclusion
}

/** 默认注入单元：已确认结论 + 边界（不可拆开丢边界）；说明不进入。 */
export function settingInjectText(setting) {
  return deriveSettingText(setting)
}

export function isWorldSettingItem(item) {
  return Boolean(item && item.kind === 'fact' && item.setting && item.setting.type === SETTING_TYPE)
}

/** 确认态世界观设定的注入载荷（整条作为一个预算单元）。 */
export function settingInjectUnit(item) {
  if (!isWorldSettingItem(item) || item.status !== 'confirmed') return null
  const text = settingInjectText(item.setting)
  if (!text) return null
  return {
    id: item.id,
    kind: 'fact',
    label: '世界观',
    title: item.setting.title || '',
    text,
    explanation: item.setting.explanation || '',
    tags: item.setting.tags || [],
    itemRevision: item.itemRevision ?? null,
  }
}

const normalizeMatch = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()

/**
 * 确定性相关性：作者固定优先由调用方处理；
 * 其余 world 设定按当轮文字与标题/标签的规范化精确包含匹配计分，同分按 id 稳定序。
 */
export function rankWorldSettingIds(items, turnText, pinnedIds = [], excludedIds = []) {
  const pinned = new Set((pinnedIds || []).map(String))
  const excluded = new Set((excludedIds || []).map(String))
  const hay = normalizeMatch(turnText)
  const scored = []
  for (const it of items || []) {
    if (!isWorldSettingItem(it) || it.status !== 'confirmed') continue
    const id = String(it.id)
    if (excluded.has(id) || pinned.has(id)) continue
    const title = normalizeMatch(it.setting?.title)
    const tags = (it.setting?.tags || []).map(normalizeMatch).filter(Boolean)
    let score = 0
    if (title && hay.includes(title)) score += 3
    for (const t of tags) if (hay.includes(t)) score += 2
    scored.push({ id, score })
  }
  scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return scored
}

/**
 * 解析「整理为设定」的模型结构化结果（allowlist）。
 * 模型输出永远不能带 confirmed/targetPath/actor 作为权威。
 */
export function parseOrganizeResult(raw) {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      // 允许 ```json 围栏
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (!m) return { ok: false, error: 'organize-parse-failed' }
      try {
        data = JSON.parse(m[1])
      } catch {
        return { ok: false, error: 'organize-parse-failed' }
      }
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'organize-parse-failed' }
  if (data.schemaVersion != null && Number(data.schemaVersion) !== 1) {
    return { ok: false, error: 'organize-schema-unsupported' }
  }
  const list = Array.isArray(data.settings) ? data.settings : Array.isArray(data.items) ? data.items : null
  if (!list) return { ok: false, error: 'organize-shape-invalid' }
  const settings = []
  const rejected = []
  for (const row of list) {
    try {
      // Provenance is supplied by the frozen adapter snapshot, never by a model.
      const { setting } = normalizeSetting({ ...row, sources: [] }, { requireTitleConclusion: true })
      settings.push({
        ...setting,
        // 模型字段只能作候选展示；状态由 host/作者操作决定
        modelMark: row?.suggestion === true || row?.mark === 'suggestion' ? 'suggestion' : row?.mark === 'open' ? 'open' : null,
        pending: row?.pending === true || row?.mark === 'open',
      })
    } catch (err) {
      rejected.push({ error: err?.code || err?.message || 'bad-setting', row: { title: row?.title, conclusion: row?.conclusion } })
    }
  }
  return {
    ok: true,
    settings,
    rejected,
    notes: typeof data.notes === 'string' ? data.notes : '',
    // 丢弃任何模型伪权威字段
    ignoredAuthority: Boolean(data.confirmed || data.targetPath || data.actor),
  }
}
