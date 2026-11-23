/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_err) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const gitManager = new window.GmcGitPanelManager(spillDetector, chatInjector);
  const blockManager = new window.GmcCodeBlockManager(spillDetector, chatInjector);

  let scanTimer = null;
  let isStartingWatcher = false;
  let watcherState = { running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false, hasGit: false, lastEvent: null };

  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) {
    floatingBar = document.createElement("div");
    floatingBar.className = "gmc-floating-bar";
    document.body.appendChild(floatingBar);
  }

  const makeBtn = (cls, text, title = "", hidden = false) => {
    const firstClass = cls.split(" ").at(0);
    let el = floatingBar.querySelector(`.${firstClass}`);
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = cls;
      el.textContent = text;
      if (title) el.title = title;
      if (hidden) el.style.display = "none";
      floatingBar.appendChild(el);
    }
    return el;
  };

  const statusPill = makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF");
  const eventPill = makeBtn("gmc-global-event-pill", "", "Cliquer pour envoyer ce statut dans le chat", true);
  const gitBtn = makeBtn("gmc-global-git-btn", "🔀 Git status", "Afficher les fichiers modifiés (git status)", true);
  const exportBtn = makeBtn("gmc-global-export-btn", "📦 Exporter projet", "Exporter le projet et l'envoyer dans le chat", true);
  const testsBtn = makeBtn("gmc-global-tests-btn", "🧪 Lancer les tests", "Exécuter les tests et envoyer les échecs", true);
  const purgeBtn = makeBtn("gmc-global-purge-btn", "🧹 DOM allégé", "Purger tous les blocs de la page");

  const setBtnState = (btn, state, label) => {
    btn.classList.remove("state-running", "state-pass", "state-fail");
    if (state) btn.classList.add(`state-${state}`);
    btn.textContent = label;
  };

  const updateIndicators = () => {
    const running = Boolean(watcherState?.running);
    if (running) isStartingWatcher = false;
    statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) {
      statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    } else if (!isStartingWatcher) {
      statusPill.textContent = "🔴 Watcher OFF";
    }
    gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    exportBtn.style.display = running && watcherState.hasExporter ? "inline-flex" : "none";
    testsBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    eventPill.style.display = running && watcherState.lastEvent ? "inline-flex" : "none";
    if (running && watcherState.lastEvent) eventPill.textContent = String(watcherState.lastEvent);
  };
  const refreshState = () => {
    if (!chrome.runtime?.id) return;
    chrome.storage?.local?.get("watchClipboardState", (res) => {
      if (res?.watchClipboardState) { watcherState = res.watchClipboardState; updateIndicators(); }
    });
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (st) => {
      if (!chrome.runtime.lastError && st) { watcherState = st; updateIndicators(); }
    });
  };

  statusPill.addEventListener("click", () => {
    if (watcherState.running || isStartingWatcher || !chrome.runtime?.id) return;
    isStartingWatcher = true;
    statusPill.textContent = "⏳ Démarrage...";
    chrome.storage.local.get(["savedTargetDir", "savedExtraArgs"], (res) => {
      chrome.runtime.sendMessage(
        { type: "START_WATCHER", targetDir: (res.savedTargetDir || ".").trim() || ".", extraArgs: (res.savedExtraArgs || "").trim() },
        (reply) => {
          isStartingWatcher = false;
          if (reply?.state) watcherState = reply.state;
          updateIndicators();
        }
      );
    });
  });
  eventPill.addEventListener("click", () => chatInjector.insertPrompt(eventPill.textContent, true));
  gitBtn.addEventListener("click", () => {
    if (gitManager.panelEl) { gitManager.close(); return; }
    setBtnState(gitBtn, "running", "⏳ Git...");
    chrome.runtime.sendMessage({ type: "GIT_STATUS" }, (res) => {
      if (!res?.ok) return setBtnState(gitBtn, "fail", "❌ Erreur Git");
      const entries = res.entries || [];
      if (entries.length === 0) {
        setBtnState(gitBtn, "pass", "✅ Aucun changement");
        setTimeout(() => setBtnState(gitBtn, null, "🔀 Git status"), 2200);
        return;
      }
      setBtnState(gitBtn, null, "🔀 Git status");
      gitManager.open(entries);
    });
  });
  exportBtn.addEventListener("click", () => {
    setBtnState(exportBtn, "running", "⏳ Export...");
    chrome.runtime.sendMessage({ type: "EXPORT_PROJECT" }, (res) => {
      if (res?.ok && res.content) { chatInjector.dropFile(res.filename || "export.txt", res.content, true); setBtnState(exportBtn, "pass", "✅ Exporté & envoyé"); }
      else setBtnState(exportBtn, "fail", "❌ Erreur");
    });
  });
  testsBtn.addEventListener("click", () => {
    setBtnState(testsBtn, "running", "⏳ Tests...");
    chrome.runtime.sendMessage({ type: "RUN_PROJECT_TESTS", injectIntoActiveTab: false }, async (res) => {
      if (!res?.ok) return setBtnState(testsBtn, "fail", "❌ Erreur");
      if (res.passed) return setBtnState(testsBtn, "pass", "✅ Tests OK");
      if (res.output) {
        const ok = chatInjector.insertTestResults(res.output, true);
        if (ok) setBtnState(testsBtn, "fail", "⚠️ Échecs envoyés");
        else { try { await navigator.clipboard.writeText(res.output); } catch (_err) {} setBtnState(testsBtn, "fail", "⚠️ Échecs copiés"); }
      } else setBtnState(testsBtn, "fail", "⚠️ Échecs (vide)");
    });
  });
  purgeBtn.addEventListener("click", () => blockManager.purgeAll());

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.watchClipboardState?.newValue) { watcherState = changes.watchClipboardState.newValue; updateIndicators(); }
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "WATCHER_STATE_CHANGED" && msg.state) { watcherState = msg.state; updateIndicators(); }
    if (msg?.type === "INSERT_TEST_RESULT" && msg.output) sendResponse({ inserted: chatInjector.insertTestResults(msg.output, false) });
  });

  const scanAll = (preExisting = false) => { gitManager.scanCommitBlocks(); blockManager.scan(preExisting); };
  window.__gmcObserver = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(() => scanAll(false), 300); });
  window.__gmcObserver.observe(document.body, { childList: true, subtree: true });
  scanAll(true);
  refreshState();
  window.__gmcStatusTimer = setInterval(() => { if (!document.hidden) refreshState(); }, 4000);
}
