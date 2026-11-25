/**
 * Gestion du cycle d'exécution des tests unitaires et du bouton de couverture dans la barre flottante.
 */
class TestActionsController {
  constructor(chatInjector, sendBgMessage, setBtnState, buttons, getWatcherState, onRefreshUi) {
    this.chat = chatInjector;
    this.sendBgMessage = sendBgMessage;
    this.setBtnState = setBtnState;
    this.testsBtn = buttons.testsBtn;
    this.coverageBtn = buttons.coverageBtn;
    this.getWatcherState = getWatcherState;
    this.onRefreshUi = onRefreshUi;
    this.lastUncoveredReport = "";
    this.lastCoveragePercent = null;
    this.lastTestsPassed = false;
    this.lastPassedEventSnapshot = null;
    this.panel = new window.GmcTestOutputPanelManager(chatInjector, () => this.sendBgMessage({ type: "STOP_PROJECT_TESTS" }, () => {}), () => this.resetTestsButton());
    this.bindEvents();
  }

  resetTestsButton() { this.setBtnState(this.testsBtn, null, "🧪 Lancer les tests"); }

  invalidateOnNewFiles() {
    if (!this.lastTestsPassed) return;
    if ((this.getWatcherState()?.lastEvent ?? null) !== this.lastPassedEventSnapshot) {
      this.lastTestsPassed = false;
      this.lastPassedEventSnapshot = null;
      this.lastUncoveredReport = "";
      this.lastCoveragePercent = null;
      this.resetTestsButton();
    }
  }

  parseCoveragePercent(reportText) {
    const m = String(reportText || "").match(/COUVERTURE GLOBALE\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i);
    return m ? Number.parseFloat(m.at(1)) : null;
  }

  renderCoverageIndicator() {
    const st = this.getWatcherState();
    if (!st?.running || !st.hasRunTestsClip || !this.lastTestsPassed || !this.lastUncoveredReport) { this.coverageBtn.style.display = "none"; return; }
    this.coverageBtn.style.display = "inline-flex";
    const pct = this.lastCoveragePercent ?? this.parseCoveragePercent(this.lastUncoveredReport);
    const isFull = pct !== null && pct >= 100;
    this.coverageBtn.classList.toggle("state-pass", isFull);
    this.coverageBtn.classList.toggle("state-fail", pct !== null && pct < 70);
    this.coverageBtn.textContent = isFull ? "✅ Couv. 100.0%" : `📊 Couverture${pct !== null ? ` (${pct.toFixed(1)}%)` : ""}`;
    this.coverageBtn.title = isFull ? "Toutes les lignes exécutables mesurées sont couvertes par les tests" : "Envoyer à l'IA le bilan de couverture et les lignes non couvertes";
  }

  async finalizeTestRun(res) {
    this.testsBtn.disabled = false;
    if (!res?.ok && !res?.stopped) { this.setBtnState(this.testsBtn, "fail", "❌ Erreur"); this.panel.finish(false, res?.error || "Erreur d'exécution des tests.", false); this.onRefreshUi(); return; }
    if (res?.stopped) { this.setBtnState(this.testsBtn, "fail", "⏹️ Tests arrêtés"); this.panel.finish(false, this.panel.fullReport || "Exécution arrêtée.", true); this.onRefreshUi(); return; }
    const finalReport = String(res.output || this.panel.fullReport || "").trim();
    this.panel.finish(Boolean(res.passed), finalReport, false);
    if (res.passed) {
      this.setBtnState(this.testsBtn, "pass", "✅ Tests OK");
      this.lastTestsPassed = true;
      this.lastPassedEventSnapshot = this.getWatcherState()?.lastEvent ?? null;
      this.lastUncoveredReport = String(res.uncovered || "").trim();
      this.lastCoveragePercent = this.parseCoveragePercent(this.lastUncoveredReport);
      this.onRefreshUi();
      return;
    }
    if (finalReport) {
      if (this.chat.insertTestResults(finalReport, true)) this.resetTestsButton();
      else { try { await navigator.clipboard.writeText(finalReport); } catch (_err) {} this.setBtnState(this.testsBtn, "fail", "⚠️ Échecs copiés"); }
    } else this.setBtnState(this.testsBtn, "fail", "⚠️ Échecs (vide)");
    this.onRefreshUi();
  }

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

  bindEvents() {
    this.coverageBtn.addEventListener("click", () => {
      if (!this.lastUncoveredReport) return;
      this.chat.insertPrompt("Voici le bilan de couverture et les lignes non encore couvertes par les tests unitaires :\n\x60\x60\x60text\n" + this.lastUncoveredReport + "\n\x60\x60\x60\nPeux-tu ajouter ou compléter les tests unitaires pour améliorer la couverture ?\n", true);
      this.lastUncoveredReport = ""; this.lastCoveragePercent = null; this.lastTestsPassed = false; this.lastPassedEventSnapshot = null;
      this.renderCoverageIndicator();
    });
    this.testsBtn.addEventListener("click", () => {
      if (this.testsBtn.disabled || this.panel.isRunning) { if (this.panel.isRunning && !this.panel.panelEl) this.panel.toggle(); return; }
      this.testsBtn.disabled = true; this.setBtnState(this.testsBtn, "running", "⏳ Tests...");
      this.lastTestsPassed = false; this.lastPassedEventSnapshot = null; this.lastUncoveredReport = ""; this.lastCoveragePercent = null;
      this.panel.open("⏳ Exécution des tests en cours...", "", true); this.onRefreshUi();
      this.sendBgMessage({ type: "START_PROJECT_TESTS" }, (startRes) => {
        const errTxt = String(startRes?.error || "");
        if (errTxt === "not_found") { this.panel.appendChunk("Mode streaming indisponible (redémarrez watch_clipboard). Exécution synchrone...\n"); this.sendBgMessage({ type: "RUN_PROJECT_TESTS", injectIntoActiveTab: false }, (r) => this.finalizeTestRun(r)); return; }
        if (!startRes?.ok && !/déjà en cours/i.test(errTxt)) { this.finalizeTestRun(startRes); return; }
        this.startPollingStream(0);
      });
    });
  }
}
window.GmcTestActionsController = TestActionsController;
