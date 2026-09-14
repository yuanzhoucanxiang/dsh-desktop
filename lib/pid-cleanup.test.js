'use strict'

/**
 * N01 隔离测试：清理必须"按本轮 PID"，不能在同名进程上做批量操作。
 *
 * 做法：起两个**同名同命令行**的假进程（同一可执行文件、同一段参数），只登记其中一个 PID；
 * 断言被登记的那个被清掉、另一个仍然存活 —— 等价于"另一个同名应用（比如用户正式桌面）
 * 不属于清理集合"，但不拿用户真实进程做破坏性试验。
 *
 * 运行：node lib/pid-cleanup.test.js
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { killTree, pidAlive, selectCleanupTargets } = require('./pid-cleanup')

let pass = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 支持 async 用例：不 await 会把断言失败变成"打印 PASS 之后再抛未捕获异常"。 */
const ok = async (name, fn) => {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pid-test-'))
const script = path.join(dir, 'dummy-app.js')
fs.writeFileSync(script, 'setInterval(() => {}, 1000)\n')

const sameArgs = [script, '--role=dummy-app']
const a = spawn(process.execPath, sameArgs, { stdio: 'ignore', windowsHide: true })
const b = spawn(process.execPath, sameArgs, { stdio: 'ignore', windowsHide: true })

;(async () => {
  await sleep(800)
  console.log(`  诊断：a=${a.pid} alive=${pidAlive(a.pid)} · b=${b.pid} alive=${pidAlive(b.pid)}`)

  await ok('清理集合只包含显式登记的 PID（同名未登记的不会被收进去）', () => {
    const targets = selectCleanupTargets([{ pid: a.pid }])
    assert.deepEqual(targets, [a.pid])
    assert.ok(!targets.includes(b.pid), '另一个同名进程不得进入清理集合')
    // 防御：绝不允许按名批量（把镜像名当目标传进来必须被过滤掉）
    assert.deepEqual(selectCleanupTargets(['DeepSeek Harness Desktop.exe']), [])
    assert.deepEqual(selectCleanupTargets([process.pid]), [], '不得把测试自己列为清理目标')
  })

  await ok('按 PID 清理只影响该进程，同名的另一个仍存活', async () => {
    assert.equal(pidAlive(a.pid), true, 'a 应存活')
    assert.equal(pidAlive(b.pid), true, 'b 应存活')
    killTree(a.pid)
    await sleep(1200)
    const aAlive = pidAlive(a.pid)
    const bAlive = pidAlive(b.pid)
    console.log(`  诊断：清理 a 之后 a=${aAlive} b=${bAlive}`)
    assert.equal(aAlive, false, '被登记的进程应已结束')
    assert.equal(bAlive, true, '另一个同名进程必须仍然存活')
  })

  await ok('收尾：清掉剩余的测试进程（仍是按 PID）', async () => {
    killTree(b.pid)
    await sleep(900)
    assert.equal(pidAlive(b.pid), false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  console.log(`\npid-cleanup: ${pass} 项通过`)
})()
