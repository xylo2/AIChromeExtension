/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_err) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);
  if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
  document
    .querySelectorAll(".gmc-composer-quick-group, .gmc-quick-yes-btn, .gmc-quick-next-btn, .gmc-quick-excuse-btn")
    .forEach((el) => el.remove());

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const gitManager = new window.GmcGitPanelManager(spillDetector, chatInjector);
  const svgPreview = new window.GmcSvgPreviewManager(spillDetector);

  let scanTimer = null;
  let isStartingWatcher = false;
  let lastUncoveredReport = "";
  let lastCoveragePercent = null;
  let lastTestsPassed = false;
  let lastCheckedHref = String(window.location?.href || "");
  let watcherState = { running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false, hasGit: false, lastEvent: null };

  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) {
    floatingBar = document.createElement("div");
    floatingBar.className = "gmc-floating-bar";
    document.body.appendChild(floatingBar);
  }
  const ensureRow = (cls) => {
    let row = floatingBar.querySelector(`.${cls}`);
    if (!row) { row = document.createElement("div"); row.className = `gmc-floating-row ${cls}`; floatingBar.appendChild(row); }
    return row;
  };
  const topRow = ensureRow("gmc-floating-row-status");
  const bottomRow = ensureRow("gmc-floating-row-actions");
  const testsRow = ensureRow("gmc-floating-row-tests");

  const makeBtn = (cls, text, title = "", hidden = false, parent = bottomRow) => {
    const firstClass = cls.split(" ").at(0);
    let el = floatingBar.querySelector(`.${firstClass}`) || parent.querySelector(`.${firstClass}`);
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

  const statusPill = makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, topRow);
  const purgeBtn = makeBtn("gmc-global-purge-btn", "🧹 DOM allégé", "Purger tous les blocs de la page", false, topRow);
  const eventPill = makeBtn("gmc-global-event-pill", "", "Cliquer pour envoyer ce statut dans le chat", true, bottomRow);
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
    if (!chrome.runtime?.id) {
      alert("Extension rechargée : actualisez cette page (F5) pour reconnecter les boutons.");
      return;
    }
    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError) { onReply({ ok: false, error: chrome.runtime.lastError.message || "Port fermé" }); return; }
      onReply(res);
    });
  };

  const setBtnState = (btn, state, label) => {
    btn.classList.remove("state-running", "state-pass", "state-fail");
    if (state) btn.classList.add(`state-${state}`);
    btn.textContent = label;
  };

  const resetTestsButton = () => setBtnState(testsBtn, null, "🧪 Lancer les tests");

  const parseCoveragePercent = (reportText) => {
    const m = String(reportText || "").match(/COUVERTURE GLOBALE\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i);
    return m ? Number.parseFloat(m.at(1)) : null;
  };

  const renderCoverageIndicator = () => {
    if (!watcherState?.running || !watcherState.hasRunTestsClip || !lastTestsPassed || !lastUncoveredReport) {
      coverageBtn.style.display = "none";
      return;
    }
    coverageBtn.style.display = "inline-flex";
    const pct = lastCoveragePercent ?? parseCoveragePercent(lastUncoveredReport);
    const isFull = pct !== null && pct >= 100;
    coverageBtn.classList.toggle("state-pass", isFull);
    coverageBtn.classList.toggle("state-fail", pct !== null && pct < 70);
    const pctSuffix = pct !== null ? ` (${pct.toFixed(1)}%)` : "";
    coverageBtn.textContent = isFull ? "✅ Couv. 100.0%" : `📊 Couverture${pctSuffix}`;
    coverageBtn.title = isFull
      ? "Toutes les lignes exécutables mesurées sont couvertes par les tests"
      : "Envoyer à l'IA le bilan de couverture et les lignes non couvertes";
  };

  const testPanel = new window.GmcTestOutputPanelManager(
    chatInjector,
    () => { sendBgMessage({ type: "STOP_PROJECT_TESTS" }, () => {}); },
    resetTestsButton
  );

  const blockManager = new window.GmcCodeBlockManager(spillDetector, chatInjector, () => {
    setTimeout(() => composerUi.mount(), 80);
  }, svgPreview);
  const updateIndicators = () => {
    const running = Boolean(watcherState?.running);
    if (running) isStartingWatcher = false;
    statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    else if (!isStartingWatcher) statusPill.textContent = "🔴 Watcher OFF";
    gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    exportBtn.style.display = running && watcherState.hasExporter ? "inline-flex" : "none";
    testsBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    testsBtn.disabled = Boolean(testPanel.isRunning);
    testLogBtn.style.display = running && watcherState.hasRunTestsClip && (testPanel.fullReport || testPanel.isRunning) ? "inline-flex" : "none";
    renderCoverageIndicator();
    eventPill.style.display = running && watcherState.lastEvent ? "inline-flex" : "none";
    if (running && watcherState.lastEvent) eventPill.textContent = String(watcherState.lastEvent);
    composerUi.mount();
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
    if (watcherState.running || isStartingWatcher) return;
    isStartingWatcher = true;
    statusPill.textContent = "⏳ Démarrage...";
    chrome.storage.local.get(["savedTargetDir", "savedExtraArgs"], (res) => {
      sendBgMessage(
        { type: "START_WATCHER", targetDir: (res.savedTargetDir || ".").trim() || ".", extraArgs: (res.savedExtraArgs || "").trim() },
        (reply) => { isStartingWatcher = false; if (reply?.state) watcherState = reply.state; updateIndicators(); }
      );
    });
  });
  eventPill.addEventListener("click", () => chatInjector.insertPrompt(eventPill.textContent, true));
  yesBtn.addEventListener("click", () => chatInjector.insertPrompt("Oui", true));
  nextBtn.addEventListener("click", () => chatInjector.insertPrompt("Suite", true));
  excuseBtn.addEventListener("click", () => chatInjector.insertPrompt(composerUi.pickExcuse(), false));
  gitBtn.addEventListener("click", () => {
    if (gitManager.panelEl) { gitManager.close(); return; }
    setBtnState(gitBtn, "running", "⏳ Git...");
    sendBgMessage({ type: "GIT_STATUS" }, (res) => {
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
    sendBgMessage({ type: "EXPORT_PROJECT" }, (res) => {
      if (res?.ok && res.content) { chatInjector.dropFile(res.filename || "export.txt", res.content, true); setBtnState(exportBtn, "pass", "✅ Exporté & envoyé"); }
      else setBtnState(exportBtn, "fail", "❌ Erreur");
    });
  });
  coverageBtn.addEventListener("click", () => {
    if (!lastUncoveredReport) return;
    const prompt = "Voici le bilan de couverture et les lignes non encore couvertes par les tests unitaires :\n" + "\x60\x60\x60text\n" + lastUncoveredReport + "\n\x60\x60\x60\nPeux-tu ajouter ou compléter les tests unitaires pour améliorer la couverture ?\n";
    chatInjector.insertPrompt(prompt, true);
    lastUncoveredReport = "";
    lastCoveragePercent = null;
    lastTestsPassed = false;
    renderCoverageIndicator();
  });

  const finalizeTestRun = async (res) => {
    testsBtn.disabled = false;
    if (!res?.ok && !res?.stopped) {
      setBtnState(testsBtn, "fail", "❌ Erreur");
      testPanel.finish(false, res?.error || "Erreur d'exécution des tests.", false);
      updateIndicators();
      return;
    }
    if (res?.stopped) {
      setBtnState(testsBtn, "fail", "⏹️ Tests arrêtés");
      testPanel.finish(false, testPanel.fullReport || "Exécution arrêtée.", true);
      updateIndicators();
      return;
    }
    const finalReport = String(res.output || testPanel.fullReport || "").trim();
    testPanel.finish(Boolean(res.passed), finalReport, false);
    if (res.passed) {
      setBtnState(testsBtn, "pass", "✅ Tests OK");
      lastTestsPassed = true;
      lastUncoveredReport = String(res.uncovered || "").trim();
      lastCoveragePercent = parseCoveragePercent(lastUncoveredReport);
      updateIndicators();
      return;
    }
    if (finalReport) {
      const ok = chatInjector.insertTestResults(finalReport, true);
      if (ok) resetTestsButton();
      else { try { await navigator.clipboard.writeText(finalReport); } catch (_err) {} setBtnState(testsBtn, "fail", "⚠️ Échecs copiés"); }
    } else setBtnState(testsBtn, "fail", "⚠️ Échecs (vide)");
    updateIndicators();
  };
  const startPollingTestStream = (initialOffset = 0) => {
    let offset = initialOffset;
    if (window.__gmcStreamTimer) clearInterval(window.__gmcStreamTimer);
    window.__gmcStreamTimer = setInterval(() => {
      sendBgMessage({ type: "POLL_TEST_STREAM", offset }, (snap) => {
        if (!snap?.ok) return;
        if (snap.chunk) testPanel.appendChunk(snap.chunk);
        offset = Number(snap.offset || offset);
        if (!snap.running) {
          clearInterval(window.__gmcStreamTimer);
          window.__gmcStreamTimer = null;
          finalizeTestRun(snap);
        }
      });
    }, 300);
  };

  testsBtn.addEventListener("click", () => {
    if (testsBtn.disabled || testPanel.isRunning) {
      if (testPanel.isRunning && !testPanel.panelEl) testPanel.toggle();
      return;
    }
    testsBtn.disabled = true;
    setBtnState(testsBtn, "running", "⏳ Tests...");
    lastTestsPassed = false;
    lastUncoveredReport = "";
    lastCoveragePercent = null;
    testPanel.open("⏳ Exécution des tests en cours...", "", true);
    updateIndicators();
    sendBgMessage({ type: "START_PROJECT_TESTS" }, (startRes) => {
      const errTxt = String(startRes?.error || "");
      if (errTxt === "not_found") {
        testPanel.appendChunk("Mode streaming indisponible (redémarrez watch_clipboard). Exécution synchrone...\n");
        sendBgMessage({ type: "RUN_PROJECT_TESTS", injectIntoActiveTab: false }, finalizeTestRun);
        return;
      }
      const alreadyRunning = /déjà en cours/i.test(errTxt);
      if (!startRes?.ok && !alreadyRunning) { finalizeTestRun(startRes); return; }
      startPollingTestStream(0);
    });
  });
  testLogBtn.addEventListener("click", () => testPanel.toggle());
  purgeBtn.addEventListener("click", () => blockManager.purgeAll());

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.watchClipboardState?.newValue) { watcherState = changes.watchClipboardState.newValue; updateIndicators(); }
  });
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

  const scanAll = (preExisting = false) => { composerUi.mount(); gitManager.scanCommitBlocks(); blockManager.scan(preExisting); svgPreview.scanStandaloneBlocks(); };
  window.__gmcObserver = new MutationObserver((records) => {
    if (!isExternalMutation(records)) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanAll(false), 300);
  });
  window.__gmcObserver.observe(document.body, { childList: true, subtree: true });
  scanAll(true);
  refreshState();
  window.__gmcStatusTimer = setInterval(() => {
    const currentHref = String(window.location?.href || "");
    if (currentHref !== lastCheckedHref) { lastCheckedHref = currentHref; scanAll(false); }
    if (!document.hidden) refreshState();
  }, 2000);
}
