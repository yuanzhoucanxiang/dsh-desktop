'use strict'

/* 设置面板渲染逻辑（sandbox 页面，全部能力经 preload 的 dshShell 桥）
 * 两个页签：插件（只读体检） / 软件更新（状态机卡片，借鉴 lumen 的更新体验） */

const $ = (id) => document.getElementById(id)

/* ─────────────────────────── 皮肤（与启动画面同一体系） ───────────────────
 * 首帧用查询参数（主进程开窗时带上，零闪烁），随后跟随托盘皮肤切换即时变。 */
const query = new URLSearchParams(location.search)
function applySkin(id) {
  document.body.dataset.theme = ['deep', 'seascape', 'palis'].includes(id) ? id : 'deep'
}
applySkin(query.get('theme'))
if (window.dshShell) {
  if (window.dshShell.onTheme) window.dshShell.onTheme(applySkin)
  // 以主进程状态为准再校正一次（查询参数缺失/过期时兜底）
  if (window.dshShell.status) {
    window.dshShell.status().then((s) => { if (s && s.theme) applySkin(s.theme) }).catch(() => {})
  }
}

const BAD_CODES = new Set(['dangling-link', 'missing-entry', 'no-dsh-bundle', 'unreadable'])
let lastReport = null
let updateResults = null // { at, results: [{name, latest, upToDate, error}] }
let updateStatus = null // { state, version, notes, percent, message, checkedAt }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function timeOf(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString() } catch { return '' }
}

/* ─────────────────────────────── 页签 ─────────────────────────────────── */

function switchTab(tab) {
  const target = tab === 'update' ? 'update' : 'plugins'
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === target)
  }
  $('page-plugins').classList.toggle('hidden', target !== 'plugins')
  $('page-update').classList.toggle('hidden', target !== 'update')
}
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
}
switchTab(query.get('tab'))
if (window.dshShell && window.dshShell.onSettingsTab) {
  window.dshShell.onSettingsTab((tab) => switchTab(tab))
}

/* ───────────────────────────── 插件体检页 ─────────────────────────────── */

function chipClass(code) {
  return BAD_CODES.has(code) ? 'bad' : 'warn'
}

function renderRows() {
  const rows = $('rows')
  if (!lastReport || lastReport.error) {
    rows.innerHTML = '<tr><td colspan="5" class="loading">暂无数据</td></tr>'
    return
  }
  const updates = updateResults ? new Map(updateResults.results.map((r) => [r.name, r])) : null
  const html = lastReport.items.map((it) => {
    const srcLabel = it.source === 'link' ? '🔗 本地链接' : '📦 npm'
    const chips = it.problemLabels && it.problemLabels.length
      ? it.problems.map((c, i) => `<span class="chip ${chipClass(c)}" title="${esc(it.problems[i])}">${esc(it.problemLabels[i])}</span>`).join('')
      : '<span class="chip">✓ 正常</span>'
    let latest = '—'
    if (it.source === 'link') {
      latest = '<span class="dim">本地开发版</span>'
    } else if (updates && updates.has(it.name)) {
      const r = updates.get(it.name)
      if (r.error) latest = `<span class="err" title="${esc(r.error)}">检测失败</span>`
      else if (r.upToDate) latest = `<span class="dim">${esc(r.latest)}（已是最新）</span>`
      else latest = `<span class="up" title="已装 ${esc(it.version)}">↑ ${esc(r.latest)} 有新版</span>`
    }
    return `<tr>
      <td class="name">${esc(it.name)}<span class="src">${srcLabel}</span></td>
      <td class="ver">${esc(it.version || '?')}</td>
      <td style="color:var(--label-3)">${it.inBundles ? '已启用' : '未启用'}</td>
      <td><div class="chips">${chips}</div></td>
      <td class="latest">${latest}</td>
    </tr>`
  }).join('')
  rows.innerHTML = html || '<tr><td colspan="5" class="loading">profile 里还没有插件</td></tr>'
}

