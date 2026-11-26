/**
 * Écouteurs DOM, raccourcis clavier (Alt+P/S/T), auto-fix syntaxique, auto-tests et actions guidées.
 */
class ContentEventsController {
  constructor(ctx) {
    this.ctx = ctx; this.autoFixEnabled = true; this.autoTestEnabled = false;
    this.lastAutoSyntaxSig = ""; this.autoSyntaxAttemptsByFile = new Map();
    this.MAX_AUTO_SYNTAX_PER_FILE = 2; this.lastAutoTestEventSig = ""; this.wasWatcherRunning = false;
    this.autoFixNoticeTimer = null; this.autoFixNoticeLabel = "";
  }
  enableAutoFixOnServiceStart() {
    this.autoFixEnabled = true; this.autoSyntaxAttemptsByFile.clear(); this.lastAutoSyntaxSig = "";
    this.clearAutoFixNotice(); chrome.storage?.local?.set?.({ gmcAutoFix: true }); this.syncToggleButtons();
  }
  loadPrefs() {
    this.autoFixEnabled = true; this.syncToggleButtons(); chrome.storage?.local?.set?.({ gmcAutoFix: true });
    chrome.storage?.local?.get?.(["gmcAutoTest"], (res) => { if (typeof res?.gmcAutoTest === "boolean") this.autoTestEnabled = res.gmcAutoTest; this.syncToggleButtons(); });
  }
  clearAutoFixNotice() { if (this.autoFixNoticeTimer) { clearTimeout(this.autoFixNoticeTimer); this.autoFixNoticeTimer = null; } this.autoFixNoticeLabel = ""; }
  notifyAutoFixTriggered(fileKey, attemptNum) {
    const shortName = String(fileKey || "fichier").split(/[\\/]/).pop();
    this.clearAutoFixNotice(); this.autoFixNoticeLabel = `⚡ Auto-fix envoyé (${shortName} ${attemptNum}/${this.MAX_AUTO_SYNTAX_PER_FILE})`;
    this.syncToggleButtons();
    this.autoFixNoticeTimer = setTimeout(() => { this.autoFixNoticeTimer = null; this.autoFixNoticeLabel = ""; this.syncToggleButtons(); }, 6500);
  }
  isAutoFixHandlingCurrentError() {
    const st = this.ctx.getWatcherState?.();
    if (!this.autoFixEnabled || !st?.hasSyntaxError) return false;
    const fileKey = this.extractSyntaxEventFile(st.lastEvent || "") || "__default__";
    return (this.autoSyntaxAttemptsByFile.get(fileKey) || 0) < this.MAX_AUTO_SYNTAX_PER_FILE || Boolean(this.autoFixNoticeLabel);
  }
  syncToggleButtons() {
    const { els } = this.ctx;
    if (els.autoSyntaxBtn) {
      els.autoSyntaxBtn.classList.toggle("state-running", Boolean(this.autoFixNoticeLabel));
      els.autoSyntaxBtn.classList.toggle("state-pass", this.autoFixEnabled && !this.autoFixNoticeLabel);
      els.autoSyntaxBtn.textContent = this.autoFixNoticeLabel || (this.autoFixEnabled ? "⚡ Auto-fix: ON" : "⚡ Auto-fix: OFF");
    }
    if (els.autoTestBtn) { els.autoTestBtn.textContent = this.autoTestEnabled ? "🧪 Auto-tests: ON" : "🧪 Auto-tests: OFF"; els.autoTestBtn.classList.toggle("state-pass", this.autoTestEnabled); }
  }
  extractSyntaxEventFile(evSig) { const m = String(evSig || "").match(/^\[SYNTAXE\]\s+([^\s(]+)/); return m ? m.at(1) : ""; }
  resetSyntaxAttemptsForEvent(evSig) {
    const fileKey = this.extractSyntaxEventFile(evSig);
    if (fileKey) this.autoSyntaxAttemptsByFile.delete(fileKey); else this.autoSyntaxAttemptsByFile.clear();
    this.lastAutoSyntaxSig = ""; this.clearAutoFixNotice(); this.syncToggleButtons();
  }
  sendSyntaxErrorToAi(fallbackText = "", onSent = null) {
    const { blockManager, sendBgMessage, chatInjector, tokenBudget, updateIndicators } = this.ctx;
    blockManager.resetAutoSuiteQuota();
    sendBgMessage({ type: "GET_SYNTAX_ERROR" }, (res) => {
      const err = res?.syntax_error;
      const prompt = (res?.ok && err?.file) ? `Erreur de syntaxe détectée automatiquement dans \x60${err.file}\x60 (${err.message}) :\n\x60\x60\x60text\n${err.snippet || ""}\n\x60\x60\x60\nPeux-tu corriger ce fichier ?` : fallbackText;
      if (!prompt) return;
      tokenBudget?.recordPayload(prompt);
      if (chatInjector.insertPrompt(prompt, { minDelayMs: 650, maxWaitMs: 5500 }) && typeof onSent === "function") onSent(err?.file || "");
      updateIndicators?.();
    });
  }
  executeGuidedAction() {
    const actionId = typeof this.ctx.getGuidedActionId === "function" ? this.ctx.getGuidedActionId() : "";
    const { els, blockManager, chatInjector, gitManager, tokenBudget } = this.ctx;
    if (actionId === "fix_syntax") { this.resetSyntaxAttemptsForEvent(this.ctx.getWatcherState()?.lastEvent || ""); this.sendSyntaxErrorToAi(); return; }
    if (actionId === "copy_suite") { blockManager.copyAndPurgeAll(); return; }
    if (actionId === "commit_msg") { const msgPrompt = gitManager.buildCommitMessageOnlyPrompt(); blockManager.resetAutoSuiteQuota(); tokenBudget?.recordPayload(msgPrompt); chatInjector.insertPrompt(msgPrompt, true); this.ctx.clearCommitMsgFlag(); return; }
    if (actionId === "run_tests") els.testsBtn?.click();
  }
  triggerQuickCommitFlow() {
    const { els, blockManager, chatInjector, gitManager, sendBgMessage, setBtnState, tokenBudget, updateIndicators } = this.ctx;
    blockManager.resetAutoSuiteQuota();
    if (typeof this.ctx.canRequestCommitMsg === "function" && this.ctx.canRequestCommitMsg()) {
      const msgOnly = gitManager.buildCommitMessageOnlyPrompt(); tokenBudget?.recordPayload(msgOnly); chatInjector.insertPrompt(msgOnly, true); this.ctx.clearCommitMsgFlag(); return;
    }
    const btn = els.composerCommitBtn || els.gitBtn, origText = btn ? btn.textContent : "💬 Commit";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Diff..."; }
    sendBgMessage({ type: "GIT_STATUS" }, (res) => {
      const entries = res?.entries || [];
      if (!res?.ok || entries.length === 0) { if (btn) { btn.disabled = false; btn.textContent = res?.ok ? "✅ Rien à committer" : "❌ Erreur Git"; setTimeout(() => { btn.textContent = origText; }, 2000); } return; }
      const files = entries.map((e) => e.path).filter(Boolean);
      gitManager.lastValidatedFiles = [...files]; chrome.storage?.local?.set?.({ savedGitSelectedFiles: files });
      sendBgMessage({ type: "GIT_DIFF_SELECTED", files }, (diffRes) => {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
        if (!diffRes?.ok) { setBtnState(els.gitBtn, "fail", "❌ Erreur diff"); return; }
        const diffName = diffRes.filename || "git_changes.diff.txt", diffContent = String(diffRes.content || diffRes.diff || "");
        const commitPrompt = gitManager.buildCommitPrompt(files, diffName);
        tokenBudget?.recordPayload(`${diffContent}\n${commitPrompt}`, Number(diffRes.estimated_tokens || 0) + (tokenBudget?.estimateTokens(commitPrompt) || 0));
        if (diffContent) chatInjector.dropFile(diffName, diffContent, false);
        chatInjector.insertPrompt(commitPrompt, { minDelayMs: 1600, maxWaitMs: 7000, waitForFile: diffContent ? diffName : "" });
        this.ctx.clearCommitMsgFlag(); updateIndicators?.();
      });
    });
  }
  handleStateUpdate(nextState) {
    const isNowRunning = Boolean(nextState?.running);
    if (isNowRunning && !this.wasWatcherRunning) this.enableAutoFixOnServiceStart();
    this.wasWatcherRunning = isNowRunning;
    this.ctx.setWatcherState(nextState); this.ctx.updateIndicators();
    const evSig = String(nextState?.lastEvent || "");
    const okMatch = evSig.match(/^\[(?:OK|COMPLET)\]\s+([^\s(]+)/);
    if (okMatch) this.autoSyntaxAttemptsByFile.delete(okMatch.at(1));
    if (this.autoFixEnabled && nextState?.hasSyntaxError && evSig) {
      if (evSig !== this.lastAutoSyntaxSig) {
        this.lastAutoSyntaxSig = evSig;
        const fileKey = this.extractSyntaxEventFile(evSig) || "__default__";
        const tries = this.autoSyntaxAttemptsByFile.get(fileKey) || 0;
        if (tries >= this.MAX_AUTO_SYNTAX_PER_FILE) { this.clearAutoFixNotice(); if (this.ctx.els.autoSyntaxBtn) this.ctx.els.autoSyntaxBtn.textContent = `⏸️ Auto-fix max (${fileKey})`; this.ctx.updateIndicators(); return; }
        const nextTry = tries + 1; this.autoSyntaxAttemptsByFile.set(fileKey, nextTry);
        this.sendSyntaxErrorToAi(evSig, (resolvedFile) => this.notifyAutoFixTriggered(resolvedFile || fileKey, nextTry));
      }
      return;
    }
    if (!nextState?.hasSyntaxError) this.lastAutoSyntaxSig = "";
    if (this.autoTestEnabled && nextState?.running && nextState?.hasRunTestsClip && !nextState?.hasSyntaxError && /^\[(?:OK|COMPLET)\]/.test(evSig)) {
      if (evSig !== this.lastAutoTestEventSig && !this.ctx.testActions?.panel?.isRunning) { this.lastAutoTestEventSig = evSig; this.ctx.els.testsBtn?.click(); }
    }
  }
  bindAll() {
    const { els, blockManager, chatInjector, gitManager, exportMenu, testActions, sendBgMessage, setBtnState, triggerProjectExport, tokenBudget, updateIndicators } = this.ctx;
    this.loadPrefs();
    els.budgetPill?.addEventListener("click", () => { tokenBudget?.reset(); updateIndicators?.(); });
    els.guidedBtn?.addEventListener("click", () => this.executeGuidedAction());
    els.autoSyntaxBtn?.addEventListener("click", () => { this.autoFixEnabled = !this.autoFixEnabled; this.autoSyntaxAttemptsByFile.clear(); this.lastAutoSyntaxSig = ""; this.clearAutoFixNotice(); chrome.storage?.local?.set?.({ gmcAutoFix: this.autoFixEnabled }); this.syncToggleButtons(); if (this.autoFixEnabled && this.ctx.getWatcherState()?.hasSyntaxError) this.handleStateUpdate(this.ctx.getWatcherState()); updateIndicators?.(); });
    els.autoTestBtn?.addEventListener("click", () => { this.autoTestEnabled = !this.autoTestEnabled; chrome.storage?.local?.set?.({ gmcAutoTest: this.autoTestEnabled }); this.syncToggleButtons(); });
    els.statusPill?.addEventListener("click", () => {
      if (this.ctx.getWatcherState()?.running || this.ctx.isStarting()) return;
      this.enableAutoFixOnServiceStart(); this.ctx.setStarting(true); els.statusPill.textContent = "⏳ Démarrage...";
      chrome.storage?.local?.get?.(["savedTargetDir", "savedExtraArgs"], (res) => { sendBgMessage({ type: "START_WATCHER", targetDir: (res.savedTargetDir || ".").trim() || ".", extraArgs: (res.savedExtraArgs || "").trim() }, (reply) => { this.ctx.setStarting(false); if (reply?.state) this.handleStateUpdate(reply.state); else this.ctx.updateIndicators(); }); });
    });
    els.copyPurgeAllBtn?.addEventListener("click", () => blockManager.copyAndPurgeAll());
    els.commitMsgBtn?.addEventListener("click", () => { const p = gitManager.buildCommitMessageOnlyPrompt(); blockManager.resetAutoSuiteQuota(); tokenBudget?.recordPayload(p); chatInjector.insertPrompt(p, true); this.ctx.clearCommitMsgFlag(); });
    els.composerCommitBtn?.addEventListener("click", () => this.triggerQuickCommitFlow());
    els.eventPill?.addEventListener("click", () => { const st = this.ctx.getWatcherState(), rawEv = String(st?.lastEvent || els.eventPill.textContent || ""); if (st?.hasSyntaxError || rawEv.startsWith("[SYNTAXE]")) { this.resetSyntaxAttemptsForEvent(rawEv); this.sendSyntaxErrorToAi(rawEv); return; } blockManager.resetAutoSuiteQuota(); tokenBudget?.recordPayload(rawEv); chatInjector.insertPrompt(rawEv, true); updateIndicators?.(); });
    els.yesBtn?.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Oui", true); });
    els.nextBtn?.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Suite", true); });
    els.excuseBtn?.addEventListener("click", () => chatInjector.insertPrompt(this.ctx.composerUi.pickExcuse(), false));
    els.gitBtn?.addEventListener("click", () => { if (gitManager.panelEl) { gitManager.close(); return; } setBtnState(els.gitBtn, "running", "⏳ Git..."); sendBgMessage({ type: "GIT_STATUS" }, (res) => { if (!res?.ok) return setBtnState(els.gitBtn, "fail", "❌ Erreur Git"); const entries = res.entries || []; if (entries.length === 0) { setBtnState(els.gitBtn, "pass", "✅ Aucun changement"); setTimeout(() => setBtnState(els.gitBtn, null, "🔀 Git status"), 2200); return; } setBtnState(els.gitBtn, null, "🔀 Git status"); gitManager.open(entries); }); });
    els.exportBtn?.addEventListener("click", () => { if (!exportMenu) { triggerProjectExport("full", []); return; } if (exportMenu.menuEl) { exportMenu.close(); return; } sendBgMessage({ type: "EXPORT_FOLDERS" }, (res) => exportMenu.toggle((m, sub) => triggerProjectExport(m, sub), res?.folders || [])); });
    els.testLogBtn?.addEventListener("click", () => testActions.panel.toggle());
    els.purgeBtn?.addEventListener("click", () => blockManager.purgeAll());
    document.addEventListener("keydown", (e) => { if (!e.altKey || e.ctrlKey || e.metaKey) return; const k = e.key.toLowerCase(); if (k === "p") { e.preventDefault(); blockManager.copyAndPurgeAll(); } else if (k === "s") { e.preventDefault(); blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Suite", true); } else if (k === "t" && !els.testsBtn?.disabled) { e.preventDefault(); els.testsBtn?.click(); } });
  }
}
window.GmcContentEventsController = ContentEventsController;
