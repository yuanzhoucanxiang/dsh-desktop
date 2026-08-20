window.__ModuleLoader__.load({
  id: "@dsh-local/dialog-optimize",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    // Idempotency: if the bundle is evaluated twice on one page (SPA soft
    // refresh / boot race), the second instance must be a no-op so it cannot
    // duplicate the nav. The flag is cleared on effect dispose, so a genuine
    // hot reload re-initializes cleanly instead of leaving a stale no-op.
    if (window.__dshDialogOptimizeLoaded === true) {
      exports.name = "dialog-optimize"
      exports.apply = function () {}
      exports.inject = []
      return module.exports
    }
    window.__dshDialogOptimizeLoaded = true

    const NS = "@dsh-local/dialog-optimize"
    const ROW_HEIGHT = 28
    const KEEP_KINDS = new Set(["user", "steering", "context"])
    // every flow node that is user-facing conversation content. Messages sent
    // while the agent is busy are routed to kind "steering" (same user bubble),
    // so the nav MUST include it or it silently drops messages the user sees.
    const USER_SIDE_KINDS = new Set([
      "user", "steering", "context", "command", "manual-compaction",
      "compaction", "turn-error", "turn-max-tokens", "unknown",
    ])

    // ------------------------------------------------------------------ css
    const CSS = [
      // small rows: every open disclosure row pins at the top of its scroll
      // container while its block is on screen.
      '[data-open] > [data-disclosure-row] {',
      '  position: sticky; top: var(--dsh-stick-top, 0px); z-index: 5;',
      '  background: var(--dsw-alias-bg-base);',
      '}',
      '[data-open] > [data-disclosure-row][data-dsh-stuck] {',
      '  box-shadow: 0 calc(-1 * var(--dsh-stick-pad, 0px)) 0 var(--dsw-alias-bg-base), 0 1px 0 var(--dsw-alias-border-l2);',
      '}',
      // collapsed reply content
      '[data-dsh-reply-hidden="1"] { display: none !important; }',
      // the per-reply collapse row (injected between the question and the reply)
      '.dshReplyRow { height: ' + ROW_HEIGHT + 'px; display: flex; align-items: center; }',
      '.dshReplyButton {',
      '  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px;',
      '  border: none; border-radius: 6px; background: none; cursor: pointer;',
      '  color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 13px; line-height: 20px;',
      '}',
      '.dshReplyButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dshReplyChevron { display: inline-flex; color: var(--dsw-alias-label-caption); transition: transform .12s; }',
      '.dshReplyRow[data-collapsed="1"] .dshReplyChevron { transform: rotate(-90deg); }',
      '.dshReplyRow[data-pinned="1"] { background: var(--dsw-alias-bg-base); border-bottom: 1px solid var(--dsw-alias-border-l2); }',
      // back-to-top button
      '.dshTopButton {',
      '  position: fixed; z-index: 9;',
      '  display: inline-flex; align-items: center; gap: 4px;',
      '  height: 28px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 14px; background: var(--dsw-alias-bg-base); cursor: pointer;',
      '  color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 13px; line-height: 20px;',
      '  box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.12));',
      '}',
      '.dshTopButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      // left conversation-content navigation rail (movable / resizable / collapsible)
      '.dshNav {',
      '  position: fixed; z-index: 9;',
      '  display: flex; flex-direction: column;',
      '  min-width: 160px; max-width: 440px;',
      '  border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 8px; background: var(--dsw-alias-bg-base);',
      '  box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.12));',
      '  overflow: hidden;',
      '}',
      '.dshNavHeader {',
      '  display: flex; align-items: center; gap: 6px;',
      '  padding: 6px 8px; user-select: none;',
      '  border-bottom: 1px solid var(--dsw-alias-border-l2); flex: none;',
      '}',
      '.dshNavTitle { flex: 1; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }',
      '.dshNavMinBtn {',
      '  flex: none; width: 20px; height: 20px; border: none; border-radius: 4px;',
      '  background: none; cursor: pointer; color: var(--dsw-alias-label-secondary);',
      '  font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;',
      '}',
      '.dshNavMinBtn:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dshNavList {',
      '  display: flex; flex-direction: column; gap: 2px;',
      '  padding: 4px; overflow-y: auto; overflow-x: hidden; max-height: 50vh;',
      '}',
      '.dshNavResize { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }',
      '.dshNavIcon {',
      '  position: fixed; z-index: 9; width: 32px; height: 32px;',
      '  border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%;',
      '  background: var(--dsw-alias-bg-base); cursor: pointer; color: var(--dsw-alias-label-secondary);',
      '  box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.12));',
      '  display: inline-flex; align-items: center; justify-content: center; font-size: 16px;',
      '}',
      '.dshNavIcon:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dshNavItem {',
      '  display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;',
      '  padding: 4px 8px; border: none; border-radius: 6px;',
      '  background: none; cursor: pointer;',
      '  color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 12px; line-height: 18px;',
      '}',
      '.dshNavContent { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dshNavSep { flex: none; width: 1px; height: 12px; background: var(--dsw-alias-border-l2); }',
      '.dshNavTime { flex: none; color: var(--dsw-alias-label-caption); font-size: 11px; }',
      '.dshNavItem:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dshNavItem[data-active="1"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dshNavOlder { color: var(--dsw-alias-label-tertiary); }',
      '.dshNavTooltip {',
      '  position: fixed; z-index: 12; max-width: 340px;',
      '  padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 8px; background: var(--dsw-alias-bg-base);',
      '  box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.12));',
      '  color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px;',
      '  white-space: pre-wrap; word-break: break-word; pointer-events: none;',
      '}',
      '.dshNavTooltip .dshNavTooltipTime { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 2px; }',
      // recall (撤回) controls
      '.dshRecallBtn {',
      '  display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 6px;',
      '  border: none; border-radius: 5px; background: none; cursor: pointer;',
      '  color: var(--dsw-alias-label-tertiary); font-family: inherit; font-size: 11px; line-height: 16px;',
      '}',
      '.dshRecallBtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dshFlowRecall {',
      '  width: 28px; height: 28px; flex: none; display: inline-flex; align-items: center; justify-content: center;',
      '  padding: 0; border: none; border-radius: 28px; background: none; cursor: pointer;',
      '  color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 1;',
      '}',
      '.dshFlowRecall:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.dshNavItem .dshRecallBtn { flex: none; }',
      '.dshRecallModal {',
      '  position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;',
      '  background: rgba(0, 0, 0, .35);',
      '}',
      '.dshRecallCard {',
      '  width: min(560px, 92vw); max-height: 75vh; display: flex; flex-direction: column;',
      '  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 10px; box-shadow: var(--dsw-shadow-lv2, 0 4px 16px rgba(0,0,0,.2));',
      '}',
      '.dshRecallTitle { padding: 12px 14px 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dshRecallBody { padding: 10px 14px; overflow-y: auto; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }',
      '.dshRecallFiles { margin-top: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; max-height: 160px; overflow-y: auto; font-size: 12px; line-height: 19px; white-space: pre-wrap; word-break: break-all; }',
      '.dshRecallNote { color: var(--dsw-alias-label-tertiary); font-size: 12px; margin-top: 8px; }',
      '.dshRecallFooter { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l2); }',
      '.dshRecallBtnOk { height: 28px; padding: 0 14px; border: none; border-radius: 7px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); cursor: pointer; font-family: inherit; font-size: 13px; }',
      '.dshRecallBtnOk:hover { filter: brightness(1.08); }',
      '.dshRecallBtnCancel { height: 28px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-family: inherit; font-size: 13px; }',
      '.dshRecallBtnCancel:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      // recalled (shadowed) conversation content — hidden from the DOM view;
      // the harness projection still renders shadowed events, so the client
      // hides them itself and persists the range for refreshes
      '[data-dsh-recalled="1"] { display: none !important; }',
    ].join('\n')

    let styleEl = null
    if (typeof document !== "undefined") {
      if (document.querySelector('style[data-plugin-css="' + NS + '"]') === null) {
        styleEl = document.createElement("style")
        styleEl.dataset.plugin = NS
        styleEl.dataset.pluginCss = NS
        styleEl.textContent = CSS
        document.head.appendChild(styleEl)
      }
    }

    // ------------------------------------------------------- geometry utils
    function scrollportOf(el) {
      for (let node = el && el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node)
        const oy = style.overflowY
        if (oy === "auto" || oy === "scroll" || oy === "overlay") return node
      }
      return null
    }
    function padOf(scrollport) {
      if (scrollport === null) return 0
      return parseFloat(getComputedStyle(scrollport).paddingTop) || 0
    }

    // ------------------------------------------------- reply rows
    const replyRows = new Set()
    const autoExpandedRows = new WeakSet()
    const autoCollapsedFlows = new WeakSet()
    const wasRunningRows = new WeakSet()

    function createReplyRow(anchorItem) {
      const row = document.createElement("div")
      row.className = "dshReplyRow"
      row.setAttribute("data-dsh-reply-row", "1")
      row._anchor = anchorItem
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "dshReplyButton"
      btn.setAttribute("aria-expanded", "true")
      btn.title = "收起流程，仅显示最终输出"
      const chevron = document.createElement("span")
      chevron.className = "dshReplyChevron"
      chevron.setAttribute("aria-hidden", "true")
      chevron.textContent = "\u25BE"
      const label = document.createElement("span")
      label.textContent = "收起流程"
      btn.append(chevron, label)
      row.append(btn)

      btn.addEventListener("click", () => {
        const collapsed = row.getAttribute("data-collapsed") === "1"
        const next = !collapsed
        if (next) row.setAttribute("data-collapsed", "1")
        else row.removeAttribute("data-collapsed")
        chevron.textContent = next ? "\u25B8" : "\u25BE"
        label.textContent = next ? "展开流程" : "收起流程"
        btn.setAttribute("aria-expanded", next ? "false" : "true")
        btn.title = next ? "展开流程" : "收起流程，仅显示最终输出"
        markReply(row, next)
        schedule()
      })

      replyRows.add(row)
      return row
    }

    // Inject one collapse row at the START of each reply's AI content. A reply
    // begins at the first AI-side flow item whose previous sibling is not
    // AI-side (covers turns whose user question is paged out / absent).
    const KEEP_KINDS2 = KEEP_KINDS
    function isAiSide(kind) {
      return kind !== void 0 && !KEEP_KINDS2.has(kind) && kind !== "turn-tail"
    }
    function cleanupOrphanRows() {
      for (const row of replyRows) {
        if (!row.isConnected) { replyRows.delete(row); continue }
        // the row is only valid while its anchored flow item is still mounted;
        // a session switch reconciles the column in place, leaving foreign rows
        // behind, so we must drop them once their anchor is gone.
        const anchor = row._anchor
        if (anchor === undefined || !anchor.isConnected) {
          const slot = row._dshSlot
          if (slot !== undefined && slot !== null && slot.isConnected) slot.remove()
          row.remove()
          replyRows.delete(row)
        }
      }
    }
    function ensureReplyRows(root) {
      const items = root.querySelectorAll("[data-chat-flow-key]")
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const kind = item.dataset.chatFlowKind
        if (!isAiSide(kind)) continue
        const prev = item.previousElementSibling
        if (prev !== null && prev.dataset && prev.dataset.dshReplyRow === "1") continue
        const prevKind = prev !== null && prev.dataset ? prev.dataset.chatFlowKind : void 0
        if (isAiSide(prevKind)) continue
        item.before(createReplyRow(item))
      }
    }

    // flowItems of one reply: from the row forward through AI-side content,
    // stopping at the turn tail (or the next user/steering/context row).
    function replySpan(rowEl) {
      const items = []
      let el = rowEl.nextElementSibling
      while (el !== null && el.dataset.chatFlowKey !== void 0) {
        const kind = el.dataset.chatFlowKind
        if (KEEP_KINDS.has(kind)) break
        items.push(el)
        if (kind === "turn-tail") break
        el = el.nextElementSibling
      }
      return items
    }

    function markReply(rowEl, collapsed) {
      const items = replySpan(rowEl)
      if (!collapsed) {
        for (const item of items) {
          item.removeAttribute("data-dsh-reply-hidden")
          for (const el of item.querySelectorAll('[data-dsh-reply-hidden="1"]')) el.removeAttribute("data-dsh-reply-hidden")
        }
        return
      }
      let finalStep = null
      for (const item of items) {
        if (item.dataset.chatFlowKind === "assistant-step") finalStep = item
      }
      for (const item of items) {
        if (item.dataset.chatFlowKind === "turn-tail") continue
        if (item === finalStep) continue
        item.setAttribute("data-dsh-reply-hidden", "1")
      }
      if (finalStep !== null) {
        for (const think of finalStep.querySelectorAll('[data-variant="think"]')) {
          think.setAttribute("data-dsh-reply-hidden", "1")
        }
      }
    }

    // ------------------------------------------------- back-to-top button
    let topButton = null
    function ensureTopButton() {
      if (topButton !== null) return
      topButton = document.createElement("button")
      topButton.type = "button"
      topButton.className = "dshTopButton"
      topButton.title = "回到对话顶部"
      topButton.innerHTML = '<span aria-hidden="true">\u2191</span><span>顶部</span>'
      topButton.addEventListener("click", () => {
        const scroller = document.querySelector("[data-conversation-scroll]")
        if (scroller !== null) scroller.scrollTo({ top: 0, behavior: "smooth" })
      })
      document.body.append(topButton)
    }

    // ------------------------------------------- conversation-content nav
    let navEl = null
    let navListEl = null
    let navIconEl = null
    let tooltipEl = null
    let navCollapsed = false
    function ensureNav() {
      if (navEl !== null) return
      navEl = document.createElement("div")
      navEl.className = "dshNav"
      navEl.setAttribute("aria-label", "对话内容导航")
      navEl.style.width = "220px"

      const header = document.createElement("div")
      header.className = "dshNavHeader"
      const title = document.createElement("span")
      title.className = "dshNavTitle"
      title.textContent = "对话导航"
      const minBtn = document.createElement("button")
      minBtn.type = "button"
      minBtn.className = "dshNavMinBtn"
      minBtn.title = "最小化"
      minBtn.textContent = "\u2013"
      minBtn.addEventListener("click", () => setNavCollapsed(true))
      header.append(title, minBtn)
      navEl.append(header)

      navListEl = document.createElement("div")
      navListEl.className = "dshNavList"
      navEl.append(navListEl)

      const resize = document.createElement("div")
      resize.className = "dshNavResize"
      navEl.append(resize)
      document.body.append(navEl)

      navIconEl = document.createElement("button")
      navIconEl.type = "button"
      navIconEl.className = "dshNavIcon"
      navIconEl.title = "展开对话导航"
      navIconEl.textContent = "\u2630"
      navIconEl.style.display = "none"
      navIconEl.addEventListener("click", () => setNavCollapsed(false))
      document.body.append(navIconEl)

      tooltipEl = document.createElement("div")
      tooltipEl.className = "dshNavTooltip"
      tooltipEl.style.display = "none"
      document.body.append(tooltipEl)

      // resize via the bottom-right handle
      let resizing = null
      resize.addEventListener("pointerdown", (e) => {
        resizing = { px: e.clientX, py: e.clientY, w: navEl.offsetWidth, h: navListEl.offsetHeight }
        resize.setPointerCapture(e.pointerId)
        e.preventDefault()
        e.stopPropagation()
      })
      resize.addEventListener("pointermove", (e) => {
        if (resizing === null) return
        const w = Math.max(160, Math.min(440, resizing.w + (e.clientX - resizing.px)))
        const h = Math.max(120, resizing.h + (e.clientY - resizing.py))
        navEl.style.width = w + "px"
        navListEl.style.maxHeight = h + "px"
      })
      const endResize = () => { resizing = null }
      resize.addEventListener("pointerup", endResize)
      resize.addEventListener("pointercancel", endResize)
    }
    function setNavCollapsed(collapsed) {
      navCollapsed = collapsed
      if (navEl === null || navIconEl === null) return
      if (collapsed) {
        navEl.style.display = "none"
        navIconEl.style.display = ""
      } else {
        navIconEl.style.display = "none"
        navEl.style.display = ""
      }
      schedule()
    }
    function questionOf(row) {
      const anchor = row._dshSlot && row._dshSlot.isConnected ? row._dshSlot : row
      let cursor = anchor.previousElementSibling
      while (cursor !== null && cursor.dataset && KEEP_KINDS.has(cursor.dataset.chatFlowKind)) {
        if (cursor.dataset.chatFlowKind === "user") return cursor
        cursor = cursor.previousElementSibling
      }
      return null
    }
    function firstQuestionOf(row) {
      // earliest consecutive user message = the turn's TRUE start (a turn may
      // carry several user messages in a row, e.g. a typed correction)
      const anchor = row._dshSlot && row._dshSlot.isConnected ? row._dshSlot : row
      let cursor = anchor.previousElementSibling
      let first = null
      while (cursor !== null && cursor.dataset && KEEP_KINDS.has(cursor.dataset.chatFlowKind)) {
        if (cursor.dataset.chatFlowKind === "user") first = cursor
        cursor = cursor.previousElementSibling
      }
      return first
    }
    // ── 内核私有 hash 类名集中处（技术债，见 docs/dsh-ecosystem.md 4.1）─────────
    // 这些类名是内核前端的编译产物，内核升级时可能改变。四处调用点本来就都有降级
    // 路径（文本兜底 / 正则兜底 / 直接跳过），所以不会崩；但"静默降级"会让人查不出
    // 问题 —— 于是统一走 pick()：**从未命中过**且已错过很多次时告警一次。
    // 注意不能"一没找到就告警"：例如 older 在没有分页历史时本来就不存在。
    // 打包门禁 `npm run selector-check` 会在这些选择器从内核里消失时直接让 dist 失败。
    const HASH_SEL = {
      bubble: ".gdEzaW_bubble",
      timeStart: ".p-xYUq_timeStart",
      older: ".Md3f7G_older button",
      actions: ".p-xYUq_actions",
    }
    const selSeen = {}
    const selMiss = {}
    const SEL_MISS_ALARM = 30
    function pick(scope, key) {
      if (scope === null || scope === undefined) return null
      const el = scope.querySelector(HASH_SEL[key])
      if (el !== null) {
        selSeen[key] = 1
        return el
      }
      selMiss[key] = (selMiss[key] || 0) + 1
      if (selSeen[key] !== 1 && selMiss[key] === SEL_MISS_ALARM) {
        console.warn(
          "[dialog-optimize] 内核私有选择器疑似失效：" + HASH_SEL[key]
          + "（试了 " + SEL_MISS_ALARM + " 次从未命中，内核前端可能已升级）—— "
          + "相关功能已降级运行；请更新选择器，或改走官方 Slots 契约。"
        )
      }
      return null
    }

    function fullTextOf(questionEl) {
      if (questionEl === null) return ""
      const bubble = pick(questionEl, "bubble")
      const text = (bubble ? bubble.textContent : questionEl.textContent || "").trim()
      return text.replace(/\s+/g, " ").trim()
    }
    function timeTextOf(questionEl) {
      if (questionEl === null) return ""
      const clock = pick(questionEl, "timeStart")
      if (clock !== null && clock.textContent && clock.textContent.trim() !== "") return clock.textContent.trim()
      const m = (questionEl.textContent || "").match(/\d{1,2}:\d{2}/)
      return m ? m[0] : ""
    }
    function syncNav(root) {
      if (navEl === null) return
      // the nav lists EVERY user-facing flow node (user messages, steering
      // messages sent mid-run, injected context, commands, compaction…), so no
      // conversation content is dropped and each item maps 1:1 to its DOM
      // position for the active match
      const flowItems = root.querySelectorAll("[data-chat-flow-key]")
      const rows = []
      for (let i = 0; i < flowItems.length; i++) {
        if (flowItems[i].dataset.dshRecalled === "1") continue
        const kind = flowItems[i].dataset.chatFlowKind
        if (USER_SIDE_KINDS.has(kind)) rows.push(flowItems[i])
      }
      if (rows.length === 0) {
        navEl.style.display = "none"
        if (navIconEl !== null) navIconEl.style.display = "none"
        navEl._rows = []
        return
      }
      // rebuild only when the set of rows actually changed (identity, not
      // count — two sessions with equal turn counts must not share labels)
      const sameRows = Array.isArray(navEl._rows) && navEl._rows.length === rows.length && navEl._rows.every((r, i) => r === rows[i])
      if (!sameRows) {
        navEl._rows = rows.slice()
        navListEl.innerHTML = ""
        // display-only hint that more history is paged out (the dialog's own
        // "load earlier" button handles the loading)
        if (pick(root, "older") !== null) {
          const olderItem = document.createElement("div")
          olderItem.className = "dshNavItem dshNavOlder"
          olderItem.textContent = "加载更早"
          navListEl.append(olderItem)
        }
        rows.forEach((q, i) => {
          const btn = document.createElement("button")
          btn.type = "button"
          btn.className = "dshNavItem"
          const full = fullTextOf(q)
          const time = timeTextOf(q)
          const content = document.createElement("span")
          content.className = "dshNavContent"
          content.textContent = (i + 1) + ". " + full
          const sep = document.createElement("span")
          sep.className = "dshNavSep"
          sep.setAttribute("aria-hidden", "true")
          const timeEl = document.createElement("span")
          timeEl.className = "dshNavTime"
          timeEl.textContent = time
          btn.append(content, sep, timeEl)
          btn.addEventListener("click", () => {
            const scrollport = document.querySelector("[data-conversation-scroll]")
            if (scrollport === null) return
            const target = q
            const delta = target.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - 8
            scrollport.scrollBy({ top: delta, behavior: "smooth" })
          })
          btn.addEventListener("mouseenter", () => {
            if (tooltipEl === null) return
            tooltipEl.textContent = ""
            const t1 = document.createElement("div")
            t1.textContent = full
            tooltipEl.append(t1)
            if (time !== "") {
              const t2 = document.createElement("div")
              t2.className = "dshNavTooltipTime"
              t2.textContent = time
              tooltipEl.append(t2)
            }
            const rect = btn.getBoundingClientRect()
            tooltipEl.style.display = ""
            tooltipEl.style.left = (rect.right + 10) + "px"
            tooltipEl.style.top = Math.min(rect.top, window.innerHeight - 120) + "px"
          })
          btn.addEventListener("mouseleave", () => {
            if (tooltipEl !== null) tooltipEl.style.display = "none"
          })
          btn._row = q
          if (RECALLABLE_KINDS.has(q.dataset.chatFlowKind)) {
            btn.append(recallButton("\u21A9", () => recallFlowItem(q)))
          }
          navListEl.append(btn)
        })
      }
      const scrollport = document.querySelector("[data-conversation-scroll]")
      const pinTop = scrollport === null ? 0 : scrollport.getBoundingClientRect().top
      // active = the LAST message whose top has scrolled past the viewport top
      // (exactly one highlight, no overlap)
      let activeRow = null
      let activeTop = -Infinity
      for (const btn of navListEl.children) {
        btn.removeAttribute("data-active")
        const q = btn._row
        if (q === undefined) continue
        const top = q.getBoundingClientRect().top
        if (top <= pinTop + 8 && top > activeTop) {
          activeTop = top
          activeRow = q
        }
      }
      if (activeRow !== null) {
        for (const btn of navListEl.children) {
          if (btn._row === activeRow) btn.setAttribute("data-active", "1")
        }
      }
      // fixed at the top-left corner inside the dialog (10px insets)
      const rect = scrollport === null ? { top: 0, left: 0 } : scrollport.getBoundingClientRect()
      navEl.style.left = (rect.left + 10) + "px"
      navEl.style.top = (rect.top + 10) + "px"
      navIconEl.style.left = (rect.left + 10) + "px"
      navIconEl.style.top = (rect.top + 10) + "px"
      if (navCollapsed) {
        navEl.style.display = "none"
        navIconEl.style.display = ""
      } else {
        navEl.style.display = ""
        navIconEl.style.display = "none"
      }
    }

    // ------------------------------------------------- recall (撤回)
    const RECALL_URL = "/api/dialog-optimize/recall"
    const RECALLABLE_KINDS = new Set(["user", "steering"])
    let recallModalEl = null
    let sessionsSvc = null

    function recallButton(label, onClick) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "dshRecallBtn"
      btn.textContent = label
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        e.preventDefault()
        onClick()
      })
      return btn
    }

    // one "撤回" button per user/steering bubble, inserted into the message's
    // own actions row (time … [撤回] [复制]), i.e. to the LEFT of the copy
    // button so it never overlaps the time label; React re-renders may drop
    // it, so the frame loop self-heals it
    function ensureRecallButtons(root) {
      const items = root.querySelectorAll("[data-chat-flow-key]")
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.dataset.dshRecalled === "1") continue
        if (!RECALLABLE_KINDS.has(item.dataset.chatFlowKind)) continue
        let btn = item._dshRecallBtn
        if (btn !== undefined && btn.isConnected) continue
        const row = pick(item, "actions")
        if (row === null) continue
        btn = recallButton("\u21A9", () => recallFlowItem(item))
        btn.classList.add("dshFlowRecall")
        btn.setAttribute("aria-label", "\u64A4\u56DE")
        btn.title = "\u64A4\u56DE\u5E76\u91CD\u7F16\u8F91"
        item._dshRecallBtn = btn
        const copy = row.querySelector("button")
        if (copy !== null) row.insertBefore(btn, copy)
        else row.append(btn)
      }
    }

    function hideRecallModal() {
      if (recallModalEl !== null) {
        recallModalEl.remove()
        recallModalEl = null
      }
    }

    function recallLine(text) {
      const div = document.createElement("div")
      div.textContent = text
      return div
    }

    // plan without onConfirm renders as an error/notice dialog
    function showRecallModal(plan, onConfirm) {
      hideRecallModal()
      const modal = document.createElement("div")
      modal.className = "dshRecallModal"
      const card = document.createElement("div")
      card.className = "dshRecallCard"
      const title = document.createElement("div")
      title.className = "dshRecallTitle"
      title.textContent = onConfirm === null ? "\u64A4\u56DE\u5931\u8D25" : "\u64A4\u56DE\u5BF9\u8BDD"
      const body = document.createElement("div")
      body.className = "dshRecallBody"
      if (onConfirm === null) {
        body.textContent = plan.text || "\u672A\u77E5\u9519\u8BEF"
      } else {
        body.append(recallLine("\u5C06\u64A4\u56DE\u8BE5\u6D88\u606F\u53CA\u5176\u540E\u7684\u5168\u90E8\u5BF9\u8BDD\u5185\u5BB9\uFF08\u4ECE\u5F53\u524D\u5BF9\u8BDD\u4E2D\u79FB\u9664\uFF0C\u4E0D\u4F1A\u65B0\u5EFA\u4F1A\u8BDD\uFF09\uFF0C\u5E76\u56DE\u9000\u76F8\u5173\u6587\u4EF6\u6539\u52A8\uFF1A"))
        body.append(recallLine(plan.text || "\uFF08\u65E0\u6587\u672C\u5185\u5BB9\uFF09"))
        if (plan.files !== undefined && plan.files.length > 0) {
          const files = document.createElement("div")
          files.className = "dshRecallFiles"
          files.textContent = plan.files.map((f) => {
            const head = f.action === "delete" ? "\u274C \u5220\u9664 " : f.action === "restore" ? "\u21BA \u6062\u590D " : "\u26A0 \u8DF3\u8FC7 "
            return head + f.path + (f.note ? "  \u2014 " + f.note : "")
          }).join("\n")
          body.append(files)
        } else {
          body.append(recallLine("\u64A4\u56DE\u70B9\u4E4B\u540E\u6CA1\u6709\u68C0\u6D4B\u5230 AI \u6539\u52A8\u7684\u6587\u4EF6\u3002"))
        }
        const note = document.createElement("div")
        note.className = "dshRecallNote"
        note.textContent = "\u6CE8\u610F\uFF1A\u901A\u8FC7 shell \u547D\u4EE4\uFF08pwsh/bash\uFF09\u5BF9\u6587\u4EF6\u7684\u6539\u52A8\u65E0\u6CD5\u68C0\u6D4B\u548C\u56DE\u9000\uFF1B\u64A4\u56DE\u540E\u53EF\u5728\u8F93\u5165\u6846\u91CD\u65B0\u7F16\u8F91\u5E76\u91CD\u53D1\u3002"
        body.append(note)
      }
      const footer = document.createElement("div")
      footer.className = "dshRecallFooter"
      if (onConfirm !== null) {
        const cancel = document.createElement("button")
        cancel.type = "button"
        cancel.className = "dshRecallBtnCancel"
        cancel.textContent = "\u53D6\u6D88"
        cancel.addEventListener("click", hideRecallModal)
        const ok = document.createElement("button")
        ok.type = "button"
        ok.className = "dshRecallBtnOk"
        ok.textContent = "\u786E\u8BA4\u64A4\u56DE"
        ok.addEventListener("click", () => { hideRecallModal(); onConfirm() })
        footer.append(cancel, ok)
      } else {
        const close = document.createElement("button")
        close.type = "button"
        close.className = "dshRecallBtnCancel"
        close.textContent = "\u5173\u95ED"
        close.addEventListener("click", hideRecallModal)
        footer.append(close)
      }
      modal.append(card)
      card.append(title, body, footer)
      document.body.append(modal)
      recallModalEl = modal
    }

    async function recallFlowItem(item) {
      const key = item.dataset.chatFlowKey
      if (!key) return
      let plan
      try {
        const res = await fetch(RECALL_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key })
        })
        plan = await res.json()
      } catch (err) {
        showRecallModal({ ok: false, text: "\u7F51\u7EDC\u9519\u8BEF\uFF1A" + (err && err.message ? err.message : String(err)) }, null)
        return
      }
      if (!plan.ok) { showRecallModal({ ok: false, text: plan.error || "\u64A4\u56DE\u5931\u8D25" }, null); return }
      showRecallModal(plan, () => confirmRecall(key, item))
    }

    // ---- hide the recalled range in the DOM view ----
    const RECALL_HIDDEN_KEY = "dshRecallHiddenRanges"
    function recalledRanges() {
      try {
        const raw = localStorage.getItem(RECALL_HIDDEN_KEY)
        const list = raw === null ? [] : JSON.parse(raw)
        if (!Array.isArray(list)) return []
        const out = []
        for (const r of list) {
          if (!r || typeof r.key !== "string") continue
          // legacy {key, lastKey} records (range-walk era): expand ONCE into an
          // explicit key set, but only when BOTH endpoints resolve — otherwise
          // the walk could over-hide (this is what hid new messages before)
          if (!Array.isArray(r.keys)) {
            const expanded = expandLegacyRange(r)
            if (expanded !== null) out.push({ key: r.key, keys: expanded })
            continue
          }
          out.push(r)
        }
        if (out.length !== list.length) {
          try { localStorage.setItem(RECALL_HIDDEN_KEY, JSON.stringify(out)) } catch { /* ignore */ }
        }
        return out
      } catch {
        return []
      }
    }
    function expandLegacyRange(range) {
      const root = document.querySelector("[data-conversation-scroll]")
      if (root === null) return null
      const byKey = new Map()
      for (const el of root.querySelectorAll("[data-chat-flow-key]")) {
        const k = el.dataset.chatFlowKey
        if (k !== undefined) byKey.set(k, el)
      }
      const start = byKey.get(range.key)
      const end = range.lastKey !== undefined ? byKey.get(range.lastKey) : null
      if (start === undefined || (range.lastKey !== undefined && end === null)) return null
      const keys = []
      let el = start
      let guard = 0
      while (el !== null && guard < 100000) {
        const k = el.dataset.chatFlowKey
        if (k !== undefined) keys.push(k)
        guard++
        if (el === end) break
        el = el.nextElementSibling
      }
      return keys
    }
    function hideRangeFrom(item, lastItem) {
      let el = item
      let guard = 0
      while (el !== null && guard < 100000) {
        el.dataset.dshRecalled = "1"
        guard++
        if (el === lastItem) break
        el = el.nextElementSibling
      }
      if (lastItem !== null && lastItem.dataset.dshRecalled !== "1") lastItem.dataset.dshRecalled = "1"
    }
    // apply persisted ranges on every frame (survives React re-renders and page
    // refreshes; flow keys are globally unique per message, and only the exact
    // recorded items are hidden — never anything appended later)
    function applyRecalledHides(root) {
      const ranges = recalledRanges()
      if (ranges.length === 0) return
      const byKey = new Map()
      for (const el of root.querySelectorAll("[data-chat-flow-key]")) {
        const k = el.dataset.chatFlowKey
        if (k !== undefined) byKey.set(k, el)
      }
      for (const range of ranges) {
        for (const k of range.keys) {
          const el = byKey.get(k)
          if (el !== undefined) el.dataset.dshRecalled = "1"
        }
      }
      // hide reply rows that sit inside a hidden range: their anchor (first AI
      // item) or their preceding user item is hidden
      for (const row of replyRows) {
        if (!row.isConnected || row.dataset.dshRecalled === "1") continue
        const anchor = row._anchor
        const prev = row.previousElementSibling
        const hidden =
          (anchor !== undefined && anchor.dataset && anchor.dataset.dshRecalled === "1") ||
          (prev !== null && prev.dataset && prev.dataset.dshRecalled === "1")
        if (hidden) row.dataset.dshRecalled = "1"
      }
    }
    function persistRecalledRange(item, lastItem) {
      const key = item.dataset.chatFlowKey
      if (key === undefined) return
      // record the EXACT flow keys of every item in the range — a later walk
      // could over-hide new messages when the end marker is missing
      const keys = []
      let el = item
      let guard = 0
      while (el !== null && guard < 100000) {
        const k = el.dataset.chatFlowKey
        if (k !== undefined) keys.push(k)
        guard++
        if (el === lastItem) break
        el = el.nextElementSibling
      }
      try {
        const ranges = recalledRanges()
        ranges.push({ key, keys })
        localStorage.setItem(RECALL_HIDDEN_KEY, JSON.stringify(ranges))
      } catch { /* storage unavailable */ }
    }

    async function confirmRecall(key, item) {
      let done
      try {
        const res = await fetch(RECALL_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, confirm: true })
        })
        done = await res.json()
      } catch (err) {
        showRecallModal({ ok: false, text: "\u7F51\u7EDC\u9519\u8BEF\uFF1A" + (err && err.message ? err.message : String(err)) }, null)
        return
      }
      if (!done.ok) { showRecallModal({ ok: false, text: done.error || "\u64A4\u56DE\u5931\u8D25" }, null); return }
      // hide the recalled message and everything after it (up to the current
      // end) in the DOM; the harness view projection still renders shadowed
      // events, so the plugin hides them itself and persists the range
      const root = document.querySelector("[data-conversation-scroll]")
      let lastItem = null
      if (root !== null && item.isConnected) {
        const all = root.querySelectorAll("[data-chat-flow-key]")
        lastItem = all.length > 0 ? all[all.length - 1] : null
        hideRangeFrom(item, lastItem)
        persistRecalledRange(item, lastItem)
      }
      // prefill the composer with the original text for re-editing
      const ta = document.querySelector("[data-composer-seat] textarea")
      if (ta !== null) {
        ta.focus()
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
        if (setter !== undefined) setter.call(ta, done.text)
        ta.dispatchEvent(new Event("input", { bubbles: true }))
      }
      if (done.errors !== undefined && done.errors.length) {
        showRecallModal({ ok: false, text: "\u64A4\u56DE\u5DF2\u5B8C\u6210\uFF0C\u4F46\u90E8\u5206\u6587\u4EF6\u56DE\u9000\u5931\u8D25\uFF1A\n" + done.errors.join("\n") }, null)
      }
    }

    // ------------------------------------------------- shared frame loop
    let replyPinOffset = 0
    let raf = 0
    function frame() {
      raf = 0
      const root = document.querySelector("[data-conversation-scroll]")
      if (root === null) return

      cleanupOrphanRows()
      ensureReplyRows(root)
      ensureTopButton()
      ensureNav()
      applyRecalledHides(root)
      syncNav(root)
      ensureRecallButtons(root)

      // a) keep collapsed replies collapsed as new nodes stream in
      for (const row of replyRows) {
        if (row.getAttribute("data-collapsed") === "1") markReply(row, true)
      }

      // a2) streaming behavior: running blocks (think / tool / command) stay
      //     expanded and follow the output; once a block finishes it folds back
      //     into its summary row. When the turn ends, the whole flow folds to
      //     the final text only.
      const disclosureRows = root.querySelectorAll("[data-disclosure-row]")
      for (let i = 0; i < disclosureRows.length; i++) {
        const row = disclosureRows[i]
        const parent = row.parentElement
        if (parent === null) continue
        const expanded = parent.hasAttribute("data-open")
        const running = row.closest('[data-state="running"]') !== null
        if (running) {
          wasRunningRows.add(row)
          if (!expanded && !autoExpandedRows.has(row)) {
            autoExpandedRows.add(row)
            row.click()
          }
        } else if (wasRunningRows.has(row)) {
          wasRunningRows.delete(row)
          autoExpandedRows.delete(row)
          if (expanded) row.click()
        }
      }
      for (const row of replyRows) {
        if (!row.isConnected || autoCollapsedFlows.has(row)) continue
        const span = replySpan(row)
        const done = span.some((el) => el.dataset.chatFlowKind === "turn-tail")
        if (!done) continue
        autoCollapsedFlows.add(row)
        if (row.getAttribute("data-collapsed") !== "1") {
          const btn = row.querySelector("button")
          if (btn !== null) btn.click()
          else {
            row.setAttribute("data-collapsed", "1")
            markReply(row, true)
          }
        }
      }

      // b) pin each reply row at the head while its reply spans the viewport.
      //    A placeholder keeps the flow slot, so position:fixed never shifts
      //    layout and the natural position is always read from the placeholder
      //    (never from the fixed row itself).
      replyPinOffset = 0
      for (const row of replyRows) {
        if (!row.isConnected) continue
        const scrollport = scrollportOf(row)
        const pinTop = (scrollport === null ? 0 : scrollport.getBoundingClientRect().top) + padOf(scrollport)
        let slot = row._dshSlot
        if (slot !== undefined && slot !== null && !slot.isConnected) { slot = null; row._dshSlot = null }
        const naturalRect = slot !== undefined && slot !== null ? slot.getBoundingClientRect() : row.getBoundingClientRect()
        const items = replySpan(row)
        const endEl = items.length > 0 ? items[items.length - 1] : row
        const endBottom = endEl.getBoundingClientRect().bottom
        // pin only while EXPANDED (the collapse control stays reachable while
        // scrolling a long reply); a collapsed flow is short and must not float
        const collapsed = row.getAttribute("data-collapsed") === "1"
        const pinned = !collapsed && naturalRect.top < pinTop && endBottom > pinTop + ROW_HEIGHT
        if (pinned) {
          if (slot === undefined || slot === null) {
            slot = document.createElement("div")
            slot.className = "dshReplySlot"
            slot.style.height = ROW_HEIGHT + "px"
            row.before(slot)
            row._dshSlot = slot
          }
          row.style.position = "fixed"
          row.style.top = pinTop + "px"
          row.style.left = naturalRect.left + "px"
          row.style.width = naturalRect.width + "px"
          row.style.zIndex = "8"
          row.setAttribute("data-pinned", "1")
          replyPinOffset = ROW_HEIGHT
        } else {
          if (slot !== undefined && slot !== null) {
            slot.remove()
            row._dshSlot = null
          }
          row.style.position = ""
          row.style.top = ""
          row.style.left = ""
          row.style.width = ""
          row.style.zIndex = ""
          row.removeAttribute("data-pinned")
        }
      }

      // c) stuck class for every open disclosure row (small rows pin below a
      //    pinned reply row)
      const rows = root.querySelectorAll("[data-open] > [data-disclosure-row]")
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const scrollport = scrollportOf(row)
        const isChat = scrollport === root
        const offset = isChat ? replyPinOffset : 0
        const pinTop = (scrollport === null ? 0 : scrollport.getBoundingClientRect().top) + padOf(scrollport) + offset
        const rect = row.getBoundingClientRect()
        const stuck = rect.top <= pinTop + 1 && rect.bottom > pinTop + 1
        row.style.setProperty("--dsh-stick-top", offset + "px")
        if (stuck) {
          row.style.setProperty("--dsh-stick-pad", (padOf(scrollport) + offset) + "px")
          row.setAttribute("data-dsh-stuck", "1")
        } else {
          row.removeAttribute("data-dsh-stuck")
        }
      }

      // d) back-to-top button: visible when scrolled down; anchored above the
      //    composer, right-aligned with the column
      const rect = root.getBoundingClientRect()
      const colWidth = Math.min(748, window.innerWidth - 64)
      const right = Math.max(16, (window.innerWidth - colWidth) / 2)
      topButton.style.top = (rect.bottom - 44) + "px"
      topButton.style.right = right + "px"
      topButton.style.display = root.scrollTop > 200 ? "" : "none"
    }
    function schedule() {
      if (raf !== 0) return
      raf = requestAnimationFrame(frame)
      // fallback for throttled rAF (background/headless tabs) — guarantees the
      // frame always runs once per scheduling burst
      setTimeout(() => {
        if (raf === 0) return
        cancelAnimationFrame(raf)
        raf = 0
        frame()
      }, 50)
    }

    // ------------------------------------------------------------- plugin
    const inject = ["sessions"]
    function apply(ctx) {
      sessionsSvc = ctx.sessions
      ctx.effect(() => {
        const target = document.body ?? document.documentElement
        target.addEventListener("scroll", schedule, { capture: true, passive: true })
        window.addEventListener("scroll", schedule, { capture: true, passive: true })
        window.addEventListener("resize", schedule)
        const observer = new MutationObserver(schedule)
        observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-open", "data-state"], characterData: true })
        // polling safety net: guarantees the flow auto-collapse fires right
        // after a turn completes even if a specific DOM mutation was missed
        const interval = setInterval(schedule, 1000)
        schedule()
        return () => {
          clearInterval(interval)
          target.removeEventListener("scroll", schedule, { capture: true })
          window.removeEventListener("scroll", schedule, { capture: true })
          window.removeEventListener("resize", schedule)
          observer.disconnect()
          // remove every DOM artifact so a hot reload re-creates them cleanly
          for (const el of [navEl, navIconEl, tooltipEl, topButton, styleEl]) {
            if (el !== null && el.isConnected) el.remove()
          }
          hideRecallModal()
          document.querySelectorAll(".dshRecallBtn").forEach((el) => el.remove())
          navEl = null
          navListEl = null
          navIconEl = null
          tooltipEl = null
          topButton = null
          styleEl = null
          sessionsSvc = null
          replyRows.clear()
          window.__dshDialogOptimizeLoaded = false
        }
      }, "dialog-optimize: frame")
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
