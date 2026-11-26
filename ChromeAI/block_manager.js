// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Utilisateur_A

/**
 * Gestion du repliage, du regroupement par tour, de la purge DOM et de l'auto-Suite.
 */
class CodeBlockManager {
  /** Initialise les détecteurs, les seuils de compaction DOM et l'écouteur clavier. */
  constructor(spillDetector, chatInjector, onPurgeCallback = null, svgPreview = null) {
    this.spill = spillDetector;
    this.chat = chatInjector;
    this.onPurge = onPurgeCallback;
    this.svgPreview = svgPreview;
    this.verifier = window.GmcBlockVerificationHelper
      ? new window.GmcBlockVerificationHelper(chatInjector, spillDetector) : null;
    this.controlsUi = window.GmcBlockControlsUiHelper
      ? new window.GmcBlockControlsUiHelper(spillDetector, svgPreview) : null;
    this.MAX_SAFE_LINES = 75;
    this.MAX_ACTIVE_DOM_BLOCKS = 4;
    this.MAX_VISIBLE_TURNS = 4;
    this.TURN_SELECTOR = '.mZJni, .pWvJNd, [data-scope-id="turn"], [data-aim-turn], ' +
      "[data-turn-id], message-content, model-response, user-query";
    this.AUTO_SUITE_DELAY_MS = 2800;
    this.MAX_CONSECUTIVE_AUTO_SUITE = 2;
    this.trackedBlocks = [];
    this.autoSentSuiteForTurn = null;
    this.consecutiveAutoSuiteCount = 0;
    this.pendingSuiteTimer = null;
    this.bindUserTypingCancelsAutoSuite();
  }

  /** Annule le compte à rebours auto-Suite dès que l'utilisateur saisit du texte. */
  bindUserTypingCancelsAutoSuite() {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    const cancel = (ev) => {
      const modKey = ev?.type === "keydown" && (ev.ctrlKey || ev.metaKey || ev.altKey);
      if (ev?.isTrusted !== false && !modKey && this.pendingSuiteTimer) this.resetAutoSuiteQuota();
    };
    ["keydown", "beforeinput", "input", "paste"].forEach((evtName) => {
      document.addEventListener(evtName, cancel, true);
    });
  }

  /** Indique si la zone de saisie du compositeur contient déjà un brouillon non vide. */
  isComposerNonEmpty() {
    const inputEl = this.chat?.findChatInputElement?.();
    return Boolean(inputEl && this.chat?.getInputText?.(inputEl) !== "");
  }

  /** Vérifie si un bloc suivi a déjà été purgé du DOM. */
  isItemPurged(item) { return Boolean(item?.purged || item?.el?.getAttribute?.("data-gmc-purged") === "true"); }
  pruneDisconnectedBlocks() { this.trackedBlocks = this.trackedBlocks.filter((b) => b?.el && b.el.isConnected !== false); }
  getUnpurgedBlocks() { return this.trackedBlocks.filter((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b)); }
  getUnpurgedBlocksFrom(startItem) {
    const idx = this.trackedBlocks.indexOf(startItem);
    return (idx >= 0 ? this.trackedBlocks.slice(idx) : this.trackedBlocks).filter((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b));
  }
  getUnpurgedCount() { return this.getUnpurgedBlocks().length; }
  hideSuiteBanner() { this.verifier?.hideSuiteBanner(); }
  showSuiteBanner(delayMs) { this.verifier?.showSuiteBanner(delayMs, () => this.resetAutoSuiteQuota()); }
  resetAutoSuiteQuota() {
    this.consecutiveAutoSuiteCount = 0;
    if (this.pendingSuiteTimer) { clearTimeout(this.pendingSuiteTimer); this.pendingSuiteTimer = null; }
    this.hideSuiteBanner();
  }
  preserveScrollAround(_targetEl, mutatorFn) { return mutatorFn(); }
  /** Formate le libellé d'état d'un bloc (normal, >75 lignes, débordement ou SVG). */
  formatLabel(headerName, lineCount, hasSpill, hasSvg = false) {
    const svgTag = hasSvg ? " [SVG — survoler pour aperçu]" : "";
    if (hasSpill) return `🚨 ${headerName}${svgTag} (${lineCount} lignes — débordement hors bloc récupéré)`;
    if (lineCount > this.MAX_SAFE_LINES) return `⚠️ ${headerName}${svgTag} (${lineCount} lignes — bloc long > 75)`;
    return `${hasSvg ? "🖼️" : "📄"} ${headerName}${svgTag} (${lineCount} lignes)`;
  }

