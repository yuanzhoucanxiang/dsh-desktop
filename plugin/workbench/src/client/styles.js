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
  '.dshWbChatBody{flex:1;min-height:0;display:flex;flex-direction:column;}',
  '.dshWbChatBody.is-empty{justify-content:center;align-items:center;text-align:center;padding:0 8px;}',
  // 状态条（输入框下那条窄条）：三指标 + 上下文进度条 + 模型名；读不到就如实写"还没数据"+原因（title）
  // （类名 2026-10-13 从 `.dshWbStrip*` 改成 `.dshWbMeter*`，对齐原型 `.meter` 的形状）
  '.dshWbMeter{flex:none;display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);}',
  '.dshWbMeterItem{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;cursor:default;}',
  // 真聊天瓷砖（只读转录）：**气泡**布局（原型 `.msg.user` / `.msg.agent`），长文截断，绝不撑破窄窗
  '.dshWbChatLog{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;overflow:auto;margin-top:4px;padding-right:2px;}',
  '.dshWbMsg{display:flex;flex-direction:column;gap:2px;max-width:86%;}',
  '.dshWbMsg.is-user{align-self:flex-end;align-items:flex-end;}',
  '.dshWbMsgWho{padding:0 2px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);}',
  '.dshWbMsgBody{padding:7px 10px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;white-space:pre-wrap;word-break:break-word;}',
  '.dshWbMsg.is-user .dshWbMsgBody{border-bottom-right-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbMsg.is-assistant .dshWbMsgBody{border-bottom-left-radius:4px;}',
  '.dshWbMsg.is-error .dshWbMsgBody{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}',
  // 长文折叠：默认三行（`-webkit-line-clamp`），展开后自然撑开
  '.dshWbMsgBody.is-clamped{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}',
  '.dshWbMsgMore{align-self:flex-start;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:14px;padding:1px 2px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}',
  '.dshWbMsg.is-user .dshWbMsgMore{align-self:flex-end;}',
  '.dshWbMsgMore:hover{color:var(--dsw-alias-label-primary);}',
  '.dshWbMsg.is-detail .dshWbMsgBody{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}',
  // 工具活动行（结构化 tool）：一行压扁，不套气泡；失败用错误色 + 文字说明（不只靠颜色）
  '.dshWbAct{display:flex;align-items:center;gap:6px;padding:2px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}',
  '.dshWbActIcon{flex:none;opacity:.8;}',
  '.dshWbActName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,monospace);}',
  '.dshWbActPhase{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);}',
  '.dshWbAct.is-error{color:var(--dsw-alias-state-error-primary);}',
  '.dshWbAct.is-error .dshWbActPhase{background:transparent;border:1px solid var(--dsw-alias-state-error-primary);}',
  // 流式态：一个会呼吸的点 + "正在生成…" + 实时 tok/s（尊重 reduced-motion）
  '.dshWbStreaming{display:flex;align-items:center;gap:8px;padding:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}',
  '.dshWbStreamDot{flex:none;width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-brand-primary);animation:dshWbPulse 1.1s ease-in-out infinite;}',
  '.dshWbStreamSpeed{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}',
  '@keyframes dshWbPulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}',
  '@media (prefers-reduced-motion:reduce){.dshWbStreamDot{animation:none;opacity:1;}}',
  // 输入区（长条底部，原型 `.composer`）：文本域与发送**同框**，`+` 在左侧圆形
  '.dshWbComposer{flex:none;display:flex;gap:8px;align-items:flex-end;margin-top:8px;}',
  '.dshWbInputWrap{position:relative;flex:1;min-width:0;display:flex;}',
  '.dshWbComposerInput{flex:1;min-width:0;resize:none;padding:7px 62px 7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;}',
  '.dshWbComposerInput:disabled{opacity:.55;cursor:not-allowed;}',
  '.dshWbSendIn{position:absolute;right:6px;bottom:6px;padding:5px 12px;border:1px solid transparent;border-radius:9px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer;}',
  '.dshWbSendIn:disabled{opacity:.5;cursor:not-allowed;}',
  // 输入区下方的次要出口（「回到完整会话」从整行大按钮收成一条小链接，别再抢视觉）
  '.dshWbChatFoot{flex:none;display:flex;justify-content:flex-end;margin-top:6px;}',
  '.dshWbLinkBtn{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;padding:2px 4px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}',
  '.dshWbLinkBtn:hover{color:var(--dsw-alias-label-primary);}',
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
  // 长条形态的收紧：412px 宽里 20/24 的内边距太奢侈；对话列撑满、输入区钉底（原型是一列到底）
  '.dshWbHome[data-wb-shape="strip"] .dshWbHomePanel{padding:10px 12px;gap:8px;}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbChat{width:auto;flex:1;min-height:0;border:none;border-radius:0;background:transparent;padding:0;}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbHomeBody{flex-direction:column;gap:0;}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbChatSessionTitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  // 拼接区（长条右侧那一列）：窗口已由壳加宽，这里只把列摆进去（宽度来自 spliceWidth）
  '.dshWbHomeBody.is-spliced{gap:10px;}',
  '.dshWbSplice{flex:none;min-width:0;display:flex;flex-direction:column;gap:8px;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l1);overflow:auto;}',
  '.dshWbSpliceHead{flex:none;display:flex;align-items:center;gap:8px;}',
  '.dshWbSpliceLabel{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshWbSpliceBody{flex:1;min-height:0;overflow:auto;}',
  '.dshWbSeamItem.is-spliced{border-color:var(--dsw-alias-brand-primary);}',
  '.dshWbBarBtn{flex:none;width:26px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;}',
  '.dshWbBarBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  // 「退出」用文字（不是字形）：它是回主界面的唯一出口，得一眼看懂（2026-10-13 项目所有者问过"怎么回去"）
  '.dshWbBarBtn.is-exit{width:auto;padding:0 10px;font-size:12px;border-color:var(--dsw-alias-border-l2);}',
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
  // 长条·接缝扇形（原型 v2.2：以接缝为轴心、中间那颗顶到最外、逐颗错峰滑入）。
  // 窗外画不了（窗口边界是硬的），所以是**窗内扇形**：收起态 opacity+visibility 双保险
  // （只靠 opacity 还会吃点击），展开态按 --wb-delay 逐颗错峰。
  '.dshWbSeam{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2210;display:flex;align-items:center;pointer-events:auto;}',
  '.dshWbSeamGrip{flex:none;padding:16px 6px;border:1px solid var(--dsw-alias-border-l2);border-right:none;border-radius:9px 0 0 9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;}',
  '.dshWbSeam:hover .dshWbSeamGrip,.dshWbSeam.is-open .dshWbSeamGrip{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}',
  '.dshWbSeamFan{position:absolute;right:0;top:50%;width:0;height:0;}',
  '.dshWbSeamItem{position:absolute;right:0;top:0;margin-top:-14px;display:flex;align-items:center;gap:0;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;opacity:0;visibility:hidden;pointer-events:none;transform:translate(0,calc(var(--wb-y) * 1px));transition:transform .18s ease-out,opacity .18s ease-out,visibility .18s;}',
  '.dshWbSeam.is-open .dshWbSeamItem{opacity:1;visibility:visible;pointer-events:auto;transform:translate(calc(var(--wb-out) * -1px),calc(var(--wb-y) * 1px));transition-delay:var(--wb-delay);}',
  '.dshWbSeamItem:hover,.dshWbSeamItem:focus-visible{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);}',
  '.dshWbSeamItem.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
  '.dshWbSeamGlyph{flex:none;width:28px;height:28px;display:grid;place-items:center;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;}',
  // 状态点（原型 `.st`）+ 当前标记：点表示状态、文字再说明一次（状态不只靠颜色）
  '.dshWbSeamSt{flex:none;width:6px;height:6px;margin-left:6px;border-radius:999px;border:1px solid var(--dsw-alias-label-tertiary);}',
  '.dshWbSeamSt.is-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
  '.dshWbSeamTag{flex:none;margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;font-style:normal;}',
  '.dshWbSeam.is-open .dshWbSeamItem .dshWbSeamTag{display:none;}',
  '.dshWbSeamText{max-width:0;overflow:hidden;opacity:0;transition:max-width .16s ease-out,opacity .16s ease-out;}',
  '.dshWbSeamItem:hover .dshWbSeamText,.dshWbSeamItem:focus-visible .dshWbSeamText{max-width:150px;opacity:1;padding-right:10px;}',
  '.dshWbSeamEmpty{position:absolute;right:34px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;opacity:0;visibility:hidden;transition:opacity .16s ease-out,visibility .16s;}',
  '.dshWbSeam.is-open .dshWbSeamEmpty{opacity:1;visibility:visible;}',
  // 状态条（原型 `.meter`）：三指标 + 上下文进度条 + 模型名
  '.dshWbMeter{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}',
  '.dshWbMeterItem{white-space:nowrap;}',
  '.dshWbMeterBar{flex:none;width:56px;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}',
  '.dshWbMeterBar i{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;}',
  '.dshWbMeterModel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;}',
  // 小条的紧凑状态条（原型 `.mini` 就是"同一条数据换个尺寸"）：贴底、更小字号、去掉进度条
  '.dshWbMeter.is-compact{flex:none;margin:0;padding:6px 14px 8px;border-top:1px solid var(--dsw-alias-border-l1);gap:4px 8px;font-size:10px;line-height:14px;}',
  // 输入区左侧「+」与其弹层（原型 `.plus` / `.sheet`）
  '.dshWbComposer{position:relative;display:flex;align-items:flex-end;gap:8px;}',
  '.dshWbPlus{flex:none;width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;}',
  '.dshWbPlus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbSheet{position:absolute;left:0;bottom:38px;z-index:2;display:flex;flex-direction:column;gap:2px;min-width:180px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.28);}',
  '.dshWbSheetCap{padding:2px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);}',
  '.dshWbSheetItem{display:block;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;text-align:left;cursor:pointer;}',
  '.dshWbSheetItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.dshWbSheetItem.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
  '.dshWbSheetItem:disabled{opacity:.5;cursor:not-allowed;}',
  '.dshWbSheetSep{height:1px;margin:6px 4px;background:var(--dsw-alias-border-l1);}',
  '.dshWbSheetEmpty{padding:4px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
  // 对话里的日期分隔（原型 `.day`）
  '.dshWbChatDay{align-self:center;padding:2px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-tertiary);}',
].join('')

export function ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
