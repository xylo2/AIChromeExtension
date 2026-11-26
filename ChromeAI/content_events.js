/**
 * Écouteurs DOM, raccourcis clavier (Alt+P/S/T) et auto-fix syntaxique pour ChromeAI.
 */
class ContentEventsController {
  constructor(ctx) {
    this.ctx = ctx;
    this.autoFixEnabled = false;
    this.lastAutoSyntaxSig = "";
  }

  sendSyntaxErrorToAi(fallbackText = "") {
    const { blockManager, sendBgMessage, chatInjector } = this.ctx;
    blockManager.resetAutoSuiteQuota();
    sendBgMessage({ type: "GET_SYNTAX_ERROR" }, (res) => {
      const err = res?.syntax_error;
      if (res?.ok && err?.file) {
        const prompt = `Erreur de syntaxe détectée automatiquement dans \x60${err.file}\x60 (${err.message}) :\n\x60\x60\x60text\n${err.snippet || ""}\n\x60\x60\x60\nPeux-tu corriger ce fichier ?`;
        chatInjector.insertPrompt(prompt, true);
      } else if (fallbackText) chatInjector.insertPrompt(fallbackText, true);
    });
  }

  handleStateUpdate(nextState) {
    this.ctx.setWatcherState(nextState);
    this.ctx.updateIndicators();
    if (this.autoFixEnabled && nextState?.hasSyntaxError && nextState?.lastEvent) {
      const sig = String(nextState.lastEvent);
      if (sig !== this.lastAutoSyntaxSig) { this.lastAutoSyntaxSig = sig; this.sendSyntaxErrorToAi(sig); }
    } else if (!nextState?.hasSyntaxError) this.lastAutoSyntaxSig = "";
  }

  bindAll() {
    const { els, blockManager, chatInjector, gitManager, exportMenu, testActions, sendBgMessage, setBtnState, triggerProjectExport } = this.ctx;
    els.autoSyntaxBtn?.addEventListener("click", () => {
      this.autoFixEnabled = !this.autoFixEnabled;
      els.autoSyntaxBtn.textContent = this.autoFixEnabled ? "⚡ Auto-fix: ON" : "⚡ Auto-fix: OFF";
      els.autoSyntaxBtn.classList.toggle("state-pass", this.autoFixEnabled);
      if (this.autoFixEnabled && this.ctx.getWatcherState()?.hasSyntaxError) this.handleStateUpdate(this.ctx.getWatcherState());
    });
    els.statusPill.addEventListener("click", () => {
      if (this.ctx.getWatcherState()?.running || this.ctx.isStarting()) return;
      this.ctx.setStarting(true); els.statusPill.textContent = "⏳ Démarrage...";
      chrome.storage.local.get(["savedTargetDir", "savedExtraArgs"], (res) => {
        sendBgMessage({ type: "START_WATCHER", targetDir: (res.savedTargetDir || ".").trim() || ".", extraArgs: (res.savedExtraArgs || "").trim() }, (reply) => {
          this.ctx.setStarting(false); if (reply?.state) this.handleStateUpdate(reply.state); else this.ctx.updateIndicators();
        });
      });
    });
    els.copyPurgeAllBtn.addEventListener("click", () => blockManager.copyAndPurgeAll());
    els.commitMsgBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt(gitManager.buildCommitMessageOnlyPrompt(), true); this.ctx.clearCommitMsgFlag(); });
    els.eventPill.addEventListener("click", () => {
      const st = this.ctx.getWatcherState(); const rawEv = String(st?.lastEvent || els.eventPill.textContent || "");
      if (st?.hasSyntaxError || rawEv.startsWith("[SYNTAXE]")) { this.sendSyntaxErrorToAi(rawEv); return; }
      blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt(rawEv, true);
    });
    els.yesBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Oui", true); });
    els.nextBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Suite", true); });
    els.excuseBtn.addEventListener("click", () => chatInjector.insertPrompt(this.ctx.composerUi.pickExcuse(), false));
    els.gitBtn.addEventListener("click", () => {
      if (gitManager.panelEl) { gitManager.close(); return; }
      setBtnState(els.gitBtn, "running", "⏳ Git...");
      sendBgMessage({ type: "GIT_STATUS" }, (res) => {
        if (!res?.ok) return setBtnState(els.gitBtn, "fail", "❌ Erreur Git");
        const entries = res.entries || [];
        if (entries.length === 0) { setBtnState(els.gitBtn, "pass", "✅ Aucun changement"); setTimeout(() => setBtnState(els.gitBtn, null, "🔀 Git status"), 2200); return; }
        setBtnState(els.gitBtn, null, "🔀 Git status"); gitManager.open(entries);
      });
    });
    els.exportBtn.addEventListener("click", () => {
      if (!exportMenu) { triggerProjectExport("full", []); return; }
      if (exportMenu.menuEl) { exportMenu.close(); return; }
      sendBgMessage({ type: "EXPORT_FOLDERS" }, (res) => exportMenu.toggle((m, sub) => triggerProjectExport(m, sub), res?.folders || []));
    });
    els.testLogBtn.addEventListener("click", () => testActions.panel.toggle());
    els.purgeBtn.addEventListener("click", () => blockManager.purgeAll());
    document.addEventListener("keydown", (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "p") { e.preventDefault(); blockManager.copyAndPurgeAll(); }
      else if (k === "s") { e.preventDefault(); blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Suite", true); }
      else if (k === "t" && !els.testsBtn.disabled) { e.preventDefault(); els.testsBtn.click(); }
    });
  }
}
window.GmcContentEventsController = ContentEventsController;
