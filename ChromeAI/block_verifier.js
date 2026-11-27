// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Utilisateur_A

/**
 * Vérification IA des blocs (unitaire ou groupée), bannière auto-Suite et fin de tour.
 */
class BlockVerificationHelper {
  /** Initialise l'injecteur de chat et le détecteur de débordement. */
  constructor(chatInjector, spillDetector) {
    this.chat = chatInjector;
    this.spill = spillDetector;
    this.suiteCountdownTimer = null;
    this.suiteBannerEl = null;
  }

  /** Construit l'icône SVG de validation sans HTML brut. */
  createDoneSvg() {
    const ns = ["http://www", "w3", "org/2000/svg"].join(".");
    const mk = (t) => (typeof document.createElementNS === "function" ? document.createElementNS(ns, t) : document.createElement(t));
    const svg = mk("svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    const poly = mk("polyline");
    poly.setAttribute("points", "20 6 9 17 4 12");
    svg.appendChild(poly);
    return svg;
  }

  /** Construit un nom de pièce jointe de repli à partir de l'en-tête FILE ou FILE_PART. */
  buildFallbackAttachmentName(headerName) {
    const parts = (headerName || "bloc.txt").split("|");
    const baseName = parts.at(0).trim().split(/[\\/]/).filter(Boolean).pop() || "bloc.txt";
    const partIdx = parts.length > 1 ? parts.at(1).split("/").at(0).trim() : "";
    return partIdx ? `${baseName}.part${partIdx}.txt` : `${baseName}.txt`;
  }

  /** Interroge le serveur local pour relire le fichier ou fragment réellement écrit sur disque. */
  requestSavedFile(headerName, maxWaitMs = 1400) {
    return new Promise((resolve) => {
      const deadline = Date.now() + maxWaitMs;
      const attempt = () => {
        if (typeof chrome === "undefined" || !chrome.runtime?.id) {
          resolve({ ok: false });
          return;
        }
        chrome.runtime.sendMessage({ type: "READ_SAVED_FILE", header: headerName }, (res) => {
          if (res?.ok && typeof res.content === "string") resolve(res);
          else if (Date.now() < deadline) setTimeout(attempt, 350);
          else resolve({ ok: false });
        });
      };
      attempt();
    });
  }
  /** Résout le nom et le contenu à vérifier (priorité au disque, repli sur le DOM). */
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

  /** Regroupe l'ensemble des blocs du tour dans verification_tour.txt et demande un contrôle. */
  async verifyGroupWithAi(leadItem, members, getSingleCodeFn) {
    const sections = [], headersList = [], targetPaths = new Set();
    for (const m of members) {
      headersList.push(m.headerName);
      targetPaths.add(String(m.headerName || "").split("|").at(0).trim());
      const { attachContent } = await this.resolveItemPayload(m, getSingleCodeFn);
      sections.push(`--- ${m.headerName} ---\n${attachContent}`);
    }
    const bundleName = "verification_tour.txt";
    const singleTarget = targetPaths.size === 1 ? Array.from(targetPaths).at(0) : "";
    const scopeSummary = singleTarget
      ? `l'intégralité des ${members.length} parties assemblées pour \x60${singleTarget}\x60 (\x60${headersList.join("`, `")}\x60)`
      : `l'ensemble des ${members.length} blocs représentés dans cette carte (\x60${headersList.join("`, `")}\x60)`;
    this.chat.dropFile(bundleName, sections.join("\n\n"), false);
    this.chat.insertPrompt(
      `Vérification complète de récupération pour ${scopeSummary} : voici exactement l'intégralité du contenu récupéré dans la pièce jointe \x60${bundleName}\x60. Confirme simplement si chaque partie et l'ensemble du contenu correspondent bien à ce que tu voulais produire (sans troncature, perte ou artefact d'affichage). Si jamais il manque du code ou qu'il est altéré, régénère uniquement les blocs concernés découpés en \x60FILE_PART\x60 de moins de 65 lignes chacun.`,
      { minDelayMs: 900, maxWaitMs: 4500, waitForFile: bundleName }
    );
  }

  /** Transmet un bloc unique ou l'ensemble d'un bloc regroupé à l'IA pour contrôler son intégrité. */
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
          `Vérification de récupération pour \x60${item.headerName}\x60 : voici exactement le contenu récupéré dans la pièce jointe \x60${attachName}\x60. Confirme simplement si ce code correspond bien à l'intégralité de ce que tu voulais produire pour ce bloc (sans troncature, perte ou artefact d'affichage). Si jamais il manque du code ou qu'il est altéré, régénère-le découpé en plusieurs blocs \x60FILE_PART\x60 de moins de 65 lignes chacun.`,
          { minDelayMs: 900, maxWaitMs: 4500, waitForFile: attachName }
        );
      }
      if (btn) {
        btn.textContent = "";
        btn.appendChild(this.createDoneSvg());
        btn.classList.add("gmc-verified-btn");
        btn.disabled = true;
      }
    } finally {
      item.isVerifyingSpill = false;
    }
  }
  /** Remonte le DOM pour identifier l'élément conteneur englobant toute la réponse du tour. */
  findTurnContainer(el) {
    if (!el) return null;
    const directTurn = el.closest?.('.mZJni, .pWvJNd, [data-scope-id="turn"], [data-aim-turn], model-response');
    if (directTurn && typeof directTurn.querySelectorAll === "function") {
      if (directTurn.querySelectorAll('[data-scope-id="turn"], .mZJni').length <= 1) {
        return directTurn;
      }
    }
    let curr = el, bestTurn = null, bestMultiPre = null;
    const msgTurnSel = '.mZJni, .pWvJNd, [data-container-id="main-col"], model-response, .conversation-container';
    const outerTurnSel = '[data-scope-id="turn"], [data-aim-turn], ' + msgTurnSel;
    for (let depth = 0; depth < 90 && curr; depth++) {
      const tag = String(curr.tagName || "").toUpperCase();
      if (["BODY", "HTML", "MAIN"].includes(tag)) break;
      if (typeof curr.querySelector === "function" && curr.querySelector("rich-textarea, textarea")) break;
      if (typeof curr.querySelectorAll === "function") {
        const msgCnt = curr.querySelectorAll(msgTurnSel).length;
        const userCnt = curr.querySelectorAll("user-query").length;
        if (msgCnt > 1 || userCnt > 1) break;
        const preCnt = curr.querySelectorAll("pre").length;
        if (preCnt > 1) bestMultiPre = curr;
        if (typeof curr.matches === "function" && curr.matches(msgTurnSel)) {
          if (preCnt > 1 || msgCnt === 0) return curr;
          bestTurn = curr;
        } else if (typeof curr.matches === "function" && curr.matches(outerTurnSel)) {
          if (!bestTurn) bestTurn = curr;
        }
        if (userCnt === 1 && preCnt > 1) return curr;
      }
      curr = curr.parentElement;
    }
    return bestTurn || bestMultiPre || el?.parentElement || null;
  }

  /** Détecte si le texte suivant un bloc de code invite l'utilisateur à répondre Suite. */
  hasSuitePromptAfterBlock(item) {
    if (!item?.el) return false;
    const tailParts = [], turnRoot = this.findTurnContainer(item.el);
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
    for (let up = 0; up < 8 && anc; up++) {
      let sib = anc.nextSibling;
      for (let steps = 0; sib && steps < 20; steps++) {
        if ((sib.nodeType === 1 && !String(sib.className || "").includes("gmc-")) || sib.nodeType === 3) {
          const txt = String(sib.textContent || "").trim();
          if (txt) tailParts.push(txt);
        }
        sib = sib.nextSibling;
      }
      anc = anc.parentElement;
    }
    const combinedTail = tailParts.join("\n").replace(/[*_`]+/g, "");
    return Boolean(combinedTail) && /(?:partie\s+suivante\s+attendue|attends\s*[«"']?\s*suite\s*[»"']?|r[eé]pond(?:s|re)\s*[«"']?\s*suite\s*[»"']?|(?:dire|dis|écris|ecris|tape|envoie|envoyer|indique|demande|saisis)(?:-moi)?\s*[«"']?\s*suite\s*[»"']?|^\s*suite\s*\?\s*$)/im.test(combinedTail);
  }

  /** Arrête le compte à rebours et supprime la bannière flottante d'auto-Suite. */
  hideSuiteBanner() {
    if (this.suiteCountdownTimer) { clearInterval(this.suiteCountdownTimer); this.suiteCountdownTimer = null; }
    if (this.suiteBannerEl) { this.suiteBannerEl.remove(); this.suiteBannerEl = null; }
  }

  /** Aligne la bannière flottante d'auto-Suite juste au-dessus de la zone de saisie. */
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

  /** Insère la bannière d'auto-Suite dans document.body et la positionne. */
  mountSuiteBannerFloating(banner) {
    if (!document.body?.appendChild) return false;
    document.body.appendChild(banner);
    this.positionSuiteBannerAboveComposer(banner);
    return true;
  }

  /** Affiche un compte à rebours annulable avant l'envoi automatique de Suite. */
  showSuiteBanner(delayMs, onCancel) {
    this.hideSuiteBanner();
    if (typeof document === "undefined" || !document.createElement) return;
    const banner = document.createElement("div");
    banner.className = "gmc-autosuite-banner";
    const label = document.createElement("span"), cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gmc-autosuite-cancel";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); onCancel(); });
    banner.append(label, cancelBtn);
    if (!this.mountSuiteBannerFloating(banner)) return;
    this.suiteBannerEl = banner;
    const deadline = Date.now() + delayMs;
    const updateLabel = () => {
      this.positionSuiteBannerAboveComposer(banner);
      label.textContent = `⏳ Envoi auto de « Suite » dans ${Math.max(0.1, (deadline - Date.now()) / 1000).toFixed(1)}s…`;
    };
    updateLabel();
    this.suiteCountdownTimer = setInterval(updateLabel, 200);
  }
}
window.GmcBlockVerificationHelper = BlockVerificationHelper;
