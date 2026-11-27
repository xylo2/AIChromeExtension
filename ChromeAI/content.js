// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Utilisateur_A

/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_e) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);
  if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
  if (window.__gmcBuildStreamTimer) clearInterval(window.__gmcBuildStreamTimer);
  const staleSel = [
    ".gmc-composer-quick-group", ".gmc-quick-yes-btn", ".gmc-quick-next-btn",
    ".gmc-quick-excuse-btn", ".gmc-quick-commit-btn", ".gmc-quick-guided-btn",
    ".gmc-global-copypurge-btn"
  ].join(", ");
  document.querySelectorAll(staleSel).forEach((el) => el.remove());

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const tokenBudget = window.GmcTokenBudgetManager
    ? new window.GmcTokenBudgetManager() : null;
  const exportMenu = window.GmcExportMenuManager
    ? new window.GmcExportMenuManager(tokenBudget) : null;
  let canRequestCommitMsg = false, scanTimer = null, isStartingWatcher = false;
  let isTriggeringFreshExport = false, guidedActionId = "";
  let exportBadgeTimer = null, eventsCtrl = null, hasLiveWorkerSync = false;
  let lastBudgetKey = tokenBudget ? tokenBudget.getConversationKey() : "";
  let watcherState = {
    running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false,
    hasBuildPackage: false, hasGit: false, hasSyntaxError: false,
    lastEvent: null, recentEvents: []
  };
  let updateIndicators = () => {};

  /** Envoie un message au service worker en gérant les erreurs de contexte. */
  const sendBgMessage = (payload, onDone = () => {}) => {
    if (!chrome.runtime?.id) {
      onDone({ ok: false, error: "Contexte extension invalidé." });
      return;
    }
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          onDone({ ok: false, error: chrome.runtime.lastError.message || "Erreur." });
          return;
        }
        onDone(res || { ok: false });
      });
    } catch (err) {
      onDone({ ok: false, error: err?.message || "Erreur extension." });
    }
  };
  /** Met à jour la classe d'état et le libellé d'un bouton de la barre. */
  const setBtnState = (btn, stateClass, labelText = null) => {
    if (!btn) return;
    btn.classList?.remove("state-running", "state-pass", "state-fail");
    if (stateClass) btn.classList?.add(`state-${stateClass}`);
    if (labelText !== null) btn.textContent = labelText;
  };
  const gitManager = new window.GmcGitPanelManager(
    spillDetector, chatInjector,
    (isVerify) => { canRequestCommitMsg = Boolean(isVerify); updateIndicators(); }
  );
  const svgPreview = new window.GmcSvgPreviewManager(spillDetector);
  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) {
    floatingBar = document.createElement("div");
    floatingBar.className = "gmc-floating-bar";
    document.body.appendChild(floatingBar);
  }

  /** Crée ou récupère une ligne typologique de la barre flottante. */
  const ensureRow = (cls) => {
    let row = floatingBar.querySelector(`.${cls}`);
    if (!row) {
      row = document.createElement("div");
      row.className = `gmc-floating-row ${cls}`;
      floatingBar.appendChild(row);
    }
    return row;
  };
  const serviceRow = ensureRow("gmc-floating-row-status");
  const projectRow = ensureRow("gmc-floating-row-actions");
  const testsRow = ensureRow("gmc-floating-row-tests");
  const domRow = ensureRow("gmc-floating-row-dom");

  /** Crée ou rattache un bouton de contrôle dans sa ligne cible. */
  const makeBtn = (cls, text, title = "", hidden = false, parent = projectRow) => {
    const firstCls = cls.split(" ").at(0);
    let el = floatingBar.querySelector(`.${firstCls}`) || parent.querySelector(`.${firstCls}`);
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = cls;
      el.textContent = text;
      if (title) el.title = title;
      if (hidden) el.style.display = "none";
    }
    if (el.parentElement !== parent) parent.appendChild(el);
    return el;
  };
  const els = {
    statusPill: makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, serviceRow),
    autoSyntaxBtn: makeBtn("gmc-auto-syntax-btn", "⚡ Auto-fix: ON", "Corriger automatiquement les erreurs de syntaxe", true, serviceRow),
    autoTestBtn: makeBtn("gmc-auto-test-btn", "🧪 Auto-tests: OFF", "Lancer automatiquement les tests après assemblage", true, serviceRow),
    budgetPill: makeBtn("gmc-budget-pill", "📊 0 tok", "", true, projectRow),
    newChatBtn: makeBtn("gmc-new-chat-btn", "🆕 Nouveau chat", "Ouvrir une nouvelle conversation AI vierge", true, projectRow),
    exportBtn: makeBtn("gmc-export-btn", "📦 Exporter", "Exporter le projet vers le chat", true, projectRow),
    buildBtn: makeBtn("gmc-build-btn", "🔨 Build", "Générer le package (tools/build_package.py)", true, projectRow),
    buildLogBtn: makeBtn("gmc-build-log-btn", "📄 Sortie build", "Afficher le journal de build", true, projectRow),
    gitBtn: makeBtn("gmc-git-btn", "🔀 Git status", "Inspecter les fichiers modifiés", true, projectRow),
    commitMsgBtn: makeBtn("gmc-commit-msg-btn", "💬 Msg commit", "Demander le message de commit à l'IA", true, projectRow),
    testsBtn: makeBtn("gmc-tests-btn", "🧪 Lancer les tests", "Exécuter la suite de tests", true, testsRow),
    rerunFailedBtn: makeBtn("gmc-rerun-failed-btn", "🎯 Relancer KO (0)", "Relancer uniquement les tests KO de la dernière exécution", true, testsRow),
    testLogBtn: makeBtn("gmc-test-log-btn", "📋 Sortie tests", "Afficher le rapport complet des tests", true, testsRow),
    coverageBtn: makeBtn("gmc-coverage-btn", "📊 Couverture", "", true, testsRow),
    eventPill: makeBtn("gmc-global-event-pill", "", "", true, domRow),
    purgeBtn: makeBtn("gmc-purge-all-btn", "🧹 Purger DOM", "Purger tous les blocs de code du DOM", true, domRow)
  };
  const composerUi = new window.GmcComposerQuickButtonsManager(chatInjector, projectRow, els.exportBtn);
  const mkQuickBtn = (cls, text, title = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `gmc-composer-btn ${cls}`.trim();
    b.textContent = text;
    if (title) b.title = title;
    composerUi.groupEl.appendChild(b);
    return b;
  };
  els.guidedBtn = mkQuickBtn("gmc-composer-primary", "", "");
  els.guidedBtn.style.display = "none";
  els.yesBtn = mkQuickBtn("", "Oui", "Envoyer « Oui »");
  els.nextBtn = mkQuickBtn("", "Suite", "Envoyer « Suite »");
  els.composerCommitBtn = mkQuickBtn("", "💬 Commit", "Vérifier le diff et générer le message de commit");
  els.excuseBtn = mkQuickBtn("gmc-composer-muted", "🎲 Excuse", "Insérer une excuse de développeur");
  const testActions = new window.GmcTestActionsController(
    chatInjector, sendBgMessage, setBtnState,
    { testsBtn: els.testsBtn, rerunFailedBtn: els.rerunFailedBtn, coverageBtn: els.coverageBtn },
    () => watcherState, () => updateIndicators(), tokenBudget
  );
  const blockManager = new window.GmcCodeBlockManager(
    spillDetector, chatInjector,
    () => { updateIndicators(); setTimeout(() => { if (watcherState?.running) composerUi.mount(); }, 80); },
    svgPreview
  );

  /** Déclenche l'export du projet et joint l'archive générée au chat. */
  const triggerProjectExport = (mode = "full", subpaths = []) => {
    if (!els.exportBtn || els.exportBtn.disabled) return;
    els.exportBtn.disabled = true;
    setBtnState(els.exportBtn, "running", "⏳ Export...");
    if (exportBadgeTimer) { clearTimeout(exportBadgeTimer); exportBadgeTimer = null; }
    sendBgMessage({ type: "EXPORT_PROJECT", mode, subpaths }, (res) => {
      els.exportBtn.disabled = false;
      if (exportBadgeTimer) { clearTimeout(exportBadgeTimer); exportBadgeTimer = null; }
      if (!res?.ok || !res.content) {
        setBtnState(els.exportBtn, "fail", "❌ Erreur export");
        exportBadgeTimer = setTimeout(() => { exportBadgeTimer = null; setBtnState(els.exportBtn, null, "📦 Exporter"); }, 2500);
        return;
      }
      const fname = res.filename || "project_export.txt";
      const prompt = exportMenu ? exportMenu.buildExportPrompt(mode, fname, res.file_count, res.estimated_tokens, subpaths) : `Fichier joint (\x60${fname}\x60) :`;
      tokenBudget?.recordPayload(`${res.content}\n${prompt}`, Number(res.estimated_tokens || 0));
      chatInjector.dropFile(fname, res.content, false);
      chatInjector.insertPrompt(prompt, { minDelayMs: 1600, maxWaitMs: 7000, waitForFile: fname });
      setBtnState(els.exportBtn, "pass", "✅ Exporté");
      exportBadgeTimer = setTimeout(() => { exportBadgeTimer = null; setBtnState(els.exportBtn, null, "📦 Exporter"); }, 2200);
      updateIndicators();
    });
  };
  /** Vérifie si un export automatique a été demandé depuis un nouveau chat vierge. */
  const checkPendingFreshExport = () => {
    if (isTriggeringFreshExport || !watcherState?.running || !watcherState?.hasExporter || !chrome.storage?.local?.get) return;
    chrome.storage.local.get("pendingFreshExportAt", (res) => {
      const ts = Number(res?.pendingFreshExportAt || 0);
      if (!ts || (Date.now() - ts) > 120000) return;
      if (!chatInjector.findChatInputElement()) return;
      isTriggeringFreshExport = true;
      chrome.storage.local.remove?.("pendingFreshExportAt");
      setTimeout(() => { isTriggeringFreshExport = false; triggerProjectExport("full", []); }, 450);
    });
  };
  const toggleRowVisibility = (rowEl, btnList) => { rowEl.style.display = btnList.some((b) => b && b.style.display !== "none") ? "flex" : "none"; };

  /** Synchronise l'état visuel de la barre flottante et de l'action guidée. */
  updateIndicators = () => {
    const running = Boolean(watcherState?.running);
    if (running) { isStartingWatcher = false; testActions.invalidateOnNewFiles(); }
    floatingBar.classList.toggle("gmc-offline-bar", !running);
    els.statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) els.statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    else if (!isStartingWatcher) els.statusPill.textContent = "🔴 Watcher OFF";
    if (els.budgetPill) { els.budgetPill.style.display = running ? "inline-flex" : "none"; if (running && tokenBudget) { const b = tokenBudget.formatBadgeState(); setBtnState(els.budgetPill, b.level, b.label); els.budgetPill.title = `${b.title}\n(Cliquer pour remettre à zéro)`; } }
    const unpurgedCount = running ? blockManager.getUnpurgedCount() : 0;
    els.purgeBtn.style.display = running && unpurgedCount > 0 ? "inline-flex" : "none";
    els.autoSyntaxBtn.style.display = running ? "inline-flex" : "none";
    els.autoTestBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    els.commitMsgBtn.style.display = running && watcherState.hasGit && canRequestCommitMsg ? "inline-flex" : "none";
    els.composerCommitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    els.gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    els.buildBtn.style.display = running && watcherState.hasBuildPackage ? "inline-flex" : "none";
    els.newChatBtn.style.display = running ? "inline-flex" : "none";
    els.exportBtn.style.display = running && watcherState.hasExporter ? "inline-flex" : "none";
    els.testsBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    els.testsBtn.disabled = Boolean(testActions.panel.isRunning);
    els.testLogBtn.style.display = running && watcherState.hasRunTestsClip && (testActions.panel.fullReport || testActions.panel.isRunning) ? "inline-flex" : "none";
    els.buildLogBtn.style.display = running && watcherState.hasBuildPackage && (eventsCtrl?.buildPanel?.fullReport || eventsCtrl?.buildPanel?.isRunning) ? "inline-flex" : "none";
    testActions.renderCoverageIndicator();
    els.eventPill.style.display = running && watcherState.lastEvent ? "inline-flex" : "none";
    if (running && watcherState.lastEvent) {
      const evStr = String(watcherState.lastEvent), isSyntaxErr = Boolean(watcherState.hasSyntaxError || evStr.startsWith("[SYNTAXE]"));
      els.eventPill.classList.toggle("state-fail", isSyntaxErr); els.eventPill.textContent = isSyntaxErr ? `⚠️ ${evStr}` : evStr;
    }
    toggleRowVisibility(projectRow, [els.budgetPill, els.newChatBtn, els.exportBtn, els.buildBtn, els.buildLogBtn, els.gitBtn, els.commitMsgBtn]);
    toggleRowVisibility(testsRow, [els.testsBtn, els.rerunFailedBtn, els.testLogBtn, els.coverageBtn]);
    toggleRowVisibility(domRow, [els.eventPill, els.purgeBtn]);
    const failedTestsCount = typeof testActions.getFailedTests === "function" ? testActions.getFailedTests().length : 0;
    const guided = running ? composerUi.resolveGuidedAction({ watcherState, unpurgedCount, hasTestFailure: testActions.hasPendingFailure(), canCommitMsg: canRequestCommitMsg, testsPassedForCurrentEvent: Boolean(testActions.lastTestsPassed || testActions.panel.isRunning), autoFixActive: Boolean(eventsCtrl?.isAutoFixHandlingCurrentError?.()), failedTestsCount }) : null;
    guidedActionId = guided ? guided.id : ""; els.guidedBtn.style.display = guided ? "inline-flex" : "none";
    if (guided) { els.guidedBtn.textContent = guided.label; els.guidedBtn.title = guided.title; }
    if (running) { composerUi.mount(); checkPendingFreshExport(); } else if (composerUi.groupEl.parentElement) composerUi.groupEl.remove();
  };

  const scanAll = (preExisting = false) => { if (!watcherState?.running) { updateIndicators(); return; } composerUi.mount(); gitManager.scanCommitBlocks(); blockManager.scan(preExisting); svgPreview.scanStandaloneBlocks(); updateIndicators(); };
  eventsCtrl = new window.GmcContentEventsController({
    els, blockManager, chatInjector, gitManager, exportMenu, testActions, composerUi, tokenBudget, sendBgMessage, setBtnState, triggerProjectExport, updateIndicators,
    getWatcherState: () => watcherState, setWatcherState: (s) => { const wasOff = !watcherState?.running; watcherState = s; if (wasOff && s?.running) { scanAll(true); setTimeout(() => scanAll(true), 800); } },
    isStarting: () => isStartingWatcher, setStarting: (v) => { isStartingWatcher = v; }, canRequestCommitMsg: () => canRequestCommitMsg, clearCommitMsgFlag: () => { canRequestCommitMsg = false; updateIndicators(); }, getGuidedActionId: () => guidedActionId
  });
  eventsCtrl.bindAll();

  const stopOrphanedInstance = () => {
    clearInterval(ownStatusTimer);
    try { ownObserver.disconnect(); } catch (_e) {}
    if (!document.querySelector(".gmc-floating-bar[data-gmc-live='true']")) {
      els.statusPill.className = "gmc-global-status-pill offline";
      els.statusPill.textContent = "🔄 Recharger (F5)";
      els.statusPill.onclick = () => window.location.reload();
    }
  };
  floatingBar.setAttribute("data-gmc-live", "true");
  const refreshState = () => {
    if (!chrome.runtime?.id) { floatingBar.removeAttribute("data-gmc-live"); stopOrphanedInstance(); return; }
    if (hasLiveWorkerSync) chrome.storage?.local?.get("watchClipboardState", (res) => { if (res?.watchClipboardState) eventsCtrl.handleStateUpdate(res.watchClipboardState); });
    try { chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (st) => { if (!chrome.runtime.lastError && st) { hasLiveWorkerSync = true; eventsCtrl.handleStateUpdate(st); } }); } catch (_err) {}
  };
  chrome.storage?.onChanged?.addListener((changes, area) => { if (area === "local" && changes.watchClipboardState?.newValue) { hasLiveWorkerSync = true; eventsCtrl.handleStateUpdate(changes.watchClipboardState.newValue); } });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "WATCHER_STATE_CHANGED" && msg.state) { hasLiveWorkerSync = true; eventsCtrl.handleStateUpdate(msg.state); }
    if (msg?.type === "INSERT_TEST_RESULT" && msg.output) sendResponse({ inserted: chatInjector.insertTestResults(msg.output, false) });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshState(); if (watcherState?.running) scanAll(true); } });
  const isExternalMutation = (records) => records.some((r) => {
    const t = r.target, ownSel = ".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-git-panel, .gmc-svg-preview-tooltip, .gmc-autosuite-banner";
    if (t && t.nodeType === 1 && (String(t.className || "").includes("gmc-") || t.closest?.(ownSel))) return false;
    const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
    return nodes.length === 0 || nodes.some((n) => n.nodeType !== 1 || !String(n.className || "").includes("gmc-"));
  });
  const ownObserver = new MutationObserver((records) => { if (!watcherState?.running || !isExternalMutation(records)) return; clearTimeout(scanTimer); scanTimer = setTimeout(() => scanAll(false), 300); });
  window.__gmcObserver = ownObserver;
  ownObserver.observe(document.body, { childList: true, subtree: true });
  tokenBudget?.syncFromStorage(() => updateIndicators()); updateIndicators(); refreshState();
  const ownStatusTimer = setInterval(() => {
    const currentKey = tokenBudget ? tokenBudget.getConversationKey() : "";
    if (currentKey !== lastBudgetKey) { lastBudgetKey = currentKey; tokenBudget?.syncFromStorage(() => updateIndicators()); scanAll(true); checkPendingFreshExport(); }
    if (!document.hidden) refreshState();
  }, 2000);
  window.__gmcStatusTimer = ownStatusTimer;
}
