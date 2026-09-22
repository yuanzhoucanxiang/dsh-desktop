/**
 * 跨进程文件锁（从 lib/project-memory.js 原样抽出，供记忆与协调记录共用）。
 *
 * W01 约束（照搬，不改语义）：**绝不移动/删除不是自己持有的锁**；持锁进程已消失时
 * 不是"抢占"而是报 lock-stale —— 抢占会在旧持有者恢复时出现双持有缺口。
 * 心跳/超时只用来发现需要恢复的操作，不授权抢活锁或重复创建（方案 P2 §3.2）。
 *
 * 锁文件内容 = `<pid>:<uuid>`；释放前必须复核 owner 仍是自己（防锁被外部替换后误删）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function lockMetaPath(file) {
  return file + '.lock'
}

export function ownerToken() {
  return `${process.pid}:${randomUUID()}`
}

export function readLockOwner(lock) {
  try {
    return fs.readFileSync(lock, 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * V4：让等待真正休眠而不是烧 CPU。
 *
 * 原来是 `while (Date.now() < waitUntil) {}` 空转。锁本身是同步 API（调用方全是同步
 * 函数，改异步会波及上百条既有断言），所以等待期间事件循环仍然被占住——这一点无法
 * 在不重写调用栈的前提下消除；但至少不再空转烧满一个核。配合下面两处改动，实际危害
 * 从「每次保存卡满 8 秒」降到「短暂等待或立即返回可重试错误」：
 *   1. 持有者已消失时不再耗到 deadline，走 staleFastFailMs 快速失败；
 *   2. 草稿路径把 deadlineMs 收到 1.5s（见 draft-checkpoints.writeCheckpoint）。
 */
const sleepCell = (() => {
  try {
    return new Int32Array(new SharedArrayBuffer(4))
  } catch {
    return null
  }
})()

export function sleepSync(ms) {
  const span = Math.max(0, Number(ms) || 0)
  if (sleepCell) {
    try {
      Atomics.wait(sleepCell, 0, 0, span)
      return
    } catch { /* 落到自旋兜底 */ }
  }
  const end = Date.now() + span
  while (Date.now() < end) { /* 兜底：无 SharedArrayBuffer 时只能自旋 */ }
}

/**
 * 把**持有者可证明已消失**的残留锁改名隔离（不删除，保留取证），返回隔离后的文件名。
 *
 * ## CXR01（2026-09-22 独立复核，P1）：本函数**禁止在线调用**
 *
 * 曾经的做法是“改名前再复核一次 owner”，并声称“窗口收敛到微秒级、即使重叠也有
 * revision/etag 兜底”。复核正确地推翻了两点：
 *
 * 1. **check-then-rename 本质上不是原子的**，把窗口缩短不等于互斥保证。精确时序：
 *    清扫 B 完成第二次 dead 检查后暂停 → 清扫 A 移走旧死锁 → 写入 W 取得新锁进入临界区
 *    → B 恢复并把 **W 的活锁**改名 → 写入 X 又获取同路径锁 → W 与 X 临界区重叠。
 *    确定性探针（handoff-probes.mjs）在 rename 边界注入调度已实测 `movedLiveOwner: true, overlap: true`。
 * 2. **revision/etag 兜不了这个底**。它们是临界区**内部**的读后比较，前提是互斥已经成立；
 *    互斥失效后两个写入方各自读到一致的前像，不会自动变成原子的 compare-and-swap。
 *
 * 而在没有共享的“清扫/获取互斥协议”之前，任何 check-then-act 都消不掉这个窗口
 * （多加一次 token 复核、或 rename 后再复核都不能）。所以正确做法是：**不在线移动他人的锁**。
 *
 * 现在的分寸：
 *   - 必须显式传 `{ offline: true }` 才会动作，且只用于“应用已关闭、确认没有任何写入者”的离线维护；
 *   - 在线路径（内核启动、维护接口）**一律不调用它**，改为只读诊断 + 把确切路径告知作者；
 *   - 获取路径上仍然绝不抢占：持有者已消失只报 `lock-stale`（可重试诊断）。
 *
 * 代价（如实记）：崩溃留下的残留锁现在会一直卡着那个桶，直到作者关掉应用手动删掉。
 * 这是故意的取舍：宁可一个桶暂时不可写，也不要两个写入方重叠造成静默覆写。
 * 长期解法是换成能提供**原子所有权**的锁机制（或给作品一个稳定 ID + 单写入者模型）。
 */
