#!/usr/bin/env node
/**
 * **使用流程探针**（2026-10-17，项目所有者："一些按钮好像没反应，你自己要进行使用流程测试"）。
 *
 * 做法：起一个**独立 HOME** 的实例（不打扰正在用的预览）→ 自动进工具台 → 拼上写作模式 →
 * 对每块窗口**逐个**点候选按钮，每次点前清零、点后等 800ms 读 `MutationObserver` 增量：
 *   · 有变化 → REACTED；无变化且无异常 → **DEAD**（死按钮）；抛异常 → **ERROR**。
 *
 * 为什么单个点：一口气点完再读计数会导致"变化归因不到具体按钮"（第一版就错在这）。
 *
 * 用法：node scripts/flow-probe.cjs [--keep]   退出码 0 = 无死按钮；1 = 有 DEAD/ERROR。
 */
'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DEBUG_PORT = 9461
const KEEP = process.argv.includes('--keep')
/**
 * ★ 实例的私有数据目录：**复制一份** `~/.dsh-desktop` 到临时目录，而不是共用它。
 *
 * 两个坑（2026-10-17/18 各踩一次）：
 * 1. **共用** `~/.dsh-desktop`：两个实例同时跑 ⇒ 后起的把 token 换掉 ⇒ 先起的页面
 *    `内核对 / 返回 401`（用户实报过，探针也复现）；
 * 2. **完全隔离**（空 HOME）：写作模式/工具台这些**插件**装在 `~/.dsh-desktop` 里 ⇒
 *    空 HOME 里接缝 0 个模式、插件加载标记都是 false。
 * 所以：**复制**（只挑加载插件需要的几项，跳过 sessions/storages/attachments 这类大目录）。
 */
const COPY_ENTRIES = [
  'profiles',
  'plugins',
  'workbench.json',
  'writing-mode.json',
  'settings.yaml.imported',
  '.credentials.yaml',
  '.anonymous-user-id',
  '.migrated-from-dsh.json',
  '.agent-presets',
  'remote-web-ui-registry',
  'writing-mode',
  '.writing-mode',
  'super-injector',
  'llm-deepseek',
  'writing-harness',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const base = path.join(os.tmpdir(), 'dsh-flow-probe')
const HOME = path.join(base, `home-${stamp}`)
const USER_DATA = path.join(base, `userdata-${stamp}`)
fs.mkdirSync(HOME, { recursive: true })
fs.mkdirSync(USER_DATA, { recursive: true })
{
  const shared = path.join(os.homedir(), '.dsh-desktop')
  let copied = 0
  if (fs.existsSync(shared)) {
    for (const entry of COPY_ENTRIES) {
      const src = path.join(shared, entry)
      if (!fs.existsSync(src)) continue
      try {
        fs.cpSync(src, path.join(HOME, entry), { recursive: true, force: true })
        copied += 1
      } catch (err) {
        console.log(`（复制 ${entry} 失败：${err.message}）`)
      }
    }
  }
  console.log(`（已把 ${copied} 项插件配置复制进临时 HOME：${HOME}）`)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
Object.assign(env, {
  DSH_DESKTOP_HOME: HOME,
  DSH_DESKTOP_USER_DATA: USER_DATA,
  DSH_DESKTOP_DISPLAY: process.env.DSH_DESKTOP_DISPLAY || 'secondary',
})

const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: ROOT, env, stdio: 'ignore', detached: true })
child.unref()
console.log(`实例已拉起（独立 HOME=${HOME}）`)

function connect(url) {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(String(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || '').slice(0, 120))
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push(String(m.params.args?.map((a) => a.value || a.description || '').join(' ')).slice(0, 120))
    }
  })
  const ready = new Promise((res) => ws.addEventListener('open', res))
  return {
    ready,
    errors,
    /**
     * **每条 CDP 调用都带超时**（2026-10-18 踩到）：拼接模块窗口时主页面可能忙 ⇒ `evaluate` 迟迟不回
     * ⇒ 挂起的 Promise **不会**保持事件循环 ⇒ node 直接以 0 退出、探针静默结束（看起来"跑完了"）。
     * 超时后返回空结果，让流程继续往下走。
     */
    send(method, params = {}, timeoutMs = 15000) {
      const mid = ++id
      ws.send(JSON.stringify({ id: mid, method, params }))
      return new Promise((res) => {
        const timer = setTimeout(() => {
          if (pending.has(mid)) {
            pending.delete(mid)
            res({ __timeout: true })
          }
        }, timeoutMs)
        pending.set(mid, (m) => {
          clearTimeout(timer)
          res(m)
        })
      })
    },
    close: () => ws.close(),
  }
}

