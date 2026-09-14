/**
 * 写作模式客户端入口（ESM 源码；构建经 esbuild 打包为 client.js 的 ModuleLoader 工厂体）。
 * - react / react/jsx-runtime 由 factory 的 require 提供（external，不打入第二份）
 * - 共享控制器与纯函数来自 ../shared/*（P1 起为真模块导入，不再由构建脚本正则拼装）
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { createEditorSession } from '../shared/editor-session.js'
import { buildPreparedTurn, memoryHint } from '../shared/context-builder.js'
import { T } from './copy.js'
import { ensureWritingCss } from './styles/writing-css.js'
import { api } from './services/writing-api.js'
import { WritingModeApp } from './app/WritingModeApp.js'
import { ensureDomFloat } from './app/dom-float.js'
import { WritingModeSettings } from './features/settings/WritingModeSettings.js'
import { WritingModeFooterEntry, WritingModeHeaderEntry } from './features/settings/entries.js'
import { applyBodyAttr, setCloseGuard, modeListeners, setModeActive, commitModeActive, subscribeMode, getModeActive } from './state/mode-store.js'
import { companionRows, WritingCompanion } from './features/companion/index.js'
import { loadProjectMemory, CompanionMemoryPanel } from './features/memory/index.js'
import { bindHarness, harnessSessions, harnessConnection, harnessWorkspaces } from './adapters/harness/runtime.js'
import { appendCompanionDraft, ensureCompanionSession } from './adapters/harness/sessions.js'
import {
  companionDrafts,
  loadCompanionDraft,
  companionRecoveryState,
  companionDraftDirty,
  companionDraftConflict,
  companionDraftStatus,
  setDraftStatus,
  getDraftStatus,
  subscribeDraftStatus,
  resolveDraftConflict,
  retryDraftConflictRemote,
  persistCompanionDraft,
} from './state/companion-drafts.js'
import { versionOf, getPrefs, subscribePrefs, loadPrefs, savePrefs } from './state/prefs-store.js'

const __wmAlreadyLoaded = window.__dshWritingModeLoaded === true
window.__dshWritingModeLoaded = true

export const name = 'writing-mode'




// Conversation history stays in Harness. Unsent text lives in host checkpoints.











ensureWritingCss()





/** 侧栏底部入口：点击切换写作模式。 */

/** 从文件名提取 -vN。模块级，供组件内 useMemo 使用。 */

/** DOM 常驻浮动入口：不依赖 shell.overlay 是否在当前页挂载。 */

/** 内核设置 → 写作模式 */

export const inject = __wmAlreadyLoaded ? [] : ['slots', 'sessions', 'connection', 'workspaces']
export function apply(ctx) {
  if (__wmAlreadyLoaded) return
  bindHarness(ctx)
  try {
    ensureDomFloat()
  } catch (err) {
    console.warn('[writing-mode] float inject failed:', err)
  }
  // 1) 全屏工作台
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'writing-mode',
              order: 20,
              label: () => T.toggle,
            },
            WritingModeApp
          )
        ),
      'writing-mode: overlay'
    )
  } catch (err) {
    console.warn('[writing-mode] shell.overlay register failed:', err)
  }
  // 2) 主界面侧栏底部入口（官方槽位，比浮动钮好找）
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'writing-mode',
              order: 30,
              label: () => T.toggle,
            },
            WritingModeFooterEntry
          )
        ),
      'writing-mode: sidebar-footer'
    )
  } catch (err) {
    console.warn('[writing-mode] sidebar.footer.action register failed:', err)
  }
  // 3) 会话顶栏工具区入口（可选；内核无此槽则静默）
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'writing-mode',
              order: 40,
              label: () => T.toggle,
            },
            WritingModeHeaderEntry
          )
        ),
      'writing-mode: header-util'
    )
  } catch (err) {
    console.warn('[writing-mode] header.utilities register failed:', err)
  }
  // 4) 内核设置 → 写作模式
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'writing-mode',
              order: 46,
              label: () => '写作模式',
            },
            WritingModeSettings
          )
        ),
      'writing-mode: settings'
    )
  } catch (err) {
    console.warn('[writing-mode] settings.section register failed:', err)
  }
  console.info('[writing-mode] client ready · float=DOM · overlay+sidebar+settings')
}

export { companionDraftConflict as __draftConflict }
export { appendCompanionDraft, ensureCompanionSession, loadCompanionDraft, resolveDraftConflict, retryDraftConflictRemote, subscribeDraftStatus, getDraftStatus, persistCompanionDraft, companionDraftDirty as __draftDirty, companionDraftStatus as __draftStatus, companionRows, createEditorSession, api }
