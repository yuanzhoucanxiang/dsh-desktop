'use strict'

/* 插件体检面板渲染逻辑（sandbox 页面，全部能力经 preload 的 dshShell 桥） */

const $ = (id) => document.getElementById(id)
const BAD_CODES = new Set(['dangling-link', 'missing-entry', 'no-dsh-bundle', 'unreadable'])
let lastReport = null
let updateResults = null // { at, results: [{name, latest, upToDate, error}] }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

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
      <td class="dim" style="color:var(--label-3)">${it.inBundles ? '已启用' : '未启用'}</td>
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
  const upd = updateResults ? ` · 更新检测于 ${new Date(updateResults.at).toLocaleTimeString()}` : ''
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
  if (!window.dshShell || !window.dshShell.pluginsReport) {
    $('error-banner').textContent = '此页面需在 DeepSeek Harness Desktop 内打开（缺少外壳桥）'
    $('error-banner').classList.remove('hidden')
    $('rows').innerHTML = '<tr><td colspan="5" class="loading">不可用</td></tr>'
    return
  }
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

async function checkUpdates() {
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
$('btn-updates').addEventListener('click', checkUpdates)
$('btn-restore').addEventListener('click', restore)
refresh()
