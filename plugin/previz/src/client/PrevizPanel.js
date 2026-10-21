import * as react from 'react'
import { api, artifactUrl, createProject, selectProject } from './api.js'
import { refresh, setUi } from './store.js'
import { useSnapshot, useUiState } from './usePreviz.js'

const h = react.createElement

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    height: '100%',
    minHeight: 0,
    padding: 14,
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-bg-base)',
    font: '13px/1.5 system-ui, sans-serif',
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontWeight: 700, fontSize: 15 },
  muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
  pill: (color) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '1px 8px',
    borderRadius: 999,
    border: `1px solid ${color}`,
    color,
    fontSize: 11,
    lineHeight: '17px',
    whiteSpace: 'nowrap',
  }),
  btn: (kind) => ({
    padding: '4px 10px',
    borderRadius: 7,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: kind === 'primary' ? 'var(--dsw-alias-brand-primary)' : 'transparent',
    color: kind === 'primary' ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    fontSize: 12,
    opacity: kind === 'disabled' ? 0.55 : 1,
  }),
  body: { display: 'flex', gap: 12, flex: 1, minHeight: 0 },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  side: { width: 250, flex: 'none', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 },
  panel: {
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: 10,
    background: 'var(--dsw-alias-bg-layer-1)',
    padding: 10,
  },
  preview: {
    flex: 1,
    minHeight: 160,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--dsw-alias-bg-layer-2)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  video: { width: '100%', maxHeight: '48vh', background: '#000', display: 'block' },
  img: { maxWidth: '100%', maxHeight: '48vh', objectFit: 'contain', display: 'block' },
  artifact: (active) => ({
    textAlign: 'left',
    padding: '5px 8px',
    borderRadius: 7,
    border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
    background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    fontSize: 12,
  }),
  log: {
    margin: 0,
    maxHeight: 110,
    overflow: 'auto',
    padding: 8,
    borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 11,
    whiteSpace: 'pre-wrap',
  },
  row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
}

function runtimeColor(state) {
  if (state === 'ready') return 'var(--dsw-alias-brand-primary)'
  if (state === 'down') return 'var(--dsw-alias-label-warning, #d8a657)'
  if (state === 'error') return 'var(--dsw-alias-label-danger, #e06c75)'
  return 'var(--dsw-alias-label-tertiary)'
}

function runtimeText(runtime) {
  if (!runtime) return '读取中…'
  if (runtime.state === 'ready') return 'Blender 就绪'
  if (runtime.state === 'down') return '后端未启动'
  if (runtime.state === 'starting') return '启动中…'
  return '后端异常'
}

function jobText(job) {
  if (!job) return '空闲'
  if (job.state === 'running') {
    return Number.isFinite(job.progress) ? `渲染中 ${Math.round(job.progress * 100)}%` : '渲染中…'
  }
  return { done: '已完成', failed: '失败', cancelled: '已取消', queued: '排队中' }[job.state] || job.state
}

