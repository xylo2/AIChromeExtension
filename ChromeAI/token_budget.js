/**
 * Suivi du budget cumulé de tokens de la conversation et alertes anti-blocage.
 */
class TokenBudgetManager {
  constructor() {
    this.WARN_THRESHOLD = 60000;
    this.CRITICAL_THRESHOLD = 90000;
    this.HEAVY_EXPORT_LIMIT = 35000;
    this.sessionTokens = 0;
  }

  estimateTokens(text) {
    const clean = String(text || "");
    return clean ? Math.max(1, Math.ceil(clean.length / 4)) : 0;
  }

  recordPayload(text, explicitTokens = 0) {
    const added = Number(explicitTokens) > 0 ? Number(explicitTokens) : this.estimateTokens(text);
    this.sessionTokens += added;
    return this.sessionTokens;
  }

  reset() {
    this.sessionTokens = 0;
  }

  getConversationTurnCount() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return 0;
    return document.querySelectorAll("[data-aim-turn], [data-turn-id], message-content, model-response, user-query").length;
  }

  getRecommendedExportMode() {
    return this.getConversationTurnCount() >= 2 ? "modified" : "full";
  }

  shouldConfirmHeavyExport(estimatedTokens) {
    const tok = Number(estimatedTokens || 0);
    if (tok <= this.HEAVY_EXPORT_LIMIT) return false;
    return this.getConversationTurnCount() >= 2 || this.sessionTokens >= 25000;
  }

  formatBadgeState() {
    const kStr = this.sessionTokens >= 1000 ? `${(this.sessionTokens / 1000).toFixed(1)}k` : `${this.sessionTokens}`;
    if (this.sessionTokens >= this.CRITICAL_THRESHOLD) {
      return { level: "fail", label: `🔥 ${kStr} tok`, title: "Budget critique (>90k tok) : ouvrez un Nouveau chat pour éviter le blocage." };
    }
    if (this.sessionTokens >= this.WARN_THRESHOLD) {
      return { level: "running", label: `⚠️ ${kStr} tok`, title: "Budget élevé (>60k tok) : privilégiez les exports Modifiés ou Squelette." };
    }
    return { level: "", label: `📊 ${kStr} tok`, title: "Estimation cumulée des tokens envoyés dans cette session." };
  }
}
window.GmcTokenBudgetManager = TokenBudgetManager;
