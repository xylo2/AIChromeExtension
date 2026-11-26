/**
 * Gestion du repliage, du regroupement par tour, de la purge DOM et de l'auto-Suite.
 */
class CodeBlockManager {
  constructor(spillDetector, chatInjector, onPurgeCallback = null, svgPreview = null) {
    this.spill = spillDetector; this.chat = chatInjector; this.onPurge = onPurgeCallback; this.svgPreview = svgPreview;
    this.verifier = window.GmcBlockVerificationHelper ? new window.GmcBlockVerificationHelper(chatInjector, spillDetector) : null;
    this.controlsUi = window.GmcBlockControlsUiHelper ? new window.GmcBlockControlsUiHelper(spillDetector, svgPreview) : null;
    this.MAX_SAFE_LINES = 75; this.MAX_ACTIVE_DOM_BLOCKS = 4; this.MAX_VISIBLE_TURNS = 4;
    this.TURN_SELECTOR = "[data-aim-turn], [data-turn-id], message-content, model-response, user-query";
    this.AUTO_SUITE_DELAY_MS = 2800; this.MAX_CONSECUTIVE_AUTO_SUITE = 2;
    this.trackedBlocks = []; this.autoSentSuiteForTurn = null; this.consecutiveAutoSuiteCount = 0; this.pendingSuiteTimer = null;
    this.bindUserTypingCancelsAutoSuite();
  }

  bindUserTypingCancelsAutoSuite() {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    const cancel = (ev) => {
      if (ev?.isTrusted === false || (ev?.type === "keydown" && (ev.ctrlKey || ev.metaKey || ev.altKey))) return;
      if (this.pendingSuiteTimer) this.resetAutoSuiteQuota();
    };
    ["keydown", "beforeinput", "input", "paste"].forEach((evtName) => document.addEventListener(evtName, cancel, true));
  }

  isComposerNonEmpty() {
    if (!this.chat || typeof this.chat.findChatInputElement !== "function" || typeof this.chat.getInputText !== "function") return false;
    const inputEl = this.chat.findChatInputElement();
    return Boolean(inputEl && this.chat.getInputText(inputEl) !== "");
  }

  isItemPurged(item) { return Boolean(item?.purged || item?.el?.getAttribute?.("data-gmc-purged") === "true"); }
  getUnpurgedBlocks() { return this.trackedBlocks.filter((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b)); }
  getUnpurgedBlocksFrom(startItem) {
    const idx = this.trackedBlocks.indexOf(startItem);
    const slice = idx >= 0 ? this.trackedBlocks.slice(idx) : this.trackedBlocks;
    return slice.filter((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b));
  }
  getUnpurgedCount() { return this.getUnpurgedBlocks().length; }
  hideSuiteBanner() { this.verifier?.hideSuiteBanner(); }
  showSuiteBanner(delayMs) { this.verifier?.showSuiteBanner(delayMs, () => this.resetAutoSuiteQuota()); }
  resetAutoSuiteQuota() { this.consecutiveAutoSuiteCount = 0; if (this.pendingSuiteTimer) { clearTimeout(this.pendingSuiteTimer); this.pendingSuiteTimer = null; } this.hideSuiteBanner(); }

  preserveScrollAround(targetEl, mutatorFn) {
    if (!targetEl || typeof targetEl.getBoundingClientRect !== "function" || typeof window === "undefined" || typeof window.scrollBy !== "function") return mutatorFn();
    const beforeRect = targetEl.getBoundingClientRect();
    const res = mutatorFn();
    if (beforeRect.top < 0 && beforeRect.height > 0) {
      const delta = targetEl.getBoundingClientRect().height - beforeRect.height;
      if (Math.abs(delta) > 2) window.scrollBy(0, delta);
    }
    return res;
  }

  formatLabel(headerName, lineCount, hasSpill, hasSvg = false) {
    const svgTag = hasSvg ? " [SVG — survoler pour aperçu]" : "";
    if (hasSpill) return `🚨 ${headerName}${svgTag} (${lineCount} lignes — débordement hors bloc récupéré)`;
    if (lineCount > this.MAX_SAFE_LINES) return `⚠️ ${headerName}${svgTag} (${lineCount} lignes — bloc long > 75)`;
    return `${hasSvg ? "🖼️" : "📄"} ${headerName}${svgTag} (${lineCount} lignes)`;
  }

