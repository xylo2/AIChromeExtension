/**
 * Vérification IA des blocs FILE/FILE_PART (unitaire ou groupée par tour), bannière auto-Suite et détection de fin de tour.
 */
class BlockVerificationHelper {
  constructor(chatInjector, spillDetector) {
    this.chat = chatInjector;
    this.spill = spillDetector;
    this.suiteCountdownTimer = null;
    this.suiteBannerEl = null;
    this.DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
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
        if (typeof chrome === "undefined" || !chrome.runtime?.id) { resolve({ ok: false }); return; }
        chrome.runtime.sendMessage({ type: "READ_SAVED_FILE", header: headerName }, (res) => {
          if (res?.ok && typeof res.content === "string") resolve(res);
          else if (Date.now() < deadline) setTimeout(attempt, 350);
          else resolve({ ok: false });
        });
      };
      attempt();
    });
  }

  async resolveItemPayload(item, getSingleCodeFn) {
    const combinedText = getSingleCodeFn(item);
    let attachName = this.buildFallbackAttachmentName(item.headerName);
    let attachContent = combinedText;
    const res = await this.requestSavedFile(item.headerName, 1400);
    if (res?.ok && typeof res.content === "string") {
      attachName = res.filename || attachName;
      attachContent = res.content;
    }
    return { attachName, attachContent };
  }

  async verifyGroupWithAi(leadItem, members, getSingleCodeFn) {
    const sections = [];
    const headersList = [];
    for (const m of members) {
      headersList.push(m.headerName);
      const { attachContent } = await this.resolveItemPayload(m, getSingleCodeFn);
      sections.push(`--- ${m.headerName} ---\n${attachContent}`);
    }
    const bundleName = "verification_tour.txt";
    this.chat.dropFile(bundleName, sections.join("\n\n"), false);
    this.chat.insertPrompt(
      `Vérification groupée de récupération pour les ${members.length} blocs du tour (\x60${headersList.join("`, `")}\x60) : voici exactement le contenu récupéré dans la pièce jointe \x60${bundleName}\x60. Confirme simplement si chaque bloc correspond bien à l'intégralité de ce que tu voulais produire (sans troncature, perte ou artefact d'affichage). Si jamais il manque du code ou qu'il est altéré, régénère uniquement les blocs concernés découpés en \x60FILE_PART\x60 de moins de 75 lignes chacun.`,
      { minDelayMs: 900, maxWaitMs: 4500, waitForFile: bundleName }
    );
  }
  async verifyWithAi(item, getSingleCodeFn) {
    if (!item || !item.headerName || item.isVerifyingSpill) return;
    item.isVerifyingSpill = true;
    const btn = item.verifyBtn;
    if (btn) btn.disabled = true;
    try {
      const members = Array.isArray(item.groupItems) && item.groupItems.length > 1 ? item.groupItems : [item];
      if (members.length > 1) {
        await this.verifyGroupWithAi(item, members, getSingleCodeFn);
      } else {
        const { attachName, attachContent } = await this.resolveItemPayload(item, getSingleCodeFn);
        this.chat.dropFile(attachName, attachContent, false);
        this.chat.insertPrompt(
          `Vérification de récupération pour \x60${item.headerName}\x60 : voici exactement le contenu récupéré dans la pièce jointe \x60${attachName}\x60. Confirme simplement si ce code correspond bien à l'intégralité de ce que tu voulais produire pour ce bloc (sans troncature, perte ou artefact d'affichage). Si jamais il manque du code ou qu'il est altéré, régénère-le découpé en plusieurs blocs \x60FILE_PART\x60 de moins de 75 lignes chacun.`,
          { minDelayMs: 900, maxWaitMs: 4500, waitForFile: attachName }
        );
      }
      if (btn) { btn.innerHTML = this.DONE_SVG; btn.classList.add("gmc-verified-btn"); btn.disabled = true; }
    } finally {
      item.isVerifyingSpill = false;
    }
  }

  findTurnContainer(el) {
    let curr = el;
    let bestMultiPre = null;
    const turnSel = "[data-aim-turn], [data-turn-id], message-content, model-response, .conversation-container, article";
    for (let depth = 0; depth < 22 && curr; depth++) {
      const tag = String(curr.tagName || "").toUpperCase();
      if (["BODY", "HTML", "MAIN"].includes(tag)) break;
      if (typeof curr.querySelector === "function" && curr.querySelector("textarea, [contenteditable='true']")) break;
      if (typeof curr.matches === "function" && curr.matches(turnSel)) return curr;
      if (typeof curr.querySelectorAll === "function") {
        if (curr.querySelectorAll(turnSel).length > 1) break;
        const pres = curr.querySelectorAll("pre");
        if (pres.length > 1) bestMultiPre = curr;
      }
      curr = curr.parentElement;
    }
    return bestMultiPre || el?.parentElement || null;
  }

  hasSuitePromptAfterBlock(item) {
    if (!item?.el) return false;
    const tailParts = [];
    const turnRoot = this.findTurnContainer(item.el);
    if (turnRoot && typeof turnRoot.querySelectorAll === "function") {
      for (const node of Array.from(turnRoot.querySelectorAll("p, li, div, span"))) {
        if (node === item.el || item.el.contains?.(node) || node.contains?.(item.el)) continue;
        if (node.closest?.(".gmc-placeholder, .gmc-floating-bar, pre, code")) continue;
        if (typeof item.el.compareDocumentPosition === "function" && !(item.el.compareDocumentPosition(node) & 4)) continue;
        const txt = String(node.textContent || "").trim();
        if (txt) tailParts.push(txt);
      }
    }
    let anc = this.spill.findCodeBlockWrapper(item.el) || item.el;
    for (let up = 0; up < 6 && anc; up++) {
      let sib = anc.nextSibling;
      for (let steps = 0; sib && steps < 18; steps++) {
        if ((sib.nodeType === 1 && !String(sib.className || "").includes("gmc-")) || sib.nodeType === 3) {
          const txt = String(sib.textContent || "").trim();
          if (txt) tailParts.push(txt);
        }
        sib = sib.nextSibling;
      }
      anc = anc.parentElement;
    }
    const combinedTail = tailParts.join("\n");
    return Boolean(combinedTail) && /(?:partie\s+suivante\s+attendue|r[eé]pond(?:s|re)\s*[«"']\s*suite\s*[»"']|(?:dire|dis|écris|ecris|tape|envoie|envoyer)\s*[«"']\s*suite\s*[»"'])/i.test(combinedTail);
  }

  hideSuiteBanner() { if (this.suiteCountdownTimer) { clearInterval(this.suiteCountdownTimer); this.suiteCountdownTimer = null; } if (this.suiteBannerEl) { this.suiteBannerEl.remove(); this.suiteBannerEl = null; } }
  positionSuiteBannerAboveComposer(banner) {
    const inputEl = typeof this.chat?.findChatInputElement === "function" ? this.chat.findChatInputElement() : null;
    const composerBox = inputEl && typeof this.chat?.findComposerContainer === "function" ? this.chat.findComposerContainer(inputEl) : inputEl?.parentElement;
    const rect = composerBox && typeof composerBox.getBoundingClientRect === "function" ? composerBox.getBoundingClientRect() : null;
    const viewW = typeof window !== "undefined" ? (window.innerWidth || 0) : 0;
    const viewH = typeof window !== "undefined" ? (window.innerHeight || 0) : 0;
    if (rect && rect.height > 0 && rect.top > 40 && viewH > 0) {
      banner.style.bottom = `${Math.max(12, Math.round(viewH - rect.top + 8))}px`;
      if (rect.width > 0 && viewW > 0) {
        banner.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
        banner.style.right = "auto";
        banner.style.transform = "translateX(-50%)";
      }
    }
  }
  mountSuiteBannerFloating(banner) {
    if (!document.body?.appendChild) return false;
    document.body.appendChild(banner);
    this.positionSuiteBannerAboveComposer(banner);
    return true;
  }
  showSuiteBanner(delayMs, onCancel) {
    this.hideSuiteBanner();
    if (typeof document === "undefined" || !document.createElement) return;
    const banner = document.createElement("div"); banner.className = "gmc-autosuite-banner";
    const label = document.createElement("span"), cancelBtn = document.createElement("button");
    cancelBtn.type = "button"; cancelBtn.className = "gmc-autosuite-cancel"; cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); onCancel(); });
    banner.append(label, cancelBtn);
    if (!this.mountSuiteBannerFloating(banner)) return;
    this.suiteBannerEl = banner;
    const deadline = Date.now() + delayMs;
    const updateLabel = () => {
      this.positionSuiteBannerAboveComposer(banner);
      label.textContent = `⏳ Envoi auto de « Suite » dans ${Math.max(0.1, (deadline - Date.now()) / 1000).toFixed(1)}s…`;
    };
    updateLabel(); this.suiteCountdownTimer = setInterval(updateLabel, 200);
  }
}
window.GmcBlockVerificationHelper = BlockVerificationHelper;
