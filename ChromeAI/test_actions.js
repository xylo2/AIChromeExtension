/**
 * Gestion du cycle d'exécution des tests unitaires, relance des tests KO et couverture.
 */
class TestActionsController {
  /** Initialise les contrôles de tests, le panneau de logs et les écouteurs d'événements. */
  constructor(chatInjector, sendBgMessage, setBtnState, buttons, getWatcherState, onRefreshUi, budgetManager = null) {
    this.chat = chatInjector; this.sendBgMessage = sendBgMessage; this.setBtnState = setBtnState;
    this.testsBtn = buttons.testsBtn; this.rerunFailedBtn = buttons.rerunFailedBtn || null;
    this.coverageBtn = buttons.coverageBtn;
    this.getWatcherState = getWatcherState; this.onRefreshUi = onRefreshUi; this.budget = budgetManager;
    this.MAX_PROMPT_REPORT_CHARS = 6500; this.autoClosePanelTimer = null;
    this.lastUncoveredReport = ""; this.lastCoveragePercent = null;
    this.lastTestsPassed = false; this.lastPassedEventSnapshot = null;
    this.lastSentFailureSig = ""; this.lastFailureEventSnapshot = null; this.lastFailureReport = "";
    this.lastFailedTests = []; this.isTargetedRun = false;
    this.panel = new window.GmcTestOutputPanelManager(chatInjector, () => this.sendBgMessage({ type: "STOP_PROJECT_TESTS" }, () => {}), () => this.resetTestsButton());
    this.bindEvents();
  }

  /** Réinitialise le libellé et l'état visuel des boutons de tests. */
  resetTestsButton() {
    this.setBtnState(this.testsBtn, null, "🧪 Lancer les tests");
    if (this.rerunFailedBtn) this.setBtnState(this.rerunFailedBtn, null, `🎯 Relancer KO (${this.lastFailedTests.length})`);
  }

  /** Calcule une empreinte normalisée d'un rapport d'échec pour éviter les doublons. */
  computeFailureSignature(reportText) { return String(reportText || "").replace(/\s+/g, " ").trim().slice(0, 400); }

  /** Indique si un échec de tests non encore résolu est mémorisé. */
  hasPendingFailure() { return Boolean(this.lastFailureReport && !this.lastTestsPassed); }

  /** Retourne la liste des tests KO mémorisés lors de la dernière exécution. */
  getFailedTests() { return [...this.lastFailedTests]; }

  /** Indique si l'utilisateur est en train de rédiger un brouillon dans le compositeur. */
  hasUserDraftInComposer() {
    const inputEl = typeof this.chat?.findChatInputElement === "function" ? this.chat.findChatInputElement() : null;
    return Boolean(inputEl && typeof this.chat?.getInputText === "function" && this.chat.getInputText(inputEl) !== "");
  }

  /** Extrait les identifiants des tests en échec depuis un rapport Python ou Node.js. */
  extractFailedTestNames(reportText) {
    const names = [], seen = new Set();
    const pushName = (raw) => {
      const clean = String(raw || "").replace(/\s*\([0-9.]+m?s\)\s*$/, "").trim();
      if (clean && !seen.has(clean)) { seen.add(clean); names.push(clean); }
    };
    for (const line of String(reportText || "").split("\n")) {
      const trimmed = line.trim();
      const pyMatch = trimmed.match(/^(?:\[DOUBLON\]\s*)?(?:FAIL|ERROR):\s+(.+?)(?:\s+->\s+.*)?$/);
      if (pyMatch) { pushName(pyMatch.at(1)); continue; }
      const jsMatch = trimmed.match(/^[✖✗]\s+(.+)$/);
      if (jsMatch && !/^failing tests:?$/i.test(jsMatch.at(1).trim())) pushName(jsMatch.at(1));
    }
    return names;
  }

  /** Tronque un rapport volumineux avant insertion dans le prompt pour économiser les tokens. */
  truncateReportForPrompt(reportText) {
    const clean = String(reportText || "").trim();
    if (clean.length <= this.MAX_PROMPT_REPORT_CHARS) return clean;
    const omitted = clean.length - this.MAX_PROMPT_REPORT_CHARS;
    return `${clean.slice(0, this.MAX_PROMPT_REPORT_CHARS).trim()}\n[... ${omitted} caractères tronqués — voir panneau Sortie tests ...]`;
  }
  /** Réinitialise les statuts de tests et couverture lorsqu'un nouveau fichier est assemblé. */
  invalidateOnNewFiles() {
    const curEv = this.getWatcherState()?.lastEvent ?? null;
    if (this.lastTestsPassed && curEv !== this.lastPassedEventSnapshot) {
      this.lastTestsPassed = false; this.lastPassedEventSnapshot = null; this.lastUncoveredReport = ""; this.lastCoveragePercent = null;
      this.resetTestsButton();
    }
    if (this.lastSentFailureSig && curEv !== this.lastFailureEventSnapshot) {
      this.lastSentFailureSig = ""; this.lastFailureEventSnapshot = null; this.lastFailureReport = "";
    }
  }

