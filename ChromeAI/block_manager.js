/**
 * Gestion du repliage, de la purge DOM et de la navigation entre blocs FILE / SVG.
 */
class CodeBlockManager {
  constructor(spillDetector, chatInjector, onPurgeCallback = null, svgPreview = null) {
    this.spill = spillDetector;
    this.chat = chatInjector;
    this.onPurge = onPurgeCallback;
    this.svgPreview = svgPreview;
    this.verifier = window.GmcBlockVerificationHelper ? new window.GmcBlockVerificationHelper(chatInjector, spillDetector) : null;
    this.controlsUi = window.GmcBlockControlsUiHelper ? new window.GmcBlockControlsUiHelper(spillDetector, svgPreview) : null;
    this.MAX_SAFE_LINES = 95;
    this.AUTO_SUITE_DELAY_MS = 2800;
    this.MAX_CONSECUTIVE_AUTO_SUITE = 2;
    this.trackedBlocks = [];
    this.autoSentSuiteForTurn = null;
    this.consecutiveAutoSuiteCount = 0;
    this.pendingSuiteTimer = null;
  }

  isItemPurged(item) { return Boolean(item?.purged || item?.el?.getAttribute?.("data-gmc-purged") === "true"); }

  resetAutoSuiteQuota() {
    this.consecutiveAutoSuiteCount = 0;
    if (this.pendingSuiteTimer) { clearTimeout(this.pendingSuiteTimer); this.pendingSuiteTimer = null; }
  }

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
    if (lineCount > this.MAX_SAFE_LINES) return `⚠️ ${headerName}${svgTag} (${lineCount} lignes — bloc long)`;
    return `${hasSvg ? "🖼️" : "📄"} ${headerName}${svgTag} (${lineCount} lignes)`;
  }

  extractCombinedCode(item) {
    if (this.isItemPurged(item) && item.cachedCombinedCode) return item.cachedCombinedCode;
    const baseCode = this.spill.extractRawCode(item.el);
    const sp = this.spill.collect(item.el);
    item.spilledNodes = sp.nodes;
    const combined = [sp.beforeText, baseCode, sp.afterText].filter(Boolean).join("\n");
    if (combined) item.cachedCombinedCode = combined;
    return combined;
  }

  purgeDomOnly(item, customMessage = "Contenu copié et purgé") {
    const { el, labelEl, purgeButtons, verifyBtn, headerName, spilledNodes } = item;
    if (!el || this.isItemPurged(item)) return false;
    if (!item.cachedCombinedCode) this.extractCombinedCode(item);
    return this.preserveScrollAround(el.parentElement || el, () => {
      const codeNode = el.tagName === "CODE" ? el : (el.querySelector("code") || el);
      codeNode.textContent = headerName ? `${headerName} — ${customMessage}` : customMessage;
      item.purged = true;
      el.setAttribute("data-gmc-purged", "true");
      el.classList.add("gmc-purged-code");
      (spilledNodes || []).forEach((n) => n.remove());
      item.spilledNodes = [];
      if (labelEl) labelEl.textContent = `✅ ${headerName || "Bloc"} — ${customMessage}`;
      (purgeButtons || []).forEach((btn) => { btn.disabled = true; btn.classList.add("gmc-purged-btn"); });
      if (verifyBtn && !verifyBtn.disabled) verifyBtn.title = "Transmettre le bloc à l'IA pour vérification (sans copier ni purger)";
      return true;
    });
  }

  purgeAll() {
    let anyPurged = false;
    this.trackedBlocks.forEach((b) => { if (this.purgeDomOnly(b, "Purge manuelle")) anyPurged = true; });
    if (anyPurged && typeof this.onPurge === "function") this.onPurge();
  }
  async copyOnly(item) {
    const text = this.extractCombinedCode(item);
    try { await navigator.clipboard.writeText(text); } catch (_err) {}
    return text;
  }

  findTurnContainer(el) { return this.verifier ? this.verifier.findTurnContainer(el) : (el?.parentElement || null); }
  hasSuitePromptAfterBlock(item) { return this.verifier ? this.verifier.hasSuitePromptAfterBlock(item) : false; }

  maybeAutoSendSuite(item) {
    if (!this.chat || typeof this.chat.insertPrompt !== "function") return false;
    if (this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE) return false;
    if (this.trackedBlocks.some((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b))) return false;
    const turnKey = this.findTurnContainer(item.el) || item.el;
    if (this.autoSentSuiteForTurn === turnKey || !this.hasSuitePromptAfterBlock(item)) return false;
    this.autoSentSuiteForTurn = turnKey;
    if (this.pendingSuiteTimer) clearTimeout(this.pendingSuiteTimer);
    this.pendingSuiteTimer = setTimeout(() => {
      this.pendingSuiteTimer = null;
      if (this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE) return;
      this.consecutiveAutoSuiteCount += 1;
      this.chat.insertPrompt("Suite", true);
    }, this.AUTO_SUITE_DELAY_MS);
    return true;
  }

  scrollToNextUnpurgedBlock(currentItem) {
    const startIdx = this.trackedBlocks.indexOf(currentItem);
    if (startIdx < 0) return false;
    const nextItem = this.trackedBlocks.slice(startIdx + 1).find((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b));
    if (!nextItem) return false;
    const target = nextItem.headerPurgeBtn?.isConnected ? nextItem.headerPurgeBtn : (nextItem.placeholderEl || nextItem.el);
    if (target && typeof target.scrollIntoView === "function") { target.scrollIntoView({ behavior: "smooth", block: "center" }); return true; }
    return false;
  }

  async copyAndPurge(item) {
    const isRedOrOversized = Boolean(
      item?.hasSpill ||
      (item?.spilledNodes && item.spilledNodes.length > 0) ||
      item?.placeholderEl?.classList?.contains?.("gmc-spilled") ||
      item?.placeholderEl?.classList?.contains?.("gmc-oversized")
    );
    await this.copyOnly(item);
    if (this.purgeDomOnly(item)) {
      if (typeof this.onPurge === "function") this.onPurge();
      if (!this.scrollToNextUnpurgedBlock(item) && !isRedOrOversized) this.maybeAutoSendSuite(item);
    }
  }

  buildFallbackAttachmentName(headerName) {
    return this.verifier ? this.verifier.buildFallbackAttachmentName(headerName) : `${headerName || "bloc.txt"}.txt`;
  }

  async verifyWithAi(item) {
    if (!this.verifier) return;
    this.resetAutoSuiteQuota();
    await this.verifier.verifyWithAi(item, (it) => {
      const code = this.isItemPurged(it) ? (it.cachedCombinedCode || "") : this.extractCombinedCode(it);
      if (code) it.cachedCombinedCode = code;
      return code;
    });
  }

  syncItem(item) { if (item?.el && this.controlsUi) this.controlsUi.syncItemVisuals(item, this); }
  createPurgeBtn(item) { return this.controlsUi ? this.controlsUi.createPurgeBtn(item, (it) => this.copyAndPurge(it)) : document.createElement("button"); }
  createDownloadBtn(item) { return this.controlsUi ? this.controlsUi.createDownloadBtn(item, (it) => this.extractCombinedCode(it)) : document.createElement("button"); }
  attachHeaderControls(pre, item) { this.controlsUi?.attachHeaderControls(pre, item, (it) => this.copyAndPurge(it), (it) => this.extractCombinedCode(it)); }

  detectHeaderName(rawCode) {
    const match = this.spill.findFirstNonEmptyLine(rawCode).match(this.spill.FILE_TAG_REGEX);
    return match ? match.at(1) : (this.svgPreview?.hasSvg(rawCode) ? "image.svg" : null);
  }

  scan(preExisting = false) {
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
      this.attachHeaderControls(pre, item);
      this.syncItem(item);
    }
    for (const item of this.trackedBlocks) { this.attachHeaderControls(item.el, item); this.syncItem(item); }
  }
}
window.GmcCodeBlockManager = CodeBlockManager;
