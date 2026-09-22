/**
 * Explicit relocation recovery. Copies into fresh buckets; never merges native workspaces.
 *
 * V5 加固：候选**必须携带与目标作品的关联证据**才允许导入。
 * 此前 relocationCandidates 只判断「绝对路径 + 不等于 target + 已不存在」，与 target 毫无关系，
 * 于是两部作品都移动过目录时，打开 B 会列出 A 的旧路径，确认即把 A 的草稿写进 B——
 * 这正是审查报告要求挡住的「把两个作品错误合并」。
 *
 * V6：项目身份统一走 lib/project-identity.js 的 identityKey（与 draft / memory / coordination 同口径）。
 *
 * 分寸：旧桶**永不删除**、永不改写；导入只往新桶复制，且重试不覆盖已恢复的编辑。
 * 证据不足时宁可拒绝导入（作者把目录移回原位即可完整恢复），也不冒混淆两部作品的风险。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { listCheckpoints, readCheckpoint, writeCheckpoint } from './draft-checkpoints.js'
import { coordinationDir } from './coordination.js'
import { identityKey } from './project-identity.js'
import { PROJECTION_REL } from './setting-projection.js'

const home = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 24)

function records(dir) {
  let names
  try { names = fs.readdirSync(dir) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  return names.filter(n => /^[a-f0-9]+\.json$/.test(n)).flatMap(n => {
    const file = path.join(dir, n)
    if (!fs.lstatSync(file).isFile()) return []
    try { return [JSON.parse(fs.readFileSync(file, 'utf8'))] } catch { return [] }
  })
}

/** 尽力读取目标作品随目录一起搬走的记忆文件，取它的 projectKey（搬走前的绝对路径）。 */
function memoryProjectKey(target) {
  try {
    const raw = fs.readFileSync(path.join(target, 'state', 'writing-memory.json'), 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    return typeof parsed?.projectKey === 'string' && parsed.projectKey ? parsed.projectKey : null
  } catch { return null }
}

/** 尽力从可读稿里取「> 项目：<path>」——它在记忆被改写后仍然留着搬迁前的路径。 */
function projectionProjectKey(target) {
  try {
    const text = fs.readFileSync(path.join(target, ...PROJECTION_REL.split('/')), 'utf8')
    const m = /^>\s*项目：(.+)$/m.exec(text)
    return m ? m[1].trim() : null
  } catch { return null }
}

/**
 * 关联证据分级。只有前两项允许导入；其余一律 `importable: false`。
 * 返回 { relation, importable, detail }
 *
 * ## CXR02（2026-09-22 独立复核，P1）：“同名同位”不是证据
 *
 * 曾经把「旧草稿引用的手稿在目标作品里同相对路径」也算证据
 * （relation=manuscript-reference, importable=true）。这是错的：两部完全不同的作品
 * 都会很自然地有 `draft/第一章.md`。复核探针实测：A/B 两部作品各自有同名但内容不同的
 * `draft/第一章.md`，移动 A 后在 B 查候选，A 被判为有关联、**不需要 confirmUnrelated 就能导入**，
 * 实测 copied=1——而界面声称“有证据属于当前作品”，实际依据只是一个常见相对文件名。
 *
 * 修正：降级为**无关联证据**（importable 永远为 false），只把观察写进 detail 供作者参考。
 * 内容指纹同理：最多是**辅助线索**，不得单独授予导入资格（两个作品可能都放同一份模板/空文件）。
 * 文件名相同不等于身份相同；长期解法是给作品一个**稳定 ID** 并随目录搬迁，
 * 而不是从文件名/内容反推身份。
 */
export function relocationRelation(target, oldPath, oldRecords = []) {
  const want = identityKey(oldPath)
  const memKey = memoryProjectKey(target)
  if (memKey && identityKey(memKey) === want) {
    return { relation: 'memory-project-key', importable: true, detail: '作品备忘里记录的项目路径正是这个旧位置' }
  }
  const projKey = projectionProjectKey(target)
  if (projKey && identityKey(projKey) === want) {
    return { relation: 'projection-record', importable: true, detail: '可读稿抬头记录的项目路径正是这个旧位置' }
  }
  // CXR02：以下只是**观察**，不是证据。同相对路径、乃至内容一致，都可能纯属巧合。
  let hint = null
  for (const rec of oldRecords) {
    const refPath = typeof rec?.reference?.path === 'string' ? rec.reference.path : ''
    if (!refPath || identityKey(refPath) === want) continue
    if (!identityKey(refPath).startsWith(want + '/')) continue
    const rel = path.relative(oldPath, refPath)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    try { if (!fs.statSync(path.join(target, rel)).isFile()) continue } catch { continue }
    // 内容比对只能拿草稿里的引用快照去比（旧位置已被移走，refPath 已不存在），
    // 而且即使一致也只当辅助线索，**不升级为证据**。
    let identical = false
    const refText = typeof rec?.reference?.text === 'string' ? rec.reference.text : null
    if (refText !== null) {
      try { identical = fs.readFileSync(path.join(target, rel), 'utf8') === refText } catch { identical = false }
    }
    hint = { rel, identical }
    break
  }
  if (hint) {
    return {
      relation: 'unrelated-filename-hint',
      importable: false,
      detail: `目标作品里存在同相对路径的文件（${hint.rel}${hint.identical ? '，且当前内容与旧草稿引用的快照一致' : ''}），但文件名相同不等于同一部作品，这**不构成关联证据**。仍可导入，但需你显式确认这是同一部作品。`,
    }
  }
  return { relation: 'unrelated', importable: false, detail: '没找到它属于当前作品的证据（作品备忘与可读稿里都没记过这个旧路径）。仍可导入，但需你显式确认这是同一部作品。' }
}

export function relocationCandidates(target, companions = {}) {
  const map = new Map()
  const add = (oldPath, sessionId = null) => {
    if (!oldPath || oldPath.includes('\0') || !path.isAbsolute(oldPath) || oldPath === target || fs.existsSync(oldPath)) return
    const key = identityKey(oldPath)
    const row = map.get(key) || { oldPath, sessions: [] }
    if (sessionId && !row.sessions.includes(sessionId)) row.sessions.push(sessionId)
    map.set(key, row)
  }
  for (const c of records(path.join(home(), 'writing-mode/drafts'))) add(String(c.project || '').replace(/\0.*$/, ''))
  for (const c of records(coordinationDir())) add(c.projectKey, c.sessionId)
  for (const [p, id] of Object.entries(companions || {})) add(p, id)

  return [...map.values()].map((c) => {
    const oldRecords = listCheckpoints(c.oldPath)
    const relation = relocationRelation(target, c.oldPath, oldRecords)
    return {
      ...c,
      ...relation,
      drafts: oldRecords.filter(r => r && !r.cleared && String(r.text || '')).length,
      token: hash(JSON.stringify({ oldPath: c.oldPath, relation: relation.relation })),
    }
  })
}

export function relocationHistory(target) {
  return listCheckpoints(target + '\0history').flatMap(c => { try { return [JSON.parse(c.text)] } catch { return [] } })
}

/**
 * 目标桶是否已被占用。**读不回来也算占用**：
 * D03 之后 readCheckpoint 对损坏文件抛 corrupt-draft 而不是返回 null，
 * 若不拦住，一次恢复就会因为某个无关的坏桶整体 500（或者更糟：把它当不存在而覆写）。
 * 损坏桶交给 D03 的显式恢复路径处理，恢复流程只跳过它。
 */
function occupied(bucket, windowId) {
  try { return readCheckpoint(bucket, windowId) !== null } catch { return true }
}

export function recoverRelocation(target, oldPath, token, companions = {}, opts = {}) {
  const source = relocationCandidates(target, companions).find(c => c.oldPath === oldPath && c.token === token)
  if (!source) throw Object.assign(new Error('recovery-source-changed'), { status: 409, code: 'recovery-source-changed' })
  // V5：token 只证明「客户端看到的是同一条候选」，不证明这条候选属于本作品。
  // 导入前在 host 侧重新判一次关联证据，模型/客户端都无法绕过。
  //
  // 分寸：无证据时**默认硬拒**，但给作者一个显式的知情覆盖（confirmUnrelated 必须严格 === true）。
  // 为何不一刀切禁到底：真搬迁但从未用过备忘/可读稿/带引用的作品就是没证据，
  // 硬禁会把作者逼到「只能把目录改回原名」。而本操作是**非破坏性**的（只往新桶复制、
  // 旧桶永不删改、重试不覆盖已恢复的编辑），所以知情同意 + 审计留痕是相称的。
  // token 已把 relation 编进去，有证据候选的 token 无法用来走覆盖路径。
  if (!source.importable && opts.confirmUnrelated !== true) {
    throw Object.assign(new Error('recovery-source-unrelated'), { status: 409, code: 'recovery-source-unrelated', relation: source.relation })
  }
  const overridden = !source.importable
  const relation = overridden ? 'unrelated-author-confirmed' : source.relation
  let copied = 0
  let skipped = 0
  for (const suffix of ['', '\0world']) {
    for (const c of listCheckpoints(oldPath + suffix)) {
      if (!c.text && !c.reference) continue
      const windowId = 'moved-' + hash(oldPath + ':' + c.windowId)
      if (occupied(target + suffix, windowId)) { skipped++; continue } // retries never overwrite a recovered edit
      writeCheckpoint(target + suffix, windowId, { baseRev: 0, text: c.text, reference: c.reference })
      copied++
    }
  }
  const windowId = 'moved-' + hash(oldPath)
  if (!occupied(target + '\0history', windowId)) {
    writeCheckpoint(target + '\0history', windowId, { baseRev: 0, text: JSON.stringify({ oldPath: source.oldPath, relation, sessions: source.sessions, at: new Date().toISOString() }) })
  }
  return { copied, skipped, relation, confirmedUnrelated: overridden, histories: relocationHistory(target) }
}
