/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { T } from '../copy.js'
import { CSS } from '../styles/writing-css.js'
import { modeListeners, setModeActive, getModeActive } from '../state/mode-store.js'

export let domFloatEl = null
export function ensureDomFloat() {
  if (typeof document === 'undefined') return
  if (domFloatEl && document.body.contains(domFloatEl)) return
  const existing = document.getElementById('dsh-writing-mode-float')
  if (existing) {
    domFloatEl = existing
    return
  }
  const btn = document.createElement('button')
  btn.id = 'dsh-writing-mode-float'
  btn.type = 'button'
  btn.className = 'dshWmFloat'
  btn.textContent = T.toggle
  btn.addEventListener('click', () => setModeActive(!getModeActive()))
  const sync = () => {
    const on = getModeActive()
    btn.classList.toggle('is-on', on)
    btn.textContent = on ? T.exit : T.toggle
    btn.title = on ? T.exit : T.toggle
    // 打开工作台时由 CSS 隐藏（html[data-writing-mode]），避免与顶栏退出钮叠在一起
    btn.style.display = ''
    btn.style.zIndex = '95'
  }
  modeListeners.add(sync)
  sync()
  document.body.appendChild(btn)
  domFloatEl = btn

  // 全局 Ctrl+Shift+W 切换写作模式（与编辑器内快捷键互不冲突时）
  if (!window.__dshWritingModeHotkey) {
    window.__dshWritingModeHotkey = true
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
          e.preventDefault()
          setModeActive(!getModeActive())
        }
      },
      true
    )
  }
}
