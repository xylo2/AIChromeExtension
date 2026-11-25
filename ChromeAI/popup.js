/**
 * Contrôleur orienté objet de la fenêtre popup de l'extension ChromeAI.
 */
class WatcherPopupController {
  constructor() {
    this.DEFAULT_ROOT_DIR = "C:\\git";
    this.DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";
    this.CONFIG_INPUT_IDS = ["rootDirInput", "targetDirInput", "testRunnerInput", "extraArgsInput"];
    this.isWatcherRunning = false;
  }

  getEl(id) {
    return document.getElementById(id);
  }

  formatArg(value) {
    if (!value) return "";
    return /\s/.test(value) ? `"${value}"` : value;
  }

  getCleanRootDir() {
    const raw = (this.getEl("rootDirInput")?.value || "").trim();
    return (raw || this.DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
  }

  buildInstallCommand(rootDir) {
    const cleanRoot = (rootDir || this.DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
    return `python "${cleanRoot}\\tools\\watch_clipboard\\install_native_host.py" ${chrome.runtime.id}`;
  }

  buildCommandPreview(targetDir, extraArgs) {
    const cleanTarget = (targetDir || ".").trim() || ".";
    const parts = ["python", "tools\\watch_clipboard\\watch_clipboard.py", this.formatArg(cleanTarget)];
    const cleanExtra = (extraArgs || "").trim();
    if (cleanExtra) parts.push(cleanExtra);
    return parts.join(" ");
  }

  updateCommandPreview() {
    const rootDir = this.getCleanRootDir();
    const targetVal = this.getEl("targetDirInput")?.value || "";
    const extraVal = this.getEl("extraArgsInput")?.value || "";
    const footerEl = this.getEl("footerRootDir");
    const previewEl = this.getEl("previewCommand");
    const installEl = this.getEl("installCommandText");
    if (footerEl) footerEl.textContent = rootDir;
    if (previewEl) previewEl.textContent = this.buildCommandPreview(targetVal, extraVal);
    if (installEl) installEl.textContent = this.buildInstallCommand(rootDir);
  }

  setConfigInputsLocked(locked) {
    this.isWatcherRunning = Boolean(locked);
    for (const id of this.CONFIG_INPUT_IDS) {
      const inputEl = this.getEl(id);
      if (inputEl) {
        inputEl.disabled = this.isWatcherRunning;
        inputEl.title = this.isWatcherRunning ? "Arrêtez watch_clipboard avant de modifier ce paramètre." : "";
      }
    }
    const notice = this.getEl("configLockNotice");
    if (notice) notice.style.display = this.isWatcherRunning ? "block" : "none";
  }

  bindCopyButton(btnId, codeId) {
    const btn = this.getEl(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const text = this.getEl(codeId)?.textContent || "";
      if (!text || text === "-") return;
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = "Copié !";
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  }
  showError(msg) {
    const box = this.getEl("errorBox");
    if (!box) return;
    if (!msg) { box.style.display = "none"; box.textContent = ""; return; }
    box.style.display = "block";
    box.textContent = msg;
  }

  showInstallHelp(installCommand) {
    const helpBox = this.getEl("installHelpBox");
    if (!helpBox) return;
    if (!installCommand) { helpBox.style.display = "none"; return; }
    const cmdEl = this.getEl("installCommandText");
    if (cmdEl) cmdEl.textContent = installCommand;
    helpBox.style.display = "block";
  }

  setButtonsBusy(busy) {
    ["startBtn", "stopBtn", "refreshBtn"].forEach((id) => {
      const btn = this.getEl(id);
      if (btn) btn.disabled = busy;
    });
  }

  renderState(state) {
    const running = Boolean(state && state.running);
    this.setConfigInputsLocked(running);
    const pill = this.getEl("statusPill");
    const detailsOnline = this.getEl("detailsOnline");
    const detailsOffline = this.getEl("detailsOffline");
    const startBtn = this.getEl("startBtn");
    const stopBtn = this.getEl("stopBtn");
    if (running) {
      if (pill) { pill.textContent = "ACTIF"; pill.className = "pill on"; }
      if (detailsOnline) detailsOnline.style.display = "block";
      if (detailsOffline) detailsOffline.style.display = "none";
      const targetEl = this.getEl("activeTargetDir");
      const pidEl = this.getEl("pid");
      if (targetEl) targetEl.textContent = state.targetDir || "-";
      if (pidEl) pidEl.textContent = state.pid ? String(state.pid) : "-";
      if (startBtn) startBtn.style.display = "none";
      if (stopBtn) stopBtn.style.display = "block";
      this.showInstallHelp(null);
      chrome.storage.local.get("savedRootDir", (res) => {
        if (res.savedRootDir && this.getEl("rootDirInput")) {
          this.getEl("rootDirInput").value = res.savedRootDir;
          this.updateCommandPreview();
        }
      });
    } else {
      if (pill) { pill.textContent = "HORS LIGNE"; pill.className = "pill off"; }
      if (detailsOnline) detailsOnline.style.display = "none";
      if (detailsOffline) detailsOffline.style.display = "block";
      if (startBtn) startBtn.style.display = "block";
      if (stopBtn) stopBtn.style.display = "none";
    }
    const lastCheck = this.getEl("lastCheck");
    if (state && state.checkedAt && lastCheck) lastCheck.textContent = `Vérifié : ${state.checkedAt}`;
  }

  bindEvents() {
    const rootInput = this.getEl("rootDirInput");
    const targetInput = this.getEl("targetDirInput");
    const testRunnerInput = this.getEl("testRunnerInput");
    const extraInput = this.getEl("extraArgsInput");
    rootInput?.addEventListener("input", () => { if (!this.isWatcherRunning) { chrome.storage.local.set({ savedRootDir: this.getCleanRootDir() }); this.updateCommandPreview(); } });
    testRunnerInput?.addEventListener("input", () => { if (!this.isWatcherRunning) chrome.storage.local.set({ savedTestRunner: testRunnerInput.value.trim() || this.DEFAULT_TEST_RUNNER }); });
    targetInput?.addEventListener("input", () => { if (!this.isWatcherRunning) this.updateCommandPreview(); });
    extraInput?.addEventListener("input", () => { if (!this.isWatcherRunning) this.updateCommandPreview(); });
    this.bindCopyButton("copyPreviewBtn", "previewCommand");
    this.bindCopyButton("copyInstallBtn", "installCommandText");
    this.getEl("startBtn")?.addEventListener("click", () => {
      if (this.isWatcherRunning) return;
      this.showError(""); this.showInstallHelp(null); this.setButtonsBusy(true);
      const rootDir = this.getCleanRootDir();
      const targetDir = (targetInput?.value || "").trim() || ".";
      const testRunner = (testRunnerInput?.value || "").trim() || this.DEFAULT_TEST_RUNNER;
      const extraArgs = (extraInput?.value || "").trim();
      chrome.storage.local.set({ savedRootDir: rootDir, savedTargetDir: targetDir, savedTestRunner: testRunner, savedExtraArgs: extraArgs });
      chrome.runtime.sendMessage({ type: "START_WATCHER", targetDir, extraArgs }, (res) => {
        this.setButtonsBusy(false);
        if (!res || !res.ok) {
          const detail = (res && (res.error || res.response?.error)) || "Échec du lancement natif.";
          this.showError(`Erreur : ${detail}`);
          if (res?.missingHost) this.showInstallHelp(this.buildInstallCommand(rootDir));
        }
        if (res?.state) this.renderState(res.state);
      });
    });
    this.getEl("stopBtn")?.addEventListener("click", () => {
      this.showError(""); this.showInstallHelp(null); this.setButtonsBusy(true);
      chrome.runtime.sendMessage({ type: "STOP_WATCHER" }, (state) => { this.setButtonsBusy(false); if (state) this.renderState(state); });
    });
    this.getEl("refreshBtn")?.addEventListener("click", () => {
      this.showError("");
      chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); });
    });
  }

  init() {
    chrome.storage.local.get(["watchClipboardState", "savedRootDir", "savedTargetDir", "savedTestRunner", "savedExtraArgs"], (res) => {
      if (this.getEl("rootDirInput")) this.getEl("rootDirInput").value = res.savedRootDir || this.DEFAULT_ROOT_DIR;
      if (res.savedTargetDir && this.getEl("targetDirInput")) this.getEl("targetDirInput").value = res.savedTargetDir;
      if (this.getEl("testRunnerInput")) this.getEl("testRunnerInput").value = res.savedTestRunner || this.DEFAULT_TEST_RUNNER;
      if (res.savedExtraArgs && this.getEl("extraArgsInput")) this.getEl("extraArgsInput").value = res.savedExtraArgs;
      this.updateCommandPreview();
      if (res.watchClipboardState) this.renderState(res.watchClipboardState);
    });
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); });
    const popupPoll = setInterval(() => chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); }), 1000);
    window.addEventListener("unload", () => clearInterval(popupPoll));
    this.bindEvents();
  }
}
window.GmcPopupController = WatcherPopupController;
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => new WatcherPopupController().init());
}
