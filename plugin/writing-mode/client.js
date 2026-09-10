/**
 * Browser half of @dsh-local/writing-mode.
 *
 * shell.overlay 挂全屏写作工作台：
 *   关闭态 → 右下角浮动切换钮
 *   打开态 → 三栏（项目树 / 专注编辑器 / AI 助手）
 * 文档库 = 用户可配置多根（~/.dsh/writing-mode.json，经 host /api/writing-mode）。
 */
window.__ModuleLoader__.load({
  id: '@dsh-local/writing-mode',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    if (window.__dshWritingModeLoaded === true) {
      exports.name = 'writing-mode'
      exports.apply = function () {}
      exports.inject = []
      return module.exports
    }
    window.__dshWritingModeLoaded = true

    const react = require('react')
    const jsx = require('react/jsx-runtime')
    const API = '/api/writing-mode'
    const LS_KEY = 'dsh-writing-mode-active'
    const LS_FILE = 'dsh-writing-mode-file'

    const zh = {
      toggle: '写作模式',
      exit: '退出写作',
      docs: '文档库',
      newDoc: '新建',
      untitled: '未命名',
      save: '保存',
      saved: '已保存',
      saving: '保存中…',
      delete: '删除',
      confirmDelete: '删除这篇文档？',
      ai: 'AI 助手',
      polish: '润色',
      continue: '续写',
      outline: '大纲',
      compress: '压缩',
      expand: '扩写',
      research: '找资料',
      spark: '灵感',
      insert: '插入文末',
      replaceSel: '替换选区',
      sendChat: '发送到会话',
      applying: '处理中…',
      noText: '先选中或写点内容',
      aiUnavailable: '内核未提供 LLM 服务，可「发送到会话」由主对话完成。',
      empty: '还没有库根。点 + 选择写作文件夹（例如 E:\\剧本）。',
      emptyCta: '一键加入 E:\\剧本',
      noProjects: '该库下没有含 project.md 的项目。可打开任意 .md / .fountain。',
      focus: '专注',
      chars: '字',
      words: '字数',
      openAi: 'AI',
      closeAi: '收 AI',
      gates: '门禁',
      gateShort: '门禁',
      runGates: '跑门禁',
      gatesPass: '全部通过',
      gatesFail: '{n} 项未达标',
      gatesNone: '不支持该类型',
      gatesIdle: '打开 .md / .fountain 后可跑门禁',
      saveAsNew: '另存为新版',
      bumpHint: '按文件名生成 v(N+1)，保留旧稿',
      hideLib: '收起库',
      showLib: '展开库',
      search: '搜索文件…',
      openLatest: '打开最新版',
      isHistory: '历史稿',
      isLatest: '当前版',
      versions: '版本',
      comparePrev: '对比上一版',
      closeDiff: '关闭对比',
      diffTitle: '与上一版对比',
      reviewFix: '按此评审改稿',
      ledger: '台账速览',
      ledgerHook: '当前钩子',
      ledgerFores: '伏笔未兑现',
      ledgerReview: '最新评审',
      ledgerTimeline: '时间线尾条',
      ledgerNone: '打开项目内文件后显示',
      addRoot: '添加库…',
      switchRoot: '切换库',
      removeRoot: '移除',
      missing: '路径失效',
      unsaved: '未保存',
      pathLabel: '路径',
      suggestRoot: '建议加入库：',
      addSuggest: '加入库',
      copyPath: '复制路径',
      copied: '已复制',
    }
    const en = {
      toggle: 'Writing',
      exit: 'Exit writing',
      docs: 'Library',
      newDoc: 'New',
      untitled: 'Untitled',
      save: 'Save',
      saved: 'Saved',
      saving: 'Saving…',
      delete: 'Delete',
      confirmDelete: 'Delete this document?',
      ai: 'Assistant',
      polish: 'Polish',
      continue: 'Continue',
      outline: 'Outline',
      compress: 'Compress',
      expand: 'Expand',
      research: 'Research',
      spark: 'Sparks',
      insert: 'Append',
      replaceSel: 'Replace selection',
      sendChat: 'Send to chat',
      applying: 'Working…',
      noText: 'Select or write something first',
      aiUnavailable: 'No LLM service; use Send to chat instead.',
      empty: 'No library root. Click + to pick a folder (e.g. E:\\剧本).',
      emptyCta: 'Add E:\\剧本',
      noProjects: 'No project.md under this root. You can still open any .md / .fountain.',
      focus: 'Focus',
      chars: 'chars',
      words: 'Words',
      openAi: 'AI',
      closeAi: 'Hide AI',
      gates: 'Gates',
      gateShort: 'Gate',
      runGates: 'Run gates',
      gatesPass: 'All pass',
      gatesFail: '{n} failed',
      gatesNone: 'Unsupported type',
      gatesIdle: 'Open .md / .fountain to run gates',
      saveAsNew: 'Save as v+1',
      bumpHint: 'Create -v(N+1) keeping the old draft',
      hideLib: 'Hide library',
      showLib: 'Show library',
      search: 'Search files…',
      openLatest: 'Open latest',
      isHistory: 'History',
      isLatest: 'Current',
      versions: 'Versions',
      comparePrev: 'Diff vs prev',
      closeDiff: 'Close diff',
      diffTitle: 'Diff vs previous',
      reviewFix: 'Fix from review',
      ledger: 'Ledger',
      ledgerHook: 'Chapter hook',
      ledgerFores: 'Open foreshadows',
      ledgerReview: 'Latest review',
      ledgerTimeline: 'Timeline tail',
      ledgerNone: 'Open a project file',
      addRoot: 'Add library…',
      switchRoot: 'Library',
      removeRoot: 'Remove',
      missing: 'Missing',
      unsaved: 'Unsaved',
      pathLabel: 'Path',
      suggestRoot: 'Suggested library:',
      addSuggest: 'Add',
      copyPath: 'Copy path',
      copied: 'Copied',
    }

    function pickLocale() {
      try {
        const lang = String(navigator.language || '').toLowerCase()
        return lang.startsWith('zh') ? zh : en
      } catch {
        return zh
      }
    }
    const T = pickLocale()

    const CSS = [
      /* 写作台打开：藏自有浮钮 + PALIS 浮钮/状态条，避免叠层 */
      'html[data-writing-mode="on"] #dsh-writing-mode-float{display:none !important;}',
      'html[data-writing-mode="on"] .ptp-float{display:none !important;}',
      'html[data-writing-mode="on"] #palis-theme-float,',
      'html[data-writing-mode="on"] #palis-float,',
      'html[data-writing-mode="on"] .palis-float,',
      'html[data-writing-mode="on"] .ptp-status,',
      'html[data-writing-mode="on"] #palis-status,',
      'html[data-writing-mode="on"] [data-palis-status],',
      'html[data-writing-mode="on"] .palis-statusbar{display:none !important;}',

      '.dshWmFloat{',
      '  position:fixed;right:18px;bottom:18px;z-index:95;',
      '  display:inline-flex;align-items:center;gap:6px;',
      '  height:34px;padding:0 14px;border-radius:999px;cursor:pointer;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-3);',
      '  color:var(--dsw-alias-label-secondary);',
      '  font:inherit;font-size:12px;line-height:1;',
      '  box-shadow:0 4px 16px rgba(0,0,0,.16);',
      '}',
      '.dshWmFloat:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',

      /* 压住 PALIS 状态条 / 更高层 UI */
      '.dshWmRoot{',
      '  position:fixed;top:0;left:0;right:0;bottom:0;',
      '  z-index:2000 !important;',
      '  display:flex;flex-direction:column;',
      '  background:var(--dsw-alias-bg-base);',
      '  color:var(--dsw-alias-label-primary);',
      '  font-family:var(--dsw-font-sans,var(--ds-font-family-sans,system-ui,sans-serif));',
      '  overflow:hidden;',
      '}',

      /* 顶栏右侧让出系统窗口控件（Win 最小化/最大化/关闭约 120–140px） */
      '.dshWmBar{',
      '  display:flex;align-items:center;gap:8px;',
      '  height:52px;padding:0 148px 0 16px;flex:none;',
      '  border-bottom:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '  box-sizing:border-box;',
      '}',
      '.dshWmBrand{',
      '  font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary);',
      '  padding-right:10px;margin-right:2px;',
      '  border-right:1px solid var(--dsw-alias-border-l2);',
      '  flex:none;',
      '}',
      '.dshWmBarGroup{display:flex;align-items:center;gap:6px;min-width:0;flex:none;}',
      '.dshWmBarSpacer{flex:1;min-width:16px;}',
      '.dshWmSelect{',
      '  font:inherit;font-size:12px;padding:6px 10px;border-radius:8px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);',
      '  max-width:160px;',
      '}',
      '.dshWmBtn{',
      '  font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;',
      '  background:transparent;color:var(--dsw-alias-label-secondary);',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  white-space:nowrap;flex:none;',
      '}',
      '.dshWmBtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmBtn:disabled{opacity:.4;cursor:default;}',
      '.dshWmBtn.is-primary{',
      '  background:var(--dsw-alias-button-primary-fill);',
      '  color:var(--dsw-alias-label-primary-foreground);border-color:transparent;',
      '}',
      '.dshWmBtn.is-ghost{border-color:transparent;padding-left:8px;padding-right:8px;}',
      '.dshWmBtn.is-danger{color:var(--dsw-alias-state-error-primary);}',
      '.dshWmBtn.is-on{',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);',
      '  border-color:var(--dsw-alias-brand-primary);',
      '  color:var(--dsw-alias-label-primary);',
      '}',

      '.dshWmBody{flex:1;display:flex;min-height:0;}',
      '.dshWmSide{',
      '  width:248px;flex:none;display:flex;flex-direction:column;min-height:0;',
      '  border-right:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '}',
      '.dshWmSide.is-ai{width:312px;border-right:none;border-left:1px solid var(--dsw-alias-border-l2);}',
      '.dshWmSideHead{',
      '  display:flex;align-items:center;gap:6px;padding:12px 12px 8px;flex:none;',
      '  font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);',
      '}',
      '.dshWmList{flex:1;overflow:auto;padding:4px 10px 20px;}',
      '.dshWmProj{margin-bottom:12px;}',
      '.dshWmProjToggle{',
      '  display:flex;align-items:center;gap:6px;width:100%;',
      '  padding:8px 8px 4px;border:none;background:transparent;cursor:pointer;',
      '  font:inherit;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);',
      '  text-align:left;',
      '}',
      '.dshWmProjToggle:hover{color:var(--dsw-alias-brand-primary);}',
      '.dshWmProjChev{font-size:10px;color:var(--dsw-alias-label-tertiary);transition:transform .12s;flex:none;}',
      '.dshWmProjChev.is-open{transform:rotate(90deg);}',
      '.dshWmFolder{',
      '  font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;',
      '  color:var(--dsw-alias-label-tertiary);padding:8px 8px 3px;',
      '}',
      '.dshWmSearch{',
      '  width:100%;margin:0 0 8px;padding:7px 10px;border-radius:8px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);',
      '  font:inherit;font-size:12px;outline:none;box-sizing:border-box;',
      '}',
      '.dshWmSearch:focus{border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmItem{',
      '  display:block;width:100%;text-align:left;cursor:pointer;',
      '  padding:7px 8px;margin-bottom:2px;border-radius:8px;border:1px solid transparent;',
      '  background:transparent;color:var(--dsw-alias-label-primary);',
      '  font:inherit;font-size:12.5px;line-height:1.35;box-sizing:border-box;',
      '}',
      '.dshWmItem:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dshWmItem.is-on{',
      '  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent);',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);',
      '}',
      '.dshWmItemRow{display:flex;align-items:baseline;gap:4px;}',
      '.dshWmItemTitle{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}',
      '.dshWmItemMeta{display:block;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}',
      '.dshWmVer{',
      '  display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;flex:none;',
      '  font-size:10px;font-weight:700;line-height:16px;',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);',
      '  color:var(--dsw-alias-brand-primary);',
      '}',
      '.dshWmVer.is-hist{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);}',

      '.dshWmMain{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}',
      '.dshWmDocChrome{flex:none;padding:24px 32px 0;max-width:820px;margin:0 auto;width:100%;box-sizing:border-box;}',
      '.dshWmPathRow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;}',
      '.dshWmPathText{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshWmDocName{margin:10px 0 4px;font-size:22px;font-weight:650;line-height:1.3;}',
      '.dshWmDocRule{height:1px;margin:12px 0 0;background:var(--dsw-alias-border-l2);}',
      '.dshWmHistBanner{',
      '  display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 12px;',
      '  border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
      '  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#c9a227) 12%,transparent);',
      '  font-size:12px;',
      '}',
      '.dshWmVerBar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;}',
      '.dshWmVerBarLabel{font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmVerChip{',
      '  font:inherit;font-size:11px;padding:3px 8px;border-radius:999px;cursor:pointer;',
      '  border:1px solid var(--dsw-alias-border-l2);background:transparent;',
      '  color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmVerChip:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmVerChip.is-on{',
      '  border-color:var(--dsw-alias-brand-primary);',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);',
      '  color:var(--dsw-alias-label-primary);font-weight:600;',
      '}',
      '.dshWmEditorWrap{flex:1;min-height:0;display:flex;justify-content:center;}',
      '.dshWmEditor{',
      '  flex:1;min-height:0;max-width:820px;width:100%;',
      '  resize:none;outline:none;border:none;box-sizing:border-box;',
      '  padding:20px 32px 48px;',
      '  font-family:"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",Georgia,serif;',
      '  font-size:var(--dsh-wm-font-size,17px);',
      '  line-height:var(--dsh-wm-line-height,1.95);letter-spacing:.02em;',
      '  color:var(--dsw-alias-label-primary);background:transparent;',
      '}',
      '.dshWmStatus{',
      '  flex:none;height:32px;display:flex;align-items:center;gap:10px;padding:0 16px;',
      '  border-top:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '  font-size:11px;color:var(--dsw-alias-label-tertiary);',
      '}',
      '.dshWmStatus .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);}',
      '.dshWmStatus .dot.is-dirty{background:var(--dsw-alias-state-warning-primary,#c9a227);}',
      '.dshWmStatus .dot.is-saved{background:var(--dsw-alias-state-success-primary);}',
      '.dshWmStatusSep{opacity:.35;}',

      '.dshWmAiBody{',
      '  flex:1;display:flex;flex-direction:column;min-height:0;',
      '  padding:8px 12px 20px;gap:8px;overflow:auto;',
      '}',
      '.dshWmAiSection{display:flex;flex-direction:column;gap:8px;}',
      '.dshWmAiSectionTitle{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmAiMain{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;}',
      '.dshWmAiActions{display:flex;flex-wrap:wrap;gap:6px;}',
      '.dshWmAiOut{',
      '  flex:1;min-height:140px;overflow:auto;padding:12px;border-radius:10px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);',
      '  font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;',
      '}',
      '.dshWmAiHint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;}',
      '.dshWmSec{display:flex;flex-direction:column;gap:6px;}',
      '.dshWmSecToggle{',
      '  display:flex;align-items:center;gap:6px;width:100%;',
      '  padding:6px 0;border:none;background:transparent;cursor:pointer;',
      '  font:inherit;font-size:11px;font-weight:700;letter-spacing:.06em;',
      '  text-transform:uppercase;color:var(--dsw-alias-label-tertiary);text-align:left;',
      '}',
      '.dshWmSecToggle:hover{color:var(--dsw-alias-label-primary);}',
      '.dshWmSecBadge{',
      '  margin-left:auto;font-size:10px;font-weight:600;letter-spacing:0;text-transform:none;',
      '  padding:1px 6px;border-radius:999px;',
      '  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmSecBadge.is-pass{color:var(--dsw-alias-state-success-primary);}',
      '.dshWmSecBadge.is-fail{color:var(--dsw-alias-state-error-primary);}',
      '.dshWmGateList{display:flex;flex-direction:column;gap:3px;}',
      '.dshWmGateRow{',
      '  display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:1.45;',
      '  padding:5px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);',
      '}',
      '.dshWmGateRow .ok{color:var(--dsw-alias-state-success-primary);font-weight:700;font-size:10px;flex:none;width:34px;}',
      '.dshWmGateRow .bad{color:var(--dsw-alias-state-error-primary);font-weight:700;font-size:10px;flex:none;width:34px;}',
      '.dshWmGateLabel{color:var(--dsw-alias-label-primary);flex:none;min-width:5em;}',
      '.dshWmGateDetail{color:var(--dsw-alias-label-tertiary);flex:1;word-break:break-word;font-size:11px;}',
      '.dshWmLedger{',
      '  display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:1.55;',
      '  padding:8px 10px;border-radius:10px;',
      '  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
      '  color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmLedgerRow{display:flex;gap:8px;}',
      '.dshWmLedgerK{flex:none;min-width:4.5em;color:var(--dsw-alias-label-tertiary);font-size:11px;}',
      '.dshWmLedgerV{flex:1;word-break:break-word;color:var(--dsw-alias-label-primary);}',
      '.dshWmDiff{',
      '  flex:none;max-height:36%;overflow:auto;',
      '  border-top:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);padding:8px 12px;',
      '}',
      '.dshWmDiffHead{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmDiffLine{',
      '  font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:1.55;',
      '  white-space:pre-wrap;word-break:break-word;padding:1px 6px;border-radius:3px;',
      '}',
      '.dshWmDiffLine.add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);}',
      '.dshWmDiffLine.del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);text-decoration:line-through;}',
      '.dshWmDiffLine.ctx{color:var(--dsw-alias-label-tertiary);}',
      '.dshWmWelcome{',
      '  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;',
      '  gap:14px;padding:40px;text-align:center;color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmWelcomeTitle{font-size:22px;font-weight:650;color:var(--dsw-alias-label-primary);}',
      '.dshWmWelcomeBody{font-size:13px;line-height:1.7;max-width:420px;}',
      '.dshWmEmpty{padding:16px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.6;}',
      '.dshWmFlash{',
      '  position:absolute;left:50%;transform:translateX(-50%);top:60px;z-index:20;',
      '  max-width:70%;padding:8px 14px;border-radius:8px;',
      '  background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 95%,transparent);',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  color:var(--dsw-alias-label-primary);font-size:12px;',
      '  box-shadow:0 4px 16px rgba(0,0,0,.2);',
      '}',

      'body[data-writing-focus="1"] .dshWmSide{display:none;}',
      'body[data-writing-focus="1"] .dshWmEditor{',
      '  font-size:calc(var(--dsh-wm-font-size,17px) + 1px);',
      '  line-height:calc(var(--dsh-wm-line-height,1.95) + 0.1);max-width:720px;',
      '}',
      'body[data-writing-focus="1"] .dshWmDocChrome{max-width:720px;}',
      'body[data-writing-mode][data-writing-lib="0"] .dshWmSide:not(.is-ai){display:none;}',
    ].join('\n')
    const TAG = 'dsh-writing-mode-css'
    if (typeof document !== 'undefined' && !document.getElementById(TAG)) {
      const tag = document.createElement('style')
      tag.id = TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function api(route, opts) {
      const url = route ? `${API}?route=${encodeURIComponent(route)}` : API
      const res = await fetch(url, opts)
      return res.json().catch(() => ({ ok: false }))
    }

    function applyBodyAttr(active) {
      try {
        if (active) document.documentElement.setAttribute('data-writing-mode', 'on')
        else {
          document.documentElement.removeAttribute('data-writing-mode')
          document.body.removeAttribute('data-writing-focus')
          document.body.removeAttribute('data-writing-lib')
        }
      } catch {}
    }

    /* ── 模块级开关（overlay 与侧栏入口共用）── */
    function readActiveLS() {
      try {
        return localStorage.getItem(LS_KEY) === '1'
      } catch {
        return false
      }
    }
    let modeActive = readActiveLS()
    const modeListeners = new Set()
    function setModeActive(next) {
      if (modeActive === next) return
      modeActive = next
      try {
        localStorage.setItem(LS_KEY, next ? '1' : '0')
      } catch {}
      applyBodyAttr(next)
      for (const fn of modeListeners) {
        try {
          fn()
        } catch {}
      }
    }
    function subscribeMode(fn) {
      modeListeners.add(fn)
      return () => modeListeners.delete(fn)
    }
    function getModeActive() {
      return modeActive
    }

    /** 侧栏底部入口：点击切换写作模式。 */
    function WritingModeFooterEntry() {
      const [on, setOn] = react.useState(getModeActive)
      react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
      return jsx.jsx('button', {
        type: 'button',
        className: on ? 'dshWmBtn is-primary' : 'dshWmBtn',
        title: on ? T.exit : T.toggle,
        style: { width: '100%', justifyContent: 'center' },
        onClick: () => setModeActive(!on),
        children: on ? T.exit : T.toggle,
      })
    }

    /** 会话顶栏工具区入口（次要，槽位缺失时静默）。 */
    function WritingModeHeaderEntry() {
      const [on, setOn] = react.useState(getModeActive)
      react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
      return jsx.jsx('button', {
        type: 'button',
        className: 'dshWmBtn',
        title: on ? T.exit : T.toggle,
        onClick: () => setModeActive(!on),
        children: on ? T.exit : T.toggle,
      })
    }

    /** 从文件名提取 -vN。模块级，供组件内 useMemo 使用。 */
    function versionOf(name) {
      const m = String(name || '').match(/-v(\d+)(\.[^.]+)?$/i)
      return m ? Number(m[1]) : null
    }

    const DEFAULT_PREFS = {
      fontSize: 17,
      lineHeight: 1.95,
      autoSaveMs: 800,
      autoGate: true,
      aiMode: 'harness',
      aiProvider: 'deepseek-official',
      aiModel: 'deepseek-v4-flash',
      aiApiKey: '',
    }
    let prefsCache = { ...DEFAULT_PREFS }
    const prefsListeners = new Set()
    function getPrefs() {
      return prefsCache
    }
    function subscribePrefs(fn) {
      prefsListeners.add(fn)
      return () => prefsListeners.delete(fn)
    }
    function notifyPrefs() {
      for (const fn of prefsListeners) {
        try {
          fn()
        } catch {}
      }
    }
    function applyPrefsCss(p) {
      try {
        const el = document.documentElement
        el.style.setProperty('--dsh-wm-font-size', String(p.fontSize) + 'px')
        el.style.setProperty('--dsh-wm-line-height', String(p.lineHeight))
      } catch {}
    }
    async function loadPrefs() {
      try {
        const data = await api('config')
        if (data.ok && data.prefs) {
          prefsCache = { ...DEFAULT_PREFS, ...data.prefs }
          applyPrefsCss(prefsCache)
          notifyPrefs()
        }
      } catch {}
      return prefsCache
    }
    async function savePrefs(patch) {
      prefsCache = { ...prefsCache, ...patch }
      applyPrefsCss(prefsCache)
      notifyPrefs()
      try {
        await api('prefs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
      } catch {}
      return prefsCache
    }
    // 启动时预取一次
    if (typeof window !== 'undefined') {
      void loadPrefs()
    }

    function WritingModeApp() {
      const [active, setActive] = react.useState(getModeActive)
      react.useEffect(() => subscribeMode(() => setActive(getModeActive())), [])
      const open = () => setModeActive(true)
      const close = () => setModeActive(false)
      const [roots, setRoots] = react.useState([])
      const [tree, setTree] = react.useState([])
      const [activeRoot, setActiveRoot] = react.useState(null)
      const [filePath, setFilePath] = react.useState(() => {
        try {
          return localStorage.getItem(LS_FILE) || null
        } catch {
          return null
        }
      })
      const [content, setContent] = react.useState('')
      const [dirty, setDirty] = react.useState(false)
      const [saveState, setSaveState] = react.useState('idle')
      const [aiOpen, setAiOpen] = react.useState(true)
      const [aiOut, setAiOut] = react.useState('')
      const [aiBusy, setAiBusy] = react.useState(false)
      const [aiErr, setAiErr] = react.useState('')
      const [gate, setGate] = react.useState(null)
      const [gateBusy, setGateBusy] = react.useState(false)
      const [gateErr, setGateErr] = react.useState('')
      const [focus, setFocus] = react.useState(false)
      const [libOpen, setLibOpen] = react.useState(true)
      const [libQuery, setLibQuery] = react.useState('')
      const [collapsed, setCollapsed] = react.useState(() => new Set())
      const [copied, setCopied] = react.useState(false)
      const [diffLines, setDiffLines] = react.useState(null)
      const [diffLabel, setDiffLabel] = react.useState('')
      const [ledger, setLedger] = react.useState(null)
      const [gateOpen, setGateOpen] = react.useState(false)
      const [ledgerOpen, setLedgerOpen] = react.useState(false)
      const [newDocMode, setNewDocMode] = react.useState(false)
      const [newDocName, setNewDocName] = react.useState('')
      const [addRootMode, setAddRootMode] = react.useState(false)
      const [addRootPath, setAddRootPath] = react.useState('')
      const [flash, setFlash] = react.useState('')
      const [prefs, setPrefs] = react.useState(getPrefs)
      react.useEffect(() => subscribePrefs(() => setPrefs({ ...getPrefs() })), [])
      react.useEffect(() => {
        void loadPrefs()
      }, [active])
      const taRef = react.useRef(null)
      const saveTimer = react.useRef(0)
      const fileInputRef = react.useRef(null)
      const runGateRef = react.useRef(() => {})

      const docBasename = filePath
        ? String(filePath).split(/[\\/]/).filter(Boolean).pop()
        : ''
      const docFolder = filePath
        ? (() => {
            const parts = String(filePath).split(/[\\/]/).filter(Boolean)
            if (parts.length < 2) return ''
            return parts[parts.length - 2]
          })()
        : ''

      /** 同章版本系列（必须在任何 early-return 之前，遵守 Hooks 规则）。 */
      const versionSeries = react.useMemo(() => {
        if (!filePath) return []
        const curVer = versionOf(docBasename)
        if (curVer == null) return []
        const base = docBasename.replace(/-v\d+(\.[^.]+)?$/i, '')
        const ext = (docBasename.match(/\.[^.]+$/) || [''])[0]
        const out = []
        for (const root of tree) {
          for (const proj of root.projects || []) {
            for (const f of proj.files || []) {
              if (!String(f.rel).startsWith('draft/')) continue
              const n = f.name
              if (!n.startsWith(base + '-v') || !n.toLowerCase().endsWith(ext.toLowerCase())) continue
              const v = versionOf(n)
              if (v == null) continue
              out.push({ v, abs: f.abs, name: n })
            }
          }
        }
        out.sort((a, b) => a.v - b.v)
        return out
      }, [filePath, docBasename, tree])

      const curVerNum = versionOf(docBasename)
      const latestVer =
        versionSeries.length > 0 ? versionSeries[versionSeries.length - 1] : null
      const isHistoryDoc =
        curVerNum != null && latestVer != null && curVerNum < latestVer.v

      react.useEffect(() => {
        applyBodyAttr(active)
      }, [active])

      react.useEffect(() => {
        try {
          if (focus) document.body.setAttribute('data-writing-focus', '1')
          else document.body.removeAttribute('data-writing-focus')
        } catch {}
      }, [focus])

      react.useEffect(() => {
        try {
          document.body.setAttribute('data-writing-lib', libOpen ? '1' : '0')
        } catch {}
      }, [libOpen])

      const refreshTree = react.useCallback(async () => {
        const data = await api('config')
        if (!data.ok) return
        setRoots(data.roots || [])
        setTree(data.tree || [])
        const active =
          (data.config && data.config.activeRoot) ||
          (data.roots || []).find((r) => r.default && !r.missing)?.path ||
          (data.roots || [])[0]?.path ||
          null
        setActiveRoot(active)
      }, [])

      react.useEffect(() => {
        if (!active) return
        void refreshTree()
      }, [active, refreshTree])

      const loadFile = react.useCallback(async (absPath) => {
        if (!absPath) return
        const data = await api('get&path=' + encodeURIComponent(absPath))
        if (data.ok && data.doc) {
          setContent(data.doc.content || '')
          setDirty(false)
          setSaveState('idle')
          setGate(null)
          setGateErr('')
          setLedger(null)
          // 仅在路径真正变化时回写，避免触发 load 死循环
          if (data.doc.path !== absPath) {
            setFilePath(data.doc.path)
          }
          void api('ledger', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: data.doc.path }),
          })
            .then((d) => {
              if (d.ok) setLedger(d.ledger)
            })
            .catch(() => {})
          try {
            localStorage.setItem(LS_FILE, data.doc.path)
          } catch {}
        }
      }, [])

      react.useEffect(() => {
        if (!active || !filePath) return
        void loadFile(filePath)
      }, [active, filePath, loadFile])

      const persist = react.useCallback(async () => {
        if (!filePath) return
        setSaveState('saving')
        const data = await api('save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: filePath, content }),
        })
        if (data.ok && data.doc) {
          setFilePath(data.doc.path)
          setDirty(false)
          setSaveState('saved')
          void refreshTree()
          const ext = String(data.doc.path).toLowerCase().split('.').pop()
          if (
            getPrefs().autoGate &&
            (ext === 'md' || ext === 'markdown' || ext === 'fountain')
          ) {
            try {
              runGateRef.current()
            } catch {}
          }
        } else {
          setSaveState('idle')
        }
      }, [filePath, content, refreshTree])

      /** 文件名 vN → vN+1（无版本号则追加 -v2）。返回新绝对路径或 null。 */
      function nextVersionPath(abs) {
        if (!abs) return null
        const m = String(abs).match(/^(.*?)(-v(\d+))?(\.[^.]+)$/i)
        if (!m) return null
        const [, base, , ver, ext] = m
        const n = ver ? Number(ver) + 1 : 2
        return `${base}-v${n}${ext}`
      }

      async function saveAsNewVersion() {
        if (!filePath) return
        const next = nextVersionPath(filePath)
        if (!next) return
        setSaveState('saving')
        const data = await api('save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: next, content }),
        })
        if (data.ok && data.doc) {
          setFilePath(data.doc.path)
          setDirty(false)
          setSaveState('saved')
          void refreshTree()
          try {
            localStorage.setItem(LS_FILE, data.doc.path)
          } catch {}
        } else {
          setSaveState('idle')
        }
      }

      react.useEffect(() => {
        if (!active || !dirty || !filePath) return
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          void persist()
        }, prefs.autoSaveMs || 800)
        return () => window.clearTimeout(saveTimer.current)
      }, [active, dirty, filePath, persist, prefs.autoSaveMs])

      react.useEffect(() => {
        if (!active) return
        const onKey = (e) => {
          if (e.key === 'Escape') {
            close()
            return
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            if (e.shiftKey) void saveAsNewVersion()
            else if (filePath) void persist()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [active, filePath, persist])

      function flashMsg(msg) {
        setFlash(String(msg || ''))
        window.setTimeout(() => setFlash(''), 3200)
      }

      async function addRootFromPrompt() {
        // Electron 下 window.prompt 常无反馈，改内联输入
        setAddRootMode(true)
        setAddRootPath('')
      }

      async function commitAddRoot() {
        const p = String(addRootPath || '').trim()
        if (!p) return
        const data = await api('roots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'add', path: p, active: true }),
        })
        setAddRootMode(false)
        setAddRootPath('')
        if (!data.ok) flashMsg('添加库失败：' + (data.error || 'unknown'))
        void refreshTree()
      }

      async function activateRoot(p) {
        setActiveRoot(p)
        await api('roots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'activate', path: p }),
        })
        void refreshTree()
      }

      function pickNativeFolder() {
        // webkitdirectory 在 Electron 不可靠：直接走内联路径输入
        setAddRootMode(true)
        setAddRootPath('')
      }

      function createDocInRoot() {
        const root =
          roots.find((r) => r.path === activeRoot && !r.missing) ||
          roots.find((r) => !r.missing)
        if (!root) {
          setAddRootMode(true)
          flashMsg('先添加一个库文件夹')
          return
        }
        setNewDocMode(true)
        setNewDocName(T.untitled)
      }

      function commitNewDoc() {
        const root =
          roots.find((r) => r.path === activeRoot && !r.missing) ||
          roots.find((r) => !r.missing)
        if (!root) return
        const name = (newDocName || T.untitled).trim() || T.untitled
        const base = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || T.untitled
        const stamp = Date.now().toString(36)
        const abs = root.path.replace(/[\\/]+$/, '') + '\\' + base + '-' + stamp + '.md'
        setContent('# ' + name + '\n\n')
        setFilePath(abs)
        setDirty(true)
        setSaveState('idle')
        setNewDocMode(false)
        setNewDocName('')
        try {
          taRef.current && taRef.current.focus()
        } catch {}
      }

      function selectionText() {
        const ta = taRef.current
        if (!ta) return content.slice(0, 4000)
        const s = ta.selectionStart
        const e = ta.selectionEnd
        if (typeof s === 'number' && typeof e === 'number' && e > s) {
          return content.slice(s, e)
        }
        return content.slice(Math.max(0, (s || 0) - 400), (s || 0) + 1600) || content.slice(0, 2000)
      }

      async function runAssist(action) {
        const isRec = action === 'research' || action === 'spark'
        const text = selectionText()
        if (!isRec && !text.trim()) {
          setAiErr(T.noText)
          flashMsg(T.noText)
          return
        }
        setAiBusy(true)
        setAiErr('')
        setAiOut('')
        try {
          const data = await api('assist', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action,
              text: text || content.slice(0, 4000),
              path: filePath,
              style: action === 'spark' ? 'spark' : 'research',
            }),
          })
          if (data.ok) {
            setAiOut(data.result || '')
            return
          }
          if (data.error === 'llm-unavailable') {
            // 内核未挂 llm：给出可发送会话的提示，避免「点了没反应」
            const tip =
              T.aiUnavailable +
              '\n\n【可直接发送到会话】\n请作为写作助手，对下列文本做「' +
              (T[action] || action) +
              '」：\n\n' +
              (text || content).slice(0, 2000)
            setAiOut(tip)
            setAiErr(T.aiUnavailable)
            flashMsg(T.aiUnavailable)
            return
          }
          setAiErr(String(data.error || 'failed'))
          flashMsg(String(data.error || 'failed'))
        } catch (err) {
          const m = String(err && err.message ? err.message : err)
          setAiErr(m)
          flashMsg(m)
        } finally {
          setAiBusy(false)
        }
      }

      const runGate = react.useCallback(async () => {
        setGateBusy(true)
        setGateErr('')
        try {
          const data = await api('gate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: filePath, content }),
          })
          if (data.ok && data.gate) {
            setGate(data.gate)
            if (data.gate.kind === 'none') setGateErr(T.gatesNone)
          } else {
            setGateErr(String(data.error || 'failed'))
          }
        } catch (err) {
          setGateErr(String(err && err.message ? err.message : err))
        } finally {
          setGateBusy(false)
        }
      }, [filePath, content])
      runGateRef.current = runGate

      // 打开文件后自动跑一次门禁
      react.useEffect(() => {
        if (!active || !filePath) return
        const ext = String(filePath).toLowerCase().split('.').pop()
        if (ext !== 'md' && ext !== 'markdown' && ext !== 'fountain') return
        void runGate()
      }, [active, filePath]) // 故意不含 content：只在打开时跑

      function applyInsert() {
        if (!aiOut) return
        setContent((c) => (c.endsWith('\n') ? c : c + '\n') + '\n' + aiOut + '\n')
        setDirty(true)
      }

      function applyReplace() {
        if (!aiOut) return
        const ta = taRef.current
        if (!ta) {
          setContent(aiOut)
          setDirty(true)
          return
        }
        const s = ta.selectionStart
        const e = ta.selectionEnd
        if (typeof s === 'number' && typeof e === 'number' && e > s) {
          setContent(content.slice(0, s) + aiOut + content.slice(e))
        } else {
          setContent(aiOut)
        }
        setDirty(true)
      }

      async function copyPath() {
        if (!filePath) return
        try {
          await navigator.clipboard.writeText(filePath)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        } catch {}
      }

      if (!active) {
        // 浮动入口由 ensureDomFloat 常驻注入；overlay 空闲时不重复渲染
        // 注意：此 return 必须位于**全部 hooks 之后**
        return null
      }

      const activeTree = tree.find((r) => {
        if (!activeRoot) return false
        return String(r.path).toLowerCase() === String(activeRoot).toLowerCase()
      }) || tree.find((r) => r.active) || tree[0]

      const projects = activeTree ? activeTree.projects || [] : []

      /** 把 rel 路径按顶层目录分组；q 非空时按文件名/路径过滤。 */
      function groupFiles(files, q) {
        const query = String(q || '').trim().toLowerCase()
        const map = new Map()
        for (const f of files || []) {
          if (query) {
            const hay = (f.name + ' ' + f.rel).toLowerCase()
            if (!hay.includes(query)) continue
          }
          const top = String(f.rel || '').includes('/')
            ? String(f.rel).split('/')[0]
            : '·'
          if (!map.has(top)) map.set(top, [])
          map.get(top).push(f)
        }
        const order = ['draft', 'bible', 'outline', 'state', 'reviews', '·']
        const keys = [...map.keys()].sort((a, b) => {
          const ia = order.indexOf(a)
          const ib = order.indexOf(b)
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'zh')
        })
        return keys.map((k) => ({ key: k, files: map.get(k) }))
      }

      function maxVersionInGroup(files) {
        let max = 0
        for (const f of files || []) {
          const v = versionOf(f.name)
          if (v != null && v > max) max = v
        }
        return max
      }

      function toggleProj(key) {
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      // 文件行（带版本徽标）
      function fileButton(f, maxVer) {
        const ver = versionOf(f.name)
        const isHist = ver != null && maxVer > 0 && ver < maxVer
        return jsx.jsx(
          'button',
          {
            type: 'button',
            className: 'dshWmItem' + (filePath && f.abs === filePath ? ' is-on' : ''),
            onClick: () => setFilePath(f.abs),
            title: f.rel,
            children: [
              jsx.jsx(
                'div',
                {
                  className: 'dshWmItemRow',
                  children: [
                    jsx.jsx(
                      'span',
                      {
                        className: 'dshWmItemTitle',
                        style: { flex: 1, minWidth: 0 },
                        children: f.name.replace(/-v\d+(\.[^.]+)?$/i, '$1'),
                      },
                      't'
                    ),
                    ver != null
                      ? jsx.jsx(
                          'span',
                          {
                            className: 'dshWmVer' + (isHist ? ' is-hist' : ''),
                            children: 'v' + ver,
                          },
                          'v'
                        )
                      : null,
                  ],
                },
                'row'
              ),
              jsx.jsx(
                'span',
                { className: 'dshWmItemMeta', children: f.chars + T.chars },
                'm'
              ),
            ],
          },
          f.abs
        )
      }

      /** 极简行 diff：前后缀对齐，中间段整段 del/add（章稿对比够用）。 */
      function lineDiff(oldText, newText) {
        const a = String(oldText || '').split(/\r?\n/)
        const b = String(newText || '').split(/\r?\n/)
        let p = 0
        while (p < a.length && p < b.length && a[p] === b[p]) p++
        let s = 0
        while (
          s < a.length - p &&
          s < b.length - p &&
          a[a.length - 1 - s] === b[b.length - 1 - s]
        ) {
          s++
        }
        const out = []
        const ctx = 2
        for (const line of a.slice(Math.max(0, p - ctx), p)) out.push({ t: 'ctx', line })
        for (const line of a.slice(p, a.length - s)) out.push({ t: 'del', line })
        for (const line of b.slice(p, b.length - s)) out.push({ t: 'add', line })
        for (const line of a.slice(a.length - s, a.length - s + Math.min(s, ctx))) {
          out.push({ t: 'ctx', line })
        }
        return out
      }

      async function comparePrev() {
        if (curVerNum == null || versionSeries.length < 2) return
        const idx = versionSeries.findIndex((s) => s.abs === filePath)
        const prev = versionSeries[idx - 1]
        if (!prev) return
        const a = await api('get&path=' + encodeURIComponent(prev.abs))
        const b = await api('get&path=' + encodeURIComponent(filePath))
        if (!a.ok || !b.ok) return
        setDiffLines(lineDiff(a.doc.content, b.doc.content))
        setDiffLabel(`v${prev.v} → v${curVerNum}`)
      }

      const isReviewFile = /(^|[\\/])reviews[\\/]/i.test(String(filePath || ''))

      function fillComposer(prompt) {
        try {
          const ta = document.querySelector(
            '[data-composer-seat] textarea, [data-composer-input]'
          )
          if (!ta) return false
          const proto =
            ta.tagName === 'TEXTAREA'
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          if (setter) setter.call(ta, prompt)
          else ta.value = prompt
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          ta.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        } catch {
          return false
        }
      }

      function sendToChat() {
        const payload = aiOut || selectionText()
        const prompt = payload
          ? `请作为写作助手处理下面的文稿：\n\n${payload}`
          : `请作为写作助手，帮我完善当前文稿。`
        const ok = fillComposer(prompt)
        if (!ok) {
          flashMsg('未找到主输入框，请手动复制文本到会话')
          setAiErr('未找到主输入框，请手动复制')
          return
        }
        flashMsg('已填入主会话输入框')
        close()
      }

      function sendReviewToChat() {
        const prompt =
          '请作为写作主理，严格按下列评审报告修订对应文稿（只改 draft/bible/outline/state，报告本身不要改）。\n' +
          '先读报告与 draft 当前版本，再输出修改计划并执行；完成后把新版本号写入 project.md。\n\n' +
          '=== 评审报告 ===\n' +
          content +
          '\n\n=== 报告路径 ===\n' +
          filePath +
          '\n'
        const ok = fillComposer(prompt)
        if (!ok) {
          flashMsg('未找到主输入框，请手动复制评审内容')
          return
        }
        close()
      }

      return jsx.jsx('div', {
        className: 'dshWmRoot',
        role: 'dialog',
        'aria-label': T.toggle,
        children: [
          flash
            ? jsx.jsx('div', { className: 'dshWmFlash', children: flash }, 'flash')
            : null,
          jsx.jsx(
            'div',
            {
              className: 'dshWmBar',
              children: [
                jsx.jsx('span', { className: 'dshWmBrand', children: '写作台' }),
                roots.length > 0
                  ? jsx.jsx(
                      'select',
                      {
                        className: 'dshWmSelect',
                        value: activeRoot || '',
                        onChange: (e) => void activateRoot(e.target.value),
                        title: T.switchRoot,
                        children: roots.map((r) =>
                          jsx.jsx(
                            'option',
                            {
                              value: r.path,
                              children: (r.missing ? '⚠ ' : '') + (r.label || r.path),
                            },
                            r.path
                          )
                        ),
                      },
                      'roots'
                    )
                  : null,
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-ghost',
                  onClick: () => setAddRootMode(true),
                  title: T.addRoot,
                  children: '+',
                }),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-ghost',
                  onClick: () => setAddRootMode(true),
                  children: '…',
                  title: T.addRoot,
                }),
                addRootMode
                  ? jsx.jsx(
                      'span',
                      {
                        className: 'dshWmBarGroup',
                        children: [
                          jsx.jsx('input', {
                            className: 'dshWmSearch',
                            style: { width: 180, margin: 0 },
                            value: addRootPath,
                            placeholder: 'E:\\剧本',
                            autoFocus: true,
                            onChange: (e) => setAddRootPath(e.target.value),
                            onKeyDown: (e) => {
                              if (e.key === 'Enter') void commitAddRoot()
                              if (e.key === 'Escape') setAddRootMode(false)
                            },
                          }),
                          jsx.jsx('button', {
                            type: 'button',
                            className: 'dshWmBtn is-primary',
                            onClick: () => void commitAddRoot(),
                            children: 'OK',
                          }),
                        ],
                      },
                      'add-root'
                    )
                  : null,
                jsx.jsx('span', { className: 'dshWmBarSpacer' }),
                jsx.jsx(
                  'div',
                  {
                    className: 'dshWmBarGroup',
                    children: [
                      jsx.jsx('button', {
                        type: 'button',
                        className: 'dshWmBtn is-ghost',
                        onClick: () => setLibOpen((v) => !v),
                        title: libOpen ? T.hideLib : T.showLib,
                        children: libOpen ? '⟨' : '⟩',
                      }),
                      jsx.jsx('button', {
                        type: 'button',
                        className: 'dshWmBtn' + (focus ? ' is-on' : ''),
                        onClick: () => setFocus((v) => !v),
                        children: T.focus,
                      }),
                      jsx.jsx('button', {
                        type: 'button',
                        className: 'dshWmBtn' + (aiOpen ? ' is-on' : ''),
                        onClick: () => setAiOpen((v) => !v),
                        children: aiOpen ? T.closeAi : T.openAi,
                      }),
                    ],
                  },
                  'views'
                ),
                jsx.jsx('span', { className: 'dshWmBarGroup', children: [
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn',
                    disabled: !filePath,
                    onClick: () => void persist(),
                    children: saveState === 'saving' ? T.saving : saveState === 'saved' ? T.saved : T.save,
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn',
                    disabled: !filePath,
                    title: T.bumpHint || T.saveAsNew,
                    onClick: () => void saveAsNewVersion(),
                    children: 'v+1',
                  }),
                ]}, 'file-ops'),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-primary',
                  onClick: close,
                  children: T.exit,
                }),
              ],
            },
            'bar'
          ),
          jsx.jsx(
            'div',
            {
              className: 'dshWmBody',
              children: [
                jsx.jsx(
                  'aside',
                  {
                    className: 'dshWmSide',
                    children: [
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmSideHead',
                          children: [
                            jsx.jsx('span', { children: T.docs }),
                            jsx.jsx('span', { style: { flex: 1 } }),
                            jsx.jsx('button', {
                              type: 'button',
                              className: 'dshWmBtn',
                              onClick: createDocInRoot,
                              children: T.newDoc,
                            }),
                          ],
                        },
                        'dh'
                      ),
                      newDocMode
                        ? jsx.jsx(
                            'div',
                            {
                              style: { display: 'flex', gap: 6, padding: '0 10px 8px' },
                              children: [
                                jsx.jsx('input', {
                                  className: 'dshWmSearch',
                                  style: { margin: 0, flex: 1 },
                                  value: newDocName,
                                  autoFocus: true,
                                  placeholder: T.untitled,
                                  onChange: (e) => setNewDocName(e.target.value),
                                  onKeyDown: (e) => {
                                    if (e.key === 'Enter') commitNewDoc()
                                    if (e.key === 'Escape') setNewDocMode(false)
                                  },
                                }),
                                jsx.jsx('button', {
                                  type: 'button',
                                  className: 'dshWmBtn is-primary',
                                  onClick: commitNewDoc,
                                  children: 'OK',
                                }),
                              ],
                            },
                            'new-doc'
                          )
                        : null,
                      roots.length > 0
                        ? jsx.jsx(
                            'div',
                            {
                              style: { padding: '8px 8px 0' },
                              children: jsx.jsx('input', {
                                className: 'dshWmSearch',
                                value: libQuery,
                                placeholder: T.search,
                                onChange: (e) => setLibQuery(e.target.value),
                              }),
                            },
                            'sq'
                          )
                        : null,
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmList',
                          children:
                            roots.length === 0
                              ? jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmWelcome',
                                    children: [
                                      jsx.jsx(
                                        'div',
                                        { className: 'dshWmWelcomeTitle', children: T.toggle },
                                        'wt'
                                      ),
                                      jsx.jsx(
                                        'div',
                                        { className: 'dshWmWelcomeBody', children: T.empty },
                                        'wb'
                                      ),
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'dshWmBtn is-primary',
                                          onClick: () => {
                                            setAddRootMode(true)
                                            setAddRootPath('E:\\剧本')
                                          },
                                          children: T.emptyCta,
                                        },
                                        'wc'
                                      ),
                                      jsx.jsx(
                                        'div',
                                        {
                                          className: 'dshWmAiHint',
                                          children: 'Esc · Ctrl+S · Ctrl+Shift+S',
                                        },
                                        'wk'
                                      ),
                                    ],
                                  },
                                  'wel'
                                )
                              : projects.length === 0
                                ? jsx.jsx('div', {
                                    className: 'dshWmEmpty',
                                    children: (activeTree && activeTree.missing ? T.missing + '\n' : '') + T.noProjects,
                                  })
                                : projects.map((proj) => {
                                    const groups = groupFiles(proj.files, libQuery)
                                    const openP = !collapsed.has(proj.path)
                                    const maxDraft = maxVersionInGroup(
                                      (proj.files || []).filter((f) => String(f.rel).startsWith('draft/'))
                                    )
                                    if (libQuery && groups.length === 0) return null
                                    return jsx.jsx(
                                      'div',
                                      {
                                        className: 'dshWmProj',
                                        children: [
                                          jsx.jsx(
                                            'button',
                                            {
                                              type: 'button',
                                              className: 'dshWmProjToggle',
                                              onClick: () => toggleProj(proj.path),
                                              children: [
                                                jsx.jsx(
                                                  'span',
                                                  {
                                                    className:
                                                      'dshWmProjChev' + (openP ? ' is-open' : ''),
                                                    children: '▸',
                                                  },
                                                  'c'
                                                ),
                                                jsx.jsx('span', { children: proj.name }, 'n'),
                                              ],
                                            },
                                            'pt'
                                          ),
                                          openP
                                            ? groups.map((g) =>
                                                jsx.jsx(
                                                  react.Fragment,
                                                  {
                                                    children: [
                                                      jsx.jsx(
                                                        'div',
                                                        {
                                                          className: 'dshWmFolder',
                                                          children: g.key === '·' ? 'ROOT' : g.key,
                                                        },
                                                        'fh'
                                                      ),
                                                      ...g.files.map((f) =>
                                                        fileButton(
                                                          f,
                                                          g.key === 'draft' || String(f.rel).includes('/draft/')
                                                            ? maxDraft
                                                            : 0
                                                        )
                                                      ),
                                                    ],
                                                  },
                                                  'g-' + g.key
                                                )
                                              )
                                            : null,
                                        ],
                                      },
                                      proj.path
                                    )
                                  }),
                        },
                        'dl'
                      ),
                    ],
                  },
                  'docs'
                ),
                jsx.jsx(
                  'main',
                  {
                    className: 'dshWmMain',
                    children: [
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmDocChrome',
                          children: [
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmPathRow',
                                children: [
                                  jsx.jsx('span', {
                                    className: 'dshWmPathText',
                                    children: filePath ? (docFolder ? docFolder + ' / ' : '') + docBasename : '—',
                                  }),
                                  filePath
                                    ? jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn is-ghost',
                                        onClick: () => void copyPath(),
                                        children: copied ? T.copied : T.copyPath,
                                      })
                                    : null,
                                  isReviewFile
                                    ? jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn',
                                        onClick: sendReviewToChat,
                                        children: T.reviewFix,
                                      })
                                    : null,
                                ],
                              },
                              'pr'
                            ),
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmDocName',
                                children:
                                  (docBasename || T.untitled).replace(/-v\d+(\.[^.]+)?$/i, '$1') +
                                  (curVerNum != null ? '  v' + curVerNum : ''),
                              },
                              'dn'
                            ),
                            isHistoryDoc && latestVer
                              ? jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmHistBanner',
                                    children: [
                                      jsx.jsx('span', {
                                        children: T.isHistory + ' · ' + T.isLatest + ' v' + latestVer.v,
                                      }, 'h'),
                                      jsx.jsx('span', { style: { flex: 1 } }),
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn',
                                        onClick: () => setFilePath(latestVer.abs),
                                        children: T.openLatest,
                                      }),
                                    ],
                                  },
                                  'hb'
                                )
                              : null,
                            versionSeries.length > 1
                              ? jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmVerBar',
                                    children: [
                                      jsx.jsx(
                                        'span',
                                        { className: 'dshWmVerBarLabel', children: T.versions },
                                        'vl'
                                      ),
                                      ...versionSeries.map((s) =>
                                        jsx.jsx(
                                          'button',
                                          {
                                            type: 'button',
                                            className:
                                              'dshWmVerChip' +
                                              (s.abs === filePath ? ' is-on' : ''),
                                            onClick: () => setFilePath(s.abs),
                                            children: 'v' + s.v,
                                          },
                                          'v' + s.v
                                        )
                                      ),
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'dshWmBtn is-ghost',
                                          disabled: curVerNum == null || versionSeries.length < 2,
                                          onClick: () => void comparePrev(),
                                          children: T.comparePrev,
                                        },
                                        'cmp'
                                      ),
                                    ],
                                  },
                                  'vb'
                                )
                              : null,
                            jsx.jsx('div', { className: 'dshWmDocRule' }, 'dr'),
                          ],
                        },
                        'chrome'
                      ),
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmEditorWrap',
                          children: jsx.jsx('textarea', {
                            ref: taRef,
                            className: 'dshWmEditor',
                            value: content,
                            spellCheck: false,
                            placeholder: filePath ? '开始写…' : '# …',
                            onChange: (e) => {
                              setContent(e.target.value)
                              setDirty(true)
                            },
                          }),
                        },
                        'ew'
                      ),
                      diffLines
                        ? jsx.jsx(
                            'div',
                            {
                              className: 'dshWmDiff',
                              children: [
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmDiffHead',
                                    children: [
                                      jsx.jsx('span', {
                                        children: T.diffTitle + ' ' + diffLabel,
                                      }),
                                      jsx.jsx('span', { style: { flex: 1 } }),
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn is-ghost',
                                        onClick: () => setDiffLines(null),
                                        children: T.closeDiff,
                                      }),
                                    ],
                                  },
                                  'dh'
                                ),
                                ...diffLines.map((d, i) =>
                                  jsx.jsx(
                                    'div',
                                    {
                                      className: 'dshWmDiffLine ' + d.t,
                                      children: (d.t === 'add' ? '+ ' : d.t === 'del' ? '- ' : '  ') + d.line,
                                    },
                                    'L' + i
                                  )
                                ),
                              ],
                            },
                            'diff'
                          )
                        : null,
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmStatus',
                          children: [
                            jsx.jsx('span', {
                              className:
                                'dot ' + (dirty ? 'is-dirty' : saveState === 'saved' ? 'is-saved' : ''),
                            }),
                            jsx.jsx('span', {
                              children: dirty ? T.unsaved : saveState === 'saved' ? T.saved : '—',
                            }),
                            jsx.jsx('span', { className: 'dshWmStatusSep', children: '·' }),
                            jsx.jsx('span', {
                              children: `${content.replace(/\s+/g, '').length} ${T.chars}`,
                            }),
                            jsx.jsx('span', {
                              className: 'dshWmStatusSep',
                              children: '·',
                            }),
                            jsx.jsx('span', {
                              children: (filePath || '').toLowerCase().endsWith('.fountain')
                                ? 'Fountain'
                                : 'Markdown',
                            }),
                            gate
                              ? jsx.jsx('span', {
                                  className: 'dshWmStatusSep',
                                  children: '·',
                                })
                              : null,
                            gate
                              ? jsx.jsx('span', {
                                  style: {
                                    color: gate.pass
                                      ? 'var(--dsw-alias-state-success-primary)'
                                      : 'var(--dsw-alias-state-error-primary)',
                                    fontWeight: 600,
                                  },
                                  children: gate.pass
                                    ? T.gateShort + ' ✓'
                                    : T.gateShort + ' ' + gate.fail,
                                })
                              : null,
                          ],
                        },
                        'st'
                      ),
                    ],
                  },
                  'main'
                ),
                aiOpen
                  ? jsx.jsx(
                      'aside',
                      {
                        className: 'dshWmSide is-ai',
                        children: [
                          jsx.jsx('div', { className: 'dshWmSideHead', children: T.ai }, 'ah'),
                          jsx.jsx(
                            'div',
                            {
                              className: 'dshWmAiBody',
                              children: [
                                jsx.jsx(
                                  'div',
                                  { className: 'dshWmAiSection', children: [
                                    jsx.jsx('div', { className: 'dshWmAiSectionTitle', children: 'AI' }, 'at'),
                                    jsx.jsx(
                                      'div',
                                      {
                                        className: 'dshWmAiActions',
                                        children: ['polish', 'continue', 'outline', 'compress', 'expand', 'research', 'spark'].map((a) =>
                                          jsx.jsx(
                                            'button',
                                            {
                                              type: 'button',
                                              className:
                                                'dshWmBtn' +
                                                (a === 'research' || a === 'spark' ? ' is-on' : ''),
                                              disabled: aiBusy,
                                              onClick: () => void runAssist(a),
                                              children: T[a] || a,
                                            },
                                            a
                                          )
                                        ),
                                      },
                                      'acts'
                                    ),
                                  ]},
                                  'sec-ai'
                                ),
                                aiBusy
                                  ? jsx.jsx('div', { className: 'dshWmAiHint', children: T.applying })
                                  : null,
                                aiErr
                                  ? jsx.jsx('div', { className: 'dshWmAiHint', children: aiErr })
                                  : null,
                                jsx.jsx(
                                  'div',
                                  { className: 'dshWmAiMain', children: [
                                    jsx.jsx('div', { className: 'dshWmAiOut', children: aiOut || ' ' }, 'out'),
                                  ]},
                                  'aim'
                                ),
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmAiActions',
                                    children: [
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn',
                                        disabled: !aiOut,
                                        onClick: applyInsert,
                                        children: T.insert,
                                      }),
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn',
                                        disabled: !aiOut,
                                        onClick: applyReplace,
                                        children: T.replaceSel,
                                      }),
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn is-primary',
                                        onClick: sendToChat,
                                        children: T.sendChat,
                                      }),
                                    ],
                                  },
                                  'apply'
                                ),
                                /* ── 门禁：默认收起，只露一行摘要 ── */
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmSec',
                                    children: [
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'dshWmSecToggle',
                                          onClick: () => setGateOpen((v) => !v),
                                          children: [
                                            jsx.jsx('span', {
                                              children: (gateOpen ? '▾ ' : '▸ ') + T.gates,
                                            }, 't'),
                                            jsx.jsx('span', {
                                              className:
                                                'dshWmSecBadge' +
                                                (gate
                                                  ? gate.pass
                                                    ? ' is-pass'
                                                    : ' is-fail'
                                                  : ''),
                                              children: gateBusy
                                                ? T.applying
                                                : gate
                                                  ? gate.pass
                                                    ? T.gatesPass
                                                    : T.gatesFail.replace('{n}', String(gate.fail))
                                                  : '—',
                                            }, 'b'),
                                          ],
                                        },
                                        'gt'
                                      ),
                                      gateOpen
                                        ? jsx.jsx(
                                            'div',
                                            {
                                              className: 'dshWmSec',
                                              children: [
                                                jsx.jsx(
                                                  'div',
                                                  {
                                                    className: 'dshWmAiActions',
                                                    children: [
                                                      jsx.jsx('button', {
                                                        type: 'button',
                                                        className: 'dshWmBtn',
                                                        disabled: gateBusy || !filePath,
                                                        onClick: () => void runGate(),
                                                        children: gateBusy ? T.applying : T.runGates,
                                                      }),
                                                    ],
                                                  },
                                                  'gb'
                                                ),
                                                gateErr
                                                  ? jsx.jsx('div', {
                                                      className: 'dshWmAiHint',
                                                      children: gateErr,
                                                    }, 'ge')
                                                  : null,
                                                !gate && !gateErr
                                                  ? jsx.jsx('div', {
                                                      className: 'dshWmAiHint',
                                                      children: T.gatesIdle,
                                                    }, 'gi')
                                                  : null,
                                                gate && gate.rows
                                                  ? jsx.jsx(
                                                      'div',
                                                      {
                                                        className: 'dshWmGateList',
                                                        children: gate.rows.map((r, i) =>
                                                          jsx.jsx(
                                                            'div',
                                                            {
                                                              className: 'dshWmGateRow',
                                                              children: [
                                                                jsx.jsx('span', {
                                                                  className: r.ok ? 'ok' : 'bad',
                                                                  children: r.ok ? 'PASS' : 'FAIL',
                                                                }),
                                                                jsx.jsx('span', {
                                                                  className: 'dshWmGateLabel',
                                                                  children: r.label,
                                                                }),
                                                                jsx.jsx('span', {
                                                                  className: 'dshWmGateDetail',
                                                                  children: r.detail,
                                                                }),
                                                              ],
                                                            },
                                                            'r' + i
                                                          )
                                                        ),
                                                      },
                                                      'gl'
                                                    )
                                                  : null,
                                              ],
                                            },
                                            'gb2'
                                          )
                                        : null,
                                    ],
                                  },
                                  'gh'
                                ),
                                /* ── 台账：默认收起 ── */
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmSec',
                                    children: [
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'dshWmSecToggle',
                                          onClick: () => setLedgerOpen((v) => !v),
                                          children: [
                                            jsx.jsx('span', {
                                              children: (ledgerOpen ? '▾ ' : '▸ ') + T.ledger,
                                            }, 't'),
                                            jsx.jsx('span', {
                                              className: 'dshWmSecBadge',
                                              children: ledger
                                                ? (ledger.foreshadowOpen != null
                                                    ? ledger.foreshadowOpen + ' · '
                                                    : '') + (ledger.latestReview || '—').slice(0, 18)
                                                : '—',
                                            }, 'b'),
                                          ],
                                        },
                                        'lt'
                                      ),
                                      ledgerOpen
                                        ? ledger
                                          ? jsx.jsx(
                                              'div',
                                              {
                                                className: 'dshWmLedger',
                                                children: [
                                                  jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmLedgerRow',
                                                      children: [
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerK',
                                                          children: T.ledgerHook,
                                                        }),
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerV',
                                                          children: ledger.hook || '—',
                                                        }),
                                                      ],
                                                    },
                                                    'lh'
                                                  ),
                                                  jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmLedgerRow',
                                                      children: [
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerK',
                                                          children: T.ledgerFores,
                                                        }),
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerV',
                                                          children:
                                                            ledger.foreshadowOpen == null
                                                              ? '—'
                                                              : String(ledger.foreshadowOpen),
                                                        }),
                                                      ],
                                                    },
                                                    'lf'
                                                  ),
                                                  jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmLedgerRow',
                                                      children: [
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerK',
                                                          children: T.ledgerReview,
                                                        }),
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerV',
                                                          children: ledger.latestReview || '—',
                                                        }),
                                                      ],
                                                    },
                                                    'lr'
                                                  ),
                                                  ledger.timeline && ledger.timeline.length
                                                    ? jsx.jsx(
                                                        'div',
                                                        {
                                                          className: 'dshWmLedgerRow',
                                                          children: [
                                                            jsx.jsx('span', {
                                                              className: 'dshWmLedgerK',
                                                              children: T.ledgerTimeline,
                                                            }),
                                                            jsx.jsx('span', {
                                                              className: 'dshWmLedgerV',
                                                              children:
                                                                ledger.timeline[
                                                                  ledger.timeline.length - 1
                                                                ],
                                                            }),
                                                          ],
                                                        },
                                                        'lts'
                                                      )
                                                    : null,
                                                ],
                                              },
                                              'lb'
                                            )
                                          : jsx.jsx(
                                              'div',
                                              {
                                                className: 'dshWmAiHint',
                                                children: T.ledgerNone,
                                              },
                                              'ln'
                                            )
                                        : null,
                                    ],
                                  },
                                  'lsec'
                                ),
                                jsx.jsx(
                                  'div',
                                  { className: 'dshWmAiHint', children: 'Esc · Ctrl+S · Ctrl+Shift+W' },
                                  'kbd'
                                ),
                              ],
                            },
                            'ab'
                          ),
                        ],
                      },
                      'ai'
                    )
                  : null,
              ],
            },
            'body'
          ),
        ],
      })
    }

    /** DOM 常驻浮动入口：不依赖 shell.overlay 是否在当前页挂载。 */
    let domFloatEl = null
    function ensureDomFloat() {
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

    /** 内核设置 → 写作模式 */
    function WritingModeSettings() {
      const [prefs, setPrefsLocal] = react.useState(getPrefs)
      const [roots, setRoots] = react.useState([])
      const [pathDraft, setPathDraft] = react.useState('')
      react.useEffect(() => subscribePrefs(() => setPrefsLocal({ ...getPrefs() })), [])
      react.useEffect(() => {
        void loadPrefs()
        void api('config')
          .then((d) => {
            if (d.ok) setRoots(d.roots || [])
          })
          .catch(() => {})
      }, [])

      const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }
      const label = { width: 120, flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }
      const hint = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 }

      function numInput(key, min, max, step) {
        return jsx.jsx('input', {
          type: 'number',
          min: String(min),
          max: String(max),
          step: String(step),
          value: String(prefs[key]),
          style: {
            width: 90,
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            fontSize: 13,
          },
          onChange: (e) => void savePrefs({ [key]: Number(e.target.value) }),
        })
      }

      async function addRoot() {
        const p = String(pathDraft || '').trim()
        if (!p) return
        await api('roots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'add', path: p, active: true }),
        })
        setPathDraft('')
        const d = await api('config')
        if (d.ok) setRoots(d.roots || [])
        void loadPrefs()
      }

      async function removeRoot(p) {
        await api('roots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'remove', path: p }),
        })
        const d = await api('config')
        if (d.ok) setRoots(d.roots || [])
      }

      return jsx.jsx(
        'div',
        {
          style: {
            width: '100%',
            maxWidth: 640,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            color: 'var(--dsw-alias-label-primary)',
          },
          children: [
            jsx.jsx(
              'div',
              {
                style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 },
                children: '写作工作台（Ctrl+Shift+W 或右下角进入）。设置即时生效并写入 ~/.dsh/writing-mode.json。',
              },
              'intro'
            ),
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '库根目录' }),
                  jsx.jsx(
                    'div',
                    {
                      style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
                      children: [
                        ...(roots || []).map((r) =>
                          jsx.jsx(
                            'div',
                            {
                              style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 13,
                              },
                              children: [
                                jsx.jsx('span', {
                                  style: {
                                    flex: 1,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  },
                                  children: (r.missing ? '⚠ ' : '') + r.path,
                                }),
                                jsx.jsx('button', {
                                  type: 'button',
                                  className: 'dshWmBtn',
                                  onClick: () => void removeRoot(r.path),
                                  children: '移除',
                                }),
                              ],
                            },
                            r.path
                          )
                        ),
                        jsx.jsx(
                          'div',
                          {
                            style: { display: 'flex', gap: 8 },
                            children: [
                              jsx.jsx('input', {
                                style: {
                                  flex: 1,
                                  padding: '6px 10px',
                                  borderRadius: 8,
                                  border: '1px solid var(--dsw-alias-border-l2)',
                                  background: 'var(--dsw-alias-bg-layer-2)',
                                  color: 'var(--dsw-alias-label-primary)',
                                  font: 'inherit',
                                  fontSize: 13,
                                },
                                placeholder: '例如 E:\\剧本',
                                value: pathDraft,
                                onChange: (e) => setPathDraft(e.target.value),
                                onKeyDown: (e) => {
                                  if (e.key === 'Enter') void addRoot()
                                },
                              }),
                              jsx.jsx('button', {
                                type: 'button',
                                className: 'dshWmBtn is-primary',
                                onClick: () => void addRoot(),
                                children: '添加',
                              }),
                            ],
                          },
                          'add'
                        ),
                      ],
                    }
                  ),
                ],
              },
              'roots'
            ),
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '正文字号' }),
                  numInput('fontSize', 12, 28, 1),
                  jsx.jsx('span', { style: hint, children: 'px' }),
                ],
              },
              'fs'
            ),
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '行距' }),
                  numInput('lineHeight', 1.4, 2.6, 0.05),
                ],
              },
              'lh'
            ),
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '自动保存' }),
                  numInput('autoSaveMs', 200, 5000, 100),
                  jsx.jsx('span', { style: hint, children: 'ms（防抖）' }),
                ],
              },
              'as'
            ),
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '保存后门禁' }),
                  jsx.jsx('input', {
                    type: 'checkbox',
                    checked: Boolean(prefs.autoGate),
                    onChange: (e) => void savePrefs({ autoGate: e.target.checked }),
                  }),
                  jsx.jsx('span', { style: hint, children: 'md / fountain 存盘后自动跑一次' }),
                ],
              },
              'ag'
            ),
            jsx.jsx(
              'div',
              {
                style: {
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--dsw-alias-border-l2)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--dsw-alias-label-tertiary)',
                  letterSpacing: '0.06em',
                },
                children: 'AI 模型',
              },
              'ai-head'
            ),
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '来源' }),
                  jsx.jsx(
                    'select',
                    {
                      value: prefs.aiMode === 'custom' ? 'custom' : 'harness',
                      style: {
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l2)',
                        background: 'var(--dsw-alias-bg-layer-2)',
                        color: 'var(--dsw-alias-label-primary)',
                        font: 'inherit',
                        fontSize: 13,
                      },
                      onChange: (e) =>
                        void savePrefs({ aiMode: e.target.value === 'custom' ? 'custom' : 'harness' }),
                      children: [
                        jsx.jsx('option', { value: 'harness', children: 'Harness 默认（跟当前会话）' }, 'h'),
                        jsx.jsx('option', { value: 'custom', children: '自定义 Provider / Model' }, 'c'),
                      ],
                    }
                  ),
                  jsx.jsx('span', {
                    style: hint,
                    children:
                      prefs.aiMode === 'custom'
                        ? '润色/续写/找资料走下面配置的模型'
                        : '优先用会话 requestHeader 的模型，否则 deepseek-v4-flash',
                  }),
                ],
              },
              'ai-mode'
            ),
            prefs.aiMode === 'custom'
              ? jsx.jsx(
                  'div',
                  {
                    style: { ...row, alignItems: 'flex-start' },
                    children: [
                      jsx.jsx('span', { style: label, children: 'Provider' }),
                      jsx.jsx('input', {
                        style: {
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-l2)',
                          background: 'var(--dsw-alias-bg-layer-2)',
                          color: 'var(--dsw-alias-label-primary)',
                          font: 'inherit',
                          fontSize: 13,
                        },
                        value: prefs.aiProvider,
                        placeholder: 'deepseek-official',
                        onChange: (e) => void savePrefs({ aiProvider: e.target.value }),
                      }),
                    ],
                  },
                  'ai-prov'
                )
              : null,
            prefs.aiMode === 'custom'
              ? jsx.jsx(
                  'div',
                  {
                    style: { ...row, alignItems: 'flex-start' },
                    children: [
                      jsx.jsx('span', { style: label, children: 'Model' }),
                      jsx.jsx('input', {
                        style: {
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-l2)',
                          background: 'var(--dsw-alias-bg-layer-2)',
                          color: 'var(--dsw-alias-label-primary)',
                          font: 'inherit',
                          fontSize: 13,
                        },
                        value: prefs.aiModel,
                        placeholder: 'deepseek-v4-flash',
                        onChange: (e) => void savePrefs({ aiModel: e.target.value }),
                      }),
                    ],
                  },
                  'ai-model'
                )
              : null,
            prefs.aiMode === 'custom'
              ? jsx.jsx(
                  'div',
                  {
                    style: { ...row, alignItems: 'flex-start' },
                    children: [
                      jsx.jsx('span', { style: label, children: 'API Key' }),
                      jsx.jsx('input', {
                        type: 'password',
                        style: {
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-l2)',
                          background: 'var(--dsw-alias-bg-layer-2)',
                          color: 'var(--dsw-alias-label-primary)',
                          font: 'inherit',
                          fontSize: 13,
                        },
                        value: prefs.aiApiKey,
                        placeholder: '可选；仅本机配置文件',
                        onChange: (e) => void savePrefs({ aiApiKey: e.target.value }),
                      }),
                    ],
                  },
                  'ai-key'
                )
              : null,
            jsx.jsx(
              'div',
              {
                style: row,
                children: [
                  jsx.jsx('span', { style: label, children: '进入工作台' }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn is-primary',
                    onClick: () => setModeActive(true),
                    children: '打开写作模式',
                  }),
                  jsx.jsx('span', { style: hint, children: '快捷键 Ctrl+Shift+W' }),
                ],
              },
              'open'
            ),
          ],
        }
      )
    }

    const inject = ['slots']
    function apply(ctx) {
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

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
