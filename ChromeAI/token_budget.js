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

  estimateConversationDomTokens() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return 0;
    const turns = Array.from(document.querySelectorAll("[data-aim-turn], [data-turn-id], message-content, model-response, user-query"));
    const topTurns = turns.filter((el) => !turns.some((other) => other !== el && other.contains?.(el)));
    let total = 0;
    for (const turn of topTurns) total += this.estimateTokens(turn.textContent || "");
    return total;
  }

  getTotalEstimatedTokens() {
    return this.sessionTokens + this.estimateConversationDomTokens();
  }

  recordPayload(text, explicitTokens = 0) {
    const added = Number(explicitTokens) > 0 ? Number(explicitTokens) : this.estimateTokens(text);
    this.sessionTokens += added;
    return this.getTotalEstimatedTokens();
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
    return this.getConversationTurnCount() >= 2 || this.getTotalEstimatedTokens() >= 25000;
  }

  formatBadgeState() {
    const total = this.getTotalEstimatedTokens();
    const kStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    const howItWorks = "L'extension estime le volume cumulé (historique DOM + fichiers/diffs/tests envoyés), privilégie les exports légers dès 2 tours, demande confirmation pour un export lourd (>35k) et alerte à 60k puis 90k tok pour ouvrir un Nouveau chat.";
    if (total >= this.CRITICAL_THRESHOLD) {
      return { level: "fail", label: `🔥 ${kStr} tok`, title: `Budget critique (>90k tok) : ouvrez un Nouveau chat pour éviter le blocage.\n${howItWorks}` };
    }
    if (total >= this.WARN_THRESHOLD) {
      return { level: "running", label: `⚠️ ${kStr} tok`, title: `Budget élevé (>60k tok) : privilégiez les exports Modifiés ou Squelette.\n${howItWorks}` };
    }
    return { level: "", label: `📊 ${kStr} tok`, title: `Estimation du contexte actif (${kStr} tok).\n${howItWorks}` };
  }
}
window.GmcTokenBudgetManager = TokenBudgetManager;
