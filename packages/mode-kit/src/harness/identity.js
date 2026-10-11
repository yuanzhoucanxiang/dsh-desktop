/**
 * 项目身份归一（方案 P2 §3.2）：协调记录按"规范项目身份"分桶，必须与原生侧一致。
 *
 * 规则：
 *   1. **优先用 host 返回的 canonical project**（`/api/writing-mode?route=companion` 的
 *      `binding.project` 是内核 side 解析后的作品根，是唯一权威）；
 *   2. host 还没答复时用本地归一值当**临时键**（只用于进程内 Promise 共用，不作为记录键）；
 *   3. 大小写、分隔符、结尾斜杠都要归一，否则 Windows 上 `E:\novel\A` 与 `e:/novel/a/`
 *      会被当成两个作品，各自建一个会话。
 */

/** 本地归一：仅用于进程内键与本地缓存，不写进协调记录。 */
export function canonicalProjectKey(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  return raw.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 权威身份：host 给的 canonical 优先；没有则退回本地归一值并标记 unverified。
 * UI 与记录都应使用返回的 key；unverified=true 时不得据此写协调记录（要等 host 答复）。
 */
export function projectIdentityOf(binding, fallbackPath) {
  const canonical = binding && typeof binding.project === 'string' ? binding.project : ''
  if (canonical) return { key: canonicalProjectKey(canonical), authoritative: true, display: canonical }
  return { key: canonicalProjectKey(fallbackPath), authoritative: false, display: String(fallbackPath || '') }
}