function renderSummary() {
  const el = $('summary')
  if (!lastReport || lastReport.error) { el.textContent = ''; return }
  const n = lastReport.items.length
  const p = (lastReport.problems || []).length
  const upd = updateResults ? ` · 更新检测于 ${timeOf(updateResults.at)}` : ''
  el.className = 'summary ' + (p ? 'bad' : 'good')
  el.innerHTML = `共 <b>${n}</b> 个插件 · <b>${p}</b> 项异常${upd}`
}

function renderQuarantine() {
  const card = $('quarantine')
  const list = lastReport && lastReport.quarantined
  if (!list || !list.length) { card.classList.add('hidden'); return }
  card.classList.remove('hidden')
  $('quarantine-list').innerHTML = '<ul>' + list.map((e) => {
    const at = e.at ? new Date(e.at).toLocaleString() : ''
    const why = e.reason ? `<span class="why"> — ${esc(String(e.reason).slice(0, 90))}</span>` : ''
    return `<li>${esc(e.name)}${at ? ` <span class="why">· ${esc(at)}</span>` : ''}${why}</li>`
  }).join('') + '</ul>'
}

function renderAll() {
  renderSummary()
  renderQuarantine()
  renderRows()
}

async function refresh() {
  if (!window.dshShell || !window.dshShell.pluginsReport) return
  $('btn-refresh').disabled = true
  try {
    lastReport = await window.dshShell.pluginsReport()
    if (lastReport.error) {
      $('error-banner').textContent = lastReport.error
      $('error-banner').classList.remove('hidden')
    } else {
      $('error-banner').classList.add('hidden')
    }
    renderAll()
  } catch (err) {
    $('error-banner').textContent = '体检失败：' + (err && err.message ? err.message : String(err))
    $('error-banner').classList.remove('hidden')
  } finally {
    $('btn-refresh').disabled = false
  }
}

async function checkPluginUpdates() {
  if (!window.dshShell || !window.dshShell.pluginsCheckUpdates) return
  const btn = $('btn-updates')
  btn.disabled = true
  btn.textContent = '检测中…'
  try {
    updateResults = await window.dshShell.pluginsCheckUpdates()
    renderRows()
    renderSummary()
  } catch (err) {
    $('error-banner').textContent = '更新检测失败：' + (err && err.message ? err.message : String(err))
    $('error-banner').classList.remove('hidden')
  } finally {
    btn.disabled = false
    btn.textContent = '检测更新'
  }
}

async function restore() {
  if (!window.confirm('恢复所有被隔离的插件并重启内核？')) return
  const btn = $('btn-restore')
  btn.disabled = true
  try {
    const res = await window.dshShell.pluginsRestore()
    btn.textContent = res && res.restored ? `已恢复 ${res.restored} 个，内核重启中…` : '没有待恢复的插件'
    setTimeout(refresh, 4000)
  } catch (err) {
    $('error-banner').textContent = '恢复失败：' + (err && err.message ? err.message : String(err))
    $('error-banner').classList.remove('hidden')
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = '恢复全部并重启内核' }, 4000)
  }
}

$('btn-refresh').addEventListener('click', refresh)
$('btn-updates').addEventListener('click', checkPluginUpdates)
$('btn-restore').addEventListener('click', restore)

/* ───────────────────────────── 软件更新页 ─────────────────────────────── */

/** 更新说明渲染（lumen 约定）：空行分块；非「·」开头是分类标题，「·」开头是条目。 */
function renderUpdateNotes(notes) {
  const box = $('update-notes')
  const text = String(notes || '').trim()
  if (!text) { box.classList.add('hidden'); box.textContent = ''; return }
  const lines = text.split(/\r?\n/)
  const blocks = []
  let cur = null
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { cur = null; continue }
    if (line.trimStart().startsWith('·')) {
      if (!cur) { cur = { title: '', items: [] }; blocks.push(cur) }
      cur.items.push(line.trimStart().replace(/^·\s*/, ''))
    } else {
      cur = { title: line.trim(), items: [] }
      blocks.push(cur)
    }
  }
  box.innerHTML = blocks.map((b) => {
    const title = b.title ? `<div class="nt-title">${esc(b.title)}</div>` : ''
    const items = b.items.map((it) => `<div class="nt-item"><span class="bullet">·</span><span>${esc(it)}</span></div>`).join('')
    return title + items
  }).join('')
  box.classList.remove('hidden')
}

