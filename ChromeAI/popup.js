/**
 * Contrôleur orienté objet de la fenêtre popup de l'extension ChromeAI.
 */
class WatcherPopupController {
  constructor() {
    this.DEFAULT_ROOT_DIR = "C:\\git";
    this.DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";
    this.CONFIG_INPUT_IDS = ["rootDirInput", "targetDirInput", "testRunnerInput", "extraArgsInput"];
    this.view = window.GmcPopupView ? new window.GmcPopupView(this.CONFIG_INPUT_IDS) : null;
    this.isWatcherRunning = false;
    this.folderLoadTimer = null;
  }

  getEl(id) { return document.getElementById(id); }
  formatArg(value) { return !value ? "" : (/\s/.test(value) ? `"${value}"` : value); }
  getCleanRootDir() { return ((this.getEl("rootDirInput")?.value || "").trim() || this.DEFAULT_ROOT_DIR).replace(/[\\/]+$/, ""); }

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
    if (this.getEl("footerRootDir")) this.getEl("footerRootDir").textContent = rootDir;
    if (this.getEl("previewCommand")) this.getEl("previewCommand").textContent = this.buildCommandPreview(targetVal, extraVal);
    if (this.getEl("installCommandText")) this.getEl("installCommandText").textContent = this.buildInstallCommand(rootDir);
  }

  loadWorkspaceFolders() {
    const rootDir = this.getCleanRootDir();
    const currentTarget = this.getEl("targetDirInput")?.value || "";
    chrome.runtime.sendMessage({ type: "LIST_WORKSPACE_FOLDERS", rootDir }, (res) => {
      const folders = res?.ok && Array.isArray(res.folders) ? res.folders : [];
      this.view?.renderWorkspaceFolders(folders, currentTarget);
    });
  }

  scheduleWorkspaceFoldersReload() {
    if (this.folderLoadTimer) clearTimeout(this.folderLoadTimer);
    this.folderLoadTimer = setTimeout(() => { this.folderLoadTimer = null; this.loadWorkspaceFolders(); }, 250);
  }

  setConfigInputsLocked(locked) { this.isWatcherRunning = Boolean(locked); this.view?.setConfigInputsLocked(locked); }
  bindCopyButton(btnId, codeId) { this.view?.bindCopyButton(btnId, codeId); }
  showError(msg) { this.view?.showError(msg); }
  showInstallHelp(installCommand) { this.view?.showInstallHelp(installCommand); }
  setButtonsBusy(busy) { this.view?.setButtonsBusy(busy); }
  renderState(state) {
    const wasRunning = this.isWatcherRunning;
    this.isWatcherRunning = Boolean(state && state.running);
    this.view?.renderState(state, () => this.updateCommandPreview());
    if (wasRunning && !this.isWatcherRunning) this.loadWorkspaceFolders();
  }
  bindEvents() {
    const rootInput = this.getEl("rootDirInput"), targetInput = this.getEl("targetDirInput");
    const targetSelect = this.getEl("targetDirSelect"), reloadFoldersBtn = this.getEl("reloadFoldersBtn");
    const testRunnerInput = this.getEl("testRunnerInput"), extraInput = this.getEl("extraArgsInput");
    rootInput?.addEventListener("input", () => {
      if (!this.isWatcherRunning) {
        chrome.storage.local.set({ savedRootDir: this.getCleanRootDir() });
        this.updateCommandPreview();
        this.scheduleWorkspaceFoldersReload();
      }
    });
    targetSelect?.addEventListener("change", () => {
      if (!this.isWatcherRunning && targetSelect.value) {
        if (targetInput) targetInput.value = targetSelect.value;
        chrome.storage.local.set({ savedTargetDir: targetSelect.value });
        this.updateCommandPreview();
      }
    });
    reloadFoldersBtn?.addEventListener("click", () => { if (!this.isWatcherRunning) this.loadWorkspaceFolders(); });
    testRunnerInput?.addEventListener("input", () => { if (!this.isWatcherRunning) chrome.storage.local.set({ savedTestRunner: testRunnerInput.value.trim() || this.DEFAULT_TEST_RUNNER }); });
    targetInput?.addEventListener("input", () => {
      if (!this.isWatcherRunning) {
        this.updateCommandPreview();
        if (targetSelect) {
          const clean = targetInput.value.trim().replace(/[\\/]+$/, "").toLowerCase();
          const matched = Array.from(targetSelect.options || []).find((o) => o.value && o.value.toLowerCase() === clean);
          targetSelect.value = matched ? matched.value : "";
        }
      }
    });
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
      if (!this.isWatcherRunning) this.loadWorkspaceFolders();
    });
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); });
    const popupPoll = setInterval(() => chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); }), 1000);
    window.addEventListener("unload", () => clearInterval(popupPoll));
    this.bindEvents();
  }
}
window.GmcPopupController = WatcherPopupController;
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => new WatcherPopupController().init());
