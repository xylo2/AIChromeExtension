/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_err) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);
  if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
  document.querySelectorAll(".gmc-composer-quick-group, .gmc-quick-yes-btn, .gmc-quick-next-btn, .gmc-quick-excuse-btn").forEach((el) => el.remove());

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const exportMenu = window.GmcExportMenuManager ? new window.GmcExportMenuManager() : null;
  let canRequestCommitMsg = false;
  let updateIndicators = () => {};
  const gitManager = new window.GmcGitPanelManager(spillDetector, chatInjector, (isVerify) => { canRequestCommitMsg = Boolean(isVerify); updateIndicators(); });
  const svgPreview = new window.GmcSvgPreviewManager(spillDetector);

  let scanTimer = null, isStartingWatcher = false, isTriggeringFreshExport = false;
  let lastCheckedHref = String(window.location?.href || "");
  let watcherState = { running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false, hasGit: false, hasSyntaxError: false, lastEvent: null };

  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) { floatingBar = document.createElement("div"); floatingBar.className = "gmc-floating-bar"; document.body.appendChild(floatingBar); }
  const ensureRow = (cls) => {
    let row = floatingBar.querySelector(`.${cls}`);
    if (!row) { row = document.createElement("div"); row.className = `gmc-floating-row ${cls}`; floatingBar.appendChild(row); }
    return row;
  };
  const topRow = ensureRow("gmc-floating-row-status"), bottomRow = ensureRow("gmc-floating-row-actions"), testsRow = ensureRow("gmc-floating-row-tests");

  const makeBtn = (cls, text, title = "", hidden = false, parent = bottomRow) => {
    const firstClass = cls.split(" ").at(0);
    let el = floatingBar.querySelector(`.${firstClass}`) || parent.querySelector(`.${firstClass}`);
    if (!el) {
      el = document.createElement("button"); el.type = "button"; el.className = cls; el.textContent = text;
      if (title) el.title = title;
      if (hidden) el.style.display = "none";
    }
    if (el.parentElement !== parent) parent.appendChild(el);
    return el;
  };

  const statusPill = makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, topRow);
  const copyPurgeAllBtn = makeBtn("gmc-global-copypurge-btn", "📋 Tout copier & purger", "Copier tous les blocs non purgés et purger le DOM", true, topRow);
  const purgeBtn = makeBtn("gmc-global-purge-btn", "🧹 DOM allégé", "Purger tous les blocs de la page sans copier", false, topRow);
  const eventPill = makeBtn("gmc-global-event-pill", "", "Cliquer pour envoyer ce statut dans le chat", true, bottomRow);
  const commitMsgBtn = makeBtn("gmc-global-commitmsg-btn", "💬 Message de commit", "Demander à l'IA le bloc COMMIT_MESSAGE sans renvoyer le diff", true, bottomRow);
  const gitBtn = makeBtn("gmc-global-git-btn", "🔀 Git status", "Afficher les fichiers modifiés (git status)", true, bottomRow);
  const exportBtn = makeBtn("gmc-global-export-btn", "📦 Exporter projet", "Exporter le projet et l'envoyer dans le chat", true, bottomRow);
  const coverageBtn = makeBtn("gmc-global-coverage-btn", "📊 Couverture", "Envoyer à l'IA le rapport de couverture des tests", true, testsRow);
  const testsBtn = makeBtn("gmc-global-tests-btn", "🧪 Lancer les tests", "Exécuter les tests unitaires", true, testsRow);
  const testLogBtn = makeBtn("gmc-global-testlog-btn", "📋 Sortie tests", "Afficher ou masquer la sortie complète des tests", true, testsRow);
  const composerUi = new window.GmcComposerQuickButtonsManager(chatInjector, bottomRow, gitBtn);
  const yesBtn = makeBtn("gmc-quick-yes-btn gmc-composer-btn", "Oui", "Envoyer « Oui » à l'IA", false, composerUi.groupEl);
  const nextBtn = makeBtn("gmc-quick-next-btn gmc-composer-btn", "Suite", "Envoyer « Suite » à l'IA", false, composerUi.groupEl);
  const excuseBtn = makeBtn("gmc-quick-excuse-btn gmc-composer-btn", "🎲 Excuse", "Insérer une excuse de développeur dans le chat", false, composerUi.groupEl);
  const sendBgMessage = (payload, onReply) => {
    if (!chrome.runtime?.id) { alert("Extension rechargée : actualisez cette page (F5) pour reconnecter les boutons."); return; }
    chrome.runtime.sendMessage(payload, (res) => { onReply(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message || "Port fermé" } : res); });
  };
  const setBtnState = (btn, state, label) => { btn.classList.remove("state-running", "state-pass", "state-fail"); if (state) btn.classList.add(`state-${state}`); btn.textContent = label; };
  const triggerProjectExport = (mode = "full") => {
    setBtnState(exportBtn, "running", "⏳ Export...");
    sendBgMessage({ type: "EXPORT_PROJECT", mode }, (res) => {
      if (res?.ok && res.content) {
        const fname = res.filename || "export.txt";
        const estTok = Number(res.estimated_tokens || Math.ceil(String(res.content).length / 4));
        const promptTxt = exportMenu ? exportMenu.buildExportPrompt(mode, fname, res.file_count, estTok) : `Fichier joint (\x60${fname}\x60) :`;
        chatInjector.insertPrompt(promptTxt, false);
        chatInjector.dropFile(fname, res.content, true);
        const tokLabel = estTok >= 1000 ? `~${(estTok / 1000).toFixed(1)}k tok` : `~${estTok} tok`;
        setBtnState(exportBtn, "pass", `✅ Exporté (${tokLabel})`);
      } else setBtnState(exportBtn, "fail", "❌ Erreur");
    });
  };
  const checkPendingFreshExport = () => {
    if (isTriggeringFreshExport || !watcherState?.running || !watcherState.hasExporter || !chrome.storage?.local) return;
    if (document.querySelectorAll("pre").length > 0 || !chatInjector.findChatInputElement()) return;
    chrome.storage.local.get("pendingFreshExportAt", (res) => {
      const ts = Number(res?.pendingFreshExportAt || 0);
      if (!ts || Date.now() - ts > 60000) { if (ts) chrome.storage.local.remove("pendingFreshExportAt"); return; }
      isTriggeringFreshExport = true;
      chrome.storage.local.remove("pendingFreshExportAt", () => { setTimeout(() => { isTriggeringFreshExport = false; triggerProjectExport("full"); }, 500); });
    });
  };

  const testActions = new window.GmcTestActionsController(chatInjector, sendBgMessage, setBtnState, { testsBtn, coverageBtn }, () => watcherState, () => updateIndicators());
  const blockManager = new window.GmcCodeBlockManager(spillDetector, chatInjector, () => { updateIndicators(); setTimeout(() => composerUi.mount(), 80); }, svgPreview);

  updateIndicators = () => {
    testActions.invalidateOnNewFiles();
    const running = Boolean(watcherState?.running);
    if (running) isStartingWatcher = false;
    statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    else if (!isStartingWatcher) statusPill.textContent = "🔴 Watcher OFF";
    const unpurgedCount = blockManager.getUnpurgedCount();
    copyPurgeAllBtn.style.display = unpurgedCount > 0 ? "inline-flex" : "none";
    if (unpurgedCount > 0) copyPurgeAllBtn.textContent = `📋 Tout copier & purger (${unpurgedCount})`;
    commitMsgBtn.style.display = running && watcherState.hasGit && canRequestCommitMsg ? "inline-flex" : "none";
    gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    exportBtn.style.display = running && watcherState.hasExporter ? "inline-flex" : "none";
    testsBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    testsBtn.disabled = Boolean(testActions.panel.isRunning);
    testLogBtn.style.display = running && watcherState.hasRunTestsClip && (testActions.panel.fullReport || testActions.panel.isRunning) ? "inline-flex" : "none";
    testActions.renderCoverageIndicator();
    eventPill.style.display = running && watcherState.lastEvent ? "inline-flex" : "none";
    if (running && watcherState.lastEvent) {
      const evStr = String(watcherState.lastEvent);
      const isSyntaxErr = Boolean(watcherState.hasSyntaxError || evStr.startsWith("[SYNTAXE]"));
      eventPill.classList.toggle("state-fail", isSyntaxErr);
      eventPill.textContent = isSyntaxErr ? `⚠️ ${evStr}` : evStr;
      eventPill.title = isSyntaxErr ? "Erreur de syntaxe détectée : cliquer pour envoyer l'extrait à l'IA" : "Cliquer pour envoyer ce statut dans le chat";
    }
    composerUi.mount(); checkPendingFreshExport();
  };
  const refreshState = () => {
    if (!chrome.runtime?.id) return;
    chrome.storage?.local?.get("watchClipboardState", (res) => { if (res?.watchClipboardState) { watcherState = res.watchClipboardState; updateIndicators(); } });
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (st) => { if (!chrome.runtime.lastError && st) { watcherState = st; updateIndicators(); } });
  };
  statusPill.addEventListener("click", () => {
    if (watcherState.running || isStartingWatcher) return;
    isStartingWatcher = true; statusPill.textContent = "⏳ Démarrage...";
    chrome.storage.local.get(["savedTargetDir", "savedExtraArgs"], (res) => {
      sendBgMessage({ type: "START_WATCHER", targetDir: (res.savedTargetDir || ".").trim() || ".", extraArgs: (res.savedExtraArgs || "").trim() }, (reply) => { isStartingWatcher = false; if (reply?.state) watcherState = reply.state; updateIndicators(); });
    });
  });

  copyPurgeAllBtn.addEventListener("click", () => blockManager.copyAndPurgeAll());
  commitMsgBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt(gitManager.buildCommitMessageOnlyPrompt(), true); canRequestCommitMsg = false; updateIndicators(); });
  eventPill.addEventListener("click", () => {
    blockManager.resetAutoSuiteQuota();
    const rawEv = String(watcherState?.lastEvent || eventPill.textContent || "");
    if (watcherState?.hasSyntaxError || rawEv.startsWith("[SYNTAXE]")) {
      sendBgMessage({ type: "GET_SYNTAX_ERROR" }, (res) => {
        const err = res?.syntax_error;
        if (res?.ok && err?.file) {
          const prompt = `Erreur de syntaxe détectée automatiquement dans \x60${err.file}\x60 (${err.message}) :\n\x60\x60\x60text\n${err.snippet || ""}\n\x60\x60\x60\nPeux-tu corriger ce fichier ?`;
          chatInjector.insertPrompt(prompt, true);
        } else chatInjector.insertPrompt(rawEv, true);
      });
      return;
    }
    chatInjector.insertPrompt(rawEv, true);
  });
  yesBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Oui", true); });
  nextBtn.addEventListener("click", () => { blockManager.resetAutoSuiteQuota(); chatInjector.insertPrompt("Suite", true); });
  excuseBtn.addEventListener("click", () => chatInjector.insertPrompt(composerUi.pickExcuse(), false));
  gitBtn.addEventListener("click", () => {
    if (gitManager.panelEl) { gitManager.close(); return; }
    setBtnState(gitBtn, "running", "⏳ Git...");
    sendBgMessage({ type: "GIT_STATUS" }, (res) => {
      if (!res?.ok) return setBtnState(gitBtn, "fail", "❌ Erreur Git");
      const entries = res.entries || [];
      if (entries.length === 0) { setBtnState(gitBtn, "pass", "✅ Aucun changement"); setTimeout(() => setBtnState(gitBtn, null, "🔀 Git status"), 2200); return; }
      setBtnState(gitBtn, null, "🔀 Git status"); gitManager.open(entries);
    });
  });
  exportBtn.addEventListener("click", () => { if (exportMenu) exportMenu.toggle((selectedMode) => triggerProjectExport(selectedMode)); else triggerProjectExport("full"); });
  testLogBtn.addEventListener("click", () => testActions.panel.toggle());
  purgeBtn.addEventListener("click", () => blockManager.purgeAll());

  chrome.storage?.onChanged?.addListener((changes, area) => { if (area === "local" && changes.watchClipboardState?.newValue) { watcherState = changes.watchClipboardState.newValue; updateIndicators(); } });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "WATCHER_STATE_CHANGED" && msg.state) { watcherState = msg.state; updateIndicators(); }
    if (msg?.type === "INSERT_TEST_RESULT" && msg.output) sendResponse({ inserted: chatInjector.insertTestResults(msg.output, false) });
  });
  const isExternalMutation = (records) => records.some((r) => {
    const t = r.target;
    if (t && t.nodeType === 1 && (String(t.className || "").includes("gmc-") || t.closest?.(".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-git-panel, .gmc-svg-preview-tooltip"))) return false;
    const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
    return nodes.length === 0 || nodes.some((n) => n.nodeType !== 1 || !String(n.className || "").includes("gmc-"));
  });
  const scanAll = (preExisting = false) => { composerUi.mount(); gitManager.scanCommitBlocks(); blockManager.scan(preExisting); svgPreview.scanStandaloneBlocks(); updateIndicators(); };
  window.__gmcObserver = new MutationObserver((records) => { if (!isExternalMutation(records)) return; clearTimeout(scanTimer); scanTimer = setTimeout(() => scanAll(false), 300); });
  window.__gmcObserver.observe(document.body, { childList: true, subtree: true });
  scanAll(true); refreshState();
  window.__gmcStatusTimer = setInterval(() => {
    const currentHref = String(window.location?.href || "");
    if (currentHref !== lastCheckedHref) { lastCheckedHref = currentHref; scanAll(false); checkPendingFreshExport(); }
    if (!document.hidden) refreshState();
  }, 2000);
}
