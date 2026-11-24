/**
 * Détection et récupération du code ayant débordé avant ou après un bloc <pre>.
 */
class SpillDetector {
  constructor() {
    this.FILE_TAG_REGEX = /^(?:#\s*)?=== FILE(?:_PART)?:\s*(.+?)\s*===\s*$/;
    this.END_FILE_REGEX = /^(?:#\s*)?=== END_FILE ===\s*$/;
    this.COMMIT_TAG_REGEX = /^(?:#\s*)?=== COMMIT_MESSAGE ===\s*$/;
    this.TRIPLE_BACKTICK = "\x60\x60\x60";
  }

  normalizeText(raw) {
    return (raw || "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  }

  extractRawCode(el) {
    const codeNode = el.tagName === "CODE" ? el : (el.querySelector("code") || el);
    return this.normalizeText(codeNode.textContent).trim();
  }

  findFirstNonEmptyLine(rawText) {
    for (const line of this.normalizeText(rawText).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) return trimmed;
    }
    return "";
  }

  findCodeBlockWrapper(el) {
    let curr = el;
    for (let depth = 0; depth < 6 && curr && curr.parentElement; depth++) {
      const parent = curr.parentElement;
      if (parent.querySelectorAll("pre").length > 1) break;
      if (["ARTICLE", "MAIN", "SECTION"].includes(parent.tagName)) break;
      curr = parent;
    }
    return curr;
  }

  isBoundaryTag(text) {
    const first = this.findFirstNonEmptyLine(text);
    return this.FILE_TAG_REGEX.test(first) || this.END_FILE_REGEX.test(first) || this.COMMIT_TAG_REGEX.test(first);
  }

  isFollowUpArtifact(text) {
    const t = (text || "").trim();
    const open = "<" + "FollowUp>";
    const close = "</" + "FollowUp>";
    return t.startsWith(open) || t.startsWith(close) || t.includes(close) || t.includes(open);
  }

  extractFormattedText(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return this.normalizeText(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.tagName === "BR") return "\n";
    let inner = "";
    for (const child of node.childNodes) inner += this.extractFormattedText(child);
    return /^(DIV|P|LI|PRE|BLOCKQUOTE|TR)$/.test(node.tagName) ? `${inner}\n` : inner;
  }

  isUiOrLangNoise(text) {
    const t = (text || "").trim();
    if (!t) return true;
    if (/^(?:javascript|python|json|html|css|bash|sh|text|markdown|md|ini|toml|xml|yaml|yml)$/i.test(t)) return true;
    return (
      t.includes("Les réponses de l'IA peuvent contenir des erreurs") ||
      t.includes("Utilisez le code avec précaution") ||
      t.includes("Use code with caution") ||
      t.includes("En savoir plus") ||
      /^(?:Copié|Copied|Copier|Partager|Bonne réponse|Mauvaise réponse|PlusÀ propos de cette réponse|Copiez les \d+ blocs|Souhaitez-vous|Voulez-vous|Dites-moi|Une fois|Après avoir|Dis-moi|Oups\s*:)/.test(t)
    );
  }

  looksLikeSpilledCode(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || this.isFollowUpArtifact(trimmed) || this.isUiOrLangNoise(trimmed)) return false;
    if (this.isBoundaryTag(trimmed)) return false;
    const prose = trimmed.replace(/^[\s*•\-–—(]+/, "").replace(/\)+[\s.*]*$/, "").trim();
    if (/^[A-ZÀ-ÿ][a-zà-ÿ']+(?:\s+[a-zà-ÿA-ZÀ-ÿ0-9'/]+){2,}/.test(prose) && !/[{};=]|=>/.test(prose)) return false;
    if (trimmed.startsWith(this.TRIPLE_BACKTICK) || trimmed.endsWith(this.TRIPLE_BACKTICK) || trimmed.includes("\n" + this.TRIPLE_BACKTICK)) return true;
    if (/^[\s{}\[\](),;:=<>+"'`#]+/.test(trimmed)) return true;
    if (/^[\-*/](?!\s+[A-ZÀ-ÿa-zà-ÿ]{2,}\s+[a-zà-ÿ]{2,})/.test(trimmed)) return true;
    if (/(?:def |class |function |const |let |var |import |from |return |if __name__|test\(|\{"seq":|\{"id":)/.test(trimmed)) return true;
    return trimmed.includes("\n") && /[{}();=]/.test(trimmed);
  }
  findEdgeSibling(el, direction) {
    let curr = this.findCodeBlockWrapper(el);
    const prop = direction === "prev" ? "previousSibling" : "nextSibling";
    while (curr && (!curr.parentElement ? false : !curr[prop])) {
      const parent = curr.parentElement;
      if (!parent || parent.querySelectorAll("pre").length > 1) break;
      if (["ARTICLE", "MAIN", "SECTION", "BODY"].includes(parent.tagName)) break;
      curr = parent;
    }
    return curr ? curr[prop] : null;
  }

  scanDirection(startNode, direction) {
    const nodes = [];
    const chunks = [];
    const fenceRe = new RegExp("^" + this.TRIPLE_BACKTICK + "[a-zA-Z0-9_-]*$");
    const openRe = new RegExp("^" + this.TRIPLE_BACKTICK + "[a-zA-Z0-9_-]*\\s*");
    const closeRe = new RegExp("\\s*" + this.TRIPLE_BACKTICK + "$");
    const prop = direction === "prev" ? "previousSibling" : "nextSibling";
    let sib = startNode;

    while (sib && nodes.length < 120) {
      if (sib.nodeType === Node.ELEMENT_NODE) {
        if (sib.classList.contains("gmc-floating-bar")) { sib = sib[prop]; continue; }
        if (sib.classList.contains("gmc-placeholder") || sib.querySelector(".gmc-placeholder")) break;
        const innerPre = sib.tagName === "PRE" ? sib : sib.querySelector("pre");
        if (innerPre) {
          if (innerPre.getAttribute("data-gmc-processed") === "true" || innerPre.getAttribute("data-gmc-purged") === "true") break;
          const preRaw = this.extractRawCode(innerPre);
          const firstLine = this.findFirstNonEmptyLine(preRaw);
          if (this.isBoundaryTag(firstLine)) break;
          if (firstLine.startsWith(this.TRIPLE_BACKTICK) || preRaw === this.TRIPLE_BACKTICK) { nodes.push(sib); break; }
          nodes.push(sib);
          chunks.push(this.TRIPLE_BACKTICK + "\n" + preRaw + "\n" + this.TRIPLE_BACKTICK);
          sib = sib[prop];
          continue;
        }
        if (["HR", "UL", "OL"].includes(sib.tagName) || /^H[1-6]$/.test(sib.tagName)) break;
        const rawFmt = this.extractFormattedText(sib);
        const trimmed = rawFmt.trim();
        if (!trimmed) { sib = sib[prop]; continue; }
        if (this.isFollowUpArtifact(trimmed) || this.isBoundaryTag(trimmed)) break;
        if (this.isUiOrLangNoise(trimmed)) { if (direction === "prev") { nodes.push(sib); break; } sib = sib[prop]; continue; }
        if (fenceRe.test(trimmed)) { nodes.push(sib); break; }
        if (trimmed.endsWith(this.TRIPLE_BACKTICK)) {
          nodes.push(sib);
          const cleaned = trimmed.replace(openRe, "").replace(closeRe, "");
          if (cleaned) chunks.push(cleaned);
          break;
        }
        if (!this.looksLikeSpilledCode(trimmed)) break;
        nodes.push(sib);
        chunks.push(rawFmt.replace(/\n+$/, ""));
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

  collect(el) {
    if (!el || el.getAttribute("data-gmc-purged") === "true") return { nodes: [], text: "", beforeText: "", afterText: "" };
    const before = this.scanDirection(this.findEdgeSibling(el, "prev"), "prev");
    const after = this.scanDirection(this.findEdgeSibling(el, "next"), "next");
    const nodes = [...before.nodes, ...after.nodes];
    return {
      nodes,
      text: [...before.chunks, ...after.chunks].join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      beforeText: before.chunks.join("\n").trim(),
      afterText: after.chunks.join("\n").trim()
    };
  }
}
window.GmcSpillDetector = SpillDetector;
