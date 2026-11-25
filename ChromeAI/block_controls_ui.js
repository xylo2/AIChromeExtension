/**
 * Création des placeholders, boutons de contrôle (purge, SVG) et synchronisation DOM des blocs.
 */
class BlockControlsUiHelper {
  constructor(spillDetector, svgPreview = null) {
    this.spill = spillDetector;
    this.svgPreview = svgPreview;
    this.PURGE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="12" y1="13" x2="19" y2="20"/><line x1="19" y1="13" x2="12" y2="20"/></svg>';
    this.VERIFY_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>';
    this.DOWNLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    this.DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  createPurgeBtn(item, onCopyAndPurge) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "gmc-purge-btn";
    btn.title = "Copier l'intégralité du bloc et purger le DOM"; btn.innerHTML = this.PURGE_SVG;
    btn.addEventListener("click", (e) => { e.stopPropagation(); onCopyAndPurge(item); });
    item.purgeButtons.push(btn);
    return btn;
  }

  createDownloadBtn(item, getCodeFn) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "gmc-verify-btn gmc-svg-download-btn";
    btn.title = "Télécharger le fichier .svg"; btn.innerHTML = this.DOWNLOAD_SVG; btn.style.display = "none";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.svgPreview?.downloadSvg(getCodeFn(item), item.headerName)) {
        btn.innerHTML = this.DONE_SVG; btn.classList.add("gmc-verified-btn");
        setTimeout(() => { btn.innerHTML = this.DOWNLOAD_SVG; btn.classList.remove("gmc-verified-btn"); }, 1400);
      }
    });
    return btn;
  }

  buildTrackedBlockItem(pre, headerName, preExisting, manager) {
    const placeholder = document.createElement("div"); placeholder.className = "gmc-placeholder";
    const row = document.createElement("div"); row.className = "gmc-placeholder-main";
    const labelEl = document.createElement("span");
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button"; toggleBtn.className = "gmc-toggle-btn"; toggleBtn.textContent = "Afficher";
    const verifyBtn = document.createElement("button");
    verifyBtn.type = "button"; verifyBtn.className = "gmc-verify-btn";
    verifyBtn.title = "Transmettre le bloc à l'IA pour vérification (sans copier ni purger)"; verifyBtn.innerHTML = this.VERIFY_SVG;
    const item = { el: pre, placeholderEl: placeholder, placeholderRow: row, headerName, labelEl, verifyBtn, downloadBtn: null, purgeButtons: [], placeholderPurgeBtn: null, headerPurgeBtn: null, headerPurgeAttached: false, spilledNodes: [], cachedCombinedCode: "", preExisting };
    verifyBtn.addEventListener("click", (e) => { e.stopPropagation(); manager.verifyWithAi(item); });
    item.downloadBtn = this.createDownloadBtn(item, (it) => manager.extractCombinedCode(it));
    item.placeholderPurgeBtn = this.createPurgeBtn(item, (it) => manager.copyAndPurge(it));
    toggleBtn.addEventListener("click", () => {
      const collapsed = pre.classList.toggle("gmc-collapsed-code");
      toggleBtn.textContent = collapsed ? "Afficher" : "Masquer";
      manager.syncItem(item); manager.attachHeaderControls(pre, item);
    });
    row.append(labelEl, toggleBtn, item.downloadBtn, verifyBtn, item.placeholderPurgeBtn);
    placeholder.append(row);
    return item;
  }

  syncItemVisuals(item, manager) {
    if (manager.isItemPurged(item)) {
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
    manager.preserveScrollAround(item.el.parentElement || item.el, () => { sp.nodes.forEach((n) => { if (n.classList) n.classList.toggle("gmc-spilled-hidden", isCollapsed); }); });
    const fullText = [sp.beforeText, this.spill.extractRawCode(item.el), sp.afterText].filter(Boolean).join("\n");
    if (fullText) item.cachedCombinedCode = fullText;
    const lineCount = fullText.split("\n").length, hasSpill = sp.nodes.length > 0;
    item.hasSpill = hasSpill;
    const hasSvg = Boolean(this.svgPreview?.hasSvg(fullText));
    if (item.downloadBtn) item.downloadBtn.style.display = hasSvg ? "inline-flex" : "none";
    if (hasSvg) { const getText = () => manager.extractCombinedCode(item); this.svgPreview.bindHoverTarget(item.placeholderEl, getText); this.svgPreview.bindHoverTarget(item.el, getText); }
    item.labelEl.textContent = manager.formatLabel(item.headerName, lineCount, hasSpill, hasSvg);
    item.placeholderEl.classList.toggle("gmc-spilled", hasSpill);
    item.placeholderEl.classList.toggle("gmc-oversized", !hasSpill && lineCount > manager.MAX_SAFE_LINES);
  }

  attachHeaderControls(pre, item, onCopyAndPurge, getCodeFn) {
    const wrapper = this.spill.findCodeBlockWrapper(pre);
    if (!wrapper) return;
    if (item.headerPurgeAttached && item.verifyBtn?.isConnected && item.headerPurgeBtn?.isConnected) return;
    if (item.headerPurgeAttached) {
      item.headerPurgeAttached = false; wrapper.removeAttribute("data-gmc-has-purge");
      if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "inline-flex";
      if (item.placeholderRow && item.verifyBtn && !item.verifyBtn.isConnected) item.placeholderRow.insertBefore(item.verifyBtn, item.placeholderPurgeBtn);
    }
    if (wrapper.getAttribute("data-gmc-has-purge") === "true") { item.headerPurgeAttached = true; return; }
    const nativeCopy = Array.from(wrapper.querySelectorAll("button")).find((b) => !b.closest(".gmc-placeholder") && !b.className.includes("gmc-") && /copier|copy/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`));
    if (!nativeCopy?.parentElement) return;
    wrapper.setAttribute("data-gmc-has-purge", "true"); item.headerPurgeAttached = true;
    if (!item.headerPurgeBtn) item.headerPurgeBtn = this.createPurgeBtn(item, onCopyAndPurge);
    nativeCopy.parentElement.insertBefore(item.verifyBtn, nativeCopy.nextSibling);
    nativeCopy.parentElement.insertBefore(item.headerPurgeBtn, item.verifyBtn.nextSibling);
    if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "none";
    if (nativeCopy.getAttribute("data-gmc-copy-watched") !== "true") {
      nativeCopy.setAttribute("data-gmc-copy-watched", "true");
      nativeCopy.addEventListener("click", () => { const fullText = getCodeFn(item); setTimeout(async () => { try { await navigator.clipboard.writeText(fullText); } catch (_err) {} }, 80); });
    }
  }
}
window.GmcBlockControlsUiHelper = BlockControlsUiHelper;
