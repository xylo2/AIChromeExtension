/**
 * Détection et récupération du code ayant débordé avant ou après un bloc <pre>.
 */
class SpillDetector {
  /** Initialise les expressions régulières et le moteur heuristique associé. */
  constructor() {
    this.heuristics = window.GmcSpillTextHeuristics ? new window.GmcSpillTextHeuristics() : null;
    this.FILE_TAG_REGEX = /^(?:#\s*)?=== FILE(?:_PART)?:\s*(.+?)\s*===\s*$/;
    this.END_FILE_REGEX = /^(?:#\s*)?=== END_FILE ===\s*$/;
    this.COMMIT_TAG_REGEX = /^(?:#\s*)?=== COMMIT_MESSAGE ===\s*$/;
    this.TRIPLE_BACKTICK = "\x60\x60\x60";
  }

  /** Uniformise les espaces insécables et les fins de ligne en LF. */
  normalizeText(raw) { return (raw || "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n"); }

  /** Extrait le texte brut normalisé de la balise <code> interne ou du <pre>. */
  extractRawCode(el) { const c = el.tagName === "CODE" ? el : (el.querySelector("code") || el); return this.normalizeText(c.textContent).trim(); }

  /** Retourne la première ligne non vide du bloc. */
  findFirstNonEmptyLine(rawText) { return this.heuristics ? this.heuristics.findFirstNonEmptyLine(rawText) : (this.normalizeText(rawText).split("\n").map((l) => l.trim()).find(Boolean) || ""); }

  /** Indique si la ligne correspond à une balise FILE, END_FILE ou COMMIT_MESSAGE. */
  isBoundaryTag(text) { return this.heuristics ? this.heuristics.isBoundaryTag(text) : false; }

  /** Détecte les artefacts internes FollowUp à exclure du code. */
  isFollowUpArtifact(text) { return this.heuristics ? this.heuristics.isFollowUpArtifact(text) : false; }

  /** Identifie les textes d'interface Google AI ou noms de langages isolés. */
  isUiOrLangNoise(text) { return this.heuristics ? this.heuristics.isUiOrLangNoise(text) : false; }

  /** Évalue heuristiquement si un paragraphe contient du code débordé. */
  looksLikeSpilledCode(text) { return this.heuristics ? this.heuristics.looksLikeSpilledCode(text) : false; }

  /** Remonte les ancêtres d'un <pre> jusqu'à son conteneur de carte de code unique. */
  findCodeBlockWrapper(el) {
    let curr = el;
    for (let depth = 0; depth < 6 && curr && curr.parentElement; depth++) {
      const parent = curr.parentElement;
      if (parent.querySelectorAll("pre").length > 1 || ["ARTICLE", "MAIN", "SECTION"].includes(parent.tagName)) break;
      curr = parent;
    }
    return curr;
  }
  /** Convertit récursivement un nœud DOM en texte brut en préservant les sauts de ligne. */
  extractFormattedText(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return this.normalizeText(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.tagName === "BR") return "\n";
    let inner = "";
    for (const child of node.childNodes || []) inner += this.extractFormattedText(child);
    return /^(DIV|P|LI|PRE|BLOCKQUOTE|TR)$/.test(node.tagName) ? `${inner}\n` : inner;
  }

  /** Trouve le nœud frère précédent ou suivant le conteneur du bloc de code. */
  findEdgeSibling(el, direction) {
    let curr = this.findCodeBlockWrapper(el);
    const prop = direction === "prev" ? "previousSibling" : "nextSibling";
    while (curr && curr.parentElement && !curr[prop]) {
      const parent = curr.parentElement;
      if (parent.querySelectorAll("pre").length > 1 || ["ARTICLE", "MAIN", "SECTION", "BODY"].includes(parent.tagName)) break;
      curr = parent;
    }
    return curr ? curr[prop] : null;
  }

  /** Parcourt les frères adjacents dans une direction pour récupérer le code débordé. */
  scanDirection(startNode, direction) {
    const nodes = [], chunks = [];
    const fenceRe = new RegExp("^" + this.TRIPLE_BACKTICK + "[a-zA-Z0-9_-]*$");
    const openRe = new RegExp("^" + this.TRIPLE_BACKTICK + "[a-zA-Z0-9_-]*\\s*");
    const closeRe = new RegExp("\\s*" + this.TRIPLE_BACKTICK + "$");
    const prop = direction === "prev" ? "previousSibling" : "nextSibling";
    let sib = startNode;
    while (sib && nodes.length < 120) {
      if (sib.nodeType === Node.ELEMENT_NODE) {
        if (sib.classList?.contains("gmc-floating-bar")) { sib = sib[prop]; continue; }
        if (sib.classList?.contains("gmc-placeholder") || sib.querySelector?.(".gmc-placeholder")) break;
        const innerPre = sib.tagName === "PRE" ? sib : sib.querySelector?.("pre");
        if (innerPre) {
          if (innerPre.getAttribute("data-gmc-processed") === "true" || innerPre.getAttribute("data-gmc-purged") === "true") break;
          const preRaw = this.extractRawCode(innerPre);
          const firstLine = this.findFirstNonEmptyLine(preRaw);
          if (this.isBoundaryTag(firstLine)) break;
          if (firstLine.startsWith(this.TRIPLE_BACKTICK) || preRaw === this.TRIPLE_BACKTICK) { nodes.push(sib); break; }
          nodes.push(sib); chunks.push(this.TRIPLE_BACKTICK + "\n" + preRaw + "\n" + this.TRIPLE_BACKTICK);
          sib = sib[prop]; continue;
        }
        if (["HR", "UL", "OL"].includes(sib.tagName) || /^H[1-6]$/.test(sib.tagName)) break;
        const rawFmt = this.extractFormattedText(sib), trimmed = rawFmt.trim();
        if (!trimmed) { sib = sib[prop]; continue; }
        if (this.isFollowUpArtifact(trimmed) || this.isBoundaryTag(trimmed)) break;
        if (this.isUiOrLangNoise(trimmed)) { if (direction === "prev") { nodes.push(sib); break; } sib = sib[prop]; continue; }
        if (fenceRe.test(trimmed)) { nodes.push(sib); break; }
        if (trimmed.endsWith(this.TRIPLE_BACKTICK)) {
          nodes.push(sib); const cleaned = trimmed.replace(openRe, "").replace(closeRe, ""); if (cleaned) chunks.push(cleaned); break;
        }
        if (!this.looksLikeSpilledCode(trimmed)) break;
        nodes.push(sib); chunks.push(rawFmt.replace(/\n+$/, ""));
      } else if (sib.nodeType === Node.TEXT_NODE) {
        const txt = this.normalizeText(sib.textContent).trim();
        if (txt) {
          if (this.isFollowUpArtifact(txt) || this.isBoundaryTag(txt)) break;
          if (this.isUiOrLangNoise(txt)) { if (direction === "prev") break; sib = sib[prop]; continue; }
          if (txt.includes(this.TRIPLE_BACKTICK)) { const c = txt.split(this.TRIPLE_BACKTICK).join("").trim(); if (c) chunks.push(c); break; }
          if (!this.looksLikeSpilledCode(txt)) break;
          chunks.push(txt);
        }
      }
      sib = sib[prop];
    }
    if (direction === "prev") { nodes.reverse(); chunks.reverse(); }
    return { nodes, chunks };
  }

  /** Collecte et assemble les fragments débordés avant et après l'élément <pre>. */
  collect(el) {
    if (!el || el.getAttribute("data-gmc-purged") === "true") return { nodes: [], text: "", beforeText: "", afterText: "" };
    const before = this.scanDirection(this.findEdgeSibling(el, "prev"), "prev");
    const after = this.scanDirection(this.findEdgeSibling(el, "next"), "next");
    return { nodes: [...before.nodes, ...after.nodes], text: [...before.chunks, ...after.chunks].join("\n").replace(/\n{3,}/g, "\n\n").trim(), beforeText: before.chunks.join("\n").trim(), afterText: after.chunks.join("\n").trim() };
  }
}
window.GmcSpillDetector = SpillDetector;
