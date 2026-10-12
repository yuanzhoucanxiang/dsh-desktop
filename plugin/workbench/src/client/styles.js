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
  // 主屏（L2 主屏，2026-10-11 项目所有者定形态）：全屏门面——左列对话 + 右侧模式瓷砖格；
  // z 层 2200：盖过模式浮层（写作 2000 / GIR 60）与辅助坞（2100），打开时盖住、关闭后原样回到。
  '.dshWbHome{position:fixed;inset:0;z-index:2200;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);animation:dshWbIn .16s ease-out;}',
  '@keyframes dshWbIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@media (prefers-reduced-motion:reduce){.dshWbHome{animation:none}}',
  '.dshWbHomePanel{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;padding:20px 24px;overflow:auto;}',
  '.dshWbHomeBody{flex:1;min-height:0;display:flex;gap:16px;}',
  // 左列：对话瓷砖（真实但克制的 v1：会话标题 + 回到完整会话；完整聊天交互下一轮）
  '.dshWbChat{flex:none;width:340px;display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:14px;}',
  '.dshWbChatHead{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dshWbChatCard{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;}',
  '.dshWbChatSession{min-width:0;flex:1;}',
  '.dshWbChatSessionTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshWbChatHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  // 状态条（输入框下那条窄条）：三个指标各占一段，读不到就如实写"还没数据"+原因（title）
  '.dshWbStrip{flex:none;display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);}',
  '.dshWbStripItem{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;cursor:default;}',
  // 真聊天瓷砖（只读转录）：最多几条 + 角色标签，长文截断，绝不撑破窄窗
  '.dshWbChatLog{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;overflow:auto;margin-top:8px;padding-right:2px;}',
  '.dshWbChatLine{display:flex;gap:6px;align-items:flex-start;font-size:12px;line-height:17px;}',
  '.dshWbChatWho{flex:none;padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;}',
  '.dshWbChatLine.is-user .dshWbChatWho{color:var(--dsw-alias-brand-primary);}',
  '.dshWbChatLine.is-error .dshWbChatWho{color:var(--dsw-alias-state-error-primary);}',
  '.dshWbChatText{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;}',
  // 输入框那一行（长条底部）：文本域 + 发送钮，禁用时靠 placeholder/title 说清出路
  '.dshWbComposer{flex:none;display:flex;gap:8px;align-items:flex-end;margin-top:8px;}',
  '.dshWbComposerInput{flex:1;min-width:0;resize:none;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;}',
  '.dshWbComposerInput:disabled{opacity:.55;cursor:not-allowed;}',
  '.dshWbComposer .dshWbBtn:disabled{opacity:.55;cursor:not-allowed;}',
  // 右侧：瓷砖格（提供 tile 的模式渲染内容窗口；没提供的退化为大按钮卡，保证可达）
  '.dshWbTiles{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;align-content:start;overflow:auto;padding-bottom:4px;}',
  '.dshWbTile{position:relative;display:flex;flex-direction:column;min-height:220px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;}',
  '.dshWbTile.is-active{border-color:var(--dsw-alias-brand-primary);}',
  '.dshWbTileHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.dshWbTileLabel{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshWbTileEnter{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;padding:3px 9px;cursor:pointer;}',
  '.dshWbTileEnter:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary);}',
  '.dshWbTileEnter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.dshWbTileBody{flex:1;min-height:0;overflow:auto;padding:10px;}',
  // 窄窗（<900px）对话列收上、瓷砖格收下，不横向挤坏
  '@media (max-width:900px){.dshWbHomeBody{flex-direction:column;}.dshWbChat{width:auto;flex:none;}}',
  '.dshWbHead{display:flex;align-items:baseline;gap:8px;}',
  '.dshWbTitle{flex:1;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dshWbClose{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px;}',
  '.dshWbClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  // 长条自绘顶栏三钮（2026-10-12 拍板）：只在条状形态出现；normal 仍走原生标题栏，两套并排就是混乱。
  // 刻意**不写 -webkit-app-region**——这一刀窗口还有原生边框，拖拽归原生标题栏；无边框那一刀再补。
  '.dshWbBar{flex:none;display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.dshWbBarTitle{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshWbBarBtn{flex:none;width:26px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;}',
  '.dshWbBarBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbBarBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.dshWbBarBtn.is-close:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}',
  // `—` 收到小条：整块门面只剩顶栏 + 一行"正在做什么"（168px 高塞对话与瓷砖就是破版）
  '.dshWbMini{position:fixed;inset:0;z-index:2200;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);}',
  '.dshWbMiniLine{flex:1;min-height:0;display:flex;align-items:center;padding:0 14px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshWbHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  // 模式卡片（2026-10-11 前端轮，中央面板版）：大徽标 + 名称 + 该模式自己上报的「正在做什么」；当前模式品牌色描边
  '.dshWbList{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}',
  '.dshWbMode{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:10px;width:100%;min-height:96px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;text-align:left;}',
  '.dshWbMode:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);}',
  '.dshWbMode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.dshWbMode.is-active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}',
  '.dshWbModeGlyph{flex:none;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);font-size:16px;font-weight:600;}',
  '.dshWbMode.is-active .dshWbModeGlyph{border-color:var(--dsw-alias-brand-primary);}',
  '.dshWbModeBody{min-width:0;display:flex;flex-direction:column;gap:3px;}',
  '.dshWbModeLabel{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
  '.dshWbModeCtx{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
  '.dshWbRowMark{flex:none;font-size:11px;padding:1px 8px;border:1px solid var(--dsw-alias-brand-primary);border-radius:999px;color:var(--dsw-alias-brand-primary);}',
  '.dshWbMode .dshWbRowMark{position:absolute;top:10px;right:10px;}',
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
  // 左缘拖拽把手（2026-10-11 前端轮）：宽度仍由 ui-store 的 clamp(240–720) 与 localStorage 管
  '.dshWbDockGrip{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;pointer-events:auto;}',
  '.dshWbDockGrip:hover{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 1px 0 0 var(--dsw-alias-brand-primary);}',
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
