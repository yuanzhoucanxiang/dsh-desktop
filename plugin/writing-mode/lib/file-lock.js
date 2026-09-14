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
 */
export function withFileLock(file, fn, makeError = defaultError) {
  const lock = lockMetaPath(file)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const token = ownerToken()
  const deadline = Date.now() + 8000
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
    const owner = readLockOwner(lock)
    if (isOwnerAlive(owner)) {
      if (Date.now() > deadline) throw makeError('lock-timeout', 503)
      const waitUntil = Date.now() + 20
      while (Date.now() < waitUntil) {}
      continue
    }
    // Owner process gone or unreadable — do NOT steal (would open an acquire gap).
    // Surface a recoverable diagnostic; operator/admin can clear the lock file.
    if (Date.now() > deadline) throw makeError('lock-stale', 503)
    const waitUntil = Date.now() + 40
    while (Date.now() < waitUntil) {}
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