function renderUpdate() {
  const s = updateStatus || { state: 'idle' }
  const stateEl = $('update-state')
  const hint = $('update-hint')
  const progress = $('update-progress')
  const btnCheck = $('btn-check')
  const btnDownload = $('btn-download')
  const btnInstall = $('btn-install')
  $('update-dot').classList.toggle('hidden', s.state !== 'downloaded')

  btnDownload.classList.add('hidden')
  btnInstall.classList.add('hidden')
  progress.classList.add('hidden')
  stateEl.className = 'update-state'
  hint.textContent = ''

  switch (s.state) {
    case 'idle':
      stateEl.classList.add('dim')
      stateEl.textContent = '尚未检查更新（应用启动后会在后台自动检查并下载）'
      break
    case 'checking':
      stateEl.classList.add('dim')
      stateEl.textContent = '正在检查更新…'
      btnCheck.disabled = true
      btnCheck.textContent = '检查中…'
      break
    case 'none':
      stateEl.classList.add('ok')
      stateEl.innerHTML = `✓ 已是最新版本${s.checkedAt ? `（检查于 ${esc(timeOf(s.checkedAt))}${s.message ? esc(s.message) : ''}）` : ''}`
      break
    case 'available':
      stateEl.innerHTML = `⬆ 发现新版本 <span class="ver">${esc(s.version)}</span>`
      hint.textContent = '正在后台自动下载，无需操作'
      renderUpdateNotes(s.notes)
      break
    case 'downloading':
      stateEl.innerHTML = `⬇ 正在下载 <span class="ver">${esc(s.version)}</span>`
      progress.classList.remove('hidden')
      $('progress-fill').style.width = `${Math.max(0, Math.min(100, s.percent || 0))}%`
      $('progress-text').textContent = `${Math.floor(s.percent || 0)}%`
      renderUpdateNotes(s.notes)
      break
    case 'downloaded':
      stateEl.classList.add('ok')
      stateEl.innerHTML = `✓ <span class="ver">${esc(s.version)}</span> 已下载完成`
      btnInstall.classList.remove('hidden')
      hint.textContent = '「重启并安装」约几秒、装完自动打开；不点也没关系，下次退出应用时自动装上'
      renderUpdateNotes(s.notes)
      break
    case 'error':
      stateEl.classList.add('err')
      stateEl.textContent = `⚠ ${s.message || '更新失败'}`
      btnCheck.textContent = '重新检查'
      break
    case 'dev':
      stateEl.classList.add('dim')
      stateEl.textContent = s.message || '开发模式不支持自动更新'
      break
    case 'unconfigured':
      stateEl.classList.add('dim')
      stateEl.textContent = s.message || '未配置更新源'
      break
    default:
      stateEl.classList.add('dim')
      stateEl.textContent = s.state
  }
  if (s.state !== 'checking') {
    btnCheck.disabled = false
    btnCheck.textContent = s.state === 'error' ? '重新检查' : '检查更新'
  }
}

async function loadUpdate() {
  if (!window.dshShell || !window.dshShell.updateGet) return
  try {
    const s = await window.dshShell.updateGet()
    if (s && s.appVersion) $('app-version').textContent = `当前版本 v${s.appVersion}`
    updateStatus = s
    renderUpdate()
  } catch {}
}

if (window.dshShell) {
  if (window.dshShell.onUpdateStatus) {
    window.dshShell.onUpdateStatus((s) => { updateStatus = s; renderUpdate() })
  }
  $('btn-check').addEventListener('click', async () => {
    const btn = $('btn-check')
    btn.disabled = true
    btn.textContent = '检查中…'
    try { updateStatus = await window.dshShell.updateCheck() } catch {}
    renderUpdate()
  })
  $('btn-download').addEventListener('click', () => { window.dshShell.updateDownload().catch(() => {}) })
  $('btn-install').addEventListener('click', () => { window.dshShell.updateInstall().catch(() => {}) })
}

refresh()
loadUpdate()
