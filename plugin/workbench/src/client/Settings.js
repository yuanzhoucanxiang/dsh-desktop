/**
 * 内核设置 → 工具台（`settings.section`）。
 *
 * P0 只做两件事：① 让作者看见"哪些模式注册进来了、当前是哪个"；
 * ② 如实显示 host 状态（revision / 读不到就明说），不假装成功。
 */
import * as react from 'react'
import { T } from './copy.js'
import { fetchState } from './host-api.js'
import { useWorkbench } from './use-workbench.js'

export function WorkbenchSettings() {
  const { modes, active } = useWorkbench()
  const [host, setHost] = react.useState({ loading: true })

  react.useEffect(() => {
    let dead = false
    void fetchState().then((result) => {
      if (!dead) setHost({ loading: false, ...result })
    })
    return () => {
      dead = true
    }
  }, [])

  const activeLabel = (modes.find((m) => m.id === active) || {}).label || T.activeNone

  return react.createElement(
    'div',
    { className: 'dshWbSet', 'data-wb-settings': '' },
    react.createElement(
      'div',
      { className: 'dshWbSetCard' },
      react.createElement('div', { className: 'dshWbSetTitle' }, T.settings),
      react.createElement('div', { className: 'dshWbSetLine' }, T.settingsIntro),
      react.createElement('div', { className: 'dshWbSetMuted' }, T.settingsDegraded),
    ),
    react.createElement(
      'div',
      { className: 'dshWbSetCard' },
      react.createElement('div', { className: 'dshWbSetTitle' }, T.settingsModes),
      modes.length === 0
        ? react.createElement('div', { className: 'dshWbSetMuted', 'data-wb-settings-none': '' }, T.settingsNone)
        : react.createElement(
            'div',
            { className: 'dshWbSetLine', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            modes.map((mode) =>
              react.createElement(
                'span',
                { key: mode.id, className: `dshWbSetChip${mode.active ? ' is-active' : ''}`, 'data-wb-settings-mode': mode.id },
                mode.label,
              ),
            ),
          ),
    ),
    react.createElement(
      'div',
      { className: 'dshWbSetCard' },
      react.createElement('div', { className: 'dshWbSetTitle' }, T.settingsActive),
      react.createElement('div', { className: 'dshWbSetLine', 'data-wb-settings-active': active || '' }, activeLabel),
    ),
    react.createElement(
      'div',
      { className: 'dshWbSetCard' },
      react.createElement('div', { className: 'dshWbSetTitle' }, T.settingsHost),
      react.createElement('div', { className: 'dshWbSetMuted' }, T.settingsHostHint),
      host.loading
        ? react.createElement('div', { className: 'dshWbSetMuted' }, '…')
        : host.ok
          ? react.createElement(
              'div',
              { className: 'dshWbSetLine', 'data-wb-settings-rev': String(host.state?.revision ?? '') },
              T.settingsRevision(host.state?.revision ?? 0),
              host.state?.activeModeId ? ` · ${host.state.activeModeId}` : '',
            )
          : react.createElement('div', { className: 'dshWbSetLine', 'data-wb-settings-error': host.error || 'error' }, T.settingsUnreachable),
    ),
  )
}