const pages = async () =>
  (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).filter(
    (t) => t.type === 'page' && t.url.startsWith('dsh-app://'),
  )

const INSTALL = `(() => {
  if (window.__flow) return 'already';
  window.__flow = { mut: 0 };
  const obs = new MutationObserver((list) => { window.__flow.mut += list.length });
  obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  window.__flowObs = obs;
  return 'ok';
})()`

const CLICK_ONE = (target) => `(() => {
  window.__flow.mut = 0;
  let el = null;
  if (${JSON.stringify(target)}.sel) {
    try { el = document.querySelector(${JSON.stringify(target)}.sel) } catch (e) { return 'MISSING' }
  } else if (${JSON.stringify(target)}.text) {
    const kw = new RegExp(${JSON.stringify(target)}.text);
    el = Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => kw.test((b.textContent || '').trim())) || null;
  }
  if (!el) return 'MISSING';
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 'HIDDEN';
  const vis = getComputedStyle(el);
  if (vis.visibility === 'hidden' || vis.display === 'none') return 'HIDDEN';
  el.scrollIntoView({ block: 'center' });
  el.click();
  return 'CLICKED';
})()`

/** 逐个点，单独归因。**也把"新开了一个窗口"算作有反应**（例如工具台顶栏的设置会开独立窗口，
 *  同一窗口当然没有 DOM 变化 —— 2026-10-17 第一版把它误判成死按钮）。 */