  /** Extrait le pourcentage numérique global depuis le rapport de couverture. */
  parseCoveragePercent(reportText) { const m = String(reportText || "").match(/COUVERTURE GLOBALE\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i); return m ? Number.parseFloat(m.at(1)) : null; }

  /** Met à jour la visibilité, la couleur et le texte des pastilles de couverture et relance KO. */
  renderCoverageIndicator() {
    const st = this.getWatcherState();
    const active = Boolean(st?.running && st.hasRunTestsClip);
    if (this.rerunFailedBtn) {
      const hasFailed = active && this.lastFailedTests.length > 0;
      this.rerunFailedBtn.style.display = hasFailed ? "inline-flex" : "none";
      this.rerunFailedBtn.disabled = Boolean(this.panel.isRunning);
      if (hasFailed && !this.panel.isRunning) this.rerunFailedBtn.textContent = `🎯 Relancer KO (${this.lastFailedTests.length})`;
    }
    if (!active || !this.lastTestsPassed || !this.lastUncoveredReport) { this.coverageBtn.style.display = "none"; return; }
    this.coverageBtn.style.display = "inline-flex";
    const pct = this.lastCoveragePercent ?? this.parseCoveragePercent(this.lastUncoveredReport);
    const isFull = pct !== null && pct >= 100;
    this.coverageBtn.classList.toggle("state-pass", isFull); this.coverageBtn.classList.toggle("state-fail", pct !== null && pct < 70);
    this.coverageBtn.textContent = isFull ? "✅ Couv. 100.0%" : `📊 Couverture${pct !== null ? ` (${pct.toFixed(1)}%)` : ""}`;
    this.coverageBtn.title = isFull ? "Toutes les lignes exécutables mesurées sont couvertes par les tests" : "Envoyer à l'IA le bilan de couverture et les lignes non couvertes";
  }

  /** Démarre une exécution complète ou ciblée sur les tests KO mémorisés. */
  startTestExecution(onlyFailed = false, isTrustedClick = true) {
    if (this.testsBtn.disabled || this.panel.isRunning) { if (this.panel.isRunning && !this.panel.panelEl) this.panel.toggle(); return; }
    const targetFailed = onlyFailed ? this.getFailedTests() : [];
    if (onlyFailed && targetFailed.length === 0) return;
    if (isTrustedClick) { this.lastSentFailureSig = ""; this.lastFailureEventSnapshot = null; }
    this.isTargetedRun = targetFailed.length > 0;
    this.testsBtn.disabled = true;
    if (this.rerunFailedBtn) this.rerunFailedBtn.disabled = true;
    this.setBtnState(this.isTargetedRun ? (this.rerunFailedBtn || this.testsBtn) : this.testsBtn, "running", this.isTargetedRun ? `⏳ KO (${targetFailed.length})...` : "⏳ Tests...");
    this.lastTestsPassed = false; this.lastPassedEventSnapshot = null; this.lastUncoveredReport = ""; this.lastCoveragePercent = null;
    this.panel.open(this.isTargetedRun ? `⏳ Relance des ${targetFailed.length} test(s) KO...` : "⏳ Exécution des tests en cours...", "", true);
    this.onRefreshUi();
    this.sendBgMessage({ type: "START_PROJECT_TESTS", failedTests: targetFailed }, (startRes) => {
      const errTxt = String(startRes?.error || "");
      if (errTxt === "not_found") { this.panel.appendChunk("Mode streaming indisponible. Exécution synchrone...\n"); this.sendBgMessage({ type: "RUN_PROJECT_TESTS", injectIntoActiveTab: false, failedTests: targetFailed }, (r) => this.finalizeTestRun(r)); return; }
      if (!startRes?.ok && !/déjà en cours/i.test(errTxt)) { this.finalizeTestRun(startRes); return; }
      this.startPollingStream(0);
    });
  }

