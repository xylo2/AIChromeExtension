const DEFAULT_ROOT_DIR = "C:\\git";
const DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";

function formatArg(value) {
  if (!value) return "";
  return /\s/.test(value) ? `"${value}"` : value;
}

function getCleanRootDir() {
  const raw = document.getElementById("rootDirInput").value.trim();
  return (raw || DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
}

function buildInstallCommand(rootDir) {
  const cleanRoot = (rootDir || DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
  return `python "${cleanRoot}\\tools\\watch_clipboard\\install_native_host.py" ${chrome.runtime.id}`;
}

function buildCommandPreview(targetDir, extraArgs) {
  const cleanTarget = (targetDir || ".").trim() || ".";
  const parts = ["python", "tools\\watch_clipboard\\watch_clipboard.py", formatArg(cleanTarget)];
  const cleanExtra = (extraArgs || "").trim();
  if (cleanExtra) {
    parts.push(cleanExtra);
  }
  return parts.join(" ");
}

function updateCommandPreview() {
  const rootDir = getCleanRootDir();
  const targetVal = document.getElementById("targetDirInput").value;
  const extraVal = document.getElementById("extraArgsInput").value;

  document.getElementById("footerRootDir").textContent = rootDir;
  document.getElementById("previewCommand").textContent = buildCommandPreview(targetVal, extraVal);
  document.getElementById("installCommandText").textContent = buildInstallCommand(rootDir);
}

function bindCopyButton(btnId, codeId) {
  const btn = document.getElementById(btnId);
  btn.addEventListener("click", async () => {
    const text = document.getElementById(codeId).textContent;
    if (!text || text === "-") return;
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = "Copié !";
    setTimeout(() => {
      btn.textContent = original;
    }, 1200);
  });
}

function showError(msg) {
  const box = document.getElementById("errorBox");
  if (!msg) {
    box.style.display = "none";
    box.textContent = "";
    return;
  }
  box.style.display = "block";
  box.textContent = msg;
}

function showInstallHelp(installCommand) {
  const helpBox = document.getElementById("installHelpBox");
  if (!installCommand) {
    helpBox.style.display = "none";
    return;
  }
  document.getElementById("installCommandText").textContent = installCommand;
  helpBox.style.display = "block";
}

function setButtonsBusy(busy) {
  document.getElementById("startBtn").disabled = busy;
  document.getElementById("stopBtn").disabled = busy;
  document.getElementById("refreshBtn").disabled = busy;
}

function setPopupTestsButtonState(btn, stateName, labelText) {
  btn.classList.remove("state-running", "state-pass", "state-fail");
  if (stateName) {
    btn.classList.add(`state-${stateName}`);
  }
  btn.textContent = labelText;
}

function renderState(state) {
  const pill = document.getElementById("statusPill");
  const detailsOnline = document.getElementById("detailsOnline");
  const detailsOffline = document.getElementById("detailsOffline");
  const activeTargetDir = document.getElementById("activeTargetDir");
  const pid = document.getElementById("pid");
  const activeCommand = document.getElementById("activeCommand");
  const runTestsBtn = document.getElementById("runTestsBtn");
  const lastCheck = document.getElementById("lastCheck");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");

  if (state && state.running) {
    pill.textContent = "ACTIF";
    pill.className = "pill on";
    detailsOnline.style.display = "block";
    detailsOffline.style.display = "none";
    activeTargetDir.textContent = state.targetDir || "-";
    pid.textContent = state.pid ? String(state.pid) : "-";
    activeCommand.textContent = state.command || "-";
    runTestsBtn.style.display = state.hasRunTestsClip ? "block" : "none";
    if (state.testRunnerPath) {
      runTestsBtn.title = `Exécuter ${state.testRunnerPath}`;
    }
    startBtn.style.display = "none";
    stopBtn.style.display = "block";
    showInstallHelp(null);

    chrome.storage.local.get("savedRootDir", (res) => {
      if (res.savedRootDir) {
        document.getElementById("rootDirInput").value = res.savedRootDir;
        updateCommandPreview();
      }
    });
  } else {
    pill.textContent = "HORS LIGNE";
    pill.className = "pill off";
    detailsOnline.style.display = "none";
    detailsOffline.style.display = "block";
    runTestsBtn.style.display = "none";
    setPopupTestsButtonState(runTestsBtn, null, "Lancer les tests (→ chat)");
    startBtn.style.display = "block";
    stopBtn.style.display = "none";
  }

  if (state && state.checkedAt) {
    lastCheck.textContent = `Vérifié : ${state.checkedAt}`;
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const rootInput = document.getElementById("rootDirInput");
  const targetInput = document.getElementById("targetDirInput");
  const testRunnerInput = document.getElementById("testRunnerInput");
  const extraInput = document.getElementById("extraArgsInput");
  const runTestsBtn = document.getElementById("runTestsBtn");

  rootInput.addEventListener("input", () => {
    chrome.storage.local.set({ savedRootDir: getCleanRootDir() });
    updateCommandPreview();
  });
  testRunnerInput.addEventListener("input", () => {
    const val = testRunnerInput.value.trim() || DEFAULT_TEST_RUNNER;
    chrome.storage.local.set({ savedTestRunner: val });
  });
  targetInput.addEventListener("input", updateCommandPreview);
  extraInput.addEventListener("input", updateCommandPreview);

  bindCopyButton("copyPreviewBtn", "previewCommand");
  bindCopyButton("copyActiveBtn", "activeCommand");
  bindCopyButton("copyInstallBtn", "installCommandText");

  chrome.storage.local.get(
    ["watchClipboardState", "savedRootDir", "savedTargetDir", "savedTestRunner", "savedExtraArgs"],
    (res) => {
      rootInput.value = res.savedRootDir || DEFAULT_ROOT_DIR;
      if (res.savedTargetDir) targetInput.value = res.savedTargetDir;
      testRunnerInput.value = res.savedTestRunner || DEFAULT_TEST_RUNNER;
      if (res.savedExtraArgs) extraInput.value = res.savedExtraArgs;
      updateCommandPreview();
      if (res.watchClipboardState) renderState(res.watchClipboardState);
    }
  );

  chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => {
    if (state) renderState(state);
  });

  const popupPoll = setInterval(() => {
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => {
      if (state) renderState(state);
    });
  }, 1000);

  window.addEventListener("unload", () => clearInterval(popupPoll));

  runTestsBtn.addEventListener("click", () => {
    showError("");
    runTestsBtn.disabled = true;
    setPopupTestsButtonState(runTestsBtn, "running", "⏳ Exécution des tests en cours...");

    chrome.runtime.sendMessage(
      { type: "RUN_PROJECT_TESTS", injectIntoActiveTab: true },
      (res) => {
        runTestsBtn.disabled = false;
        if (!res || !res.ok) {
          setPopupTestsButtonState(runTestsBtn, "fail", "❌ Erreur d'exécution");
          showError(`Erreur tests : ${(res && res.error) || "Échec du lancement."}`);
          return;
        }
        const statusMsg = res.passed ? "✅ Tests OK" : "⚠️ Échecs détectés";
        const suffix = res.insertedInPage ? " (collé dans le chat !)" : " (copié !)";
        setPopupTestsButtonState(runTestsBtn, res.passed ? "pass" : "fail", `${statusMsg}${suffix}`);
      }
    );
  });

  document.getElementById("startBtn").addEventListener("click", () => {
    showError("");
    showInstallHelp(null);
    setButtonsBusy(true);
    const rootDir = getCleanRootDir();
    const targetDir = targetInput.value.trim() || ".";
    const testRunner = testRunnerInput.value.trim() || DEFAULT_TEST_RUNNER;
    const extraArgs = extraInput.value.trim();

    chrome.storage.local.set({
      savedRootDir: rootDir,
      savedTargetDir: targetDir,
      savedTestRunner: testRunner,
      savedExtraArgs: extraArgs
    });

    chrome.runtime.sendMessage(
      { type: "START_WATCHER", targetDir, extraArgs },
      (res) => {
        setButtonsBusy(false);
        if (!res || !res.ok) {
          const detail = (res && (res.error || (res.response && res.response.error))) || "Échec du lancement natif.";
          showError(`Erreur : ${detail}`);
          if (res && res.missingHost) {
            showInstallHelp(buildInstallCommand(rootDir));
          }
        }
        if (res && res.state) {
          renderState(res.state);
        }
      }
    );
  });

  document.getElementById("stopBtn").addEventListener("click", () => {
    showError("");
    showInstallHelp(null);
    setButtonsBusy(true);
    chrome.runtime.sendMessage({ type: "STOP_WATCHER" }, (state) => {
      setButtonsBusy(false);
      if (state) renderState(state);
    });
  });

  document.getElementById("refreshBtn").addEventListener("click", () => {
    showError("");
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => {
      if (state) renderState(state);
    });
  });
});
