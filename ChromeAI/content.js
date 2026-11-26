/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante typologique 4 lignes et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_err) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);
  if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
  if (window.__gmcBuildStreamTimer) clearInterval(window.__gmcBuildStreamTimer);
  document.querySelectorAll(".gmc-composer-quick-group, .gmc-quick-yes-btn, .gmc-quick-next-btn, .gmc-quick-excuse-btn, .gmc-quick-commit-btn, .gmc-quick-guided-btn, .gmc-global-copypurge-btn").forEach((el) => el.remove());

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const tokenBudget = window.GmcTokenBudgetManager ? new window.GmcTokenBudgetManager() : null;
  const exportMenu = window.GmcExportMenuManager ? new window.GmcExportMenuManager(tokenBudget) : null;
  let canRequestCommitMsg = false, scanTimer = null, isStartingWatcher = false, isTriggeringFreshExport = false;
  let lastBudgetKey = tokenBudget ? tokenBudget.getConversationKey() : "", guidedActionId = "", exportBadgeTimer = null, eventsCtrl = null;
  let watcherState = { running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false, hasBuildPackage: false, hasGit: false, hasSyntaxError: false, lastEvent: null, recentEvents: [] };
  let updateIndicators = () => {};
  const gitManager = new window.GmcGitPanelManager(spillDetector, chatInjector, (isVerify) => { canRequestCommitMsg = Boolean(isVerify); updateIndicators(); });
  const svgPreview = new window.GmcSvgPreviewManager(spillDetector);

  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) { floatingBar = document.createElement("div"); floatingBar.className = "gmc-floating-bar"; document.body.appendChild(floatingBar); }
  /** Crée ou récupère une ligne typologique de la barre flottante. */
  const ensureRow = (cls) => {
    let row = floatingBar.querySelector(`.${cls}`);
    if (!row) { row = document.createElement("div"); row.className = `gmc-floating-row ${cls}`; floatingBar.appendChild(row); }
    return row;
  };
  const serviceRow = ensureRow("gmc-floating-row-status"), projectRow = ensureRow("gmc-floating-row-actions"), testsRow = ensureRow("gmc-floating-row-tests"), domRow = ensureRow("gmc-floating-row-dom");
  /** Crée ou rattache un bouton de contrôle dans sa ligne cible. */
  const makeBtn = (cls, text, title = "", hidden = false, parent = projectRow) => {
    let el = floatingBar.querySelector(`.${cls.split(" ").at(0)}`) || parent.querySelector(`.${cls.split(" ").at(0)}`);
    if (!el) { el = document.createElement("button"); el.type = "button"; el.className = cls; el.textContent = text; if (title) el.title = title; if (hidden) el.style.display = "none"; }
    if (el.parentElement !== parent) parent.appendChild(el);
    return el;
  };
  const els = {
    statusPill: makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, serviceRow),
    autoSyntaxBtn: makeBtn("gmc-global-autosyntax-btn", "⚡ Auto-fix: OFF", "Envoyer automatiquement les erreurs de syntaxe à l'IA", true, serviceRow),
    autoTestBtn: makeBtn("gmc-global-autotest-btn", "🧪 Auto-tests: OFF", "Lancer automatiquement les tests après écriture", true, serviceRow),
    budgetPill: makeBtn("gmc-global-budget-pill", "📊 0 tok", "Estimation cumulée des tokens envoyés (cliquer pour remettre à zéro)", true, projectRow),
    exportBtn: makeBtn("gmc-global-export-btn", "📦 Exporter", "Exporter le projet et l'envoyer dans le chat", true, projectRow),
    buildBtn: makeBtn("gmc-global-build-btn", "🔨 Build", "Générer le package (tools/build_package.py)", true, projectRow),
    buildLogBtn: makeBtn("gmc-global-buildlog-btn", "📋 Logs Build", "Afficher ou masquer la sortie complète de build_package.py", true, projectRow),
    gitBtn: makeBtn("gmc-global-git-btn", "🔀 Git", "Afficher les fichiers modifiés (git status)", true, projectRow),
    commitMsgBtn: makeBtn("gmc-global-commitmsg-btn", "💬 Msg commit", "Demander le message de commit à l'IA", true, projectRow),
    testsBtn: makeBtn("gmc-global-tests-btn", "🧪 Tests", "Exécuter les tests unitaires (Alt+T)", true, testsRow),
    testLogBtn: makeBtn("gmc-global-testlog-btn", "📋 Logs", "Afficher ou masquer la sortie complète des tests", true, testsRow),
    coverageBtn: makeBtn("gmc-global-coverage-btn", "📊 Couv.", "Envoyer le rapport de couverture des tests à l'IA", true, testsRow),
    eventPill: makeBtn("gmc-global-event-pill", "", "Cliquer pour envoyer ce statut dans le chat", true, domRow),
    purgeBtn: makeBtn("gmc-global-purge-btn", "🧹 Purger DOM", "Alléger la page en purgeant tous les blocs", true, domRow)
  };
  const composerUi = new window.GmcComposerQuickButtonsManager(chatInjector, projectRow, els.exportBtn);
  els.guidedBtn = makeBtn("gmc-quick-guided-btn gmc-composer-btn gmc-composer-primary", "", "", true, composerUi.groupEl);
  els.yesBtn = makeBtn("gmc-quick-yes-btn gmc-composer-btn", "Oui", "Envoyer « Oui » à l'IA", false, composerUi.groupEl);
  els.nextBtn = makeBtn("gmc-quick-next-btn gmc-composer-btn", "Suite", "Envoyer « Suite » à l'IA (Alt+S)", false, composerUi.groupEl);
  els.composerCommitBtn = makeBtn("gmc-quick-commit-btn gmc-composer-btn", "💬 Commit", "Générer le message de commit (ou vérifier le diff Git en 1 clic)", true, composerUi.groupEl);
  els.excuseBtn = makeBtn("gmc-quick-excuse-btn gmc-composer-btn gmc-composer-muted", "🎲 Excuse", "Insérer une excuse de développeur dans le chat", false, composerUi.groupEl);
  /** Envoie un message au service worker en gérant l'invalidation éventuelle de l'extension. */
  const sendBgMessage = (payload, onReply) => {
    if (!chrome.runtime?.id) { alert("Extension rechargée : actualisez cette page (F5) pour reconnecter les boutons."); return; }
    chrome.runtime.sendMessage(payload, (res) => { onReply(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message || "Port fermé" } : res); });
  };
  /** Applique une classe d'état visuel et un libellé à un bouton de la barre flottante. */
  const setBtnState = (btn, state, label) => { btn.classList.remove("state-running", "state-pass", "state-fail"); if (state) btn.classList.add(`state-${state}`); btn.textContent = label; };
  /** Génère l'export du projet selon le mode et les sous-dossiers, puis l'envoie dans le chat. */
  const triggerProjectExport = (mode = "full", subpaths = []) => {
    if (exportBadgeTimer) { clearTimeout(exportBadgeTimer); exportBadgeTimer = null; }
    setBtnState(els.exportBtn, "running", "⏳ Export...");
    sendBgMessage({ type: "EXPORT_PROJECT", mode, subpaths }, (res) => {
      if (res?.ok && res.content) {
        const fname = res.filename || "export.txt", estTok = Number(res.estimated_tokens || Math.ceil(String(res.content).length / 4));
        const promptTxt = exportMenu ? exportMenu.buildExportPrompt(mode, fname, res.file_count, estTok, subpaths) : `Fichier joint (\x60${fname}\x60) :`;
        tokenBudget?.recordPayload(res.content, estTok); chatInjector.insertPrompt(promptTxt, false); chatInjector.dropFile(fname, res.content, true);
        setBtnState(els.exportBtn, "pass", `✅ ${estTok >= 1000 ? `${(estTok / 1000).toFixed(1)}k` : estTok} tok`);
        exportBadgeTimer = setTimeout(() => { exportBadgeTimer = null; setBtnState(els.exportBtn, null, "📦 Exporter"); }, 4000);
        updateIndicators();
      } else setBtnState(els.exportBtn, "fail", "❌ Erreur");
    });
  };
  /** Déclenche automatiquement un export complet après ouverture d'un nouveau chat vierge. */
  const checkPendingFreshExport = () => {
    if (isTriggeringFreshExport || !watcherState?.running || !watcherState.hasExporter || !chrome.storage?.local) return;
    if (document.querySelectorAll("pre").length > 0 || !chatInjector.findChatInputElement()) return;
    chrome.storage.local.get("pendingFreshExportAt", (res) => {
      const ts = Number(res?.pendingFreshExportAt || 0);
      if (!ts || Date.now() - ts > 60000) { if (ts) chrome.storage.local.remove("pendingFreshExportAt"); return; }
      isTriggeringFreshExport = true;
      chrome.storage.local.remove("pendingFreshExportAt", () => { setTimeout(() => { isTriggeringFreshExport = false; triggerProjectExport("full", []); }, 500); });
    });
  };
  const testActions = new window.GmcTestActionsController(chatInjector, sendBgMessage, setBtnState, { testsBtn: els.testsBtn, coverageBtn: els.coverageBtn }, () => watcherState, () => updateIndicators(), tokenBudget);
  const blockManager = new window.GmcCodeBlockManager(spillDetector, chatInjector, () => { updateIndicators(); setTimeout(() => composerUi.mount(), 80); }, svgPreview);
  /** Affiche une ligne de la barre flottante uniquement si au moins un bouton est visible. */
  const toggleRowVisibility = (rowEl, btnList) => { rowEl.style.display = btnList.some((b) => b && b.style.display !== "none") ? "flex" : "none"; };
  /** Synchronise l'état visuel de la barre flottante, des pastilles et de l'action guidée. */
  updateIndicators = () => {
    testActions.invalidateOnNewFiles();
    const running = Boolean(watcherState?.running);
    if (running) isStartingWatcher = false;
    floatingBar.classList.toggle("gmc-offline-bar", !running);
    els.statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) els.statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    else if (!isStartingWatcher) els.statusPill.textContent = "🔴 Watcher OFF";
    if (els.budgetPill) {
      els.budgetPill.style.display = running ? "inline-flex" : "none";
      if (running && tokenBudget) { const bState = tokenBudget.formatBadgeState(); setBtnState(els.budgetPill, bState.level, bState.label); els.budgetPill.title = `${bState.title}\n(Cliquer pour remettre le compteur manuel à zéro)`; }
    }
    const unpurgedCount = blockManager.getUnpurgedCount();
    els.purgeBtn.style.display = unpurgedCount > 0 ? "inline-flex" : "none";
    els.autoSyntaxBtn.style.display = running ? "inline-flex" : "none";
    els.autoTestBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    els.commitMsgBtn.style.display = running && watcherState.hasGit && canRequestCommitMsg ? "inline-flex" : "none";
    els.composerCommitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    els.gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    els.buildBtn.style.display = running && watcherState.hasBuildPackage ? "inline-flex" : "none";
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
      const hist = Array.isArray(watcherState.recentEvents) && watcherState.recentEvents.length > 0 ? `\nHistorique :\n${watcherState.recentEvents.join("\n")}` : "";
      els.eventPill.title = (isSyntaxErr ? "Erreur de syntaxe détectée : cliquer pour renvoyer l'extrait à l'IA" : "Cliquer pour envoyer ce statut dans le chat") + hist;
    }
    toggleRowVisibility(projectRow, [els.budgetPill, els.exportBtn, els.buildBtn, els.buildLogBtn, els.gitBtn, els.commitMsgBtn]);
    toggleRowVisibility(testsRow, [els.testsBtn, els.testLogBtn, els.coverageBtn]);
    toggleRowVisibility(domRow, [els.eventPill, els.purgeBtn]);
    const guided = composerUi.resolveGuidedAction({ watcherState, unpurgedCount, hasTestFailure: testActions.hasPendingFailure(), canCommitMsg: canRequestCommitMsg, testsPassedForCurrentEvent: Boolean(testActions.lastTestsPassed || testActions.panel.isRunning), autoFixActive: Boolean(eventsCtrl?.isAutoFixHandlingCurrentError?.()) });
    guidedActionId = guided ? guided.id : "";
    els.guidedBtn.style.display = guided ? "inline-flex" : "none";
    if (guided) { els.guidedBtn.textContent = guided.label; els.guidedBtn.title = guided.title; }
    composerUi.mount(); checkPendingFreshExport();
  };
  eventsCtrl = new window.GmcContentEventsController({
    els, blockManager, chatInjector, gitManager, exportMenu, testActions, composerUi, tokenBudget, sendBgMessage, setBtnState, triggerProjectExport, updateIndicators,
    getWatcherState: () => watcherState, setWatcherState: (s) => { watcherState = s; }, isStarting: () => isStartingWatcher, setStarting: (v) => { isStartingWatcher = v; },
    canRequestCommitMsg: () => canRequestCommitMsg, clearCommitMsgFlag: () => { canRequestCommitMsg = false; updateIndicators(); }, getGuidedActionId: () => guidedActionId
  });
  eventsCtrl.bindAll();
  /** Demande au service worker l'état courant du serveur local. */
  const refreshState = () => { if (!chrome.runtime?.id) return; chrome.storage?.local?.get("watchClipboardState", (res) => { if (res?.watchClipboardState) eventsCtrl.handleStateUpdate(res.watchClipboardState); }); chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (st) => { if (!chrome.runtime.lastError && st) eventsCtrl.handleStateUpdate(st); }); };
  chrome.storage?.onChanged?.addListener((changes, area) => { if (area === "local" && changes.watchClipboardState?.newValue) eventsCtrl.handleStateUpdate(changes.watchClipboardState.newValue); });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => { if (msg?.type === "WATCHER_STATE_CHANGED" && msg.state) eventsCtrl.handleStateUpdate(msg.state); if (msg?.type === "INSERT_TEST_RESULT" && msg.output) sendResponse({ inserted: chatInjector.insertTestResults(msg.output, false) }); });
  /** Filtre les mutations DOM externes pour éviter de déclencher un scan sur nos propres composants. */
  const isExternalMutation = (records) => records.some((r) => { const t = r.target; if (t && t.nodeType === 1 && (String(t.className || "").includes("gmc-") || t.closest?.(".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-git-panel, .gmc-svg-preview-tooltip, .gmc-autosuite-banner"))) return false; const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])]; return nodes.length === 0 || nodes.some((n) => n.nodeType !== 1 || !String(n.className || "").includes("gmc-")); });
  /** Lance un balayage complet des boutons compositeur, blocs commit, blocs FILE et aperçus SVG. */
  const scanAll = (preExisting = false) => { composerUi.mount(); gitManager.scanCommitBlocks(); blockManager.scan(preExisting); svgPreview.scanStandaloneBlocks(); updateIndicators(); };
  window.__gmcObserver = new MutationObserver((records) => { if (!isExternalMutation(records)) return; clearTimeout(scanTimer); scanTimer = setTimeout(() => scanAll(false), 300); });
  window.__gmcObserver.observe(document.body, { childList: true, subtree: true });
  tokenBudget?.syncFromStorage(() => updateIndicators());
  scanAll(true); refreshState();
  window.__gmcStatusTimer = setInterval(() => {
    const currentKey = tokenBudget ? tokenBudget.getConversationKey() : "";
    if (currentKey !== lastBudgetKey) { lastBudgetKey = currentKey; tokenBudget?.syncFromStorage(() => updateIndicators()); scanAll(false); checkPendingFreshExport(); }
    if (!document.hidden) refreshState();
  }, 2000);
}
