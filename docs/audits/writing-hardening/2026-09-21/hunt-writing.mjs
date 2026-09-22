/**
 * 漏洞 hunt 探针（2026-09-21）· 只读审查用，全部在 %TEMP% 隔离目录内运行。
 * 不修改生产代码、不触碰真实作品、不启动 Electron、不结束任何进程。
 *
 * 断言语义：**REPRODUCED = 缺陷已复现**（与项目现有 hunt 探针一致，退出 0 表示探针跑完）。
 *
 * ⚠ 本文件是 **V1–V9 的原始复现取证**，不是回归门禁。
 * 修复后重跑应该全部变成 NOT_REPRODUCED（除了那些断言本身就是静态审查结论的项）。
 * 永久的正向门禁在：
 *   plugin/writing-mode/test/hardening-v1-v9.mjs   （V1–V9，断言修复后行为）
 *   lib/git-review.test.js                          （G1–G4）
 * 保留本文件的理由：项目约定不以新结果覆盖旧的负向证据。
 * 跑法：node docs/audits/writing-hardening/2026-09-21/hunt-writing.mjs [V1..V9]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../../..')
const REPO = pathToFileURL(path.join(ROOT, 'plugin/writing-mode')).href
const imp = (rel) => import(`${REPO}/${rel}`)
const hostSrc = (rel) => fs.readFileSync(path.join(ROOT, 'plugin/writing-mode', rel), 'utf8')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hunt-'))
process.env.DSH_HOME = path.join(temp, 'home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })

const results = []
function finding(id, title, reproduced, evidence) {
  results.push({ id, title, reproduced })
  console.log(`${reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED'} ${id} ${title}`)
  for (const line of evidence) console.log(`    ${line}`)
}

// ─────────────────────────────────────────────────────────────
// V1 · readBody 逐 chunk String(chunk)：多字节 UTF-8 跨 chunk 被截断
//     源：plugin/writing-mode/index.js:96-107（逐字复制，未改一行）
// ─────────────────────────────────────────────────────────────
function readBody_verbatim(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += String(chunk)
      if (data.length > 4e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('aborted', () => resolve(''))
    req.on('error', () => resolve(''))
  })
}
async function v1() {
  const { readBody } = await imp('index.js')
  // 旧实现（逐字复制自修复前的 index.js:96-107）——仅作机理对照，不是被测对象
  const legacy = readBody_verbatim
  const mkServer = (impl) => http.createServer(async (req, res) => {
    const raw = await impl(req)
    let parsed = null
    try { parsed = raw === null ? { __null: true } : JSON.parse(raw || '{}') } catch (e) { parsed = { __parseError: String(e.message) } }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ received: parsed?.content ?? null, nullBody: Boolean(parsed?.__null), parseError: parsed?.__parseError ?? null }))
  })
  const roundTrip = async (impl) => {
    const server = mkServer(impl)
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    const chapter = '夜色落在港口的桅杆上，风把咸味推进行人衣领里。'.repeat(4000)
    const body = JSON.stringify({ route: 'save', content: chapter })
    const out = await (await fetch(`http://127.0.0.1:${port}/api/writing-mode?route=save`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).json()
    server.close()
    const received = out.received
    return {
      chapter,
      bytes: Buffer.byteLength(body),
      received,
      replaced: received === null ? -1 : [...received].filter((c) => c === '\uFFFD').length,
      broken: received === null || received !== chapter,
      nullBody: out.nullBody,
      parseError: out.parseError,
    }
  }
  const prod = await roundTrip(readBody)      // 生产实现
  const old = await roundTrip(legacy)         // 旧实现（机理对照）

  finding(
    'V1',
    'readBody 逐 chunk 解码：大体积中文正文跨 chunk 处出现 U+FFFD（保存即损坏）',
    prod.broken,
    [
      `请求体字节数=${prod.bytes} 发送码点数=${[...prod.chapter].length}`,
      `【生产实现】收到码点数=${prod.received === null ? 'null' : [...prod.received].length} U+FFFD=${prod.replaced} 与原文全等=${prod.received === prod.chapter}`,
      `【旧实现对照】收到码点数=${old.received === null ? 'null' : [...old.received].length} U+FFFD=${old.replaced} 与原文全等=${old.received === old.chapter}（机理取证：逐 chunk String(chunk) 必然腰斩多字节字符）`,
      '影响路由：save / version / draft / world-draft / memory / prefs / coordination（全部 POST）',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V2 · readConfig 把「损坏」当「不存在」→ 下一次任意写配置清空库根/伙伴绑定/AI Key
// ─────────────────────────────────────────────────────────────
async function v2() {
  const { readConfig, writeConfig, normalizePrefs, configFile } = await imp('lib/store.js')
  const good = {
    roots: [{ path: path.join(temp, 'library'), label: '我的库', default: true }],
    activeRoot: path.join(temp, 'library'),
    prefs: { ...normalizePrefs({}), aiApiKey: 'sk-secret-key-123' },
    companions: { 'e:/剧本/雾港夜航': 'session-abc' },
  }
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(good, null, 2), 'utf8')

  // 模拟原子写中途被读到的瞬时状态 / 磁盘坏块 / 手工误编辑：截断成坏 JSON
  const before = fs.readFileSync(configFile(), 'utf8')
  fs.writeFileSync(configFile(), before.slice(0, Math.floor(before.length / 2)), 'utf8')

  const cfg = readConfig()
  const lostSilently = cfg.roots.length === 0 && cfg.companions === undefined

  // 复刻 index.js route=prefs 的四行（190-203）。修复后这一步会直接抛
  // config-damaged-refused（那就是修复本体），所以必须兜异常而不是让探针崩。
  const cfg2 = readConfig()
  let writeErr = null
  try {
    cfg2.prefs = normalizePrefs({ ...cfg2.prefs, fontSize: 20 })
    writeConfig(cfg2)
  } catch (e) { writeErr = e?.code || e?.message }
  // 修复后 writeConfig 拒绝回写，配置文件仍是那份损坏原件，所以读它也要兜异常
  let after = null
  let afterErr = null
  try { after = JSON.parse(fs.readFileSync(configFile(), 'utf8')) } catch (e) { afterErr = e.constructor.name }

  const siblings = fs.readdirSync(path.dirname(configFile()))

  finding(
    'V2',
    'readConfig 损坏降级为空默认值，下一次写配置把 roots/activeRoot/companions/aiApiKey 全部清零',
    !writeErr && lostSilently && Boolean(after) && after.roots.length === 0 && Object.keys(after.companions || {}).length === 0,
    [
      `损坏后 readConfig() → roots=${JSON.stringify(cfg.roots)} activeRoot=${cfg.activeRoot} companions=${JSON.stringify(cfg.companions)} __damaged=${cfg.__damaged} configError=${cfg.configError}`,
      `一次 route=prefs（只改字号）→ ${writeErr ? '抛错 ' + writeErr + '（拒绝回写，修复生效）' : '写入成功'}`,
      after ? `落盘后 → roots=${JSON.stringify(after.roots)} activeRoot=${JSON.stringify(after.activeRoot)} companions=${JSON.stringify(after.companions)}` : `文件仍不可解析（${afterErr}）—— 损坏原件未被覆写`,
      `配置目录内文件=${JSON.stringify(siblings)}`,
      '并发缺陷：route=prefs / companion / roots 均为 readConfig→改→writeConfig，无锁无 etag，两窗口并发必丢一次更新',
      '对比：draft-checkpoints 刚按 D03 修成「区分 not-found 与 corrupt 并保留原件」，配置层当时仍是老写法',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V3 · coordination：stale-token 写回落盘 phase=null → 之后永久 bad-record，无任何 API 恢复路径
// ─────────────────────────────────────────────────────────────
async function v3() {
  const c = await imp('lib/coordination.js')
  const projectKey = path.join(temp, 'poisoned-project')
  const token = 'op-token-A'

  // 场景：窗口 A 已 claim，作者显式 forget（放弃关联）；A 的在途 confirm 迟到抵达
  c.claimCoordination({ projectKey, operationToken: token, owner: 'winA' })
  c.forgetCoordination({ projectKey, operationToken: token })
  const late = c.confirmCoordination({ projectKey, operationToken: token, sessionId: 's-123' })

  const file = c.recordPath(projectKey)
  // 修复后迟到的 stale-token 不再落盘，记录文件根本不会存在 → 兜住 ENOENT
  let onDisk = null
  try { onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { onDisk = { __absent: e.code } }

  const probe = (label, fn) => {
    try { const r = fn(); return { label, threw: null, value: r } }
    catch (err) { return { label, threw: { code: err.code, status: err.status }, value: null } }
  }
  const show = (r) => r.threw ? `${r.label} → 抛错 code=${r.threw.code} status=${r.threw.status}` : `${r.label} → 返回 ${JSON.stringify(r.value)}`
  const pRead = probe('readCoordination(GET)', () => c.readCoordination(projectKey))
  const pClaim = probe('claimCoordination(新窗口新token)', () => c.claimCoordination({ projectKey, operationToken: 'op-token-B' }))
  const pForget = probe('forgetCoordination(force:true)', () => c.forgetCoordination({ projectKey, force: true }))
  const pRelease = probe('releaseCoordination', () => c.releaseCoordination({ projectKey, operationToken: token }))

  const stuck =
    pRead.threw?.code === 'bad-record' &&
    pClaim.threw?.code === 'bad-record' &&
    pRelease.threw?.code === 'bad-record' &&
    pForget.value?.ok === false &&
    fs.existsSync(file)
  finding(
    'V3',
    'stale-token 分支把 phase=null 落盘 → 协调记录永久 bad-record(500)，claim/GET/release 全挂且 forget 也清不掉',
    stuck,
    [
      `迟到 confirm 返回 outcome=${late._outcome}`,
      `落盘内容 phase=${JSON.stringify(onDisk?.phase)} version=${onDisk?.version} 文件不存在=${Boolean(onDisk?.__absent)}`,
      show(pRead), show(pClaim), show(pForget), show(pRelease),
      `记录文件仍存在=${fs.existsSync(file)}`,
      `唯一恢复路径：手工删除 ${file}`,
      '后果：该作品永远无法再绑定写作伙伴，UI 无法自愈（连读都 500）',
      '同族触发：任何 creating/confirm/uncertain 在「记录不存在」时被调用（重试、竞态、客户端先发 confirm）',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V5 · relocationCandidates 与目标作品无关 → 可把另一部作品的草稿导入当前作品
// ─────────────────────────────────────────────────────────────
async function v5() {
  const { writeCheckpoint, listCheckpoints } = await imp('lib/draft-checkpoints.js')
  const { relocationCandidates, recoverRelocation } = await imp('lib/project-recovery.js')

  const workA_old = path.join(temp, 'A-original')
  const workA_new = path.join(temp, 'A-moved')
  const workB_old = path.join(temp, 'B-original')
  const workB_new = path.join(temp, 'B-moved')
  for (const d of [workA_old, workB_old]) {
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'project.md'), 'x')
  }
  writeCheckpoint(workA_old, 'winA', { baseRev: 0, text: '【作品A的私密草稿】' })
  writeCheckpoint(workB_old, 'winB', { baseRev: 0, text: '【作品B的私密草稿】' })
  fs.renameSync(workA_old, workA_new)
  fs.renameSync(workB_old, workB_new)

  const candForB = relocationCandidates(workB_new)
  const leaked = candForB.find((x) => x.oldPath === workA_old)
  let imported = null
  let importErr = null
  if (leaked) {
    // 修复后跨作品导入会在 host 侧抛 recovery-source-unrelated，必须兜住
    try {
      const r = recoverRelocation(workB_new, leaked.oldPath, leaked.token)
      imported = { copied: r.copied, texts: listCheckpoints(workB_new).map((x) => x.text) }
    } catch (e) { importErr = e?.code || e?.message }
  }

  finding(
    'V5',
    'project-recovery 候选不按目标作品关联：打开 B 作品会列出 A 作品的旧路径，确认即把 A 的草稿写进 B',
    Boolean(leaked) && !importErr && Boolean(imported) && imported.texts.some((t) => t.includes('作品A')),
    [
      `relocationCandidates(B-moved) 返回 ${candForB.length} 条：${JSON.stringify(candForB.map((x) => ({ p: path.basename(x.oldPath), rel: x.relation, importable: x.importable })))}`,
      `其中属于另一部作品 A 的条目=${leaked ? leaked.oldPath : '无'}（relation=${leaked?.relation} importable=${leaked?.importable}）`,
      importErr ? `recoverRelocation(B-moved, A-original) → 抛错 ${importErr}（修复生效）` : `→ copied=${imported?.copied} B 桶现有草稿=${JSON.stringify(imported?.texts)}`,
      '这正是 2026-09-21 审查报告 D04 要求「防止目录复制把两个作品错误合并」要挡的情况',
      '原 draft-reliability.mjs 只测了「源目录仍存在/是副本」不能合并，未测「两个都已移动的不同作品」',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V6 · 项目身份规范化不一致
//   库层缺陷：尾部分隔符分裂草稿桶、listCheckpoints 按原始串全等比较
//   路由层缺陷：草稿桶用客户端原始串而不是 resolveUnderRoots 的规范路径
//     —— 后者正是 junction/映射盘库根下「恢复写了但 UI 读不到」的成因，
//        修复落在路由层（draftBucket 统一取 t.abs），因此用源码形状取证；
//        realpath 不进入分桶函数是故意的（否则既有桶名会整体失联）。
// ─────────────────────────────────────────────────────────────
async function v6() {
  const { writeCheckpoint, readCheckpoint, listCheckpoints } = await imp('lib/draft-checkpoints.js')
  const { bucketOf } = await imp('lib/coordination.js')
  const { identityKey } = await imp('lib/project-identity.js')

  const p = path.join(temp, 'v6-project')
  const trailing = p + path.sep
  writeCheckpoint(trailing, 'winT', { baseRev: 0, text: 'trailing-slash draft' })

  const splitBucket = readCheckpoint(p, 'winT') === null
  const listMiss = listCheckpoints(p).length === 0
  const identityDiffers = bucketOf(p) !== bucketOf(trailing) || identityKey(p) !== identityKey(trailing)

  const srcIdx = hostSrc('index.js')
  const routeUsesRaw = /readCheckpoint\(project \+/.test(srcIdx) || /listCheckpoints\(project \+/.test(srcIdx)
  const routeCanonicalizes = /const resolved = draftBucket\(/.test(srcIdx) && /return \{ ok: true, bucket: t\.abs \+ suffix \}/.test(srcIdx)

  finding(
    'V6',
    '项目身份规范化不一致：尾分隔符分裂草稿桶 / 列表按原始串全等 / 路由用客户端原始串分桶',
    splitBucket || listMiss || identityDiffers || routeUsesRaw,
    [
      `用尾部分隔符写入后，用原名读 → ${splitBucket ? '读不到（桶被分裂）' : '读得到'}`,
      `listCheckpoints(原名) → ${listMiss ? '空（原始串全等比较）' : '命中 ' + listCheckpoints(p).length + ' 条'}`,
      `coordination.bucketOf 与 draft 身份是否同口径 → 不同=${identityDiffers}`,
      `路由是否仍用客户端原始串分桶 → ${routeUsesRaw}`,
      `路由是否改走规范路径（draftBucket → t.abs）→ ${routeCanonicalizes}`,
      '原始取证（junction 库根）：客户端串 link-root\\雾港夜航 vs host 规范身份 real-root\\雾港夜航，'
        + '恢复写进规范身份的桶、UI 拿原始串读为空；该场景现在由路由层统一规范路径消除，'
        + '正向断言见 plugin/writing-mode/test/hardening-v1-v9.mjs 的 V6 组',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V4 · withFileLock 同步忙等：残留锁让内核事件循环卡满 8s 再 503，且无清理入口
// ─────────────────────────────────────────────────────────────
async function v4() {
  const { writeCheckpoint, readCheckpoint } = await imp('lib/draft-checkpoints.js')
  const proj = path.join(temp, 'lock-victim')
  writeCheckpoint(proj, 'winL', { baseRev: 0, text: 'v1' })

  // 伪造「持有者 PID 已消失」的残留锁（进程崩溃后的真实遗留物）
  const key = createHash('sha256').update(String(proj).replace(/\\/g, '/').toLowerCase() + '\n' + 'winL').digest('hex').slice(0, 32)
  const lockFile = path.join(process.env.DSH_HOME, 'writing-mode', 'drafts', key + '.json.lock')
  fs.writeFileSync(lockFile, '999999:deadbeef-0000-0000-0000-000000000000', 'utf8')

  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 1)
  const t0 = Date.now()
  let err = null
  try { writeCheckpoint(proj, 'winL', { baseRev: 1, text: 'v2' }) } catch (e) { err = e }
  const blockedMs = Date.now() - t0
  clearInterval(timer)

  const t1 = Date.now()
  try { writeCheckpoint(proj, 'winL', { baseRev: 1, text: 'v3' }) } catch {}
  const blocked2 = Date.now() - t1

  const stillReadable = readCheckpoint(proj, 'winL')?.text
  const lockStillThere = fs.existsSync(lockFile)
  const lockCount = fs.readdirSync(path.dirname(lockFile)).filter((n) => n.endsWith('.lock')).length

  finding(
    'V4',
    '残留 .lock 让每次草稿保存同步忙等 ~8s（冻结内核事件循环）后 503；无自动清理、无 UI 入口、锁文件对作者不可见',
    blockedMs > 5000 && err !== null && ticks === 0 && lockStillThere,
    [
      `首次保存：耗时 ${blockedMs}ms，抛错 code=${err?.code} status=${err?.status}`,
      `同期 setInterval(1ms) 触发次数=${ticks}（0 = 事件循环被同步忙等完全冻结，内核所有 HTTP/流式回复一起停）`,
      `第二次保存：耗时 ${blocked2}ms（每次都重演，不是一次性代价）`,
      `草稿仍读到旧值 text=${JSON.stringify(stillReadable)}（数据未损，但作者再也存不进去）`,
      `锁文件仍存在=${lockStillThere}；listCheckpoints 只筛 .json，目录下 .lock 数量=${lockCount} → UI 完全看不到`,
      'D 修复把 writeCheckpoint 接入 withFileLock，等于把暴露面从「记忆/协调」扩大到「每一次草稿自动保存」',
      '原始缺陷位置：file-lock.js 获取循环里是 while(Date.now()<waitUntil){} 空转、deadline=8000ms（现已改 Atomics.wait + 残留锁 250ms 快速失败 + 启动清扫）',
      '残留局限：等待仍是同步的（锁 API 同步，改异步会波及上百条既有断言），所以 setInterval 计数仍为 0；改善的是时长（~8s → ~0.27s）与可恢复性，不是彻底不阻塞',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V7 · GET draft 去掉 .slice(0,8) 上限 → 无界响应
// V8 · project-recovery / coordination 路由不校验 HTTP 方法
// ─────────────────────────────────────────────────────────────
async function v7v8() {
  const { writeCheckpoint, listCheckpoints, checkpointMeta, MAX_DRAFT_LIST } = await imp('lib/draft-checkpoints.js')
  const proj = path.join(temp, 'unbounded')
  const big = 'x'.repeat(400000) // 单桶 400KB，MAX_TEXT 允许到 500KB
  for (let i = 0; i < 12; i++) writeCheckpoint(proj, 'win' + i, { baseRev: 0, text: i === 0 ? big : '草稿' + i })
  const all = listCheckpoints(proj)

  // 缺陷本体在**路由层**：旧代码把 all 原样回传（一度还删了 .slice(0,8)）。
  // 库层 listCheckpoints 故意不设限——移动恢复靠它逐桶搬运，设限会静默漏桶。
  const srcIdx = hostSrc('index.js')
  const routeCapped = srcIdx.includes('.slice(0, MAX_DRAFT_LIST)')
  const routeMetaOnly = /checkpointMeta\(c, \{ world: route === 'world-draft' \}\)/.test(srcIdx)
  const metaLeaksText = 'text' in checkpointMeta({ windowId: 'w', rev: 1, text: 'x'.repeat(5000) })
  const routeReturnsAll = /checkpoints: all \}/.test(srcIdx)

  finding(
    'V7',
    'GET draft/world-draft 把每个窗口桶的全文一起回传（上限一度被删）→ 响应体随历史窗口数无界增长',
    routeReturnsAll || !routeCapped || !routeMetaOnly || metaLeaksText,
    [
      `12 个窗口桶、其中一桶 400KB；库层 listCheckpoints 回 ${all.length} 条（故意不设限，供移动恢复逐桶搬运）`,
      `路由是否仍原样回传全部 → ${routeReturnsAll}`,
      `路由是否限到 MAX_DRAFT_LIST(${MAX_DRAFT_LIST}) → ${routeCapped}`,
      `路由是否改回元数据投影 checkpointMeta → ${routeMetaOnly}`,
      `checkpointMeta 是否泄露正文 → ${metaLeaksText}`,
      '旧代码：- checkpoints: all.slice(0, 8)  /  + checkpoints: all；world-drafts.recoveries() 每次刷新拉全量并 JSON.parse 全部正文',
    ]
  )

  const src = hostSrc('index.js')
  const noMethodGuard = src.includes("if (route === 'project-recovery') {") && src.includes("if (route === 'coordination') {")
  const ctGuardPostOnly = src.includes("if (req.method === 'POST' && !/^application\\/json")
  finding(
    'V8',
    'project-recovery / coordination 路由不校验方法：PUT/DELETE/PATCH 绕过 415 JSON 门禁，project-recovery 在非 GET 方法下一律进写分支',
    noMethodGuard && ctGuardPostOnly,
    [
      `index.js:133 content-type 门禁条件为 req.method === 'POST'（仅 POST）→ 命中=${ctGuardPostOnly}`,
      `index.js:661 / 677 两处路由只按 route 匹配、不看 method → 命中=${noMethodGuard}`,
      "index.js:662 body = method==='POST' ? readJsonBody : {path:query}；665 之后 if(GET) 读、否则一律 recoverRelocation(写)",
      '实际危害受限：oldPath/token 只能来自 JSON body（非 POST 拿不到），故属纵深防御缺口而非可直达写原语；但 DELETE ?route=project-recovery 已进入写分支',
      'trustedRequest 把缺失的 sec-fetch-site 视为可信（非浏览器本地进程可直连），方法白名单是仅剩的一层',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// V9 · 备忘/世界观三个配额天花板（items 400 / changes 800 / operations 200）
//      均无清理或归档入口；撤回不释放配额；UI 对这些码无专门文案
// ─────────────────────────────────────────────────────────────
async function v9() {
  const { applyMemoryOp, readMemory } = await imp('lib/project-memory.js')
  const root = path.join(temp, 'quota-root')
  const proj = path.join(root, '长篇')
  fs.mkdirSync(proj, { recursive: true })
  fs.writeFileSync(path.join(proj, 'project.md'), '# 长篇')
  const opts = { libraryRoots: [root] }

  let r = readMemory(proj, opts)
  let rev = r.memory.revision
  let etag = r.etag
  const call = (payload) => {
    const res = applyMemoryOp(proj, { ...payload, baseRevision: rev, baseEtag: etag, clientSchemaVersion: 2, actor: 'author' }, opts)
    rev = res.memory.revision
    etag = res.etag
    return res
  }
  const attempt = (payload) => { try { call(payload); return null } catch (e) { return e } }

  // 1) 200 次真实的世界观候选保存（每次一条新 operation 收据 + 一个新 item）
  let settingOps = 0
  for (let i = 0; i < 200; i++) {
    call({ op: 'save-setting-candidate', operationId: 'op-' + i, item: { kind: 'fact', setting: { title: '设定' + i, conclusion: '结论' + i } } })
    settingOps++
  }
  const ops201 = attempt({ op: 'save-setting-candidate', operationId: 'op-201', item: { kind: 'fact', setting: { title: '第201条', conclusion: '结论' } } })
  const confirmBlocked = attempt({ op: 'confirm-setting', operationId: 'cf-1', id: readMemory(proj, opts).memory.items[0].id, item: { status: 'confirmed' } })

  // 2) 普通备忘 add（不走幂等收据）在 operations 满后是否仍可用
  const addAfterOpsFull = attempt({ op: 'add', item: { kind: 'fact', text: '普通备忘' } })

  // 3) items 天花板：填到 400 后新增被拒，且撤回一条也不释放配额
  let items = readMemory(proj, opts).memory.items.length
  while (items < 400) {
    const e = attempt({ op: 'add', item: { kind: 'fact', text: '填充备忘 ' + items } })
    if (e) break
    items = readMemory(proj, opts).memory.items.length
  }
  const add401 = attempt({ op: 'add', item: { kind: 'fact', text: '第401条' } })
  const someId = readMemory(proj, opts).memory.items[0].id
  const retractRes = attempt({ op: 'retract', id: someId })
  const addAfterRetract = attempt({ op: 'add', item: { kind: 'fact', text: '撤回后重试' } })
  const finalItems = readMemory(proj, opts).memory.items.length
  const statusOfRetracted = readMemory(proj, opts).memory.items.find((x) => x.id === someId)?.status

  // 4) 源码层面：是否存在任何清理/归档 operations 或 changes 的 op
  const src = hostSrc('lib/project-memory.js')
  const handledOps = [...src.matchAll(/op === '([a-z-]+)'/g)].map((m) => m[1])
  const uniqueOps = [...new Set(handledOps)]
  const trimsOperations = /operations\s*=\s*memory\.operations\.slice|operations\.splice/.test(src)
  const trimsItems = /items\.splice|memory\.items\s*=\s*memory\.items\.filter/.test(src)
  const clientSrc = hostSrc('src/client/features/memory/index.js')
  const clientHandlesQuota = /operations-full|memory-full|history-full/.test(clientSrc)

  finding(
    'V9',
    '世界观操作满 200 次后永久 409（operations-full），备忘满 400 条后永久 400（memory-full）；无清理入口、撤回不释放配额、UI 无专门文案',
    ops201?.code === 'operations-full' && add401?.code === 'memory-full' && addAfterRetract?.code === 'memory-full' && !trimsOperations && !trimsItems && !clientHandlesQuota,
    [
      `真实执行 ${settingOps} 次 save-setting-candidate 均成功；第 201 次 → code=${ops201?.code} status=${ops201?.status}`,
      `同时 confirm-setting 也被阻 → code=${confirmBlocked?.code}（作者无法再确认任何已有候选）`,
      `普通备忘 add（不走幂等收据）仍可用 → ${addAfterOpsFull ? 'code=' + addAfterOpsFull.code : '成功'}（锁死的只是世界观路径）`,
      `items 填到 ${finalItems} 条后 add → code=${add401?.code} status=${add401?.status}`,
      `撤回一条（status=${statusOfRetracted}，${retractRes ? '失败 ' + retractRes.code : '成功'}）后再 add → 仍 code=${addAfterRetract?.code}（items 从不 splice，撤回/已解决条目永久占配额）`,
      `applyMemoryOp 支持的 op = ${JSON.stringify(uniqueOps)} → 无 prune/trim/archive/compact 任何一项`,
      `源码检查：operations 裁剪=${trimsOperations} items 裁剪=${trimsItems}（changes 仅在 schema1 分支裁剪，schema2 直接抛 history-full）`,
      `客户端 features/memory/index.js 对 operations-full/memory-full/history-full 有专门文案=${clientHandlesQuota} → 作者只看到「备忘暂不可用：operations-full」+ 一个永远失败的重试按钮`,
      '可达性：一部长篇的世界观整理（每次整理 N 条候选 + 逐条确认/修订）很容易走到 200；且配额是按**单个作品**计，重建作品才能绕过',
    ]
  )
}

const only = process.argv[2] ? process.argv[2].toUpperCase() : ''
const PROBES = { V1: v1, V2: v2, V3: v3, V4: v4, V5: v5, V6: v6, V7: v7v8, V9: v9 }
for (const [id, fn] of Object.entries(PROBES)) {
  if (only && id !== only && !(only === 'V7' || only === 'V8')) continue
  if (only && (only === 'V7' || only === 'V8') && id !== 'V7') continue
  try { await fn() } catch (err) { console.log(`PROBE_ERROR in ${id}: ${err.stack}`) }
}

console.log('\n=== 汇总 ===')
console.log(`隔离目录：${temp}`)
console.log(`复现 ${results.filter((r) => r.reproduced).length} / ${results.length}`)
for (const r of results) console.log(`  ${r.reproduced ? '[REPRODUCED]' : '[  clean   ]'} ${r.id} ${r.title}`)
console.log('HUNT_PROBES_DONE')
