/**
 * 章节重排序（卡片拖拽的 host 侧）：把「拖拽产生的目标顺序」落实为 **draft/ 内的重命名事务**。
 *
 * 设计（docs/plans/writing-outline-card-view-research.md §2.2 的"重命名事务"）：
 * - 顺序即文件名自然序，重排 = 让 desired[i] 占用 current[i] 现在的题名（保留各自的 -vN 版本后缀）。
 * - 两阶段改名破环：第一阶段全部改成 `<原名>.reorder-<token>.tmp`（独占建名，绝不覆盖）；
 *   第二阶段 tmp → 终名。任何一步失败都尽力回滚到原始命名。
 * - **绝不覆盖**：Node 的 fs.rename 在 Windows 会静默覆盖已存在目标，所以每次改名前显式
 *   existsSync 检查，撞名即失败回滚——宁可报错，不可吞稿。
 * - 崩溃遗留：.tmp 后缀不在 TEXT_EXTS，扫描天然忽略；下次 reorder 发现遗留 tmp 直接拒绝，
 *   指引作者手动恢复（文件内容始终完好，只是名字停在中间态）。
 * - 纯函数 planReorder 可独立测试；applyReorder 接受可注入 io（默认真实 fs+renameSync）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { listProjectFiles } from './store.js'
import { naturalSortFiles } from './compile.js'

const TMP_MARK = '.reorder-'
const TMP_SUFFIX = '.tmp'

export function isReorderTmp(name) {
  return String(name).includes(TMP_MARK) && String(name).endsWith(TMP_SUFFIX)
}

const stripVersion = (name) => String(name).replace(/-v\d+(\.[^.]+)$/i, '$1')
const seriesKeyOf = (rel) => stripVersion(String(rel).split(/[\\/]/).pop()).toLowerCase()

/** 换题名保留版本后缀：成员 stem 剥掉自身 -vN 与系列题名比对，拼回新题名 + 原 -vN + 扩展名。 */
function swapStem(fileName, oldBase, newBase) {
  const ext = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  const oldStem = oldBase.slice(0, oldBase.length - path.extname(oldBase).length)
  const versionSuffix = stem.match(/-v\d+$/i)?.[0] || ''
  const memberStem = stem.slice(0, stem.length - versionSuffix.length)
  if (memberStem.toLowerCase() !== oldStem.toLowerCase()) return null
  return newBase.slice(0, newBase.length - path.extname(newBase).length) + versionSuffix + ext
}

/**
 * 纯函数：计算重命名计划。
 * @param current  当前顺序的系列（[{ key, base, files: [{ abs, name }] }]，key=base 的小写题名）
 * @param desiredKeys 期望顺序的 key 数组（必须与 current 的 key 集合完全一致）
 * @returns { moves: [{ from, to, temps: [{ from, tmp, to }] }], token } ；无需移动时 moves 为空。
 */
export function planReorder(current, desiredKeys) {
  const list = Array.isArray(current) ? current : []
  const wanted = Array.isArray(desiredKeys) ? desiredKeys.map((k) => String(k)) : []
  const keys = list.map((s) => s.key)
  if (list.length === 0) return { moves: [], token: randomUUID() }
  if (wanted.length !== list.length || new Set(wanted).size !== wanted.length) {
    throw Object.assign(new Error('order-shape-invalid'), { code: 'order-shape-invalid' })
  }
  for (const k of wanted) {
    if (!keys.includes(k)) throw Object.assign(new Error('order-unknown-series'), { code: 'order-unknown-series' })
  }
  for (const k of keys) {
    if (!wanted.includes(k)) throw Object.assign(new Error('order-unknown-series'), { code: 'order-unknown-series' })
  }
  const byKey = new Map(list.map((s) => [s.key, s]))
  const token = randomUUID()
  const moves = []
  for (let i = 0; i < wanted.length; i += 1) {
    const target = byKey.get(wanted[i])
    const holder = list[i]
    if (target.key === holder.key) continue
    const files = (target.files || []).map((f) => {
      // target 系列搬到位置 i：整系列（含 -vN 各版本）从 target.base 题名换成 holder.base 题名
      const finalName = swapStem(f.name, target.base, holder.base)
      return { abs: f.abs, name: f.name, finalName }
    })
    if (files.some((f) => f.finalName === null)) {
      throw Object.assign(new Error('order-stem-mismatch'), { code: 'order-stem-mismatch' })
    }
    moves.push({
      key: target.key,
      fromBase: target.base,
      toBase: holder.base,
      files,
    })
  }
  return { moves, token }
}

/**
 * 执行重命名事务。io 形状（可注入测试）：{ exists, rename, listTmp }，默认真实 fs。
 * @param draftDir  draft 目录（临时文件与遗留检查都限定在这里）
 */
