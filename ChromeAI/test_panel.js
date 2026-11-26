/**
 * Panneau d'affichage en direct et complet des sorties (tests et build) déplaçable à la souris.
 */
class TestOutputPanelManager {
  constructor(chatInjector, onStopCallback = null, onSendCallback = null) {
    this.chat = chatInjector;
    this.onStop = onStopCallback;
    this.onSend = onSendCallback;
    this.panelEl = null;
    this.preEl = null;
    this.headerEl = null;
    this.stopBtnEl = null;
    this.fullReport = "";
    this.passed = false;
    this.isRunning = false;
    this.savedPosition = null;
  }

  close() {
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
      this.preEl = null;
      this.headerEl = null;
      this.stopBtnEl = null;
    }
  }

  makeDraggable(panel, handle) {
    if (!panel || !handle || typeof handle.addEventListener !== "function") return;
    if (this.savedPosition) {
      panel.style.left = `${this.savedPosition.left}px`;
      panel.style.top = `${this.savedPosition.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    handle.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0 || typeof panel.getBoundingClientRect !== "function") return;
      ev.preventDefault();
      const rect = panel.getBoundingClientRect();
      const offsetX = ev.clientX - rect.left;
      const offsetY = ev.clientY - rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      const onMove = (moveEv) => {
        const maxLeft = Math.max(8, (window.innerWidth || 1200) - (rect.width || 320) - 8);
        const maxTop = Math.max(8, (window.innerHeight || 800) - 48);
        const nextLeft = Math.min(maxLeft, Math.max(8, moveEv.clientX - offsetX));
        const nextTop = Math.min(maxTop, Math.max(8, moveEv.clientY - offsetY));
        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
        this.savedPosition = { left: nextLeft, top: nextTop };
      };
      const onUp = () => {
        document.removeEventListener?.("mousemove", onMove);
        document.removeEventListener?.("mouseup", onUp);
      };
      document.addEventListener?.("mousemove", onMove);
      document.addEventListener?.("mouseup", onUp);
    });
  }
  open(titleText = "⏳ Exécution des tests en cours...", initialText = "", running = false) {
    this.close();
    this.isRunning = Boolean(running);
    const panel = document.createElement("div");
    panel.className = "gmc-git-panel gmc-test-output-panel";
    const header = document.createElement("div");
    header.className = "gmc-git-panel-header";
    header.title = "Cliquer-glisser pour déplacer cette fenêtre";
    header.textContent = titleText;
    const pre = document.createElement("pre");
    pre.className = "gmc-test-output-pre";
    pre.textContent = initialText;
    const actions = document.createElement("div");
    actions.className = "gmc-git-panel-actions";
    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "gmc-git-btn-stop";
    stopBtn.textContent = "⏹️ Arrêter";
    stopBtn.title = "Interrompre l'exécution en cours";
    stopBtn.style.display = this.isRunning ? "inline-flex" : "none";
    stopBtn.addEventListener("click", () => {
      if (!this.isRunning) return;
      stopBtn.disabled = true;
      stopBtn.textContent = "⏳ Arrêt...";
      if (typeof this.onStop === "function") this.onStop();
    });
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
      if (txt) {
        this.chat.insertTestResults(txt, true);
        if (typeof this.onSend === "function") this.onSend();
      }
      this.close();
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gmc-git-btn-close";
    closeBtn.textContent = "Fermer";
    closeBtn.addEventListener("click", () => this.close());
    actions.append(stopBtn, copyBtn, sendBtn, closeBtn);
    panel.append(header, pre, actions);
    document.body.appendChild(panel);
    this.panelEl = panel;
    this.headerEl = header;
    this.preEl = pre;
    this.stopBtnEl = stopBtn;
    this.makeDraggable(panel, header);
  }

  appendChunk(chunk) {
    if (!chunk) return;
    this.fullReport += chunk;
    if (this.preEl) {
      this.preEl.textContent += chunk;
      this.preEl.scrollTop = this.preEl.scrollHeight;
    }
  }

  finish(passed, finalText, stopped = false) {
    this.isRunning = false;
    this.passed = Boolean(passed) && !stopped;
    if (finalText) this.fullReport = finalText;
    if (this.stopBtnEl) this.stopBtnEl.style.display = "none";
    if (this.headerEl) {
      this.headerEl.textContent = stopped ? "⏹️ Exécution arrêtée" : (this.passed ? "✅ Rapport complet" : "⚠️ Rapport complet des échecs");
    }
    if (this.preEl && finalText) {
      this.preEl.textContent = finalText;
      this.preEl.scrollTop = this.preEl.scrollHeight;
    }
  }

  toggle() {
    if (this.panelEl) { this.close(); return; }
    if (!this.fullReport && !this.isRunning) return;
    const title = this.isRunning ? "⏳ Exécution en cours..." : (this.passed ? "✅ Rapport complet" : "⚠️ Rapport complet des échecs");
    this.open(title, this.fullReport, this.isRunning);
  }
}
window.GmcTestOutputPanelManager = TestOutputPanelManager;
