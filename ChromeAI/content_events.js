/**
 * Écouteurs DOM, raccourcis clavier (Alt+P/S/T), auto-fix syntaxique, auto-tests et commit 1-clic.
 */
class ContentEventsController {
  constructor(ctx) {
    this.ctx = ctx;
    this.autoFixEnabled = false;
    this.autoTestEnabled = false;
    this.lastAutoSyntaxSig = "";
    this.autoSyntaxAttemptsByFile = new Map();
    this.MAX_AUTO_SYNTAX_PER_FILE = 2;
    this.lastAutoTestEventSig = "";
  }

  loadPrefs() {
    chrome.storage?.local?.get?.(["gmcAutoFix", "gmcAutoTest"], (res) => {
      if (typeof res?.gmcAutoFix === "boolean") this.autoFixEnabled = res.gmcAutoFix;
      if (typeof res?.gmcAutoTest === "boolean") this.autoTestEnabled = res.gmcAutoTest;
      this.syncToggleButtons();
    });
  }

  syncToggleButtons() {
    const { els } = this.ctx;
    if (els.autoSyntaxBtn) {
      els.autoSyntaxBtn.textContent = this.autoFixEnabled ? "⚡ Auto-fix: ON" : "⚡ Auto-fix: OFF";
      els.autoSyntaxBtn.classList.toggle("state-pass", this.autoFixEnabled);
    }
    if (els.autoTestBtn) {
      els.autoTestBtn.textContent = this.autoTestEnabled ? "🧪 Auto-tests: ON" : "🧪 Auto-tests: OFF";
      els.autoTestBtn.classList.toggle("state-pass", this.autoTestEnabled);
    }
  }

  extractSyntaxEventFile(evSig) {
    const m = String(evSig || "").match(/^\[SYNTAXE\]\s+([^\s(]+)/);
    return m ? m.at(1) : "";
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

  triggerQuickCommitFlow() {
    const { els, blockManager, chatInjector, gitManager, sendBgMessage, setBtnState } = this.ctx;
    blockManager.resetAutoSuiteQuota();
    if (typeof this.ctx.canRequestCommitMsg === "function" && this.ctx.canRequestCommitMsg()) {
      chatInjector.insertPrompt(gitManager.buildCommitMessageOnlyPrompt(), true);
      this.ctx.clearCommitMsgFlag();
      return;
    }
    const btn = els.composerCommitBtn || els.gitBtn;
    const origText = btn ? btn.textContent : "💬 Commit";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Diff..."; }
    sendBgMessage({ type: "GIT_STATUS" }, (res) => {
      const entries = res?.entries || [];
      if (!res?.ok || entries.length === 0) {
        if (btn) { btn.disabled = false; btn.textContent = res?.ok ? "✅ Rien à committer" : "❌ Erreur Git"; setTimeout(() => { btn.textContent = origText; }, 2000); }
        return;
      }
      const files = entries.map((e) => e.path).filter(Boolean);
      gitManager.lastValidatedFiles = [...files];
      chrome.storage?.local?.set?.({ savedGitSelectedFiles: files });
      sendBgMessage({ type: "GIT_DIFF_SELECTED", files }, (diffRes) => {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
        if (!diffRes?.ok) { setBtnState(els.gitBtn, "fail", "❌ Erreur diff"); return; }
        const diffName = diffRes.filename || "git_changes.diff.txt";
        const diffContent = String(diffRes.content || diffRes.diff || "");
        if (diffContent) chatInjector.dropFile(diffName, diffContent, false);
        chatInjector.insertPrompt(gitManager.buildCommitPrompt(files, diffName), { minDelayMs: 1600, maxWaitMs: 7000, waitForFile: diffContent ? diffName : "" });
        this.ctx.clearCommitMsgFlag();
      });
    });
  }

  handleStateUpdate(nextState) {
    this.ctx.setWatcherState(nextState);
    this.ctx.updateIndicators();
    const evSig = String(nextState?.lastEvent || "");
    const okMatch = evSig.match(/^\[(?:OK|COMPLET)\]\s+([^\s(]+)/);
    if (okMatch) this.autoSyntaxAttemptsByFile.delete(okMatch.at(1));
    if (this.autoFixEnabled && nextState?.hasSyntaxError && evSig) {
      if (evSig !== this.lastAutoSyntaxSig) {
        this.lastAutoSyntaxSig = evSig;
        const fileKey = this.extractSyntaxEventFile(evSig) || "__default__";
        const tries = this.autoSyntaxAttemptsByFile.get(fileKey) || 0;
        if (tries >= this.MAX_AUTO_SYNTAX_PER_FILE) {
          if (this.ctx.els.autoSyntaxBtn) this.ctx.els.autoSyntaxBtn.textContent = `⏸️ Auto-fix max (${fileKey})`;
          return;
        }
        this.autoSyntaxAttemptsByFile.set(fileKey, tries + 1);
        this.sendSyntaxErrorToAi(evSig);
      }
      return;
    }
    if (!nextState?.hasSyntaxError) this.lastAutoSyntaxSig = "";
    if (this.autoTestEnabled && nextState?.running && nextState?.hasRunTestsClip && !nextState?.hasSyntaxError && /^\[(?:OK|COMPLET)\]/.test(evSig)) {
      if (evSig !== this.lastAutoTestEventSig && !this.ctx.testActions?.panel?.isRunning) {
        this.lastAutoTestEventSig = evSig;
        this.ctx.els.testsBtn?.click();
      }
    }
  }

  bindAll() {
    const { els, blockManager, chatInjector, gitManager, exportMenu, testActions, sendBgMessage, setBtnState, triggerProjectExport } = this.ctx;
    this.loadPrefs();
    els.autoSyntaxBtn?.addEventListener("click", () => {
      this.autoFixEnabled = !this.autoFixEnabled;
      this.autoSyntaxAttemptsByFile.clear();
      this.lastAutoSyntaxSig = "";
      chrome.storage?.local?.set?.({ gmcAutoFix: this.autoFixEnabled });
      this.syncToggleButtons();
      if (this.autoFixEnabled && this.ctx.getWatcherState()?.hasSyntaxError) this.handleStateUpdate(this.ctx.getWatcherState());
    });
    els.autoTestBtn?.addEventListener("click", () => {
      this.autoTestEnabled = !this.autoTestEnabled;
      chrome.storage?.local?.set?.({ gmcAutoTest: this.autoTestEnabled });
      this.syncToggleButtons();
    });
    els.statusPill.addEventListener("click", () => {
      if (this.ctx.getWatcherState()?.running || this.ctx.isStarting()) return;
      this.ctx.setStarting(true); els.statusPill.textContent = "⏳ Démarrage...";
      chrome.storage?.local?.get?.(["savedTargetDir", "savedExtraArgs"], (res) => {
        sendBgMessage({ type: "START_WATCHER", targetDir: (res.savedTargetDir || ".").trim() || ".", extraArgs: (res.savedExtraArgs || "").trim() }, (reply) => {
          this.ctx.setStarting(false); if (reply?.state) this.handleStateUpdate(reply.state); else this.ctx.updateIndicators();
        });
      });
    });
    els.copyPurgeAllBtn.addEventListener("click", () => blockManager.copyAndPurgeAll());
    els.commitMsgBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt(gitManager.buildCommitMessageOnlyPrompt(), true); this.ctx.clearCommitMsgFlag(); });
    els.composerCommitBtn?.addEventListener("click", () => this.triggerQuickCommitFlow());
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
