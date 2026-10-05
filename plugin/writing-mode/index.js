/**
 * Host half of @dsh-local/writing-mode — cordis 插件入口 + /api/writing-mode 分发。
 *
 * 分层（见 CONTRACT.md；2026-10-05 后端整治阶段一落位）：
 *   lib/http.js          HTTP 公共层：环回/可信判定、路由×方法白名单、body 收集、JSON 响应
 *   lib/routes/*         按域拆分的路由处理函数（config/docs/project/memory/sessions + 分发表）
 *   lib/store.js         库根 / 扫描 / 读写 / 路径安全
 *   lib/domain.js        门禁 / 台账 / 大纲 / AI 路由与补全
 *   lib/archive-model.js 档案页数据组装（archive-export 与 wiki 两个出口共用）
 *   其余 lib/*           记忆 / 草稿 / 协调 / 恢复 / 模板 / 统计 / 重排等领域模块
 *   本文件                插件生命周期（preset 自举注册、残留锁诊断）+ 中间件 + 分发
 */
import { readConfig } from './lib/store.js'
import { COMPANION_PRESET } from './lib/companion-preset.js'
import { listStaleDraftLocks } from './lib/draft-checkpoints.js'
import { listStaleCoordinationLocks } from './lib/coordination.js'
import { MAX_BODY_BYTES, ROUTE_METHODS, trustedRequest, writeJson } from './lib/http.js'
import { ROUTE_HANDLERS } from './lib/routes/index.js'

// 兼容面：回归测试从 index.js 取这些符号（hardening V1/V8）。新代码请直接用 lib/http.js。
export { ROUTE_METHODS, readBody, readJsonBody, MAX_BODY_BYTES } from './lib/http.js'

export const name = 'writing-mode'
/** webServer=文档库 API；llm=文字工具；agentDefaultModel=全局工具模型选择。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

const API = '/api/writing-mode'

export function apply(ctx) {
  const c = ctx
  if (!c || !c.webServer || typeof c.webServer.register !== 'function') {
    console.warn('[writing-mode] webServer unavailable, host API disabled')
    return
  }
  // CXR01（2026-09-22 独立复核，P1）：启动时**只诊断、不清扫**。
  // 原先这里会把持有者进程已消失的残留锁改名隔离。复核证明这是不安全的：
  // check-then-rename 无法原子化，复核之后、改名之前若有写入者取得了该锁，
  // 就会把**那把活锁**移走，于是两个写入方临界区重叠、静默覆写。
  // 而内核启动完全可能与另一个进程（另一个桌面实例/另一个内核）的写入并发，所以这里同样不安全。
  // 改为只把确切路径打进日志并暴露给 maintenance 接口，由作者关闭应用后手动删除。
  // 代价：崩溃留下的残留锁会卡着那个桶（每次保存快速报 lock-stale）直到手动处理——
  // 宁可一个桶暂时不可写，也不要两个写入方重叠。
  try {
    const stale = [...listStaleDraftLocks(), ...listStaleCoordinationLocks()]
    if (stale.length) {
      console.warn(`[writing-mode] 发现 ${stale.length} 个残留锁（持有进程已退出）；出于互斥安全不会自动移动，请关闭桌面版后手动删除：${stale.map((r) => r.path).join(', ')}`)
    }
  } catch (err) {
    console.warn(`[writing-mode] 残留锁诊断失败（不阻止启动）：${err?.message || err}`)
  }
  // 0.1.7 起内核不再扫 ~/.dsh/.agent-presets：写作伙伴 preset 改为向 registry 自举注册。
  // 判据 = registry 同时暴露 register/composeFrom；旧内核没有该服务 → 跳过（走旧 select 路）。
  // Duplicate 视为已成功（幂等）；其它失败重置 promise，prepare 路由里可重试。
  let presetRegistration = null
  const ensurePresetRegistered = () => {
    if (presetRegistration) return presetRegistration
    const registry = typeof c.get === 'function' ? c.get('agentPresets') : null
    if (!registry || typeof registry.register !== 'function' || typeof registry.composeFrom !== 'function') {
      presetRegistration = Promise.resolve(null)
      return presetRegistration
    }
    presetRegistration = Promise.resolve()
      .then(() => registry.register(JSON.parse(JSON.stringify(COMPANION_PRESET))))
      .then((unregister) => ({ unregister }))
      .catch((err) => {
        if (/Duplicate agent preset/.test(String(err?.message || err))) return { unregister: null }
        presetRegistration = null
        throw err
      })
    return presetRegistration
  }
  // 抢先注册（fire-and-forget），插件卸载时回收；失败只告警，prepare 路由会再试。
  ctx.effect(() => {
    let unregister = null
    let settled = false
    ensurePresetRegistered()
      .then((reg) => { if (settled) reg?.unregister?.(); else unregister = reg?.unregister || null })
      .catch((err) => console.warn(`[writing-mode] 写作伙伴 preset 注册失败（建伙伴会话时会重试）：${err?.message || err}`))
    return () => { settled = true; unregister?.() }
  })
  ctx.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: API,
      handler: async (req, res) => {
        if (!trustedRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''
        // V8：方法白名单先于一切业务分支
        const allowed = Object.prototype.hasOwnProperty.call(ROUTE_METHODS, route) ? ROUTE_METHODS[route] : null
        if (!allowed) {
          writeJson(res, 404, { ok: false, error: 'unknown-route' })
          return
        }
        if (!allowed.includes(req.method)) {
          writeJson(res, 405, { ok: false, error: 'method-not-allowed', allowed })
          return
        }
        if (req.method !== 'GET' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          writeJson(res, 415, { ok: false, error: 'json-required' })
          return
        }
        // V1：声明长度超限直接 413（流式兵底在 readBody 里，走到那里只能给 400）
        const declared = Number(req.headers['content-length'])
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          writeJson(res, 413, { ok: false, error: 'body-too-large', maxBytes: MAX_BODY_BYTES })
          return
        }
        const cfg = readConfig()
        // V2：配置损坏时不再假装成「首次使用」：写接口一律拒，读接口如实报出来
        if (cfg.__damaged && req.method !== 'GET') {
          writeJson(res, 409, {
            ok: false,
            error: cfg.configError || 'corrupt-config',
            backup: cfg.configBackup || null,
            hint: '配置文件已损坏，原件已保留且未被覆盖；恢复 writing-mode.json 后才能再改设置。',
          })
          return
        }

        const handler = ROUTE_HANDLERS[route]
        if (!handler) {
          // 白名单与分发表由 scripts 的同步断言钉住；到这里还没命中说明表漏了路由
          writeJson(res, 404, { ok: false, error: 'unknown-route' })
          return
        }
        await handler({ req, res, url, route, cfg, hostCtx: c, ensurePresetRegistered })
      },
    })
  )
}
