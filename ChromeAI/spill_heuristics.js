/**
 * Règles heuristiques de classification du texte et des balises de débordement.
 */
class SpillTextHeuristics {
  constructor() {
    this.FILE_TAG_REGEX = /^(?:#\s*)?=== FILE(?:_PART)?:\s*(.+?)\s*===\s*$/;
    this.END_FILE_REGEX = /^(?:#\s*)?=== END_FILE ===\s*$/;
    this.COMMIT_TAG_REGEX = /^(?:#\s*)?=== COMMIT_MESSAGE ===\s*$/;
    this.TRIPLE_BACKTICK = "\x60\x60\x60";
  }

  normalizeText(raw) {
    return (raw || "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  }

  findFirstNonEmptyLine(rawText) {
    for (const line of this.normalizeText(rawText).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) return trimmed;
    }
    return "";
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
}
window.GmcSpillTextHeuristics = SpillTextHeuristics;
