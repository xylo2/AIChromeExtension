/**
 * Vérification IA des blocs FILE/FILE_PART et détection de la demande « Suite » en fin de tour.
 */
class BlockVerificationHelper {
  constructor(chatInjector, spillDetector) {
    this.chat = chatInjector;
    this.spill = spillDetector;
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

  async verifyWithAi(item, getCombinedCodeFn) {
    if (!item || !item.headerName || item.isVerifyingSpill) return;
    item.isVerifyingSpill = true;
    const btn = item.verifyBtn;
    if (btn) btn.disabled = true;
    const combinedText = getCombinedCodeFn(item);
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

  findTurnContainer(el) {
    let curr = el;
    for (let depth = 0; depth < 16 && curr; depth++) {
      if (typeof curr.matches === "function" && curr.matches("[data-aim-turn], [data-turn-id], message-content, model-response, .conversation-container, article")) return curr;
      curr = curr.parentElement;
    }
    return el?.parentElement || null;
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
    for (let up = 0; up < 5 && anc; up++) {
      let sib = anc.nextSibling;
      for (let steps = 0; sib && steps < 15; steps++) {
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
}
window.GmcBlockVerificationHelper = BlockVerificationHelper;