  /** Extrait et met en cache le code complet d'un bloc unique. */
  extractSingleItemCode(item) {
    if (this.isItemPurged(item) && item.cachedCombinedCode) return item.cachedCombinedCode;
    const baseCode = this.spill.extractRawCode(item.el), sp = this.spill.collect(item.el);
    item.spilledNodes = sp.nodes;
    const combined = [sp.beforeText, baseCode, sp.afterText].filter(Boolean).join("\n");
    if (combined) item.cachedCombinedCode = combined;
    return combined;
  }

  /** Extrait le code combiné d'un bloc simple ou d'un groupe de blocs. */
  extractCombinedCode(item) {
    if (Array.isArray(item?.groupItems) && item.groupItems.length > 1) {
      return item.groupItems.map((m) => this.extractSingleItemCode(m)).filter(Boolean).join("\n\n");
    }
    return this.extractSingleItemCode(item);
  }

  /** Remplace le contenu DOM d'un bloc et de ses débordements par un marqueur léger. */
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
      if (verifyBtn && !verifyBtn.disabled) verifyBtn.title = "Vérifier ce bloc avec l'IA";
      return true;
    });
  }

  isSpilledItem(item) { return Boolean(item?.hasSpill || item?.spilledNodes?.length > 0 || item?.cardEl?.classList?.contains?.("gmc-spilled")); }
  purgeAll() {
    let any = false;
    this.trackedBlocks.forEach((b) => { if (this.purgeDomOnly(b, "Purge manuelle")) any = true; });
    if (any && typeof this.onPurge === "function") this.onPurge();
  }
  compactExcessDomBlocks() {
    const active = this.getUnpurgedBlocks();
    if (active.length <= this.MAX_ACTIVE_DOM_BLOCKS) return 0;
    let count = 0;
    for (const oldItem of active.slice(0, active.length - this.MAX_ACTIVE_DOM_BLOCKS)) {
      if (this.purgeDomOnly(oldItem, "Auto-allégé (DOM)")) count += 1;
    }
    return count;
  }
  extractTurnPreview(turn) {
    const raw = String(turn?.textContent || "").replace(/\s+/g, " ").trim();
    return !raw ? "" : (raw.length > 50 ? `${raw.slice(0, 50).trim()}…` : raw);
  }
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
  /** Copie les blocs cibles dans le presse-papiers, les purge et déclenche auto-Suite si pertinent. */
  async copyAndPurgeTargets(targets) {
    if (targets.length === 0) return 0;
    const chunks = targets.map((it) => this.extractSingleItemCode(it)).filter(Boolean);
    if (chunks.length > 0) { try { await navigator.clipboard.writeText(chunks.join("\n\n")); } catch (_err) {} }
    let purgedCount = 0;
    for (const item of targets) { if (this.purgeDomOnly(item)) purgedCount += 1; }
    if (purgedCount > 0) {
      if (typeof this.onPurge === "function") this.onPurge();
      const lastItem = targets.at(-1);
      if (lastItem) this.maybeAutoSendSuite(lastItem);
    }
    return purgedCount;
  }
  async copyAndPurgeAll() { return this.copyAndPurgeTargets(this.getUnpurgedBlocks()); }
  async copyAndPurgeFrom(startItem) { return this.copyAndPurgeTargets(this.getUnpurgedBlocksFrom(startItem)); }
  async copyOnly(item) { const text = this.extractCombinedCode(item); try { await navigator.clipboard.writeText(text); } catch (_err) {} return text; }
  findTurnContainer(el) { return this.verifier ? this.verifier.findTurnContainer(el) : (el?.parentElement || null); }
  hasSuitePromptAfterBlock(item) { return this.verifier ? this.verifier.hasSuitePromptAfterBlock(item) : false; }
  maybeAutoSendSuite(item) {
    if (!this.chat || typeof this.chat.insertPrompt !== "function" || this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE || this.getUnpurgedCount() > 0 || this.isComposerNonEmpty()) return false;
    const turnKey = this.findTurnContainer(item.el) || item.el;
    if (this.autoSentSuiteForTurn === turnKey || !this.hasSuitePromptAfterBlock(item)) return false;
    this.autoSentSuiteForTurn = turnKey; if (this.pendingSuiteTimer) clearTimeout(this.pendingSuiteTimer);
    this.showSuiteBanner(this.AUTO_SUITE_DELAY_MS);
    this.pendingSuiteTimer = setTimeout(() => { this.pendingSuiteTimer = null; this.hideSuiteBanner(); if (this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE || this.isComposerNonEmpty()) return; this.consecutiveAutoSuiteCount += 1; this.chat.insertPrompt("Suite", true); }, this.AUTO_SUITE_DELAY_MS);
    return true;
  }
  hasNextUnpurgedBlock(currentItem) { const idx = this.trackedBlocks.indexOf(currentItem); return idx >= 0 && this.trackedBlocks.slice(idx + 1).some((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b) && !b.isSecondaryInGroup); }
  async copyAndPurge(item) {
    const members = Array.isArray(item?.groupItems) && item.groupItems.length > 1 ? item.groupItems : [item];
    await this.copyOnly(item); let anyPurged = false;
    for (const m of members) { if (this.purgeDomOnly(m)) anyPurged = true; }
    if (anyPurged) {
      if (typeof this.onPurge === "function") this.onPurge();
      const lastMember = members.at(-1) || item;
      if (!this.hasNextUnpurgedBlock(lastMember)) this.maybeAutoSendSuite(lastMember);
    }
  }
  findSecondaryCardRoot(secEl, leadEl, turnRoot) {
    let curr = secEl;
    for (let depth = 0; depth < 35 && curr && curr.parentElement; depth++) {
      const parent = curr.parentElement;
      if (parent === turnRoot || ["BODY", "HTML", "MAIN", "ARTICLE"].includes(String(parent.tagName || "").toUpperCase())) break;
      if ((leadEl && parent.contains?.(leadEl)) || (typeof parent.querySelectorAll === "function" && parent.querySelectorAll("pre").length > 1)) break;
      curr = parent;
    }
    return curr !== secEl ? curr : null;
  }
  setSecondaryCardHidden(cardEl, hidden) {
    if (!cardEl) return;
    cardEl.classList?.toggle("gmc-grouped-secondary-block", hidden);
    if (hidden) cardEl.setAttribute?.("data-gmc-hidden-card", "true");
    else cardEl.removeAttribute?.("data-gmc-hidden-card");
  }
  toggleBlockDisplay(item) {
    const collapsed = item.el.classList.toggle("gmc-collapsed-code");
    if (item.toggleBtn) item.toggleBtn.textContent = collapsed ? "Afficher" : "Masquer";
    const leadItem = item.groupLeadRef || item;
    if (item.isSecondaryInGroup && leadItem.el?.parentNode && typeof leadItem.el.parentNode.insertBefore === "function") {
      if (!collapsed && item.el.parentNode !== leadItem.el.parentNode) { if (!item.origParent) { item.origParent = item.el.parentNode; item.origNextSibling = item.el.nextSibling; } leadItem.el.parentNode.insertBefore(item.el, leadItem.el.nextSibling); }
      else if (collapsed && item.origParent && item.el.parentNode === leadItem.el.parentNode) { item.origParent.insertBefore(item.el, item.origNextSibling || null); }
      this.setSecondaryCardHidden(item.secondaryCardEl, collapsed);
    }
    this.syncItem(leadItem); this.attachHeaderControls(leadItem.el, leadItem);
  }
  groupTurnBlocks() {
    this.pruneDisconnectedBlocks(); const byTurn = new Map();
    for (const item of this.trackedBlocks) {
      if (item.secondaryCardEl) { this.setSecondaryCardHidden(item.secondaryCardEl, false); item.secondaryCardEl = null; }
      const turn = this.findTurnContainer(item.el);
      if (!turn || turn === document.body) { item.groupItems = null; item.isSecondaryInGroup = false; item.groupLeadRef = null; continue; }
      if (!byTurn.has(turn)) byTurn.set(turn, []);
      byTurn.get(turn).push(item);
    }
    for (const [turn, items] of byTurn.entries()) {
      if (items.length <= 1) { const s = items.at(0); if (s) { s.groupItems = null; s.isSecondaryInGroup = false; s.groupLeadRef = null; } continue; }
      const lead = items.at(0); lead.groupItems = items; lead.isSecondaryInGroup = false; lead.groupLeadRef = null;
      for (let i = 1; i < items.length; i += 1) {
        const sec = items.at(i); sec.groupItems = null; sec.isSecondaryInGroup = true; sec.groupLeadRef = lead;
        sec.secondaryCardEl = this.findSecondaryCardRoot(sec.el, lead.el, turn);
        this.setSecondaryCardHidden(sec.secondaryCardEl, sec.el.classList.contains("gmc-collapsed-code"));
      }
    }
  }
  buildFallbackAttachmentName(headerName) { return this.verifier ? this.verifier.buildFallbackAttachmentName(headerName) : (headerName || "bloc.txt") + ".txt"; }
  async verifyWithAi(item) { if (!this.verifier) return; this.resetAutoSuiteQuota(); await this.verifier.verifyWithAi(item, (it) => this.extractSingleItemCode(it)); }
  syncItem(item) { if (item?.el && this.controlsUi) { item._mgrRef = this; this.controlsUi.syncItemVisuals(item, this); } }
  createPurgeBtn(item) { return this.controlsUi ? this.controlsUi.createPurgeBtn(item, (it) => this.copyAndPurge(it)) : document.createElement("button"); }
  createDownloadBtn(item) { return this.controlsUi ? this.controlsUi.createDownloadBtn(item, (it) => this.extractCombinedCode(it)) : document.createElement("button"); }
  attachHeaderControls(pre, item) { this.controlsUi?.attachHeaderControls(pre, item, (it) => this.copyAndPurge(it), (it) => this.extractCombinedCode(it)); }
  detectHeaderName(rawCode) { const m = this.spill.findFirstNonEmptyLine(rawCode).match(this.spill.FILE_TAG_REGEX); return m ? m.at(1) : (this.svgPreview?.hasSvg(rawCode) ? "image.svg" : null); }
  scan(preExisting = false) {
    this.pruneDisconnectedBlocks();
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.getAttribute("data-gmc-processed") === "true") continue;
      const rawCode = this.spill.extractRawCode(pre);
      if (!rawCode.includes("\n") && !preExisting) continue;
      const headerName = this.detectHeaderName(rawCode);
      if (!headerName || !this.controlsUi) continue;
      pre.setAttribute("data-gmc-processed", "true");
      const item = this.controlsUi.buildTrackedBlockItem(pre, headerName, preExisting, this);
      this.trackedBlocks.push(item);
      this.preserveScrollAround(pre.parentElement || pre, () => { pre.parentNode.insertBefore(item.placeholderEl, pre); pre.classList.add("gmc-collapsed-code"); });
    }
    this.groupTurnBlocks(); this.compactExcessDomBlocks(); this.compactOldConversationTurns();
    for (const item of this.trackedBlocks) { this.attachHeaderControls(item.el, item); this.syncItem(item); }
  }
}
window.GmcCodeBlockManager = CodeBlockManager;
