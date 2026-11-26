/**
 * Création des placeholders, boutons de contrôle (purge, batch, SVG) et synchronisation DOM.
 */
class BlockControlsUiHelper {
  constructor(spillDetector, svgPreview = null) {
    this.spill = spillDetector; this.svgPreview = svgPreview;
    this.PURGE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="12" y1="13" x2="19" y2="20"/><line x1="19" y1="13" x2="12" y2="20"/></svg>';
    this.VERIFY_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>';
    this.DOWNLOAD_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    this.DONE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  hideTrailingEndMarker(pre) {
    const edge = this.spill.findEdgeSibling(pre, "next");
    if (edge?.nodeType === 1 && this.spill.END_FILE_REGEX.test(String(edge.textContent || "").trim())) edge.classList?.add("gmc-spilled-hidden");
  }
  detectFileTypeBadge(headerName) {
    const filePath = String(headerName || "").split("|").at(0).trim();
    const ext = filePath.includes(".") ? filePath.split(".").pop().toUpperCase() : "TXT";
    return ext || "TXT";
  }
  createPurgeBtn(item, onCopyAndPurge) {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "gmc-purge-btn";
    btn.title = "Copier l'intégralité du bloc (ou du tour) et purger le DOM"; btn.innerHTML = this.PURGE_SVG;
    btn.addEventListener("click", (e) => { e.stopPropagation(); btn.classList.add("gmc-used-btn"); onCopyAndPurge(item); });
    item.purgeButtons.push(btn); return btn;
  }
  createDownloadBtn(item, getCodeFn) {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "gmc-verify-btn gmc-svg-download-btn";
    btn.title = "Télécharger le fichier .svg"; btn.innerHTML = this.DOWNLOAD_SVG; btn.style.display = "none";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.svgPreview?.downloadSvg(getCodeFn(item), item.headerName)) { btn.innerHTML = this.DONE_SVG; btn.classList.add("gmc-verified-btn"); setTimeout(() => { btn.innerHTML = this.DOWNLOAD_SVG; btn.classList.remove("gmc-verified-btn"); }, 1400); }
    });
    return btn;
  }
  buildTrackedBlockItem(pre, headerName, preExisting, manager) {
    const wrapper = document.createElement("div"); wrapper.className = "gmc-block-slot";
    const placeholder = document.createElement("div"); placeholder.className = "gmc-placeholder";
    const row = document.createElement("div"); row.className = "gmc-placeholder-main";
    const labelEl = document.createElement("span"); labelEl.className = "gmc-placeholder-label";
    const actionsBox = document.createElement("div"); actionsBox.className = "gmc-placeholder-actions";
    const toggleBtn = document.createElement("button"); toggleBtn.type = "button"; toggleBtn.className = "gmc-toggle-btn"; toggleBtn.textContent = "Afficher";
    const verifyBtn = document.createElement("button"); verifyBtn.type = "button"; verifyBtn.className = "gmc-verify-btn";
    verifyBtn.title = "Transmettre le bloc à l'IA pour vérification (sans copier ni purger)"; verifyBtn.innerHTML = this.VERIFY_SVG;
    const batchRow = document.createElement("div"); batchRow.className = "gmc-batch-bar"; batchRow.style.display = "none";
    const batchBtn = document.createElement("button"); batchBtn.type = "button"; batchBtn.className = "gmc-batch-purge-btn";
    batchBtn.title = "Copier ce bloc et tous les blocs suivants, puis purger le DOM"; batchBtn.addEventListener("click", (e) => { e.stopPropagation(); batchBtn.classList.add("gmc-used-btn"); manager.copyAndPurgeFrom(item); });
    batchRow.append(batchBtn);
    const item = { el: pre, placeholderEl: wrapper, cardEl: placeholder, placeholderRow: actionsBox, headerName, labelEl, verifyBtn, toggleBtn, batchRow, batchBtn, downloadBtn: null, purgeButtons: [], placeholderPurgeBtn: null, headerPurgeBtn: null, headerPurgeAttached: false, spilledNodes: [], cachedCombinedCode: "", preExisting, groupItems: null, isSecondaryInGroup: false };
    verifyBtn.addEventListener("click", (e) => { e.stopPropagation(); verifyBtn.classList.add("gmc-used-btn"); manager.verifyWithAi(item); });
    item.downloadBtn = this.createDownloadBtn(item, (it) => manager.extractCombinedCode(it));
    item.placeholderPurgeBtn = this.createPurgeBtn(item, (it) => manager.copyAndPurge(it));
    toggleBtn.addEventListener("click", () => { manager.toggleBlockDisplay(item); });
    actionsBox.append(toggleBtn, item.downloadBtn, verifyBtn, item.placeholderPurgeBtn); row.append(labelEl, actionsBox); placeholder.append(row); wrapper.append(batchRow, placeholder); return item;
  }
  detachHeaderControls(pre, item) {
    const wrapper = this.spill.findCodeBlockWrapper(pre);
    if (wrapper) wrapper.removeAttribute("data-gmc-has-purge");
    item.headerPurgeAttached = false;
    item.verifyBtn?.classList.remove("gmc-code-header-btn");
    if (item.headerPurgeBtn) { item.headerPurgeBtn.remove(); item.headerPurgeBtn = null; }
    if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "inline-flex";
    if (item.placeholderRow && item.verifyBtn && !item.verifyBtn.isConnected) item.placeholderRow.insertBefore(item.verifyBtn, item.placeholderPurgeBtn);
  }
  syncGroupLeadVisuals(item, members, manager) {
    const isCollapsed = item.el.classList.contains("gmc-collapsed-code");
    let anySpill = false, anyOversized = false, anySvg = false;
    const summaryParts = [];
    for (const m of members) {
      this.hideTrailingEndMarker(m.el);
      const sp = this.spill.collect(m.el);
      (m.spilledNodes || []).forEach((n) => { if (!sp.nodes.includes(n)) n.classList?.remove("gmc-spilled-hidden"); });
      m.spilledNodes = sp.nodes;
      manager.preserveScrollAround(m.el.parentElement || m.el, () => sp.nodes.forEach((n) => n.classList?.toggle("gmc-spilled-hidden", isCollapsed)));
      const fullText = [sp.beforeText, this.spill.extractRawCode(m.el), sp.afterText].filter(Boolean).join("\n");
      if (fullText) m.cachedCombinedCode = fullText;
      const lines = fullText ? fullText.split("\n").length : 0;
      const hasSpill = sp.nodes.length > 0;
      const hasSvg = Boolean(this.svgPreview?.hasSvg(fullText));
      m.hasSpill = hasSpill;
      if (hasSpill) anySpill = true;
      if (!hasSpill && lines > manager.MAX_SAFE_LINES) anyOversized = true;
      if (hasSvg) anySvg = true;
      const badge = this.detectFileTypeBadge(m.headerName);
      const statusIcon = manager.isItemPurged(m) ? "✅" : (hasSpill ? "🚨" : (lines > manager.MAX_SAFE_LINES ? "⚠️" : "📄"));
      summaryParts.push(`${statusIcon} [${badge}] ${m.headerName} (${lines}l)`);
    }
    const cardTarget = item.cardEl || item.placeholderEl;
    if (item.downloadBtn) item.downloadBtn.style.display = anySvg ? "inline-flex" : "none";
    const allPurged = members.every((m) => manager.isItemPurged(m));
    const prefix = allPurged ? "✅ Copié et purgé — " : `📦 ${members.length} blocs : `;
    item.labelEl.textContent = `${prefix}${summaryParts.join("  •  ")}`;
    cardTarget.classList.toggle("gmc-spilled", !allPurged && anySpill);
    cardTarget.classList.toggle("gmc-oversized", !allPurged && !anySpill && anyOversized);
  }
  syncItemVisuals(item, manager) {
    this.hideTrailingEndMarker(item.el);
    if (item.isSecondaryInGroup) {
      if (item.placeholderEl) item.placeholderEl.style.display = "none";
      const sp = this.spill.collect(item.el);
      item.spilledNodes = sp.nodes;
      const isHidden = item.el.classList.contains("gmc-collapsed-code");
      sp.nodes.forEach((n) => n.classList?.toggle("gmc-spilled-hidden", isHidden));
      const fullText = [sp.beforeText, this.spill.extractRawCode(item.el), sp.afterText].filter(Boolean).join("\n");
      if (fullText) item.cachedCombinedCode = fullText;
      return;
    }
    if (item.placeholderEl) item.placeholderEl.style.display = "flex";
    const remainingFromHere = typeof manager.getUnpurgedBlocksFrom === "function" ? manager.getUnpurgedBlocksFrom(item) : manager.getUnpurgedBlocks();
    const showBatchFromHere = !manager.isItemPurged(item) && remainingFromHere.length > 1;
    if (item.batchRow && item.batchBtn) { item.batchRow.style.display = showBatchFromHere ? "flex" : "none"; if (showBatchFromHere) item.batchBtn.textContent = `📋 Copier à partir d'ici & purger (${remainingFromHere.length} blocs)`; }
    if (Array.isArray(item.groupItems) && item.groupItems.length > 1) { this.syncGroupLeadVisuals(item, item.groupItems, manager); return; }
    const cardTarget = item.cardEl || item.placeholderEl;
    if (manager.isItemPurged(item)) {
      if (this.svgPreview?.hasSvg(item.cachedCombinedCode)) { this.svgPreview.bindHoverTarget(cardTarget, () => item.cachedCombinedCode); if (item.downloadBtn) item.downloadBtn.style.display = "inline-flex"; }
      return;
    }
    const isCollapsed = item.el.classList.contains("gmc-collapsed-code"); const sp = this.spill.collect(item.el);
    (item.spilledNodes || []).forEach((n) => { if (!sp.nodes.includes(n)) n.classList?.remove("gmc-spilled-hidden"); });
    item.spilledNodes = sp.nodes;
    manager.preserveScrollAround(item.el.parentElement || item.el, () => sp.nodes.forEach((n) => n.classList?.toggle("gmc-spilled-hidden", isCollapsed)));
    const fullText = [sp.beforeText, this.spill.extractRawCode(item.el), sp.afterText].filter(Boolean).join("\n");
    if (fullText) item.cachedCombinedCode = fullText;
    const lineCount = fullText.split("\n").length, hasSpill = sp.nodes.length > 0, hasSvg = Boolean(this.svgPreview?.hasSvg(fullText)); item.hasSpill = hasSpill;
    if (item.downloadBtn) item.downloadBtn.style.display = hasSvg ? "inline-flex" : "none";
    if (hasSvg) { const getText = () => manager.extractCombinedCode(item); this.svgPreview.bindHoverTarget(cardTarget, getText); this.svgPreview.bindHoverTarget(item.el, getText); }
    const badge = this.detectFileTypeBadge(item.headerName);
    item.labelEl.textContent = manager.formatLabel(`[${badge}] ${item.headerName}`, lineCount, hasSpill, hasSvg);
    cardTarget.classList.toggle("gmc-spilled", hasSpill); cardTarget.classList.toggle("gmc-oversized", !hasSpill && lineCount > manager.MAX_SAFE_LINES);
  }
  attachHeaderControls(pre, item, onCopyAndPurge, getCodeFn) {
    if (item.isSecondaryInGroup) { this.detachHeaderControls(pre, item); return; }
    const wrapper = this.spill.findCodeBlockWrapper(pre); if (!wrapper) return;
    if (item.headerPurgeAttached && item.verifyBtn?.isConnected && item.headerPurgeBtn?.isConnected) return;
    if (item.headerPurgeAttached) this.detachHeaderControls(pre, item);
    if (wrapper.getAttribute("data-gmc-has-purge") === "true") { item.headerPurgeAttached = true; return; }
    const nativeCopy = Array.from(wrapper.querySelectorAll("button")).find((b) => !b.closest(".gmc-placeholder") && !b.className.includes("gmc-") && /copier|copy/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`));
    if (!nativeCopy?.parentElement) return;
    wrapper.setAttribute("data-gmc-has-purge", "true"); item.headerPurgeAttached = true;
    if (!item.headerPurgeBtn) item.headerPurgeBtn = this.createPurgeBtn(item, onCopyAndPurge);
    item.verifyBtn.classList.add("gmc-code-header-btn"); item.headerPurgeBtn.classList.add("gmc-code-header-btn");
    nativeCopy.parentElement.insertBefore(item.verifyBtn, nativeCopy.nextSibling); nativeCopy.parentElement.insertBefore(item.headerPurgeBtn, item.verifyBtn.nextSibling);
    if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "none";
    if (nativeCopy.getAttribute("data-gmc-copy-watched") !== "true") { nativeCopy.setAttribute("data-gmc-copy-watched", "true"); nativeCopy.addEventListener("click", () => { nativeCopy.classList.add("gmc-used-btn"); const fullText = getCodeFn(item); setTimeout(async () => { try { await navigator.clipboard.writeText(fullText); } catch (_err) {} }, 80); }); }
  }
}
window.GmcBlockControlsUiHelper = BlockControlsUiHelper;
