/**
 * Gestion du repliage, de la purge DOM et de la vérification IA des blocs FILE / SVG.
 */
class CodeBlockManager {
  constructor(spillDetector, chatInjector, onPurgeCallback = null, svgPreview = null) {
    this.spill = spillDetector;
    this.chat = chatInjector;
    this.onPurge = onPurgeCallback;
    this.svgPreview = svgPreview;
    this.MAX_SAFE_LINES = 95;
    this.trackedBlocks = [];
    this.autoSentSuiteForTurn = null;
    this.PURGE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="12" y1="13" x2="19" y2="20"/><line x1="19" y1="13" x2="12" y2="20"/></svg>';
    this.VERIFY_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>';
    this.DOWNLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    this.DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  isItemPurged(item) {
    return Boolean(item?.purged || item?.el?.getAttribute?.("data-gmc-purged") === "true");
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

  findTurnContainer(el) {
    let curr = el;
    for (let depth = 0; depth < 14 && curr; depth++) {
      if (typeof curr.matches === "function" && curr.matches("[data-aim-turn], [data-turn-id], message-content, model-response, .conversation-container, article")) return curr;
      curr = curr.parentElement;
    }
    return el?.parentElement || null;
  }

  hasSuitePromptAfterBlock(item) {
    if (!item?.el) return false;
    const turnRoot = this.findTurnContainer(item.el);
    const tailParts = [];
    if (turnRoot && typeof turnRoot.querySelectorAll === "function") {
      for (const node of Array.from(turnRoot.querySelectorAll("p, li, div, span"))) {
        if (node === item.el || item.el.contains?.(node) || node.contains?.(item.el)) continue;
        if (node.closest?.(".gmc-placeholder, .gmc-floating-bar, pre, code")) continue;
        if (typeof item.el.compareDocumentPosition === "function" && !(item.el.compareDocumentPosition(node) & 4)) continue;
        const txt = String(node.textContent || "").trim();
        if (txt) tailParts.push(txt);
      }
    }
    let sib = this.spill.findEdgeSibling(item.el, "next") || item.el.nextSibling;
    for (let steps = 0; sib && steps < 15; steps++) {
      if ((sib.nodeType === 1 && !String(sib.className || "").includes("gmc-")) || sib.nodeType === 3) {
        const txt = String(sib.textContent || "").trim();
        if (txt) tailParts.push(txt);
      }
      sib = sib.nextSibling;
    }
    const combinedTail = tailParts.join("\n");
    return Boolean(combinedTail) && /(?:partie\s+suivante\s+attendue|r[eé]pond(?:s|re)\s*[«"']\s*suite\s*[»"']|(?:dire|dis|écris|ecris|tape|envoie|envoyer)\s*[«"']\s*suite\s*[»"'])/i.test(combinedTail);
  }

  maybeAutoSendSuite(item) {
    if (!this.chat || typeof this.chat.insertPrompt !== "function") return false;
    if (this.trackedBlocks.some((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b))) return false;
    const turnKey = this.findTurnContainer(item.el) || item.el;
    if (this.autoSentSuiteForTurn === turnKey || !this.hasSuitePromptAfterBlock(item)) return false;
    this.autoSentSuiteForTurn = turnKey;
    this.chat.insertPrompt("Suite", true);
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
    await this.copyOnly(item);
    if (this.purgeDomOnly(item)) {
      if (typeof this.onPurge === "function") this.onPurge();
      if (!this.scrollToNextUnpurgedBlock(item)) this.maybeAutoSendSuite(item);
    }
  }

  buildFallbackAttachmentName(headerName) {
    const parts = (headerName || "bloc.txt").split("|");
    const baseName = parts.at(0).trim().split(/[\\/]/).filter(Boolean).pop() || "bloc.txt";
    const partIdx = parts.length > 1 ? parts.at(1).split("/").at(0).trim() : "";
    return partIdx ? `${baseName}.part${partIdx}.txt` : `${baseName}.txt`;
  }

  requestSavedFile(headerName, maxWaitMs = 1400) {
    return new Promise((resolve) => {
      const deadline = Date.now() + maxWaitMs;
      const attempt = () => {
        if (!chrome.runtime?.id) { resolve({ ok: false }); return; }
        chrome.runtime.sendMessage({ type: "READ_SAVED_FILE", header: headerName }, (res) => {
          if (res?.ok && typeof res.content === "string") resolve(res);
          else if (Date.now() < deadline) setTimeout(attempt, 350);
          else resolve({ ok: false });
        });
      };
      attempt();
    });
  }

  async verifyWithAi(item) {
    if (!item || !item.headerName || item.isVerifyingSpill) return;
    item.isVerifyingSpill = true;
    const btn = item.verifyBtn;
    if (btn) btn.disabled = true;
    const combinedText = this.isItemPurged(item) ? (item.cachedCombinedCode || "") : this.extractCombinedCode(item);
    if (combinedText) item.cachedCombinedCode = combinedText;
    let attachName = this.buildFallbackAttachmentName(item.headerName);
    let attachContent = combinedText;
    const res = await this.requestSavedFile(item.headerName, 1400);
    if (res?.ok && typeof res.content === "string") { attachName = res.filename || attachName; attachContent = res.content; }
    item.isVerifyingSpill = false;
    this.chat.dropFile(attachName, attachContent, false);
    this.chat.insertPrompt(
      `Vérification de récupération pour \x60${item.headerName}\x60 : voici exactement le contenu récupéré dans la pièce jointe \x60${attachName}\x60. Confirme simplement si ce code correspond bien à l'intégralité de ce que tu voulais produire pour ce bloc (sans troncature, perte ou artefact d'affichage). Si jamais il manque du code ou qu'il est altéré, régénère-le découpé en plusieurs blocs \x60FILE_PART\x60 de moins de 75 lignes chacun.`,
      { minDelayMs: 900, maxWaitMs: 4500, waitForFile: attachName }
    );
    if (btn) { btn.innerHTML = this.DONE_SVG; btn.classList.add("gmc-verified-btn"); btn.disabled = true; }
  }

  syncItem(item) {
    if (!item || !item.el) return;
    if (this.isItemPurged(item)) {
      if (this.svgPreview?.hasSvg(item.cachedCombinedCode)) {
        this.svgPreview.bindHoverTarget(item.placeholderEl, () => item.cachedCombinedCode);
        if (item.downloadBtn) item.downloadBtn.style.display = "inline-flex";
      }
      return;
    }
    const isCollapsed = item.el.classList.contains("gmc-collapsed-code");
    const sp = this.spill.collect(item.el);
    (item.spilledNodes || []).forEach((n) => { if (!sp.nodes.includes(n) && n.classList) n.classList.remove("gmc-spilled-hidden"); });
    item.spilledNodes = sp.nodes;
    this.preserveScrollAround(item.el.parentElement || item.el, () => { sp.nodes.forEach((n) => { if (n.classList) n.classList.toggle("gmc-spilled-hidden", isCollapsed); }); });
    const fullText = [sp.beforeText, this.spill.extractRawCode(item.el), sp.afterText].filter(Boolean).join("\n");
    if (fullText) item.cachedCombinedCode = fullText;
    const lineCount = fullText.split("\n").length;
    const hasSpill = sp.nodes.length > 0;
    const hasSvg = Boolean(this.svgPreview?.hasSvg(fullText));
    if (item.downloadBtn) item.downloadBtn.style.display = hasSvg ? "inline-flex" : "none";
    if (hasSvg) { const getText = () => this.extractCombinedCode(item); this.svgPreview.bindHoverTarget(item.placeholderEl, getText); this.svgPreview.bindHoverTarget(item.el, getText); }
    item.labelEl.textContent = this.formatLabel(item.headerName, lineCount, hasSpill, hasSvg);
    item.placeholderEl.classList.toggle("gmc-spilled", hasSpill);
    item.placeholderEl.classList.toggle("gmc-oversized", !hasSpill && lineCount > this.MAX_SAFE_LINES);
  }
  createPurgeBtn(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gmc-purge-btn";
    btn.title = "Copier l'intégralité du bloc et purger le DOM";
    btn.innerHTML = this.PURGE_SVG;
    btn.addEventListener("click", (e) => { e.stopPropagation(); this.copyAndPurge(item); });
    item.purgeButtons.push(btn);
    return btn;
  }

  createDownloadBtn(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gmc-verify-btn gmc-svg-download-btn";
    btn.title = "Télécharger le fichier .svg";
    btn.innerHTML = this.DOWNLOAD_SVG;
    btn.style.display = "none";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.svgPreview?.downloadSvg(this.extractCombinedCode(item), item.headerName)) {
        btn.innerHTML = this.DONE_SVG;
        btn.classList.add("gmc-verified-btn");
        setTimeout(() => { btn.innerHTML = this.DOWNLOAD_SVG; btn.classList.remove("gmc-verified-btn"); }, 1400);
      }
    });
    return btn;
  }

  attachHeaderControls(pre, item) {
    const wrapper = this.spill.findCodeBlockWrapper(pre);
    if (!wrapper) return;
    if (item.headerPurgeAttached && item.verifyBtn?.isConnected && item.headerPurgeBtn?.isConnected) return;
    if (item.headerPurgeAttached) {
      item.headerPurgeAttached = false;
      wrapper.removeAttribute("data-gmc-has-purge");
      if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "inline-flex";
      if (item.placeholderRow && item.verifyBtn && !item.verifyBtn.isConnected) item.placeholderRow.insertBefore(item.verifyBtn, item.placeholderPurgeBtn);
    }
    if (wrapper.getAttribute("data-gmc-has-purge") === "true") { item.headerPurgeAttached = true; return; }
    const nativeCopy = Array.from(wrapper.querySelectorAll("button")).find((b) => !b.closest(".gmc-placeholder") && !b.className.includes("gmc-") && /copier|copy/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`));
    if (!nativeCopy?.parentElement) return;
    wrapper.setAttribute("data-gmc-has-purge", "true");
    item.headerPurgeAttached = true;
    if (!item.headerPurgeBtn) item.headerPurgeBtn = this.createPurgeBtn(item);
    nativeCopy.parentElement.insertBefore(item.verifyBtn, nativeCopy.nextSibling);
    nativeCopy.parentElement.insertBefore(item.headerPurgeBtn, item.verifyBtn.nextSibling);
    if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "none";
    if (nativeCopy.getAttribute("data-gmc-copy-watched") !== "true") {
      nativeCopy.setAttribute("data-gmc-copy-watched", "true");
      nativeCopy.addEventListener("click", () => { const fullText = this.extractCombinedCode(item); setTimeout(async () => { try { await navigator.clipboard.writeText(fullText); } catch (_err) {} }, 80); });
    }
  }

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
      if (!headerName) continue;
      pre.setAttribute("data-gmc-processed", "true");
      const placeholder = document.createElement("div");
      placeholder.className = "gmc-placeholder";
      const row = document.createElement("div");
      row.className = "gmc-placeholder-main";
      const labelEl = document.createElement("span");
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "gmc-toggle-btn";
      toggleBtn.textContent = "Afficher";
      const verifyBtn = document.createElement("button");
      verifyBtn.type = "button";
      verifyBtn.className = "gmc-verify-btn";
      verifyBtn.title = "Transmettre le bloc à l'IA pour vérification (sans copier ni purger)";
      verifyBtn.innerHTML = this.VERIFY_SVG;
      const item = { el: pre, placeholderEl: placeholder, placeholderRow: row, headerName, labelEl, verifyBtn, downloadBtn: null, purgeButtons: [], placeholderPurgeBtn: null, headerPurgeBtn: null, headerPurgeAttached: false, spilledNodes: [], cachedCombinedCode: "", preExisting };
      verifyBtn.addEventListener("click", (e) => { e.stopPropagation(); this.verifyWithAi(item); });
      item.downloadBtn = this.createDownloadBtn(item);
      item.placeholderPurgeBtn = this.createPurgeBtn(item);
      this.trackedBlocks.push(item);
      toggleBtn.addEventListener("click", () => { const collapsed = pre.classList.toggle("gmc-collapsed-code"); toggleBtn.textContent = collapsed ? "Afficher" : "Masquer"; this.syncItem(item); this.attachHeaderControls(pre, item); });
      row.append(labelEl, toggleBtn, item.downloadBtn, verifyBtn, item.placeholderPurgeBtn);
      placeholder.append(row);
      this.preserveScrollAround(pre.parentElement || pre, () => { pre.parentNode.insertBefore(placeholder, pre); pre.classList.add("gmc-collapsed-code"); });
      this.attachHeaderControls(pre, item);
      this.syncItem(item);
    }
    for (const item of this.trackedBlocks) { this.attachHeaderControls(item.el, item); this.syncItem(item); }
  }
}
window.GmcCodeBlockManager = CodeBlockManager;
