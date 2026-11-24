/**
 * Point d'entrée léger de l'extension ChromeAI (barre flottante et orchestration).
 */
if (!window.__gmcInitialized && window.location.hostname.includes("google.")) {
  window.__gmcInitialized = true;
  if (window.__gmcObserver) { try { window.__gmcObserver.disconnect(); } catch (_err) {} }
  if (window.__gmcStatusTimer) clearInterval(window.__gmcStatusTimer);
  document
    .querySelectorAll(".gmc-composer-quick-group, .gmc-quick-yes-btn, .gmc-quick-next-btn, .gmc-quick-excuse-btn, .gmc-test-output-panel, .gmc-git-panel")
    .forEach((el) => el.remove());

  let scanTimer = null;
  let isStartingWatcher = false;
  let lastUncoveredReport = "";
  let lastCoveragePercent = null;
  let lastTestsPassed = false;
  let testStreamTimer = null;
  let watcherState = { running: false, targetDir: null, hasRunTestsClip: false, hasExporter: false, hasGit: false, lastEvent: null };

  let floatingBar = document.querySelector(".gmc-floating-bar");
  if (!floatingBar) {
    floatingBar = document.createElement("div");
    floatingBar.className = "gmc-floating-bar";
    document.body.appendChild(floatingBar);
  }
  floatingBar.innerHTML = "";

  const ensureRow = (cls) => {
    const row = document.createElement("div");
    row.className = `gmc-floating-row ${cls}`;
    floatingBar.appendChild(row);
    return row;
  };
  const topRow = ensureRow("gmc-floating-row-top");
  const bottomRow = ensureRow("gmc-floating-row-bottom");

  const makeBtn = (cls, text, title = "", hidden = false, parent = bottomRow) => {
    const firstClass = cls.split(" ").at(0);
    let el = document.querySelector(`.${firstClass}`);
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = cls;
      el.textContent = text;
      if (title) el.title = title;
    }
    el.style.display = hidden ? "none" : "inline-flex";
    parent.appendChild(el);
    return el;
  };

  const quickReplyGroup = document.createElement("div");
  quickReplyGroup.className = "gmc-composer-quick-group";

  const statusPill = makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, topRow);
  const eventPill = makeBtn("gmc-global-event-pill", "", "Cliquer pour envoyer ce statut dans le chat", true, topRow);
  const purgeBtn = makeBtn("gmc-global-purge-btn", "🧹 DOM allégé", "Purger tous les blocs de la page", false, topRow);
  const yesBtn = makeBtn("gmc-quick-yes-btn gmc-composer-btn", "Oui", "Envoyer « Oui » à l'IA", false, quickReplyGroup);
  const nextBtn = makeBtn("gmc-quick-next-btn gmc-composer-btn", "Suite", "Envoyer « Suite » à l'IA", false, quickReplyGroup);
  const excuseBtn = makeBtn("gmc-quick-excuse-btn gmc-composer-btn", "🎲 Excuse", "Insérer une excuse de développeur dans le chat", false, quickReplyGroup);
  const exportBtn = makeBtn("gmc-global-export-btn", "📦 Exporter projet", "Exporter le projet et l'envoyer dans le chat", true, bottomRow);
  const gitBtn = makeBtn("gmc-global-git-btn", "🔀 Git status", "Afficher les fichiers modifiés (git status)", true, bottomRow);
  const coverageBtn = makeBtn("gmc-global-coverage-btn", "📊 Couverture", "Envoyer à l'IA le rapport de couverture des tests", true, bottomRow);
  const testLogBtn = makeBtn("gmc-global-testlog-btn", "📋 Sortie tests", "Afficher le rapport complet de la dernière exécution des tests", true, bottomRow);
  const testsBtn = makeBtn("gmc-global-tests-btn", "🧪 Lancer les tests", "Exécuter les tests et envoyer les échecs", true, bottomRow);

  const setBtnState = (btn, state, label) => {
    btn.classList.remove("state-running", "state-pass", "state-fail");
    if (state) btn.classList.add(`state-${state}`);
    btn.textContent = label;
  };

  const resetTestsButton = () => {
    setBtnState(testsBtn, null, "🧪 Lancer les tests");
  };

  const spillDetector = new window.GmcSpillDetector();
  const chatInjector = new window.GmcChatInjector();
  const gitManager = new window.GmcGitPanelManager(spillDetector, chatInjector);
  const testPanel = new window.GmcTestOutputPanelManager(chatInjector);
  const blockManager = new window.GmcCodeBlockManager(spillDetector, chatInjector, resetTestsButton);
  const DEV_EXCUSES = [
    "Ça marchait pourtant sur ma branche avant le rebase quantique.",
    "Ce n'est pas un bug, c'est une fonctionnalité non documentée en phase bêta.",
    "Le cache du presse-papiers a décidé de prendre sa pause café.",
    "Les rayons cosmiques ont dû inverser un bit dans le service worker.",
    "C'est un comportement nominal sous un alignement défavorable de Saturne.",
    "Chez moi ça compile, le problème vient sûrement de la gravité locale.",
    "J'avais prévu de corriger ça juste après la conquête du monde."
  ];
  const pickDevExcuse = () => DEV_EXCUSES.at(Math.floor(Math.random() * DEV_EXCUSES.length));

  const isAiConversationPage = () => {
    const href = String(window.location?.href || "").toLowerCase();
    const path = String(window.location?.pathname || "").toLowerCase();
    if (href.includes("udm=50") || href.includes("aim=") || path.includes("/aim") || path.includes("/app")) return true;
    if (document.querySelector("rich-textarea, [data-aim-turn], [data-turn-id], pre")) return true;
    if (chatInjector.findChatInputElement()) return true;
    return !((path === "/" || path === "/webhp") && !href.includes("udm="));
  };

  const attachQuickGroupToFloatingBar = () => {
    quickReplyGroup.classList.remove("gmc-composer-below");
    if (quickReplyGroup.parentElement !== bottomRow || quickReplyGroup.nextSibling !== exportBtn) {
      bottomRow.insertBefore(quickReplyGroup, exportBtn);
    }
  };

  const isBottomConversationComposer = (inputEl) => {
    if (!inputEl || inputEl.closest('form[action="/search"], [role="search"]')) return false;
    if (typeof inputEl.getBoundingClientRect !== "function") return true;
    const rect = inputEl.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    return rect.height > 0 && (viewH === 0 || rect.top >= viewH * 0.45);
  };

  const mountQuickButtonsNearPlus = () => {
    document.querySelectorAll(".gmc-composer-quick-group").forEach((el) => { if (el !== quickReplyGroup) el.remove(); });
    if (!isAiConversationPage()) {
      if (quickReplyGroup.style.display !== "none") quickReplyGroup.style.display = "none";
      return;
    }
    if (quickReplyGroup.style.display !== "inline-flex") quickReplyGroup.style.display = "inline-flex";
    const inputEl = chatInjector.findChatInputElement();
    if (!isBottomConversationComposer(inputEl)) { attachQuickGroupToFloatingBar(); return; }
    let box = inputEl.parentElement;
    for (let depth = 0; depth < 7 && box; depth++) {
      const plusBtn = Array.from(box.querySelectorAll("button, [role='button']")).find((btn) => {
        if (btn.closest(".gmc-composer-quick-group") || String(btn.className || "").includes("gmc-")) return false;
        const meta = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.textContent || ""}`.toLowerCase();
        return meta.includes("ajouter") || meta.includes("importer") || meta.includes("plus") || meta.includes("upload") || btn.textContent.trim() === "+";
      });
      if (plusBtn?.parentElement && box.contains(plusBtn)) {
        let anchor = plusBtn;
        while (anchor.parentElement && anchor.parentElement !== box && anchor.parentElement.children.length <= 2 && !anchor.parentElement.contains(inputEl)) {
          anchor = anchor.parentElement;
        }
        const rowContainer = anchor.parentElement;
        const siblingInputBox = anchor.nextElementSibling;
        if (siblingInputBox && siblingInputBox.contains(inputEl) && box.parentElement) {
          if (quickReplyGroup.parentElement !== box.parentElement || box.nextSibling !== quickReplyGroup) {
            quickReplyGroup.classList.add("gmc-composer-below");
            box.parentElement.insertBefore(quickReplyGroup, box.nextSibling);
          }
          return;
        }
        if (rowContainer && (quickReplyGroup.parentElement !== rowContainer || anchor.nextSibling !== quickReplyGroup)) {
          quickReplyGroup.classList.remove("gmc-composer-below");
          rowContainer.insertBefore(quickReplyGroup, anchor.nextSibling);
        }
        return;
      }
      box = box.parentElement;
    }
    attachQuickGroupToFloatingBar();
  };
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

  const updateIndicators = () => {
    const running = Boolean(watcherState?.running);
    if (running) isStartingWatcher = false;
    statusPill.className = `gmc-global-status-pill ${running ? "online" : "offline"}`;
    const folder = watcherState.targetDir ? watcherState.targetDir.split(/[\\/]/).filter(Boolean).pop() : "";
    if (running) statusPill.textContent = `🟢 Watcher ON${folder ? ` (${folder})` : ""}`;
    else if (!isStartingWatcher) statusPill.textContent = "🔴 Watcher OFF";
    exportBtn.style.display = running && watcherState.hasExporter ? "inline-flex" : "none";
    gitBtn.style.display = running && watcherState.hasGit ? "inline-flex" : "none";
    testsBtn.style.display = running && watcherState.hasRunTestsClip ? "inline-flex" : "none";
    testLogBtn.style.display = running && watcherState.hasRunTestsClip && testPanel.fullReport ? "inline-flex" : "none";
    renderCoverageIndicator();
    eventPill.style.display = running && watcherState.lastEvent ? "inline-flex" : "none";
    if (running && watcherState.lastEvent) eventPill.textContent = String(watcherState.lastEvent);
    const hasBottomVisible = Array.from(bottomRow.children).some((el) => el.style.display !== "none");
    bottomRow.style.display = hasBottomVisible ? "flex" : "none";
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
  excuseBtn.addEventListener("click", () => chatInjector.insertPrompt(pickDevExcuse(), false));
  gitBtn.addEventListener("click", () => {
    if (gitManager.panelEl) { gitManager.close(); return; }
    testPanel.close();
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
    updateIndicators();
  });
  testLogBtn.addEventListener("click", () => { gitManager.close(); testPanel.toggle(); });

  const finalizeTestRun = async (st) => {
    const outText = String(st.output || "").trim();
    const covText = String(st.uncovered || "").trim();
    const fullText = [outText, covText].filter(Boolean).join("\n\n") || testPanel.fullReport;
    testPanel.finish(Boolean(st.passed), fullText);
    if (st.passed) {
      setBtnState(testsBtn, "pass", "✅ Tests OK");
      lastTestsPassed = true;
      lastUncoveredReport = covText;
      lastCoveragePercent = parseCoveragePercent(covText);
      updateIndicators();
      return;
    }
    updateIndicators();
    if (outText) {
      const ok = chatInjector.insertTestResults(outText, true);
      if (ok) setBtnState(testsBtn, "fail", "⚠️ Échecs envoyés");
      else { try { await navigator.clipboard.writeText(outText); } catch (_err) {} setBtnState(testsBtn, "fail", "⚠️ Échecs copiés"); }
    } else setBtnState(testsBtn, "fail", "⚠️ Échecs (vide)");
  };

  testsBtn.addEventListener("click", () => {
    if (testStreamTimer) { clearInterval(testStreamTimer); testStreamTimer = null; }
    setBtnState(testsBtn, "running", "⏳ Tests...");
    gitManager.close();
    lastTestsPassed = false;
    lastUncoveredReport = "";
    lastCoveragePercent = null;
    testPanel.fullReport = "";
    testPanel.open("⏳ Exécution des tests en cours...", "");
    updateIndicators();
    let offset = 0;
    let polling = false;
    sendBgMessage({ type: "START_PROJECT_TESTS" }, (startRes) => {
      if (!startRes?.ok) { testPanel.finish(false, startRes?.error || "Erreur démarrage"); return setBtnState(testsBtn, "fail", "❌ Erreur"); }
      testStreamTimer = setInterval(() => {
        if (polling) return;
        polling = true;
        sendBgMessage({ type: "POLL_TEST_STREAM", offset }, async (st) => {
          polling = false;
          if (!st?.ok) return;
          if (st.chunk) { testPanel.appendChunk(st.chunk); offset = st.offset ?? offset; updateIndicators(); }
          if (!st.running) {
            clearInterval(testStreamTimer);
            testStreamTimer = null;
            if (st.error) { testPanel.finish(false, st.error); setBtnState(testsBtn, "fail", "❌ Erreur"); return; }
            await finalizeTestRun(st);
          }
        });
      }, 250);
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

  const isExternalMutation = (records) => records.some((r) => {
    const t = r.target;
    if (t && t.nodeType === 1 && (String(t.className || "").includes("gmc-") || t.closest?.(".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-git-panel"))) return false;
    const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
    return nodes.length === 0 || nodes.some((n) => n.nodeType !== 1 || !String(n.className || "").includes("gmc-"));
  });

  const scanAll = (preExisting = false) => { mountQuickButtonsNearPlus(); gitManager.scanCommitBlocks(); blockManager.scan(preExisting); };
  window.__gmcObserver = new MutationObserver((records) => {
    if (!isExternalMutation(records)) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanAll(false), 300);
  });
  window.__gmcObserver.observe(document.body, { childList: true, subtree: true });
  scanAll(true);
  refreshState();
  window.__gmcStatusTimer = setInterval(() => { if (!document.hidden) refreshState(); }, 4000);
}
