/**
 * 工具台样式。全部走 `--dsw-alias-*` 设计令牌（跟随内核明暗主题与皮肤层重定义），
 * 不写死颜色；类名统一 `dshWb*` 前缀，避免与模式自己的 `dshWm*` / `gir-*` 撞名。
 */

const STYLE_ID = 'dsh-workbench-style'

export const CSS = [
  // 入口（侧栏底部）
  '.dshWbEntry{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;text-align:left;}',
  '.dshWbEntry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbEntry.is-open{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
  '.dshWbEntryGlyph{flex:none;font-size:14px;line-height:1;color:var(--dsw-alias-brand-primary);}',
  '.dshWbEntryLabel{flex:none;}',
  '.dshWbEntryMode{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;}',
  // 切换器（帧级浮层；浮层本身 click-through，只有面板接指针）
  '.dshWbScrim{position:fixed;inset:0;z-index:1400;background:transparent;}',
  '.dshWbPanel{position:absolute;left:12px;bottom:56px;min-width:260px;max-width:min(420px,calc(100vw - 24px));padding:12px;display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.32);pointer-events:auto;}',
  '.dshWbHead{display:flex;align-items:baseline;gap:8px;}',
  '.dshWbTitle{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dshWbClose{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px;}',
  '.dshWbClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  '.dshWbList{display:flex;flex-direction:column;gap:4px;}',
  '.dshWbRow{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;text-align:left;}',
  '.dshWbRow:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.dshWbRow.is-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}',
  '.dshWbRowLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshWbRowMark{flex:none;font-size:11px;color:var(--dsw-alias-brand-primary);}',
  '.dshWbEmpty{padding:8px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  // 上下文行（L1）：工具台只汇总与展示，模式自己报"正在做什么"
  '.dshWbCtx{margin:2px 0 2px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  // 通知出口（L1）：交接结果与各模式上报都走这里；点一下即关
  '.dshWbToast{position:fixed;left:12px;bottom:56px;z-index:1410;max-width:min(420px,calc(100vw - 24px));padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.28);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;pointer-events:auto;}',
  '.dshWbToast.is-warn{border-left-color:var(--dsw-alias-state-error-primary);}',
  // 辅助坞（L2）：右缘常驻面；收起时留竖排 rail。都走设计令牌，跟随主题/皮肤。
  '.dshWbDock{position:fixed;top:0;right:0;bottom:0;z-index:2100;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgba(0,0,0,.24);pointer-events:auto;}',
  '.dshWbDockHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.dshWbDockTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary);}',
  '.dshWbDockPick{flex:1;min-width:0;font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
  '.dshWbDockClose{flex:none;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;padding:4px 7px;cursor:pointer;}',
  '.dshWbDockClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbDockBody{flex:1;min-height:0;overflow:auto;padding:10px;}',
  '.dshWbDockRail{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2100;padding:10px 6px;border:1px solid var(--dsw-alias-border-l2);border-right:none;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;pointer-events:auto;}',
  '.dshWbDockRail:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbDockRailText{writing-mode:vertical-rl;letter-spacing:.08em;}',
  '.dshWbFoot{display:flex;align-items:center;gap:8px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1);}',
  '.dshWbNotice{font-size:12px;color:var(--dsw-alias-state-error-primary);}',
  // 设置段
  '.dshWbSet{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary);}',
  '.dshWbSetCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2);}',
  '.dshWbSetTitle{font-size:13px;font-weight:600;}',
  '.dshWbSetLine{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
  '.dshWbSetMuted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  '.dshWbSetChip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary);}',
  '.dshWbSetChip.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
  '.dshWbBtn{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 10px;cursor:pointer;}',
  '.dshWbBtn:hover{background:var(--dsw-alias-interactive-bg-hover);}',
].join('')

export function ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