export function quarantineStaleLock(file, opts = {}) {
  // CXR01：默认拒绝。调用方必须明确声明“我已确认没有写入者”。
  if (opts.offline !== true) return null
  const before = inspectLock(file)
  // 只动**可证明已死**的锁；空文件（对方正在写入的空档）与活锁一律跳过
  if (!before.exists || !before.dead) return null
  const target = `${before.lock}.stale-${Date.now().toString(36)}-${process.pid}`
  try {
    const after = inspectLock(file)
    if (!after.exists || !after.dead || after.owner !== before.owner) return null
    fs.renameSync(before.lock, target)
    return path.basename(target)
  } catch {
    return null
  }
}

export function isOwnerAlive(owner) {
  if (!owner) return false
  const pid = Number(String(owner).split(':')[0])
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means process exists but we cannot signal it
    return err?.code === 'EPERM'
  }
}

/**
 * 持有者令牌是否**可证明已死**：必须能解析出 PID 且该 PID 确实不存在。
 *
 * 为何不能直接用 `!isOwnerAlive(owner)`：“读不出持有者”有三种完全不同的成因——
 *   ① 锁文件刚刚被释放（不存在）→ 该做的是**立即重试获取**，不是报陈旧；
 *   ② 对方已 openSync('wx') 但还没 writeSync 的空档（文件存在但为空）→ 它是**活锁**；
 *   ③ 真残留（令牌可解析、PID 已消失）→ 才是陈旧锁。
 * 把①②当③处理会误报。W23（跨进程锁：子进程持锁 2.5s）就是这样被打破的：
 * 子进程 unlink 后父进程读到空字串，400ms 快速失败阈值已过 → 抛 lock-stale；
 * 而它本来只需再跑一轮 tryAcquire() 就能拿到锁。旧代码因为陈旧分支要等满 8s，
 * 反而在下一轮自然成功了——我把 deadline 改短后把这个隐性缺陷暴露了出来。
 */
export function ownerIsProvablyDead(owner) {
  const s = String(owner ?? '').trim()
  if (!s) return false
  const pid = Number(s.split(':')[0])
  if (!Number.isInteger(pid) || pid <= 0) return false
  return !isOwnerAlive(s)
}

/** 锁的诊断视图。dead = 可证明已死（只有它才允许被隔离/快速失败）。 */
export function inspectLock(file) {
  const lock = lockMetaPath(file)
  if (!fs.existsSync(lock)) return { file, lock, exists: false, owner: '', alive: false, dead: false, self: false }
  const owner = readLockOwner(lock)
  return {
    file,
    lock,
    exists: true,
    owner,
    alive: isOwnerAlive(owner),
    dead: ownerIsProvablyDead(owner),
    self: owner.startsWith(`${process.pid}:`),
  }
}

/** 默认错误工厂（调用方可传入自己的错误类型，保持各自的错误码语义）。 */
function defaultError(code, status) {
  const err = new Error(code)
  err.code = code
  err.status = status
  return err
}

