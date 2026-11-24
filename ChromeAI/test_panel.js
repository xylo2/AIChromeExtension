/**
 * Panneau d'affichage en direct et complet de la sortie des tests unitaires.
 */
class TestOutputPanelManager {
  constructor(chatInjector) {
    this.chat = chatInjector;
    this.panelEl = null;
    this.preEl = null;
    this.headerEl = null;
    this.fullReport = "";
    this.passed = false;
  }

  close() {
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
      this.preEl = null;
      this.headerEl = null;
    }
  }

  open(titleText = "⏳ Exécution des tests en cours...", initialText = "") {
    this.close();
    const panel = document.createElement("div");
    panel.className = "gmc-git-panel gmc-test-output-panel";
    const header = document.createElement("div");
    header.className = "gmc-git-panel-header";
    header.textContent = titleText;
    const pre = document.createElement("pre");
    pre.className = "gmc-test-output-pre";
    pre.textContent = initialText;
    const actions = document.createElement("div");
    actions.className = "gmc-git-panel-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "gmc-git-btn-verify";
    copyBtn.textContent = "📋 Copier";
    copyBtn.addEventListener("click", async () => {
      const txt = this.fullReport || this.preEl?.textContent || "";
      try { await navigator.clipboard.writeText(txt); } catch (_err) {}
      copyBtn.textContent = "✅ Copié !";
      setTimeout(() => { copyBtn.textContent = "📋 Copier"; }, 1400);
    });
    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "gmc-git-btn-validate";
    sendBtn.textContent = "→ Envoyer à l'IA";
    sendBtn.addEventListener("click", () => {
      const txt = this.fullReport || this.preEl?.textContent || "";
      if (txt) this.chat.insertTestResults(txt, true);
      this.close();
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gmc-git-btn-close";
    closeBtn.textContent = "Fermer";
    closeBtn.addEventListener("click", () => this.close());
    actions.append(copyBtn, sendBtn, closeBtn);
    panel.append(header, pre, actions);
    document.body.appendChild(panel);
    this.panelEl = panel;
    this.headerEl = header;
    this.preEl = pre;
  }

  appendChunk(chunk) {
    if (!chunk) return;
    this.fullReport += chunk;
    if (this.preEl) {
      this.preEl.textContent += chunk;
      this.preEl.scrollTop = this.preEl.scrollHeight;
    }
  }

  finish(passed, finalText) {
    this.passed = Boolean(passed);
    if (finalText) this.fullReport = finalText;
    if (this.headerEl) {
      this.headerEl.textContent = this.passed ? "✅ Rapport complet des tests" : "⚠️ Rapport complet des échecs";
    }
    if (this.preEl && finalText) {
      this.preEl.textContent = finalText;
      this.preEl.scrollTop = this.preEl.scrollHeight;
    }
  }

  toggle() {
    if (this.panelEl) { this.close(); return; }
    if (!this.fullReport) return;
    const title = this.passed ? "✅ Rapport complet des tests" : "⚠️ Rapport complet des échecs";
    this.open(title, this.fullReport);
  }
}
window.GmcTestOutputPanelManager = TestOutputPanelManager;
