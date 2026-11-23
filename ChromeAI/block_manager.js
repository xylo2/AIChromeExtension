/**
 * Gestion du repliage, de la purge DOM et de la vérification IA des blocs FILE / FILE_PART.
 */
class CodeBlockManager {
  constructor(spillDetector, chatInjector) {
    this.spill = spillDetector;
    this.chat = chatInjector;
    this.MAX_SAFE_LINES = 130;
    this.trackedBlocks = [];
    this.PURGE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="12" y1="13" x2="19" y2="20"/><line x1="19" y1="13" x2="12" y2="20"/></svg>';
    this.VERIFY_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>';
    this.DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  formatLabel(headerName, lineCount, hasSpill) {
    if (hasSpill) return `🚨 ${headerName} (${lineCount} lignes — débordement hors bloc récupéré)`;
    if (lineCount > this.MAX_SAFE_LINES) return `⚠️ ${headerName} (${lineCount} lignes — bloc long)`;
    return `📄 ${headerName} (${lineCount} lignes)`;
  }

  extractCombinedCode(item) {
    if (item.el?.getAttribute("data-gmc-purged") === "true" && item.cachedCombinedCode) return item.cachedCombinedCode;
    const baseCode = this.spill.extractRawCode(item.el);
    const sp = this.spill.collect(item.el);
    item.spilledNodes = sp.nodes;
    const combined = [sp.beforeText, baseCode, sp.afterText].filter(Boolean).join("\n");
    if (combined) item.cachedCombinedCode = combined;
    return combined;
  }

  purgeDomOnly(item, customMessage = "Contenu copié et purgé") {
    const { el, labelEl, purgeButtons, verifyBtn, headerName, spilledNodes } = item;
    if (!el || el.getAttribute("data-gmc-purged") === "true") return false;
    if (!item.cachedCombinedCode) this.extractCombinedCode(item);
    const codeNode = el.tagName === "CODE" ? el : (el.querySelector("code") || el);
    codeNode.textContent = headerName ? `${headerName} — ${customMessage}` : customMessage;
    el.setAttribute("data-gmc-purged", "true");
    el.classList.add("gmc-purged-code");
    (spilledNodes || []).forEach((n) => n.remove());
    item.spilledNodes = [];
    if (labelEl) labelEl.textContent = `✅ ${headerName || "Bloc"} — ${customMessage}`;
    (purgeButtons || []).forEach((btn) => { btn.disabled = true; btn.classList.add("gmc-purged-btn"); });
    if (verifyBtn && !verifyBtn.disabled) verifyBtn.title = "Transmettre le bloc à l'IA pour vérification (sans copier ni purger)";
    return true;
  }

  purgeAll() {
    this.trackedBlocks.forEach((b) => this.purgeDomOnly(b, "Purge manuelle"));
  }

  async copyOnly(item) {
    const text = this.extractCombinedCode(item);
    try { await navigator.clipboard.writeText(text); } catch (_err) {}
    return text;
  }

  async copyAndPurge(item) {
    await this.copyOnly(item);
    this.purgeDomOnly(item);
  }

  buildFallbackAttachmentName(headerName) {
    const parts = (headerName || "bloc.txt").split("|");
    const baseName = parts.at(0).trim().split(/[\\/]/).filter(Boolean).pop() || "bloc.txt";
    if (parts.length > 1) {
      const partIdx = parts.at(1).split("/").at(0).trim();
      if (partIdx) return `${baseName}.part${partIdx}.txt`;
    }
    return `${baseName}.txt`;
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
    const isPurged = item.el?.getAttribute("data-gmc-purged") === "true";
    const combinedText = isPurged ? (item.cachedCombinedCode || "") : this.extractCombinedCode(item);
    if (combinedText) item.cachedCombinedCode = combinedText;

    let attachName = this.buildFallbackAttachmentName(item.headerName);
    let attachContent = combinedText;
    const res = await this.requestSavedFile(item.headerName, 1400);
    if (res?.ok && typeof res.content === "string") { attachName = res.filename || attachName; attachContent = res.content; }
    item.isVerifyingSpill = false;
    this.chat.dropFile(attachName, attachContent, false);
    this.chat.insertPrompt(
      `Vérification de récupération pour \x60${item.headerName}\x60 : voici exactement le contenu récupéré dans la pièce jointe \x60${attachName}\x60. Confirme simplement si ce code correspond bien à l'intégralité de ce que tu voulais produire pour ce bloc (sans troncature, perte ou artefact d'affichage). Si jamais il manque du code ou qu'il est altéré, régénère-le découpé en plusieurs blocs \x60FILE_PART\x60 de moins de 110 lignes chacun.`,
      { minDelayMs: 1100, maxWaitMs: 5000 }
    );
    if (btn) { btn.innerHTML = this.DONE_SVG; btn.classList.add("gmc-verified-btn"); btn.disabled = true; }
  }

  syncItem(item) {
    if (!item || !item.el || item.el.getAttribute("data-gmc-purged") === "true") return;
    const isCollapsed = item.el.classList.contains("gmc-collapsed-code");
    const sp = this.spill.collect(item.el);
    (item.spilledNodes || []).forEach((n) => { if (!sp.nodes.includes(n) && n.classList) n.classList.remove("gmc-spilled-hidden"); });
    item.spilledNodes = sp.nodes;
    sp.nodes.forEach((n) => { if (n.classList) n.classList.toggle("gmc-spilled-hidden", isCollapsed); });
    const fullText = [sp.beforeText, this.spill.extractRawCode(item.el), sp.afterText].filter(Boolean).join("\n");
    const lineCount = fullText.split("\n").length;
    const hasSpill = sp.nodes.length > 0;
    item.labelEl.textContent = this.formatLabel(item.headerName, lineCount, hasSpill);
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

  attachHeaderControls(pre, item) {
    if (item.headerPurgeAttached) return;
    const wrapper = this.spill.findCodeBlockWrapper(pre);
    if (!wrapper || wrapper.getAttribute("data-gmc-has-purge") === "true") { item.headerPurgeAttached = true; return; }
    const nativeCopy = Array.from(wrapper.querySelectorAll("button")).find((b) => {
      if (b.closest(".gmc-placeholder") || b.className.includes("gmc-")) return false;
      const meta = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`.toLowerCase();
      return meta.includes("copier") || meta.includes("copy");
    });
    if (nativeCopy?.parentElement) {
      wrapper.setAttribute("data-gmc-has-purge", "true");
      item.headerPurgeAttached = true;
      const headerPurge = this.createPurgeBtn(item);
      nativeCopy.parentElement.insertBefore(item.verifyBtn, nativeCopy.nextSibling);
      nativeCopy.parentElement.insertBefore(headerPurge, item.verifyBtn.nextSibling);
      if (item.placeholderPurgeBtn) item.placeholderPurgeBtn.style.display = "none";
      nativeCopy.addEventListener("click", () => {
        const fullText = this.extractCombinedCode(item);
        setTimeout(async () => { try { await navigator.clipboard.writeText(fullText); } catch (_err) {} }, 80);
      });
    }
  }

  scan(preExisting = false) {
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.getAttribute("data-gmc-processed") === "true") continue;
      const match = this.spill.findFirstNonEmptyLine(this.spill.extractRawCode(pre)).match(this.spill.FILE_TAG_REGEX);
      if (!match) continue;
      pre.setAttribute("data-gmc-processed", "true");
      pre.classList.add("gmc-collapsed-code");
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
      const item = { el: pre, placeholderEl: placeholder, headerName: match.at(1), labelEl, verifyBtn, purgeButtons: [], placeholderPurgeBtn: null, headerPurgeAttached: false, spilledNodes: [], cachedCombinedCode: "", preExisting };
      verifyBtn.addEventListener("click", (e) => { e.stopPropagation(); this.verifyWithAi(item); });
      const purgeBtn = this.createPurgeBtn(item);
      item.placeholderPurgeBtn = purgeBtn;
      this.trackedBlocks.push(item);
      toggleBtn.addEventListener("click", () => {
        const collapsed = pre.classList.toggle("gmc-collapsed-code");
        toggleBtn.textContent = collapsed ? "Afficher" : "Masquer";
        this.syncItem(item);
        this.attachHeaderControls(pre, item);
      });
      row.append(labelEl, toggleBtn, verifyBtn, purgeBtn);
      placeholder.append(row);
      pre.parentNode.insertBefore(placeholder, pre);
      this.attachHeaderControls(pre, item);
      this.syncItem(item);
    }
    for (const item of this.trackedBlocks) { this.attachHeaderControls(item.el, item); this.syncItem(item); }
  }
}
window.GmcCodeBlockManager = CodeBlockManager;