async function runClicks(v, label, targets) {
  const ev = async (x) => (await v.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
  await v.send('Runtime.enable')
  await ev(INSTALL)
  const rows = []
  console.log(`\n== ${label} ==`)
  for (const t of targets) {
    const errBefore = v.errors.length
    const pagesBefore = (await pages().catch(() => [])).length
    const state = await ev(CLICK_ONE(t))
    if (state !== 'CLICKED') {
      rows.push({ name: t.name, state })
      console.log(`  · ${state.padEnd(8)} ${t.name}`)
      continue
    }
    await sleep(1200)
    const mut = Number(await ev(`window.__flow ? window.__flow.mut : 0`)) || 0
    const pagesAfter = (await pages().catch(() => [])).length
    const newWindow = pagesAfter > pagesBefore
    const newErr = v.errors.slice(errBefore).filter(Boolean)
    const final = mut > 0 || newWindow ? 'REACTED' : newErr.length ? 'ERROR' : 'DEAD'
    rows.push({ name: t.name, state: final, mut, newWindow, errors: newErr })
    const tag = final === 'REACTED' ? '✓' : final === 'DEAD' ? '✗ DEAD' : '✗ ERROR'
    const detail = `${mut ? `变化 ${mut}` : ''}${newWindow ? ' 新窗口' : ''}`.trim()
    console.log(`  ${tag.padEnd(8)} ${t.name}${detail ? `（${detail}）` : ''}${newErr.length ? ` 报错：${newErr[0]}` : ''}`)
  }
  return rows
}

;(async () => {
  let mainPage = null
  for (let i = 0; i < 90 && !mainPage; i += 1) {
    await sleep(1000)
    try {
      // **认准主窗**（URL 恰好 `dsh-app://app/`）：共享 HOME 可能恢复出别的窗口，
      // 取 `pages()[0]` 可能落到模块/普通窗口上 ⇒ 接缝 0 个模式的假象（2026-10-17 踩到）。
      const list = await pages()
      mainPage = list.find((t) => t.url === 'dsh-app://app/') || list[0]
    } catch {
      /* 还没起来 */
    }
  }
  if (!mainPage) {
    console.error('页面没起来')
    process.exit(1)
  }

  const main = connect(mainPage.webSocketDebuggerUrl)
  await main.ready
  await main.send('Runtime.enable')
  const evMain = async (x) => (await main.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value

  for (let i = 0; i < 40; i += 1) {
    const ok = await evMain(`(() => { const el = document.querySelector('[data-wb-entry]'); if (!el) return false; el.click(); return true })()`)
    if (ok) break
    await sleep(1000)
  }
  await sleep(4000)
  // **进工具台后先确认接缝里有模式**（没有就说明这个实例没加载写作模式/工具台插件，
  // 后面所有"点接缝开模块窗口"的测试都会假失败 —— 2026-10-17 为此白跑三轮）。
  const envHome = env.DSH_DESKTOP_HOME || '(共享 ~/.dsh-desktop)'
  console.log(`\n（实例 HOME = ${envHome}；页面 = ${mainPage.url}）`)
  console.log(`（进工具台后：接缝=${await evMain(`!!document.querySelector('[data-wb-seam]')`)} 模式项=${await evMain(`document.querySelectorAll('[data-wb-seam-mode]').length`)} 形态=${await evMain(`(async () => (await window.dshShell.getWorkbenchShape()).shape)()`)}）`)

  const rows = []
  // ① 长条顶栏（选择器取自源码：`data-wb-btn`，见 plugin/workbench/src/client/Chrome.js）
  //    只点安全的；✕/退出 会改窗口生命周期，不在这里点。
  //    **`← 回宽窗主屏` 必须放到最后**：点完长条就没了，后面的接缝/模块窗口全测不到
  //    （2026-10-17 第一版就栽在这：先点 ← 再点接缝，结果"没找到写作台模块窗口"）。
  //    **设置 ⛭ 不进自动流程**：它开的是**独立设置窗口**（同窗口无 DOM 变化，探针难判），
  //    而且那个窗口会把后续点击挡住 ⇒ 列为人工项（见日志）。
  //    **小条要还原**：点 ─ 进 mini，再点一次回 strip（按钮语义是切换）。
  rows.push(...await runClicks(main, '长条顶栏（工具台）', [
    // 这个按钮是**切换**（`title` 随形态变、handler 是 toggleMini）：点一次进 mini，
    // **再点一次**才回 strip。只点一次会把形态留在 mini ⇒ 后面拼接连接缝都找不到
    // （2026-10-18 为此白跑一轮）。
    { name: '最小化小条 ─（进 mini）', sel: '[data-wb-btn="mini"]' },
    { name: '▢ 再点回 strip', sel: '[data-wb-btn="mini"]' },
  ]))
  // 还原成 strip（mini 下接缝仍可用，但后续模块窗口布局按 strip 验更稳）
  for (let i = 0; i < 2; i += 1) {
    const shape = await evMain(`(async () => (await window.dshShell.getWorkbenchShape()).shape)()`)
    if (shape === 'strip') break
    await evMain(`(async () => { await window.dshShell.setWorkbenchShape('strip'); return 0 })()`)
    await sleep(1200)
  }
  console.log(`（形态已还原：${await evMain(`(async () => (await window.dshShell.getWorkbenchShape()).shape)()`)}）`)

  // **形态往返后接缝模式会短暂变 0**（2026-10-17 实测）：先确认是"重注册慢"还是"真的丢了"。
  // 差别很大：前者是体验问题（等两秒就好），后者是 bug（用户切回来就再也拼不上）。
  {
    const samples = []
    for (let i = 0; i < 8; i += 1) {
      samples.push(Number(await evMain(`document.querySelectorAll('[data-wb-seam-mode]').length`)) || 0)
      await sleep(1000)
    }
    const recovered = samples.some((n) => n > 0)
    console.log(`（形态往返后接缝项采样/每秒 = ${JSON.stringify(samples)} ⇒ ${recovered ? '会自己恢复（重注册慢）' : '一直是 0（真 bug）'}）`)
    if (!recovered) {
      console.log('  诊断：接缝元素 =', await evMain(`!!document.querySelector('[data-wb-seam]')`))
      console.log('  诊断：插件已加载标记 =', await evMain(`JSON.stringify({ wb: !!window.__dshWorkbenchLoaded, wm: !!window.__dshWritingModeLoaded })`))
      console.log('  诊断：扇形容器 =', await evMain(`!!document.querySelector('[data-wb-seam-fan]')`))
    }
  }

  // ② 拼上写作模式 → 两块模块窗口
  //    诊断先行：接缝项在不在/点了之后壳的记账是什么（否则"没找到模块窗口"分不清是
  //    "点击没到"还是"壳没开成"——2026-10-17 就卡在这两轮）。
  const seamCount = await evMain(`document.querySelectorAll('[data-wb-seam-mode]').length`)
  const seamIds = await evMain(`JSON.stringify(Array.from(document.querySelectorAll('[data-wb-seam-mode]')).map((b) => b.getAttribute('data-wb-seam-mode')))`)
  const clickSeam = await evMain(`(() => { const b = document.querySelector('[data-wb-seam-mode="writing"]'); if (!b) return 'no-seam-item'; b.click(); return 'clicked' })()`)
  console.log(`\n（拼接：接缝项 ${seamCount} 个 ${seamIds}；点击=${clickSeam}）`)
  await sleep(8000)
  const shellState = await evMain(
    `(async () => { try { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ shape: s.shape, modules: s.modules }) } catch (e) { return 'ERR ' + e.message } })()`,
  )
  console.log(`（拼接后壳记账 = ${shellState}）`)

  const all = await pages()
  const assistantPage = all.find((t) => t.url.includes('kind=assistant'))
  const deskPage = all.find((t) => t.url.includes('dsh-wb-module') && !t.url.includes('kind=assistant'))

  if (deskPage) {
    const desk = connect(deskPage.webSocketDebuggerUrl)
    await desk.ready
    await desk.send('Runtime.enable')
    const evDesk = async (x) => (await desk.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
    // **先开一篇稿**：没有稿子时助手窗口按设计没有输入框（伙伴面板空态），
    // 直接测"发送"会误判成死按钮。桌面空态上有「一键加入 E:\剧本」，点完再点库里的第一篇。
    const joined = await evDesk(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /一键加入/.test(b.textContent || ''));
      if (!btn) return 'no-join-button';
      btn.click();
      return 'clicked-join';
    })()`)
    console.log(`\n（写作台：开稿准备 = ${joined}）`)
    await sleep(3000)
    const opened = await evDesk(`(() => {
      const item = Array.from(document.querySelectorAll('button, [role="button"], li, [class*="Item"]'))
        .find((el) => /\\.(md|txt)$/i.test((el.textContent || '').trim()) || /第[一二三四五六七八九十0-9]章/.test(el.textContent || ''));
      if (!item) return 'no-file-item';
      item.click();
      return 'clicked-file';
    })()`)
    console.log(`（写作台：打开第一篇 = ${opened}）`)
    await sleep(4000)

    rows.push(...await runClicks(desk, '写作台（模块 main）顶栏', [
      { name: '去生图（data-wm-handoff=gir）', sel: '[data-wm-handoff="gir"]' },
      { name: '作品档案（data-wm-archive）', sel: '[data-wm-archive]' },
      { name: '专注（按钮文本）', text: '专注' },
      { name: '辅助 ▾（按钮文本）', text: '辅助' },
      { name: '保存（按钮文本）', text: '保存' },
      { name: '海明威（data-wm-hemingway）', sel: '[data-wm-hemingway]' },
      { name: '打字机（data-wm-typewriter）', sel: '[data-wm-typewriter]' },
    ]))
    desk.close()
  } else {
    console.log('\n（没找到写作台模块窗口）')
  }

  if (assistantPage) {
    const assistant = connect(assistantPage.webSocketDebuggerUrl)
    await assistant.ready
    await assistant.send('Runtime.enable')
    const evA = async (x) => (await assistant.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
    // **等助手窗口把面板渲染出来**（模块窗口是独立页面，加载比主窗慢；轮询最多 15s）。
    // 2026-10-18 实测：不等就会判成"没输入框、没提示"，其实只是还没渲染。
    for (let i = 0; i < 15; i += 1) {
      const readyNow = await evA(`(() => !!document.querySelector('.dshWmCompanion') || !!document.querySelector('[data-wm-assistant-hint]'))()`)
      if (readyNow) break
      await sleep(1000)
    }
    const hasInput = await evA(`!!document.querySelector('.dshWmCompanion textarea, .dshWmCompanion input[type="text"]')`)
    const before = Number(await evA(`document.querySelectorAll('.dshWmMessage, [class*="Message"]').length`)) || 0
    // **G8 验证（2026-10-18）**：写作台没打开稿时，助手窗口必须**如实提示**"先去打开一篇"，
    // 而不是让用户点「发送」后发现没反应（修前探针实测消息数 397→397）。
    const hasHint = await evA(`!!document.querySelector('[data-wm-assistant-hint]')`)
    console.log(`\n== 助手窗口（模块 assistant）==\n  输入框：${hasInput ? '✓' : '✗'}；消息数 ${before}`)
    console.log(`  无稿提示（G8）：${hasHint ? '✓ 有（如实说明原因）' : '✗ 没有（用户会以为点了没反应）'}`)
    rows.push({ name: '助手窗口无稿提示（G8）', state: hasHint ? 'REACTED' : 'DEAD' })
    if (hasInput) {
      await evA(`(() => {
        const ta = document.querySelector('.dshWmCompanion textarea, .dshWmCompanion input[type="text"]');
        if (!ta) return 0;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(ta, '流程探针：你好'); else ta.value = '流程探针：你好';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 1;
      })()`)
      await sleep(400)
      // **G11（2026-10-18）**：发送键是**图标按钮**（`↑`），按文本 `/发送/` 找不到 ⇒ 之前误判
      // "找不到按钮"。改成**按结构**找：先按文案/箭头，再退化成"最后一个可用按钮"，并打标记后点它。
      const sendMarked = await evA(`(() => {
        const scope = document.querySelector('.dshWmCompanion');
        if (!scope) return 'no-scope';
        const btns = Array.from(scope.querySelectorAll('button')).filter((b) => !b.disabled);
        const pick = btns.find((b) => /发送|^↑$|^➤$|^\\u{2191}$/u.test((b.textContent || '').trim()))
          || btns.find((b) => (b.querySelector('svg') && !(b.textContent || '').trim()))
          || btns[btns.length - 1];
        if (!pick) return 'no-button';
        pick.setAttribute('data-flow-send', '1');
        return 'ok:' + ((pick.textContent || '').trim().slice(0, 6) || pick.className.slice(0, 20));
      })()`)
      console.log(`  发送按钮：${sendMarked === 'ok' || String(sendMarked).startsWith('ok:') ? `已标记（${String(sendMarked).slice(3)}）` : `✗ ${sendMarked}`}`)
      const clicked = await evA(`(() => { const btn = document.querySelector('[data-flow-send="1"]'); if (!btn) return 0; btn.click(); return 1 })()`)
      // 判据用**输入框是否被清空**（比"消息条数"稳：历史会话本来就有很多条）
      await sleep(2500)
      const cleared = await evA(`(() => { const ta = document.querySelector('.dshWmCompanion textarea, .dshWmCompanion input[type="text"]'); return ta ? String(ta.value || '').trim() === '' : null })()`)
      const after = Number(await evA(`document.querySelectorAll('.dshWmMessage, [class*="Message"]').length`)) || 0
      const state = clicked && (cleared === true || after > before) ? 'REACTED' : 'DEAD'
      console.log(`  发送结果：点了=${clicked} 输入框已清空=${cleared} 消息 ${before} → ${after} ${state === 'REACTED' ? '✓' : '✗ DEAD（点了没反应）'}`)
      rows.push({ name: '写作助手发送', state })
    }
    assistant.close()
  }

  main.close()

  const dead = rows.filter((r) => r.state === 'DEAD' || r.state === 'ERROR' || r.state === 'THREW')
  console.log(`\n合计 ${rows.length} 项：死/错 ${dead.length} 项`)
  if (dead.length) console.log('需处理：', dead.map((d) => `${d.name}(${d.state})`).join('、'))
  if (!KEEP) {
    try {
      process.kill(child.pid)
    } catch {
      /* 已退出 */
    }
  } else {
    console.log('（--keep：实例保留 PID', child.pid, '）')
  }
  process.exit(dead.length ? 1 : 0)
})().catch((err) => {
  console.error('探针失败：', err)
  process.exit(2)
})