/**
 * 独占锁执行 fn。makeError 用于保持调用方错误码（记忆层传 memoryError）。
 * 超时在锁外等待（不长时间阻塞在文件锁内做网络/内核调用由调用方保证）。
 *
 * opts.deadlineMs      活锁竞争的最长等待（默认 8000；草稿写入用 1500）
 * opts.staleFastFailMs 持有者已消失时的最长等待（默认 400）——残留锁不该让每次保存卡满 8s
 * opts.unknownOwnerFastFailMs 持有者**读不出来**时的最长等待（默认 800）
 *
 * 三种等待预算对应三种不同状态（复核裁决 3）：
 *   活的持有者   → 等满 deadlineMs，报 lock-timeout（真竞争，该等）
 *   可证明已死 → staleFastFailMs 后报 lock-stale（带锁文件路径，等也没用）
 *   读不出来   → unknownOwnerFastFailMs 后报 lock-owner-unknown（**可重试**）
 * 为何不把“读不出来”归入活锁预算：它绝大多数只是对方 openSync 后、writeSync 前的
 * 微秒级空档，几轮重试就会变成可解析的活令牌；真变成垃圾字节的锁文件时，
 * 让每次写入白等 8s 毫无意义——不如快速返回一个语义明确的可重试错误。
 */
export function withFileLock(file, fn, makeError = defaultError, opts = {}) {
  const lock = lockMetaPath(file)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const token = ownerToken()
  const deadlineMs = Number.isFinite(Number(opts.deadlineMs)) ? Number(opts.deadlineMs) : 8000
  const staleMs = Number.isFinite(Number(opts.staleFastFailMs)) ? Number(opts.staleFastFailMs) : 400
  const unknownMs = Number.isFinite(Number(opts.unknownOwnerFastFailMs)) ? Number(opts.unknownOwnerFastFailMs) : 800
  const started = Date.now()
  const deadline = started + deadlineMs
  let fd = null

  const tryAcquire = () => {
    try {
      fd = fs.openSync(lock, 'wx')
      fs.writeSync(fd, token)
      fs.fsyncSync(fd)
      return true
    } catch (err) {
      if (err.code === 'EEXIST') return false
      throw makeError('lock-failed', 500)
    }
  }

  for (;;) {
    if (tryAcquire()) break
    // 锁文件已不存在 = 刚被释放（或刚被清扫隔离）：**立即重试获取**。
    // 这不是陈旧锁，报 lock-stale 会把一个本该成功的获取变成硬失败（W23 回归）。
    if (!fs.existsSync(lock)) continue
    const owner = readLockOwner(lock)
    if (ownerIsProvablyDead(owner)) {
      // Owner process provably gone — do NOT steal (would open an acquire gap).
      // CXR01：也不就地清扫——清扫同样是 check-then-act，会把别人刚取得的活锁移走。
      // 只快速返回一个**可重试、带路径的诊断**，由作者关掉应用后手动处理。
      if (Date.now() > started + staleMs) {
        const err = makeError('lock-stale', 503)
        err.lockPath = lock
        err.lockOwner = owner
        throw err
      }
      sleepSync(20)
      continue
    }
    if (isOwnerAlive(owner)) {
      // 真的活锁竞争：该等就等满预算。
      if (Date.now() > deadline) throw makeError('lock-timeout', 503)
      sleepSync(20)
      continue
    }
    // 读不出持有者（对方已 openSync 但未 writeSync 的空档 / 外来格式的垃圾锁）：
    // 既不把它当死亡（会把活锁误判为残留，W23），也不白等满 8s（复核裁决 3），
    // 而是有限重试后快速返回一个语义明确的**可重试**错误。
    if (Date.now() > started + unknownMs) {
      // 就在要放弃的这一刻再确认一次：锁已消失就该去抢，而不是报错。
      // 少了这一行就会重演 W23：existsSync 为真之后文件被释放，readLockOwner 拿到空串，
      // 于是一个本该成功的获取变成硬失败。
      if (!fs.existsSync(lock)) continue
      const err = makeError('lock-owner-unknown', 503)
      err.lockPath = lock
      err.lockOwner = owner
      throw err
    }
    sleepSync(20)
  }

  const my = token
  try {
    if (readLockOwner(lock) !== my) throw makeError('lock-lost', 503)
    return fn()
  } finally {
    try {
      if (readLockOwner(lock) === my) {
        try {
          fs.closeSync(fd)
        } catch {}
        try {
          fs.unlinkSync(lock)
        } catch {}
      } else {
        try {
          fs.closeSync(fd)
        } catch {}
      }
    } catch {}
  }
}
