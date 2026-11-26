/**
 * Suivi persistant du budget cumulé de tokens de la conversation et alertes anti-blocage.
 */
class TokenBudgetManager {
  constructor() {
    this.WARN_THRESHOLD = 60000;
    this.CRITICAL_THRESHOLD = 90000;
    this.HEAVY_EXPORT_LIMIT = 35000;
    this.PENDING_TTL_MS = 30000;
    this.TURN_SELECTORS = "[data-aim-turn], [data-turn-id], message-content, model-response, user-query, [data-attrid='AIOverview'], [data-al]";
    this.sessionTokens = 0;
    this.activeKey = "";
  }

  estimateTokens(text) {
    const clean = String(text || "");
    return clean ? Math.max(1, Math.ceil(clean.length / 4)) : 0;
  }

  getConversationKey() {
    const loc = (typeof window !== "undefined" && window?.location) ? window.location : (typeof location !== "undefined" ? location : null);
    if (!loc?.href) return "default";
    const noHash = String(loc.href).split("#").at(0) || "";
    const qIdx = noHash.indexOf("?");
    const basePart = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
    const queryPart = qIdx >= 0 ? noHash.slice(qIdx + 1) : "";
    const afterProto = basePart.includes("//") ? basePart.slice(basePart.indexOf("//") + 2) : basePart;
    if (afterProto.includes("/search")) {
      let threadId = "";
      for (const kv of queryPart.split("&")) {
        const eqIdx = kv.indexOf("=");
        if (eqIdx > 0) {
          const k = kv.slice(0, eqIdx);
          if (k === "mstk" || k === "cs" || k === "sei" || (!threadId && k === "udm")) threadId = kv.slice(eqIdx + 1);
        }
      }
      return `${afterProto}:${threadId || "ai"}`;
    }
    return afterProto || "default";
  }

  isGenericKey(key) {
    const k = String(key || "");
    return !k || k === "default" || !k.includes("/search") || /:(?:ai|50|\d{1,3})$/.test(k);
  }
  syncFromStorage(onLoaded = null) {
    const key = this.getConversationKey();
    const prevKey = this.activeKey;
    const prevTokens = this.sessionTokens;
    if (key !== prevKey) { this.activeKey = key; this.sessionTokens = 0; }
    if (typeof chrome === "undefined" || !chrome.storage?.local?.get) return;
    chrome.storage.local.get(["gmcTokenBudgets", "gmcPendingBudget"], (res) => {
      const map = res?.gmcTokenBudgets && typeof res.gmcTokenBudgets === "object" ? { ...res.gmcTokenBudgets } : {};
      const storedVal = Number(map[key] || 0);
      if (storedVal > this.sessionTokens) this.sessionTokens = storedVal;
      const pending = res?.gmcPendingBudget;
      if (this.sessionTokens === 0 && pending && Number(pending.tokens) > 0 && (Date.now() - Number(pending.at || 0)) <= this.PENDING_TTL_MS) {
        if (!this.isGenericKey(key) || prevTokens === 0) {
          this.sessionTokens = Number(pending.tokens);
          if (pending.fromKey && pending.fromKey !== key) delete map[pending.fromKey];
          map[key] = this.sessionTokens;
          chrome.storage.local.set?.({ gmcTokenBudgets: map });
          chrome.storage.local.remove?.("gmcPendingBudget");
        }
      }
      if (typeof onLoaded === "function") onLoaded();
    });
  }

  saveToStorage(pendingTokens = 0) {
    if (typeof chrome === "undefined" || !chrome.storage?.local?.get) return;
    const key = this.activeKey || this.getConversationKey();
    chrome.storage.local.get("gmcTokenBudgets", (res) => {
      const map = res?.gmcTokenBudgets && typeof res.gmcTokenBudgets === "object" ? { ...res.gmcTokenBudgets } : {};
      if (this.sessionTokens > 0) map[key] = this.sessionTokens;
      else delete map[key];
      const keys = Object.keys(map);
      if (keys.length > 25) keys.slice(0, keys.length - 25).forEach((oldK) => delete map[oldK]);
      const payload = { gmcTokenBudgets: map };
      if (pendingTokens > 0 && this.isGenericKey(key)) payload.gmcPendingBudget = { tokens: this.sessionTokens, at: Date.now(), fromKey: key };
      chrome.storage.local.set(payload);
    });
  }

  estimateConversationDomTokens() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return 0;
    const turns = Array.from(document.querySelectorAll(this.TURN_SELECTORS));
    const topTurns = turns.filter((el) => !turns.some((other) => other !== el && other.contains?.(el)));
    if (topTurns.length > 0) return topTurns.reduce((sum, turn) => sum + this.estimateTokens(turn.textContent || ""), 0);
    const mainEl = typeof document.querySelector === "function" ? document.querySelector("main, [role='main']") : null;
    return mainEl ? this.estimateTokens(mainEl.textContent || "") : 0;
  }

  getTotalEstimatedTokens() { return this.sessionTokens + this.estimateConversationDomTokens(); }
  recordPayload(text, explicitTokens = 0) { const added = Number(explicitTokens) > 0 ? Number(explicitTokens) : this.estimateTokens(text); this.sessionTokens += added; this.saveToStorage(added); return this.getTotalEstimatedTokens(); }
  reset() { this.sessionTokens = 0; chrome.storage?.local?.remove?.("gmcPendingBudget"); this.saveToStorage(0); }
  getConversationTurnCount() { return typeof document?.querySelectorAll === "function" ? document.querySelectorAll(this.TURN_SELECTORS).length : 0; }
  getRecommendedExportMode() { return this.getConversationTurnCount() >= 2 || this.getTotalEstimatedTokens() >= 15000 ? "modified" : "full"; }
  shouldConfirmHeavyExport(estimatedTokens) { return Number(estimatedTokens || 0) > this.HEAVY_EXPORT_LIMIT && (this.getConversationTurnCount() >= 2 || this.getTotalEstimatedTokens() >= 25000); }

  formatBadgeState() {
    const total = this.getTotalEstimatedTokens();
    const kStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    const howItWorks = "L'extension estime le volume cumulé (historique DOM + fichiers/diffs/tests envoyés), privilégie les exports légers dès 2 tours, demande confirmation pour un export lourd (>35k) et alerte à 60k puis 90k tok pour ouvrir un Nouveau chat.";
    if (total >= this.CRITICAL_THRESHOLD) return { level: "fail", label: `🔥 ${kStr} tok`, title: `Budget critique (>90k tok) : ouvrez un Nouveau chat pour éviter le blocage.\n${howItWorks}` };
    if (total >= this.WARN_THRESHOLD) return { level: "running", label: `⚠️ ${kStr} tok`, title: `Budget élevé (>60k tok) : privilégiez les exports Modifiés ou Squelette.\n${howItWorks}` };
    return { level: "", label: `📊 ${kStr} tok`, title: `Estimation du contexte actif (${kStr} tok).\n${howItWorks}` };
  }
}
window.GmcTokenBudgetManager = TokenBudgetManager;
