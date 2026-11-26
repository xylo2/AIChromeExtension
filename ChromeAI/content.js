/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante, budget tokens et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_err) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);
  if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
  document.querySelectorAll(".gmc-composer-quick-group, .gmc-quick-yes-btn, .gmc-quick-next-btn, .gmc-quick-excuse-btn, .gmc-quick-commit-btn, .gmc-quick-guided-btn").forEach((el) => el.remove());

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const tokenBudget = window.GmcTokenBudgetManager ? new window.GmcTokenBudgetManager() : null;
  const exportMenu = window.GmcExportMenuManager ? new window.GmcExportMenuManager(tokenBudget) : null;
  let canRequestCommitMsg = false, scanTimer = null, isStartingWatcher = false, isTriggeringFreshExport = false;
  let lastCheckedHref = String(window.location?.href || ""), guidedActionId = "";
  let watcherState = { running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false, hasGit: false, hasSyntaxError: false, lastEvent: null, recentEvents: [] };
  let updateIndicators = () => {};
  const gitManager = new window.GmcGitPanelManager(spillDetector, chatInjector, (isVerify) => { canRequestCommitMsg = Boolean(isVerify); updateIndicators(); });
  const svgPreview = new window.GmcSvgPreviewManager(spillDetector);

  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) { floatingBar = document.createElement("div"); floatingBar.className = "gmc-floating-bar"; document.body.appendChild(floatingBar); }
  const ensureRow = (cls) => {
    let row = floatingBar.querySelector(`.${cls}`);
    if (!row) { row = document.createElement("div"); row.className = `gmc-floating-row ${cls}`; floatingBar.appendChild(row); }
    return row;
  };
  const topRow = ensureRow("gmc-floating-row-status"), bottomRow = ensureRow("gmc-floating-row-actions"), testsRow = ensureRow("gmc-floating-row-tests");
  const makeBtn = (cls, text, title = "", hidden = false, parent = bottomRow) => {
    let el = floatingBar.querySelector(`.${cls.split(" ").at(0)}`) || parent.querySelector(`.${cls.split(" ").at(0)}`);
    if (!el) {
      el = document.createElement("button"); el.type = "button"; el.className = cls; el.textContent = text;
      if (title) el.title = title;
      if (hidden) el.style.display = "none";
    }
    if (el.parentElement !== parent) parent.appendChild(el);
    return el;
  };

  const els = {
    statusPill: makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, topRow),
    budgetPill: makeBtn("gmc-global-budget-pill", "📊 0 tok", "Estimation cumulée des tokens envoyés dans cette session (cliquer pour remettre à zéro)", false, topRow),
    autoSyntaxBtn: makeBtn("gmc-global-autosyntax-btn", "⚡ Auto-fix: OFF", "Envoyer automatiquement les erreurs de syntaxe détectées à l'IA", true, topRow),
    autoTestBtn: makeBtn("gmc-global-autotest-btn", "🧪 Auto-tests: OFF", "Lancer automatiquement les tests après écriture et notifier l'IA uniquement en cas d'échec", true, topRow),
    copyPurgeAllBtn: makeBtn("gmc-global-copypurge-btn", "📋 Tout copier et purger", "Copier tous les blocs non purgés et purger le DOM (Alt+P)", true, topRow),
    purgeBtn: makeBtn("gmc-global-purge-btn", "🧹 DOM allégé", "Purger tous les blocs de la page sans copier", false, topRow),
    eventPill: makeBtn("gmc-global-event-pill", "", "Cliquer pour envoyer ce statut dans le chat", true, bottomRow),
    commitMsgBtn: makeBtn("gmc-global-commitmsg-btn", "💬 Message de commit", "Demander à l'IA le bloc COMMIT_MESSAGE sans renvoyer le diff", true, bottomRow),
    gitBtn: makeBtn("gmc-global-git-btn", "🔀 Git status", "Afficher les fichiers modifiés (git status)", true, bottomRow),
    exportBtn: makeBtn("gmc-global-export-btn", "📦 Exporter projet", "Exporter le projet et l'envoyer dans le chat", true, bottomRow),
    coverageBtn: makeBtn("gmc-global-coverage-btn", "📊 Couverture", "Envoyer à l'IA le rapport de couverture des tests", true, testsRow),
    testsBtn: makeBtn("gmc-global-tests-btn", "🧪 Lancer les tests", "Exécuter les tests unitaires (Alt+T)", true, testsRow),
    testLogBtn: makeBtn("gmc-global-testlog-btn", "📋 Sortie tests", "Afficher ou masquer la sortie complète des tests", true, testsRow)
  };
  const composerUi = new window.GmcComposerQuickButtonsManager(chatInjector, bottomRow, els.gitBtn);
  els.guidedBtn = makeBtn("gmc-quick-guided-btn gmc-composer-btn", "", "", true, composerUi.groupEl);
  els.yesBtn = makeBtn("gmc-quick-yes-btn gmc-composer-btn", "Oui", "Envoyer « Oui » à l'IA", false, composerUi.groupEl);
  els.nextBtn = makeBtn("gmc-quick-next-btn gmc-composer-btn", "Suite", "Envoyer « Suite » à l'IA (Alt+S)", false, composerUi.groupEl);
  els.excuseBtn = makeBtn("gmc-quick-excuse-btn gmc-composer-btn", "🎲 Excuse", "Insérer une excuse de développeur dans le chat", false, composerUi.groupEl);
  els.composerCommitBtn = makeBtn("gmc-quick-commit-btn gmc-composer-btn", "💬 Commit", "Générer le message de commit (ou vérifier le diff Git en 1 clic)", true, composerUi.groupEl);
  const sendBgMessage = (payload, onReply) => {
    if (!chrome.runtime?.id) { alert("Extension rechargée : actualisez cette page (F5) pour reconnecter les boutons."); return; }
    chrome.runtime.sendMessage(payload, (res) => { onReply(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message || "Port fermé" } : res); });
  };
  const setBtnState = (btn, state, label) => { btn.classList.remove("state-running", "state-pass", "state-fail"); if (state) btn.classList.add(`state-${state}`); btn.textContent = label; };
  const triggerProjectExport = (mode = "full", subpaths = []) => {
    setBtnState(els.exportBtn, "running", "⏳ Export...");
    sendBgMessage({ type: "EXPORT_PROJECT", mode, subpaths }, (res) => {
      if (res?.ok && res.content) {
        const fname = res.filename || "export.txt";
        const estTok = Number(res.estimated_tokens || Math.ceil(String(res.content).length / 4));
        const promptTxt = exportMenu ? exportMenu.buildExportPrompt(mode, fname, res.file_count, estTok, subpaths) : `Fichier joint (\x60${fname}\x60) :`;
        tokenBudget?.recordPayload(promptTxt, estTok + (tokenBudget?.estimateTokens(promptTxt) || 0));
        chatInjector.insertPrompt(promptTxt, false);
        chatInjector.dropFile(fname, res.content, true);
        setBtnState(els.exportBtn, "pass", `✅ Exporté (${estTok >= 1000 ? `~${(estTok / 1000).toFixed(1)}k tok` : `~${estTok} tok`})`);
        updateIndicators();
      } else setBtnState(els.exportBtn, "fail", "❌ Erreur");
    });
  };
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
  updateIndicators = () => {
    testActions.invalidateOnNewFiles();
    const running = Boolean(watcherState?.running);
    if (running) isStartingWatcher = false;
    els.statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) els.statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    else if (!isStartingWatcher) els.statusPill.textContent = "🔴 Watcher OFF";
    if (tokenBudget && els.budgetPill) {
      const bState = tokenBudget.formatBadgeState();
      setBtnState(els.budgetPill, bState.level, bState.label);
      els.budgetPill.title = `${bState.title} (cliquer pour remettre à zéro)`;
    }
    const unpurgedCount = blockManager.getUnpurgedCount();
    els.copyPurgeAllBtn.style.display = unpurgedCount > 0 ? "inline-flex" : "none";
    if (unpurgedCount > 0) els.copyPurgeAllBtn.textContent = `📋 Tout copier et purger (${unpurgedCount})`;
    els.autoSyntaxBtn.style.display = running ? "inline-flex" : "none";
    els.autoTestBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    els.commitMsgBtn.style.display = running && watcherState.hasGit && canRequestCommitMsg ? "inline-flex" : "none";
    els.composerCommitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    els.gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    els.exportBtn.style.display = running && watcherState.hasExporter ? "inline-flex" : "none";
    els.testsBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    els.testsBtn.disabled = Boolean(testActions.panel.isRunning);
    els.testLogBtn.style.display = running && watcherState.hasRunTestsClip && (testActions.panel.fullReport || testActions.panel.isRunning) ? "inline-flex" : "none";
    testActions.renderCoverageIndicator();
    els.eventPill.style.display = running && watcherState.lastEvent ? "inline-flex" : "none";
    if (running && watcherState.lastEvent) {
      const evStr = String(watcherState.lastEvent);
      const isSyntaxErr = Boolean(watcherState.hasSyntaxError || evStr.startsWith("[SYNTAXE]"));
      els.eventPill.classList.toggle("state-fail", isSyntaxErr);
      els.eventPill.textContent = isSyntaxErr ? `⚠️ ${evStr}` : evStr;
      const hist = Array.isArray(watcherState.recentEvents) && watcherState.recentEvents.length > 0 ? `\nHistorique :\n${watcherState.recentEvents.join("\n")}` : "";
      els.eventPill.title = (isSyntaxErr ? "Erreur de syntaxe détectée : cliquer pour renvoyer l'extrait à l'IA et réinitialiser le quota Auto-fix" : "Cliquer pour envoyer ce statut dans le chat") + hist;
    }
    const guided = composerUi.resolveGuidedAction({ watcherState, unpurgedCount, hasTestFailure: testActions.hasPendingFailure(), canCommitMsg: canRequestCommitMsg });
    guidedActionId = guided ? guided.id : "";
    els.guidedBtn.style.display = guided ? "inline-flex" : "none";
    if (guided) { els.guidedBtn.textContent = guided.label; els.guidedBtn.title = guided.title; }
    composerUi.mount(); checkPendingFreshExport();
  };
  const eventsCtrl = new window.GmcContentEventsController({
    els, blockManager, chatInjector, gitManager, exportMenu, testActions, composerUi, tokenBudget, sendBgMessage, setBtnState, triggerProjectExport, updateIndicators,
    getWatcherState: () => watcherState, setWatcherState: (s) => { watcherState = s; }, isStarting: () => isStartingWatcher, setStarting: (v) => { isStartingWatcher = v; },
    canRequestCommitMsg: () => canRequestCommitMsg, clearCommitMsgFlag: () => { canRequestCommitMsg = false; updateIndicators(); }, getGuidedActionId: () => guidedActionId
  });
  eventsCtrl.bindAll();
  const refreshState = () => {
    if (!chrome.runtime?.id) return;
    chrome.storage?.local?.get("watchClipboardState", (res) => { if (res?.watchClipboardState) eventsCtrl.handleStateUpdate(res.watchClipboardState); });
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (st) => { if (!chrome.runtime.lastError && st) eventsCtrl.handleStateUpdate(st); });
  };
  chrome.storage?.onChanged?.addListener((changes, area) => { if (area === "local" && changes.watchClipboardState?.newValue) eventsCtrl.handleStateUpdate(changes.watchClipboardState.newValue); });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "WATCHER_STATE_CHANGED" && msg.state) eventsCtrl.handleStateUpdate(msg.state);
    if (msg?.type === "INSERT_TEST_RESULT" && msg.output) sendResponse({ inserted: chatInjector.insertTestResults(msg.output, false) });
  });
  const isExternalMutation = (records) => records.some((r) => {
    const t = r.target;
    if (t && t.nodeType === 1 && (String(t.className || "").includes("gmc-") || t.closest?.(".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-git-panel, .gmc-svg-preview-tooltip, .gmc-autosuite-banner"))) return false;
    const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
    return nodes.length === 0 || nodes.some((n) => n.nodeType !== 1 || !String(n.className || "").includes("gmc-"));
  });
  const scanAll = (preExisting = false) => { composerUi.mount(); gitManager.scanCommitBlocks(); blockManager.scan(preExisting); svgPreview.scanStandaloneBlocks(); updateIndicators(); };
  window.__gmcObserver = new MutationObserver((records) => { if (!isExternalMutation(records)) return; clearTimeout(scanTimer); scanTimer = setTimeout(() => scanAll(false), 300); });
  window.__gmcObserver.observe(document.body, { childList: true, subtree: true });
  scanAll(true); refreshState();
  window.__gmcStatusTimer = setInterval(() => {
    const currentHref = String(window.location?.href || "");
    if (currentHref !== lastCheckedHref) { lastCheckedHref = currentHref; tokenBudget?.reset(); scanAll(false); checkPendingFreshExport(); }
    if (!document.hidden) refreshState();
  }, 2000);
}