export function applyReorder(moves, token, dirs, io = null) {
  const impl = io || {
    exists: (p) => fs.existsSync(p),
    rename: (a, b) => fs.renameSync(a, b),
    listTmp: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => isReorderTmp(n)) : []),
  }
  // 遗留 tmp：上一次事务没有走完，拒绝并指路（内容完好，手动改名即可恢复）
  const leftovers = []
  for (const dir of dirs) leftovers.push(...impl.listTmp(dir).map((n) => path.join(dir, n)))
  if (leftovers.length) {
    throw Object.assign(new Error('reorder-leftovers: ' + leftovers.join(', ')), { code: 'reorder-leftovers' })
  }
  // 撞名预检：所有终名不得被事务外的文件占用（终名的现在占用者都在本事务里让位）
  const movingOldNames = new Set()
  for (const m of moves) for (const f of m.files) movingOldNames.add(f.abs.toLowerCase())
  for (const m of moves) {
    for (const f of m.files) {
      const finalAbs = path.join(path.dirname(f.abs), f.finalName)
      if (impl.exists(finalAbs) && !movingOldNames.has(finalAbs.toLowerCase())) {
        throw Object.assign(new Error('reorder-collision: ' + finalAbs), { code: 'reorder-collision' })
      }
    }
  }
  const done = []
  const undo = () => {
    // 逆序回滚：第二阶段已落地的先改回 tmp，再把所有 tmp 改回原名
    for (const rec of done.slice().reverse()) {
      try { impl.rename(rec.current, rec.tmp) } catch {}
    }
    for (const rec of done) {
      try { impl.rename(rec.tmp, rec.original) } catch {}
    }
  }
  try {
    // 阶段一：全部让位成 tmp（tmp 名带 token，独占性由 token 保证）
    const staged = []
    for (const m of moves) {
      for (const f of m.files) {
        const tmp = f.abs + TMP_MARK + token + TMP_SUFFIX
        if (impl.exists(tmp)) throw Object.assign(new Error('reorder-tmp-exists'), { code: 'reorder-tmp-exists' })
        impl.rename(f.abs, tmp)
        done.push({ original: f.abs, tmp, current: tmp, final: path.join(path.dirname(f.abs), f.finalName) })
        staged.push({ rec: done[done.length - 1], finalName: f.finalName })
      }
    }
    // 阶段二：tmp → 终名（终名此时必然空闲——原占用者已在阶段一让位）
    for (const s of staged) {
      if (impl.exists(s.rec.final)) throw Object.assign(new Error('reorder-collision: ' + s.rec.final), { code: 'reorder-collision' })
      impl.rename(s.rec.tmp, s.rec.final)
      s.rec.current = s.rec.final
    }
    return { ok: true, moved: done.length }
  } catch (err) {
    undo()
    throw err
  }
}

/**
 * 项目级入口：把期望顺序（当前版 abs 路径数组）落实为重命名事务。
 * 期望顺序的每个 abs 必须是项目 draft/ 下某个系列的成员；集合必须与现有系列一一对应。
 * 返回 { moved, renames: [{ from, to }] }（新旧 abs 对照，供客户端修正打开中的文档）。
 */
export function reorderDraftSeries(project, desiredAbs, io = null) {
  const files = listProjectFiles(project).filter((f) => String(f.rel).replace(/[\\/]+/g, '/').startsWith('draft/'))
  const groups = new Map()
  for (const f of files) {
    const key = seriesKeyOf(f.rel)
    if (!groups.has(key)) groups.set(key, { key, base: null, files: [] })
    const g = groups.get(key)
    g.files.push(f)
  }
  for (const g of groups.values()) {
    naturalSortFiles(g.files)
    g.base = stripVersion(g.files[0].name)
  }
  const current = naturalSortFiles([...groups.values()].map((g) => ({ ...g, rel: g.files[0].rel, name: g.base })))
  const desiredKeys = []
  const absIndex = new Map()
  for (const g of current) for (const f of g.files) absIndex.set(path.resolve(f.abs).toLowerCase(), g.key)
  for (const abs of Array.isArray(desiredAbs) ? desiredAbs : []) {
    const key = absIndex.get(path.resolve(String(abs)).toLowerCase())
    if (!key) throw Object.assign(new Error('order-unknown-series: ' + abs), { code: 'order-unknown-series' })
    if (desiredKeys.includes(key)) throw Object.assign(new Error('order-duplicate-series'), { code: 'order-duplicate-series' })
    desiredKeys.push(key)
  }
  const { moves, token } = planReorder(current, desiredKeys)
  if (!moves.length) return { moved: 0, renames: [] }
  const dirs = [...new Set(moves.flatMap((m) => m.files.map((f) => path.dirname(f.abs))))]
  applyReorder(moves, token, dirs, io)
  const renames = []
  for (const m of moves) {
    for (const f of m.files) {
      renames.push({ from: f.abs, to: path.join(path.dirname(f.abs), f.finalName) })
    }
  }
  return { moved: renames.length, renames }
}
