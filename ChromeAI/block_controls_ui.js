/**
 * Création des placeholders, boutons de contrôle (purge, batch, SVG, groupe multi-blocs) et synchronisation DOM.
 */
class BlockControlsUiHelper {
  constructor(spillDetector, svgPreview = null) {
    this.spill = spillDetector; this.svgPreview = svgPreview;
    this.PURGE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="12" y1="13" x2="19" y2="20"/><line x1="19" y1="13" x2="12" y2="20"/></svg>';
    this.VERIFY_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>';
    this.DOWNLOAD_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    this.DONE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
    this.LANG_NAMES = { JS: "javascript", PY: "python", CSS: "css", HTML: "html", JSON: "json", MD: "markdown", INI: "ini", SH: "bash", TXT: "text", SVG: "svg" };
  }
  hideTrailingEndMarker(pre) { const edge = this.spill.findEdgeSibling(pre, "next"); if (edge?.nodeType === 1 && this.spill.END_FILE_REGEX.test(String(edge.textContent || "").trim())) edge.classList?.add("gmc-spilled-hidden"); }
  detectFileTypeBadge(headerName) { const p = String(headerName || "").split("|").at(0).trim(); return (p.includes(".") ? p.split(".").pop().toUpperCase() : "TXT") || "TXT"; }
  formatCombinedLanguages(badges) {
    const u = Array.from(new Set(badges.map((b) => this.LANG_NAMES[b] || b.toLowerCase())));
    return u.length <= 1 ? (u.at(0) || "") : (u.length === 2 ? `${u.at(0)} et ${u.at(1)}` : `${u.slice(0, -1).join(", ")} et ${u.at(-1)}`);
  }
  findHeaderLanguageNode(wrapper) {
    if (!wrapper) return null;
    for (const root of [wrapper, wrapper.parentElement].filter((r) => r && typeof r.querySelectorAll === "function")) {
      for (const node of Array.from(root.querySelectorAll("span, div"))) {
        if (node.closest?.(".gmc-placeholder, pre, code, button") || (node.children && node.children.length > 0)) continue;
        if (/^(?:javascript|python|css|html|json|markdown|ini|bash|text|svg)(?:\s*(?:,|et)\s*[a-z0-9_-]+)*$/i.test(String(node.textContent || "").trim())) return node;
      }
    }
    return null;
  }
  updateHeaderLanguageLabel(wrapper, labelText) { const n = this.findHeaderLanguageNode(wrapper); if (n && labelText) { if (n.dataset && !n.dataset.gmcOrigLang) n.dataset.gmcOrigLang = String(n.textContent || "").trim(); n.textContent = labelText; } }
  hideNativeFooterCaution(wrapper) {
    if (!wrapper || typeof wrapper.querySelectorAll !== "function") return;
    for (const node of Array.from(wrapper.querySelectorAll("div, p, span"))) {
      if (!node.closest?.(".gmc-placeholder, pre, code") && /^(?:Utilisez le code avec pr[eé]caution\.?|Use code with caution\.?)$/i.test(String(node.textContent || "").trim())) {
        const box = node.parentElement && node.parentElement !== wrapper && !node.parentElement.querySelector?.("pre") ? node.parentElement : node;
        box.classList?.add("gmc-hidden-native-footer");
      }
    }
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
    btn.addEventListener("click", (e) => { e.stopPropagation(); if (this.svgPreview?.downloadSvg(getCodeFn(item), item.headerName)) { btn.innerHTML = this.DONE_SVG; btn.classList.add("gmc-verified-btn"); setTimeout(() => { btn.innerHTML = this.DOWNLOAD_SVG; btn.classList.remove("gmc-verified-btn"); }, 1400); } });
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
    verifyBtn.title = "Transmettre ce bloc à l'IA pour vérification (sans copier ni purger)"; verifyBtn.innerHTML = this.VERIFY_SVG;
    const batchRow = document.createElement("div"); batchRow.className = "gmc-batch-bar"; batchRow.style.display = "none";
    const batchBtn = document.createElement("button"); batchBtn.type = "button"; batchBtn.className = "gmc-batch-purge-btn";
    batchBtn.title = "Copier ce bloc et tous les blocs suivants, puis purger le DOM"; batchBtn.addEventListener("click", (e) => { e.stopPropagation(); batchBtn.classList.add("gmc-used-btn"); manager.copyAndPurgeFrom(item); });
    batchRow.append(batchBtn);
    const item = { el: pre, placeholderEl: wrapper, cardEl: placeholder, singleMainRow: row, groupListEl: null, placeholderRow: actionsBox, headerName, labelEl, verifyBtn, toggleBtn, batchRow, batchBtn, downloadBtn: null, purgeButtons: [], placeholderPurgeBtn: null, headerPurgeBtn: null, headerPurgeAttached: false, spilledNodes: [], cachedCombinedCode: "", preExisting, groupItems: null, isSecondaryInGroup: false };
    verifyBtn.addEventListener("click", (e) => { e.stopPropagation(); verifyBtn.classList.add("gmc-used-btn"); manager.verifyWithAi(item); });
    item.downloadBtn = this.createDownloadBtn(item, (it) => manager.extractCombinedCode(it));
    item.placeholderPurgeBtn = this.createPurgeBtn(item, (it) => manager.copyAndPurge(it));
    toggleBtn.addEventListener("click", () => { manager.toggleBlockDisplay(item); });
    actionsBox.append(toggleBtn, item.downloadBtn, verifyBtn, item.placeholderPurgeBtn); row.append(labelEl, actionsBox); placeholder.append(row); wrapper.append(batchRow, placeholder); return item;
  }
  detachHeaderControls(pre, item) {
    const wrapper = this.spill.findCodeBlockWrapper(pre);
    if (wrapper) { wrapper.removeAttribute("data-gmc-has-purge"); wrapper.querySelector?.(".gmc-hidden-native-copy")?.classList.remove("gmc-hidden-native-copy"); wrapper.querySelector?.(".gmc-hidden-native-footer")?.classList.remove("gmc-hidden-native-footer"); }
    item.headerPurgeAttached = false; item.verifyBtn?.classList.remove("gmc-code-header-btn");
    if (item.headerPurgeBtn) { item.headerPurgeBtn.remove(); item.headerPurgeBtn = null; }
    if (item.batchBtn && item.batchRow && item.batchBtn.parentElement !== item.batchRow) item.batchRow.appendChild(item.batchBtn);
    if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "inline-flex";
    if (item.placeholderRow && item.verifyBtn && !item.verifyBtn.isConnected) item.placeholderRow.insertBefore(item.verifyBtn, item.placeholderPurgeBtn);
  }
  syncGroupLeadVisuals(item, members, manager) {
    const cardTarget = item.cardEl || item.placeholderEl;
    cardTarget.classList.add("gmc-group-card"); cardTarget.classList.remove("gmc-spilled", "gmc-oversized");
    if (item.singleMainRow) item.singleMainRow.style.display = "none";
    if (!item.groupListEl) { item.groupListEl = document.createElement("div"); item.groupListEl.className = "gmc-group-list"; cardTarget.appendChild(item.groupListEl); }
    item.groupListEl.style.display = "flex"; item.groupListEl.innerHTML = "";
    let anySvg = false; const badges = [];
    for (const m of members) {
      this.hideTrailingEndMarker(m.el);
      const isCollapsed = m.el.classList.contains("gmc-collapsed-code"), sp = this.spill.collect(m.el);
      (m.spilledNodes || []).forEach((n) => { if (!sp.nodes.includes(n)) n.classList?.remove("gmc-spilled-hidden"); });
      m.spilledNodes = sp.nodes;
      manager.preserveScrollAround(m.el.parentElement || m.el, () => sp.nodes.forEach((n) => n.classList?.toggle("gmc-spilled-hidden", isCollapsed)));
      const fullText = [sp.beforeText, this.spill.extractRawCode(m.el), sp.afterText].filter(Boolean).join("\n");
      if (fullText) m.cachedCombinedCode = fullText;
      const lines = fullText ? fullText.split("\n").length : 0, hasSpill = sp.nodes.length > 0, hasSvg = Boolean(this.svgPreview?.hasSvg(fullText));
      m.hasSpill = hasSpill; if (hasSvg) anySvg = true;
      const badge = this.detectFileTypeBadge(m.headerName); badges.push(badge);
      const mRow = document.createElement("div"); mRow.className = "gmc-group-row";
      const purged = manager.isItemPurged(m);
      if (!purged && hasSpill) mRow.classList.add("gmc-row-spilled"); else if (!purged && lines > manager.MAX_SAFE_LINES) mRow.classList.add("gmc-row-oversized");
      const lbl = document.createElement("span"); lbl.className = "gmc-placeholder-label";
      lbl.textContent = purged ? `✅ [${badge}] ${m.headerName} — Copié et purgé` : manager.formatLabel(`[${badge}] ${m.headerName}`, lines, hasSpill, hasSvg);
      const act = document.createElement("div"); act.className = "gmc-group-row-actions";
      m.toggleBtn.textContent = isCollapsed ? "Afficher" : "Masquer";
      act.append(m.toggleBtn); mRow.append(lbl, act); item.groupListEl.appendChild(mRow);
    }
    const leadWrapper = this.spill.findCodeBlockWrapper(item.el);
    this.updateHeaderLanguageLabel(leadWrapper, this.formatCombinedLanguages(badges)); this.hideNativeFooterCaution(leadWrapper);
    if (item.downloadBtn) item.downloadBtn.style.display = anySvg ? "inline-flex" : "none";
  }
  syncItemVisuals(item, manager) {
    this.hideTrailingEndMarker(item.el);
    if (item.isSecondaryInGroup) {
      if (item.placeholderEl) item.placeholderEl.style.display = "none";
      const sp = this.spill.collect(item.el); item.spilledNodes = sp.nodes;
      sp.nodes.forEach((n) => n.classList?.toggle("gmc-spilled-hidden", item.el.classList.contains("gmc-collapsed-code")));
      const fullText = [sp.beforeText, this.spill.extractRawCode(item.el), sp.afterText].filter(Boolean).join("\n");
      if (fullText) item.cachedCombinedCode = fullText;
      return;
    }
    if (item.placeholderEl) item.placeholderEl.style.display = "flex";
    const isGrouped = Array.isArray(item.groupItems) && item.groupItems.length > 1;
    const rem = typeof manager.getUnpurgedBlocksFrom === "function" ? manager.getUnpurgedBlocksFrom(item) : manager.getUnpurgedBlocks();
    const unpurgedInGroup = isGrouped ? item.groupItems.filter((m) => !manager.isItemPurged(m)).length : (manager.isItemPurged(item) ? 0 : 1);
    const showBatch = !manager.isItemPurged(item) && rem.length > Math.max(1, unpurgedInGroup);
    if (item.batchBtn) { item.batchBtn.style.display = showBatch ? "inline-flex" : "none"; if (showBatch) item.batchBtn.textContent = `📋 Copier à partir d'ici & purger (${rem.length} blocs)`; if (item.batchRow) item.batchRow.style.display = showBatch && item.batchBtn.parentElement === item.batchRow ? "flex" : "none"; }
    if (isGrouped) { this.syncGroupLeadVisuals(item, item.groupItems, manager); return; }
    const cardTarget = item.cardEl || item.placeholderEl; cardTarget.classList.remove("gmc-group-card");
    if (item.groupListEl) item.groupListEl.style.display = "none"; if (item.singleMainRow) item.singleMainRow.style.display = "flex";
    if (manager.isItemPurged(item)) { if (this.svgPreview?.hasSvg(item.cachedCombinedCode)) { this.svgPreview.bindHoverTarget(cardTarget, () => item.cachedCombinedCode); if (item.downloadBtn) item.downloadBtn.style.display = "inline-flex"; } return; }
    const isCollapsed = item.el.classList.contains("gmc-collapsed-code"), sp = this.spill.collect(item.el);
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
    const isGrouped = Array.isArray(item.groupItems) && item.groupItems.length > 1;
    const nativeCopy = Array.from(wrapper.querySelectorAll("button")).find((b) => !b.closest(".gmc-placeholder") && !b.className.includes("gmc-") && /copier|copy/i.test([b.getAttribute("aria-label") || "", b.getAttribute("title") || "", b.textContent || ""].join(" ")));
    const headerAnchor = this.findHeaderLanguageNode(wrapper)?.parentElement || nativeCopy?.parentElement;
    if (!headerAnchor) return;
    if (nativeCopy) nativeCopy.classList.toggle("gmc-hidden-native-copy", isGrouped);
    if (isGrouped) this.hideNativeFooterCaution(wrapper);
    if (item.batchBtn && item.batchBtn.parentElement !== headerAnchor) { item.batchBtn.classList.add("gmc-header-batch-btn"); headerAnchor.appendChild(item.batchBtn); if (item.batchRow) item.batchRow.style.display = "none"; }
    if (item.headerPurgeAttached && item.headerPurgeBtn?.isConnected) return;
    if (item.headerPurgeAttached) this.detachHeaderControls(pre, item);
    if (wrapper.getAttribute("data-gmc-has-purge") === "true") { item.headerPurgeAttached = true; return; }
    wrapper.setAttribute("data-gmc-has-purge", "true"); item.headerPurgeAttached = true;
    if (!item.headerPurgeBtn) item.headerPurgeBtn = this.createPurgeBtn(item, onCopyAndPurge);
    item.headerPurgeBtn.classList.add("gmc-code-header-btn"); item.verifyBtn.classList.add("gmc-code-header-btn");
    headerAnchor.appendChild(item.headerPurgeBtn); headerAnchor.appendChild(item.verifyBtn);
    if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "none";
    if (nativeCopy && nativeCopy.getAttribute("data-gmc-copy-watched") !== "true") { nativeCopy.setAttribute("data-gmc-copy-watched", "true"); nativeCopy.addEventListener("click", () => { nativeCopy.classList.add("gmc-used-btn"); const fullText = getCodeFn(item); setTimeout(async () => { try { await navigator.clipboard.writeText(fullText); } catch (_err) {} }, 80); }); }
  }
}
window.GmcBlockControlsUiHelper = BlockControlsUiHelper;