export function PrevizPanel({ compact = false } = {}) {
  const snap = useSnapshot()
  const ui = useUiState()
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')
  const [notice, setNotice] = react.useState('')
  const [creating, setCreating] = react.useState(false)
  const [newId, setNewId] = react.useState('')
  const [newTitle, setNewTitle] = react.useState('')

  const runtime = snap?.runtime || null
  const job = snap?.job || null
  const artifacts = snap?.artifacts || []
  const projects = snap?.projects || []
  const project = snap?.project || null
  const selected =
    artifacts.find((a) => a.path === ui.selected) ||
    artifacts.find((a) => a.kind === 'animatic') ||
    artifacts.find((a) => a.kind === 'image') ||
    null
  const running = job?.state === 'running' || job?.state === 'queued'

  async function act(fn, okText) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await fn()
      if (!result || result.ok === false) {
        setError(result?.detail || result?.error || '操作失败')
      } else {
        if (okText) setNotice(okText)
        await refresh()
      }
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  const run = () => act(() => api('demo', {}), '已开始构建 / 渲染')
  const cancel = () => act(() => api('cancel', {}), '已取消')
  const probe = () => act(() => api('probe'), '已重新探测')
  const openBlender = () => act(() => api('open-blender', {}), '已请求打开 Blender')
  const switchProject = (e) => {
    const id = e.target.value
    if (!id || id === project?.id) return
    void act(() => selectProject(id), `已切到 ${id}`)
  }
  const newProject = () => {
    setCreating(true)
    setNewId('')
    setNewTitle('')
    setError('')
    setNotice('')
  }
  const confirmCreate = () => {
    const id = newId.trim()
    if (!id) {
      setError('项目 id 不能为空')
      return
    }
    const title = newTitle.trim() || id
    void act(async () => {
      const r = await createProject(id, title)
      if (r?.ok) setCreating(false)
      return r
    }, `已创建 ${id}`)
  }

  const projectPicker = h(
    'select',
    {
      value: project?.id || '',
      onChange: switchProject,
      disabled: busy || running,
      title: running ? '有任务在跑，先取消再切项目' : '切换项目',
      style: { ...S.btn(), paddingRight: 18 },
      'data-previz-project': '',
    },
    projects.length
      ? projects.map((p) => h('option', { key: p.id, value: p.id, disabled: !p.valid }, `${p.valid ? '' : '（缺文件）'}${p.id} · ${p.title}`))
      : h('option', { value: project?.id || '' }, project?.title || 'boutique'),
  )

  const newProjectBtn = h(
    'button',
    {
      type: 'button',
      onClick: newProject,
      disabled: busy || running,
      title: '从 boutique starter 新建项目',
      style: S.btn(),
      'data-previz-new-project': '',
    },
    '新建',
  )

  const header = h(
    'div',
    { style: S.header },
    h('span', { style: S.title }, '预演'),
    projectPicker,
    newProjectBtn,
    h('span', { style: S.pill(runtimeColor(runtime?.state)) }, runtimeText(runtime)),
    h('span', { style: S.pill(running ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)') }, jobText(job)),
    h('span', { style: { flex: 1 } }),
    runtime?.state === 'ready'
      ? h('button', { type: 'button', style: S.btn('primary'), disabled: busy || running, onClick: run, title: running ? '有任务在跑' : '构建 + 渲染 + 编码 + QC' }, '运行 demo')
      : h('button', { type: 'button', style: S.btn('primary'), disabled: busy, onClick: probe }, '重新探测'),
    running ? h('button', { type: 'button', style: S.btn(), disabled: busy, onClick: cancel }, '取消') : null,
    runtime?.state === 'ready' ? h('button', { type: 'button', style: S.btn(), disabled: busy, onClick: openBlender }, '打开 Blender') : null,
    h('button', { type: 'button', style: S.btn(), disabled: busy, onClick: () => void refresh() }, '刷新'),
  )

  const runtimeBox =
    runtime && runtime.state !== 'ready'
      ? h(
          'div',
          { style: S.panel },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, runtimeText(runtime)),
          h('div', { style: S.muted }, runtime.detail || '没有更多信息'),
          h(
            'div',
            { style: { ...S.muted, marginTop: 6 } },
            '下一步：设置环境变量 PREVIZ_BLENDER，或安装 Blender 5.2 / 把 ffmpeg 放进 PATH，然后点「重新探测」。',
          ),
        )
      : null

  const createRow = creating
    ? h(
        'div',
        { style: { ...S.panel, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }, 'data-previz-create-row': '' },
        h('input', {
          value: newId,
          onChange: (e) => setNewId(e.target.value),
          placeholder: '项目 id（字母/数字/._-）',
          style: { ...S.btn(), minWidth: 150, cursor: 'text' },
          'data-previz-new-id': '',
        }),
        h('input', {
          value: newTitle,
          onChange: (e) => setNewTitle(e.target.value),
          placeholder: '标题（可空）',
          style: { ...S.btn(), minWidth: 130, cursor: 'text' },
          'data-previz-new-title': '',
        }),
        h('button', { type: 'button', style: S.btn('primary'), onClick: confirmCreate, disabled: busy }, '创建'),
        h('button', { type: 'button', style: S.btn(), onClick: () => setCreating(false), disabled: busy }, '取消'),
      )
    : null

  const feedback =
    error || notice
      ? h('div', { style: { ...S.muted, color: error ? 'var(--dsw-alias-label-danger, #e06c75)' : 'var(--dsw-alias-brand-primary)' } }, error || notice)
      : null

  const preview = selected
    ? String(selected.path).endsWith('.mp4')
      ? h('video', { key: selected.path, src: artifactUrl(selected.path), controls: true, style: S.video })
      : String(selected.path).endsWith('.png')
        ? h('img', { key: selected.path, src: artifactUrl(selected.path), alt: selected.title, style: S.img })
        : h(
            'div',
            { style: S.panel },
            h('div', { style: { fontWeight: 600 } }, selected.title),
            h('div', { style: S.muted }, '这个产物不是视频/图片；点右侧下载或打开原文件。'),
          )
    : h('div', { style: { ...S.muted, padding: 24 } }, running ? '渲染中…完成后这里会出现 animatic / 平面图。' : '还没有产物。点「运行 demo」。')

  const list = h(
    'div',
    { style: S.side },
    h('div', { style: { ...S.muted, fontWeight: 600 } }, '最近产物'),
    artifacts.length
      ? artifacts.map((a) =>
          h(
            'button',
            {
              key: a.path,
              type: 'button',
              style: S.artifact(selected?.path === a.path),
              onClick: () => setUi({ selected: a.path }),
              title: a.path,
            },
            a.title || a.path,
            h('span', { style: { ...S.muted, marginLeft: 6 } }, a.kind),
          ),
        )
      : h('div', { style: S.muted }, '暂无'),
    selected
      ? h(
          'a',
          { href: artifactUrl(selected.path), target: '_blank', rel: 'noreferrer', style: { ...S.muted, marginTop: 4 } },
          '在新窗口打开原文件',
        )
      : null,
    h('div', { style: { ...S.muted, marginTop: 'auto' } }, 'P0 demo · 2 人 3 镜 9 秒 · 产出在临时目录'),  )

  const log = job?.logTail?.length
    ? h('pre', { style: S.log }, job.logTail.slice(-12).join('\n'))
    : null

  return h(
    'div',
    { style: { ...S.root, padding: compact ? 10 : 14 }, 'data-previz-panel': '' },
    header,
    createRow,
    runtimeBox,
    feedback,
    h(
      'div',
      { style: S.body },
      h(
        'div',
        { style: S.main },
        h('div', { style: S.preview }, preview),
        job ? h('div', { style: S.row }, h('span', { style: S.muted }, `任务 ${job.id} · ${jobText(job)}`), job.error ? h('span', { style: { ...S.muted, color: 'var(--dsw-alias-label-danger, #e06c75)' } }, job.error) : null) : null,
        log,
      ),
      list,
    ),
  )
}

export function PrevizSplice() {
  return h(PrevizPanel, { compact: false })
}

export function PrevizTile() {
  const snap = useSnapshot()
  const runtime = snap?.runtime
  const job = snap?.job
  const plan = (snap?.artifacts || []).find((a) => a.path === 'plan.png')
  return h(
    'div',
    { style: { padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }, 'data-previz-tile': '' },
    h('div', { style: S.row }, h('strong', null, '预演 · P0 demo'), h('span', { style: S.pill(runtimeColor(runtime?.state)) }, runtimeText(runtime))),
    h('div', { style: S.muted }, job ? jobText(job) : '2 人 3 镜 9 秒；运行 demo 出 animatic + 平面图。'),
    plan ? h('img', { src: artifactUrl(plan.path), alt: '平面图', style: { width: '100%', maxHeight: 150, objectFit: 'contain', borderRadius: 6 } }) : null,
  )
}
