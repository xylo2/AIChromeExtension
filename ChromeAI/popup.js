const DEFAULT_ROOT_DIR = "C:\\git";
const DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";
const CONFIG_INPUT_IDS = ["rootDirInput", "targetDirInput", "testRunnerInput", "extraArgsInput"];

let isWatcherRunning = false;

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

function setConfigInputsLocked(locked) {
  isWatcherRunning = Boolean(locked);
  for (const id of CONFIG_INPUT_IDS) {
    const inputEl = document.getElementById(id);
    if (inputEl) {
      inputEl.disabled = isWatcherRunning;
      inputEl.title = isWatcherRunning
        ? "Arrêtez watch_clipboard avant de modifier ce paramètre."
        : "";
    }
  }
  const notice = document.getElementById("configLockNotice");
  if (notice) {
    notice.style.display = isWatcherRunning ? "block" : "none";
  }
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

function renderState(state) {
  const pill = document.getElementById("statusPill");
  const detailsOnline = document.getElementById("detailsOnline");
  const detailsOffline = document.getElementById("detailsOffline");
  const activeTargetDir = document.getElementById("activeTargetDir");
  const pid = document.getElementById("pid");
  const lastCheck = document.getElementById("lastCheck");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const running = Boolean(state && state.running);

  setConfigInputsLocked(running);

  if (running) {
    pill.textContent = "ACTIF";
    pill.className = "pill on";
    detailsOnline.style.display = "block";
    detailsOffline.style.display = "none";
    activeTargetDir.textContent = state.targetDir || "-";
    pid.textContent = state.pid ? String(state.pid) : "-";
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

  rootInput.addEventListener("input", () => {
    if (isWatcherRunning) return;
    chrome.storage.local.set({ savedRootDir: getCleanRootDir() });
    updateCommandPreview();
  });
  testRunnerInput.addEventListener("input", () => {
    if (isWatcherRunning) return;
    const val = testRunnerInput.value.trim() || DEFAULT_TEST_RUNNER;
    chrome.storage.local.set({ savedTestRunner: val });
  });
  targetInput.addEventListener("input", () => {
    if (!isWatcherRunning) updateCommandPreview();
  });
  extraInput.addEventListener("input", () => {
    if (!isWatcherRunning) updateCommandPreview();
  });

  bindCopyButton("copyPreviewBtn", "previewCommand");
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

  document.getElementById("startBtn").addEventListener("click", () => {
    if (isWatcherRunning) return;
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