  extractSingleItemCode(item) {
    if (this.isItemPurged(item) && item.cachedCombinedCode) return item.cachedCombinedCode;
    const baseCode = this.spill.extractRawCode(item.el), sp = this.spill.collect(item.el);
    item.spilledNodes = sp.nodes;
    const combined = [sp.beforeText, baseCode, sp.afterText].filter(Boolean).join("\n");
    if (combined) item.cachedCombinedCode = combined;
    return combined;
  }

  extractCombinedCode(item) {
    return (Array.isArray(item?.groupItems) && item.groupItems.length > 1)
      ? item.groupItems.map((m) => this.extractSingleItemCode(m)).filter(Boolean).join("\n\n")
      : this.extractSingleItemCode(item);
  }
  purgeDomOnly(item, customMessage = "Contenu copié et purgé") {
    const { el, labelEl, purgeButtons, verifyBtn, headerName, spilledNodes } = item;
    if (!el || this.isItemPurged(item)) return false;
    if (!item.cachedCombinedCode) this.extractSingleItemCode(item);
    return this.preserveScrollAround(el.parentElement || el, () => {
      const codeNode = el.tagName === "CODE" ? el : (el.querySelector("code") || el);
      codeNode.textContent = headerName ? `${headerName} — ${customMessage}` : customMessage;
      item.purged = true; el.setAttribute("data-gmc-purged", "true"); el.classList.add("gmc-purged-code");
      (spilledNodes || []).forEach((n) => n.remove()); item.spilledNodes = [];
      if (labelEl) labelEl.textContent = `✅ ${headerName || "Bloc"} — ${customMessage}`;
      (purgeButtons || []).forEach((btn) => { btn.disabled = true; btn.classList.add("gmc-purged-btn"); });
      if (verifyBtn && !verifyBtn.disabled) verifyBtn.title = "Transmettre le bloc à l'IA pour vérification (sans copier ni purger)";
      return true;
    });
  }
  isSpilledItem(item) { return Boolean(item?.hasSpill || item?.spilledNodes?.length > 0 || item?.cardEl?.classList?.contains?.("gmc-spilled") || item?.placeholderEl?.classList?.contains?.("gmc-spilled")); }
  purgeAll() { let any = false; this.trackedBlocks.forEach((b) => { if (this.purgeDomOnly(b, "Purge manuelle")) any = true; }); if (any && typeof this.onPurge === "function") this.onPurge(); }
  compactExcessDomBlocks() { const active = this.getUnpurgedBlocks(); if (active.length <= this.MAX_ACTIVE_DOM_BLOCKS) return 0; let count = 0; for (const oldItem of active.slice(0, active.length - this.MAX_ACTIVE_DOM_BLOCKS)) { if (this.purgeDomOnly(oldItem, "Auto-allégé (DOM)")) count += 1; } return count; }
  extractTurnPreview(turn) { const raw = String(turn?.textContent || "").replace(/\s+/g, " ").trim(); return !raw ? "" : (raw.length > 50 ? `${raw.slice(0, 50).trim()}…` : raw); }
  compactOldConversationTurns() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return 0;
    const allTurns = Array.from(document.querySelectorAll(this.TURN_SELECTOR));
    const topTurns = allTurns.filter((el) => !allTurns.some((other) => other !== el && other.contains?.(el)));
    if (topTurns.length <= this.MAX_VISIBLE_TURNS) return 0;
    let collapsed = 0;
    for (const turn of topTurns.slice(0, topTurns.length - this.MAX_VISIBLE_TURNS)) {
      if (turn.getAttribute?.("data-gmc-turn-state") || turn.querySelector?.("textarea, [contenteditable='true'], pre:not([data-gmc-purged='true'])")) continue;
      turn.setAttribute("data-gmc-turn-state", "collapsed"); turn.classList?.add?.("gmc-collapsed-turn");
      if (turn.parentNode && typeof document.createElement === "function") {
        const pill = document.createElement("div"); pill.className = "gmc-placeholder gmc-turn-placeholder";
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "gmc-toggle-btn";
        const preview = this.extractTurnPreview(turn);
        btn.textContent = preview ? `💬 Tour ancien masqué : « ${preview} » (Afficher)` : "💬 Tour ancien masqué (Afficher)";
        btn.addEventListener("click", () => { turn.setAttribute("data-gmc-turn-state", "expanded"); turn.classList?.remove?.("gmc-collapsed-turn"); pill.remove(); });
        pill.appendChild(btn); turn.parentNode.insertBefore(pill, turn);
      }
      collapsed += 1;
    }
    return collapsed;
  }
  async copyAndPurgeTargets(targets) {
    if (targets.length === 0) return 0;
    const chunks = targets.map((it) => this.extractSingleItemCode(it)).filter(Boolean);
    if (chunks.length > 0) { try { await navigator.clipboard.writeText(chunks.join("\n\n")); } catch (_err) {} }
    let purgedCount = 0, hasAlertItem = false;
    for (const item of targets) { if (this.isSpilledItem(item)) hasAlertItem = true; if (this.purgeDomOnly(item)) purgedCount += 1; }
    if (purgedCount > 0) { if (typeof this.onPurge === "function") this.onPurge(); const lastItem = targets.at(-1); if (lastItem && !hasAlertItem) this.maybeAutoSendSuite(lastItem); }
    return purgedCount;
  }
  async copyAndPurgeAll() { return this.copyAndPurgeTargets(this.getUnpurgedBlocks()); }
  async copyAndPurgeFrom(startItem) { return this.copyAndPurgeTargets(this.getUnpurgedBlocksFrom(startItem)); }
  async copyOnly(item) { const text = this.extractCombinedCode(item); try { await navigator.clipboard.writeText(text); } catch (_err) {} return text; }
  findTurnContainer(el) { return this.verifier ? this.verifier.findTurnContainer(el) : (el?.parentElement || null); }
  hasSuitePromptAfterBlock(item) { return this.verifier ? this.verifier.hasSuitePromptAfterBlock(item) : false; }
  maybeAutoSendSuite(item) { if (!this.chat || typeof this.chat.insertPrompt !== "function" || this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE || this.getUnpurgedCount() > 0 || this.isComposerNonEmpty()) return false; const turnKey = this.findTurnContainer(item.el) || item.el; if (this.autoSentSuiteForTurn === turnKey || !this.hasSuitePromptAfterBlock(item)) return false; this.autoSentSuiteForTurn = turnKey; if (this.pendingSuiteTimer) clearTimeout(this.pendingSuiteTimer); this.showSuiteBanner(this.AUTO_SUITE_DELAY_MS); this.pendingSuiteTimer = setTimeout(() => { this.pendingSuiteTimer = null; this.hideSuiteBanner(); if (this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE || this.isComposerNonEmpty()) return; this.consecutiveAutoSuiteCount += 1; this.chat.insertPrompt("Suite", true); }, this.AUTO_SUITE_DELAY_MS); return true; }
  scrollToNextUnpurgedBlock(currentItem) { const startIdx = this.trackedBlocks.indexOf(currentItem); if (startIdx < 0) return false; const nextItem = this.trackedBlocks.slice(startIdx + 1).find((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b) && !b.isSecondaryInGroup); const target = nextItem ? (nextItem.headerPurgeBtn?.isConnected ? nextItem.headerPurgeBtn : (nextItem.placeholderEl || nextItem.el)) : null; if (target && typeof target.scrollIntoView === "function") { target.scrollIntoView({ behavior: "smooth", block: "center" }); return true; } return false; }
  async copyAndPurge(item) { const members = Array.isArray(item?.groupItems) && item.groupItems.length > 1 ? item.groupItems : [item]; const hasSpill = members.some((m) => this.isSpilledItem(m)) || this.isSpilledItem(item); await this.copyOnly(item); let anyPurged = false; for (const m of members) { if (this.purgeDomOnly(m)) anyPurged = true; } if (anyPurged) { if (typeof this.onPurge === "function") this.onPurge(); const lastMember = members.at(-1) || item; if (!this.scrollToNextUnpurgedBlock(lastMember) && !hasSpill) this.maybeAutoSendSuite(lastMember); } }
  toggleBlockDisplay(item) { const members = Array.isArray(item?.groupItems) && item.groupItems.length > 1 ? item.groupItems : [item]; const collapsed = item.el.classList.toggle("gmc-collapsed-code"); if (item.toggleBtn) item.toggleBtn.textContent = collapsed ? "Afficher" : "Masquer"; for (const m of members) { if (m !== item) m.el.classList.toggle("gmc-collapsed-code", collapsed); const wrapper = this.spill.findCodeBlockWrapper(m.el); if (wrapper && wrapper !== m.el && m.isSecondaryInGroup) wrapper.classList.toggle("gmc-grouped-secondary-block", collapsed); } this.syncItem(item); this.attachHeaderControls(item.el, item); }
  groupTurnBlocks() {
    const byTurn = new Map();
    for (const item of this.trackedBlocks) { if (!item?.el || item.el.isConnected === false) continue; const turn = this.findTurnContainer(item.el); if (!turn || turn === document.body) { item.groupItems = null; item.isSecondaryInGroup = false; continue; } if (!byTurn.has(turn)) byTurn.set(turn, []); byTurn.get(turn).push(item); }
    for (const items of byTurn.values()) {
      if (items.length <= 1) { const s = items.at(0); if (s) { s.groupItems = null; s.isSecondaryInGroup = false; } continue; }
      const lead = items.at(0); lead.groupItems = items; lead.isSecondaryInGroup = false; const leadCollapsed = lead.el.classList.contains("gmc-collapsed-code");
      for (let i = 1; i < items.length; i += 1) { const sec = items.at(i); sec.groupItems = null; sec.isSecondaryInGroup = true; sec.el.classList.toggle("gmc-collapsed-code", leadCollapsed); const wrapper = this.spill.findCodeBlockWrapper(sec.el); if (wrapper && wrapper !== sec.el) wrapper.classList.toggle("gmc-grouped-secondary-block", leadCollapsed); }
    }
  }
  buildFallbackAttachmentName(headerName) { return this.verifier ? this.verifier.buildFallbackAttachmentName(headerName) : (headerName || "bloc.txt") + ".txt"; }
  async verifyWithAi(item) { if (!this.verifier) return; this.resetAutoSuiteQuota(); await this.verifier.verifyWithAi(item, (it) => this.extractSingleItemCode(it)); }
  syncItem(item) { if (item?.el && this.controlsUi) this.controlsUi.syncItemVisuals(item, this); }
  createPurgeBtn(item) { return this.controlsUi ? this.controlsUi.createPurgeBtn(item, (it) => this.copyAndPurge(it)) : document.createElement("button"); }
  createDownloadBtn(item) { return this.controlsUi ? this.controlsUi.createDownloadBtn(item, (it) => this.extractCombinedCode(it)) : document.createElement("button"); }
  attachHeaderControls(pre, item) { this.controlsUi?.attachHeaderControls(pre, item, (it) => this.copyAndPurge(it), (it) => this.extractCombinedCode(it)); }
  detectHeaderName(rawCode) { const m = this.spill.findFirstNonEmptyLine(rawCode).match(this.spill.FILE_TAG_REGEX); return m ? m.at(1) : (this.svgPreview?.hasSvg(rawCode) ? "image.svg" : null); }
  scan(preExisting = false) {
for (const pre of document.querySelectorAll("pre")) { if (pre.getAttribute("data-gmc-processed") === "true") continue; const rawCode = this.spill.extractRawCode(pre); if (!rawCode.includes("\n") && !preExisting) continue; const headerName = this.detectHeaderName(rawCode); if (!headerName || !this.controlsUi) continue; pre.setAttribute("data-gmc-processed", "true"); const item = this.controlsUi.buildTrackedBlockItem(pre, headerName, preExisting, this); this.trackedBlocks.push(item); this.preserveScrollAround(pre.parentElement || pre, () => { pre.parentNode.insertBefore(item.placeholderEl, pre); pre.classList.add("gmc-collapsed-code"); }); }
this.groupTurnBlocks(); this.compactExcessDomBlocks(); this.compactOldConversationTurns();
for (const item of this.trackedBlocks) { this.attachHeaderControls(item.el, item); this.syncItem(item); }
}
}
window.GmcCodeBlockManager = CodeBlockManager;