  /** Traite le résultat final des tests (succès, arrêt manuel ou insertion des échecs). */
  async finalizeTestRun(res) {
    this.testsBtn.disabled = false;
    if (this.rerunFailedBtn) this.rerunFailedBtn.disabled = false;
    if (this.autoClosePanelTimer) { clearTimeout(this.autoClosePanelTimer); this.autoClosePanelTimer = null; }
    if (!res?.ok && !res?.stopped) { this.setBtnState(this.testsBtn, "fail", "❌ Erreur"); this.panel.finish(false, res?.error || "Erreur d'exécution des tests.", false); this.onRefreshUi(); return; }
    if (res?.stopped) { this.setBtnState(this.testsBtn, "fail", "⏹️ Tests arrêtés"); this.panel.finish(false, this.panel.fullReport || "Exécution arrêtée.", true); this.onRefreshUi(); return; }
    const finalReport = String(res.output || this.panel.fullReport || "").trim();
    this.panel.finish(Boolean(res.passed), finalReport, false);
    if (res.passed) {
      const wasTargeted = this.isTargetedRun; this.isTargetedRun = false; this.lastFailedTests = []; this.resetTestsButton();
      this.setBtnState(this.testsBtn, "pass", wasTargeted ? "✅ Tests KO OK" : "✅ Tests OK");
      this.lastTestsPassed = !wasTargeted; this.lastPassedEventSnapshot = !wasTargeted ? (this.getWatcherState()?.lastEvent ?? null) : null;
      this.lastSentFailureSig = ""; this.lastFailureEventSnapshot = null; this.lastFailureReport = "";
      this.lastUncoveredReport = wasTargeted ? "" : String(res.uncovered || "").trim();
      this.lastCoveragePercent = this.parseCoveragePercent(this.lastUncoveredReport);
      this.autoClosePanelTimer = setTimeout(() => { this.autoClosePanelTimer = null; if (this.lastTestsPassed || !this.lastFailedTests.length) this.panel.close(); }, 3500);
      this.onRefreshUi(); return;
    }
    this.isTargetedRun = false; this.lastFailureReport = finalReport;
    const parsedFailed = this.extractFailedTestNames(finalReport);
    if (parsedFailed.length > 0) this.lastFailedTests = parsedFailed;
    this.resetTestsButton();
    if (finalReport) {
      const sig = this.computeFailureSignature(finalReport), curEv = this.getWatcherState()?.lastEvent ?? null, compactPayload = this.truncateReportForPrompt(finalReport);
      const shouldAutoSubmit = !this.hasUserDraftInComposer();
      if (sig && sig === this.lastSentFailureSig && curEv === this.lastFailureEventSnapshot) {
        try { await navigator.clipboard.writeText(finalReport); } catch (_err) {}
        this.setBtnState(this.testsBtn, "fail", "⚠️ Échec déjà envoyé");
      } else if (this.chat.insertTestResults(compactPayload, shouldAutoSubmit ? { minDelayMs: 900, maxWaitMs: 5500 } : false)) {
        this.budget?.recordPayload(compactPayload); this.lastSentFailureSig = sig; this.lastFailureEventSnapshot = curEv; this.resetTestsButton();
        this.panel.close();
        if (!shouldAutoSubmit) this.setBtnState(this.testsBtn, "fail", "📝 Échecs ajoutés (brouillon)");
      } else { try { await navigator.clipboard.writeText(finalReport); } catch (_err) {} this.setBtnState(this.testsBtn, "fail", "⚠️ Échecs copiés"); }
    } else this.setBtnState(this.testsBtn, "fail", "⚠️ Échecs (vide)");
    this.onRefreshUi();
  }

  /** Interroge périodiquement le flux de logs des tests jusqu'à la fin de l'exécution. */
  startPollingStream(initialOffset = 0) {
    let offset = initialOffset;
    if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
    window.__gmcStreamTimer = setInterval(() => {
      this.sendBgMessage({ type: "POLL_TEST_STREAM", offset }, (snap) => {
        if (!snap?.ok) return;
        if (snap.chunk) this.panel.appendChunk(snap.chunk);
        offset = Number(snap.offset || offset);
        if (!snap.running) { clearInterval(window.__gmcStreamTimer); window.__gmcStreamTimer = null; this.finalizeTestRun(snap); }
      });
    }, 300);
  }

  /** Attache les gestionnaires de clic sur les boutons de tests, relance KO et couverture. */
  bindEvents() {
    this.coverageBtn.addEventListener("click", () => {
      if (!this.lastUncoveredReport) return;
      const compactCov = this.truncateReportForPrompt(this.lastUncoveredReport);
      this.chat.insertPrompt("Voici le bilan de couverture et les lignes non encore couvertes par les tests unitaires :\n\x60\x60\x60text\n" + compactCov + "\n\x60\x60\x60\nPeux-tu ajouter ou compléter les tests unitaires pour améliorer la couverture ?\n", !this.hasUserDraftInComposer());
      this.budget?.recordPayload(compactCov);
      this.lastUncoveredReport = ""; this.lastCoveragePercent = null; this.lastTestsPassed = false; this.lastPassedEventSnapshot = null; this.renderCoverageIndicator();
    });
    this.testsBtn.addEventListener("click", (ev) => this.startTestExecution(false, ev?.isTrusted !== false));
    this.rerunFailedBtn?.addEventListener("click", (ev) => this.startTestExecution(true, ev?.isTrusted !== false));
  }
}
window.GmcTestActionsController = TestActionsController;
