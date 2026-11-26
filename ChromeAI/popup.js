/**
 * Contrôleur orienté objet de la fenêtre popup de l'extension ChromeAI.
 */
class WatcherPopupController {
  /** Initialise les valeurs par défaut, la vue DOM et l'état sélectionné de la popup. */
  constructor() {
    this.DEFAULT_ROOT_DIR = "C:\\git";
    this.DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";
    this.CONFIG_INPUT_IDS = ["rootDirInput", "testRunnerInput", "extraArgsInput"];
    this.view = window.GmcPopupView ? new window.GmcPopupView(this.CONFIG_INPUT_IDS) : null;
    this.isWatcherRunning = false;
    this.folderLoadTimer = null;
    this.selectedTargetDir = ".";
  }

  /** Raccourci retournant l'élément DOM correspondant à l'identifiant fourni. */
  getEl(id) { return document.getElementById(id); }
  /** Entoure de guillemets un argument CLI s'il contient des espaces. */
  formatArg(value) { return !value ? "" : (/\s/.test(value) ? `"${value}"` : value); }
  /** Retourne le chemin nettoyé de la racine workspace saisie dans le champ. */
  getCleanRootDir() { return ((this.getEl("rootDirInput")?.value || "").trim() || this.DEFAULT_ROOT_DIR).replace(/[\\/]+$/, ""); }
  /** Retourne le dossier cible sélectionné dans le menu déroulant. */
  getCurrentTargetDir() { return (this.getEl("targetDirSelect")?.value || this.selectedTargetDir || ".").trim() || "."; }

  /** Génère la commande d'installation PowerShell de l'hôte Native Messaging. */
  buildInstallCommand(rootDir) {
    const cleanRoot = (rootDir || this.DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
    return `python "${cleanRoot}\\tools\\watch_clipboard\\install_native_host.py" ${chrome.runtime.id}`;
  }

  /** Construit l'aperçu de la ligne de commande CLI équivalente. */
  buildCommandPreview(targetDir, extraArgs) {
    const cleanTarget = (targetDir || ".").trim() || ".";
    const parts = ["python", "tools\\watch_clipboard\\watch_clipboard.py", this.formatArg(cleanTarget)];
    const cleanExtra = (extraArgs || "").trim();
    if (cleanExtra) parts.push(cleanExtra);
    return parts.join(" ");
  }

  /** Met à jour l'aperçu de commande CLI, le pied de page et la commande d'installation. */
  updateCommandPreview() {
    const rootDir = this.getCleanRootDir();
    const targetVal = this.getCurrentTargetDir();
    const extraVal = this.getEl("extraArgsInput")?.value || "";
    if (this.getEl("footerRootDir")) this.getEl("footerRootDir").textContent = rootDir;
    if (this.getEl("previewCommand")) this.getEl("previewCommand").textContent = this.buildCommandPreview(targetVal, extraVal);
    if (this.getEl("installCommandText")) this.getEl("installCommandText").textContent = this.buildInstallCommand(rootDir);
  }
  /** Interroge le service worker pour charger la liste des sous-dossiers de la racine. */
  loadWorkspaceFolders() {
    const rootDir = this.getCleanRootDir();
    const currentTarget = this.getCurrentTargetDir();
    chrome.runtime.sendMessage({ type: "LIST_WORKSPACE_FOLDERS", rootDir }, (res) => {
      const rtErr = chrome.runtime?.lastError?.message || "";
      if (rtErr || !res || !res.ok) {
        const detail = rtErr || res?.error || "Impossible de lister les sous-dossiers.";
        this.showError(`Dossiers : ${detail}`);
        if (res?.missingHost) this.showInstallHelp(this.buildInstallCommand(rootDir));
        this.view?.renderWorkspaceFolders([], currentTarget);
        this.updateCommandPreview();
        return;
      }
      this.showError("");
      this.showInstallHelp(null);
      const folders = Array.isArray(res.folders) ? res.folders : [];
      this.view?.renderWorkspaceFolders(folders, currentTarget);
      this.selectedTargetDir = this.getCurrentTargetDir();
      this.updateCommandPreview();
    });
  }

  /** Planifie le rechargement différé des sous-dossiers lors de la saisie de la racine. */
  scheduleWorkspaceFoldersReload() {
    if (this.folderLoadTimer) clearTimeout(this.folderLoadTimer);
    this.folderLoadTimer = setTimeout(() => { this.folderLoadTimer = null; this.loadWorkspaceFolders(); }, 250);
  }

  /** Verrouille ou déverrouille les champs de configuration de la popup. */
  setConfigInputsLocked(locked) { this.isWatcherRunning = Boolean(locked); this.view?.setConfigInputsLocked(locked); }
  /** Attache un bouton de copie rapide vers le presse-papiers. */
  bindCopyButton(btnId, codeId) { this.view?.bindCopyButton(btnId, codeId); }
  /** Affiche un message d'erreur dans la popup. */
  showError(msg) { this.view?.showError(msg); }
  /** Affiche la commande d'installation de l'hôte natif. */
  showInstallHelp(installCommand) { this.view?.showInstallHelp(installCommand); }
  /** Désactive ou réactive les boutons d'action pendant une requête. */
  setButtonsBusy(busy) { this.view?.setButtonsBusy(busy); }

  /** Met à jour l'interface de la popup selon le statut retourné par le watcher. */
  renderState(state) {
    const wasRunning = this.isWatcherRunning;
    this.isWatcherRunning = Boolean(state && state.running);
    this.view?.renderState(state, () => this.updateCommandPreview());
    if (wasRunning && !this.isWatcherRunning) this.loadWorkspaceFolders();
  }

  /** Enregistre les écouteurs d'événements sur les champs et boutons de la popup. */
  bindEvents() {
    const rootInput = this.getEl("rootDirInput");
    const targetSelect = this.getEl("targetDirSelect"), reloadFoldersBtn = this.getEl("reloadFoldersBtn");
    const testRunnerInput = this.getEl("testRunnerInput"), extraInput = this.getEl("extraArgsInput");
    rootInput?.addEventListener("input", () => { if (!this.isWatcherRunning) { chrome.storage.local.set({ savedRootDir: this.getCleanRootDir() }); this.updateCommandPreview(); this.scheduleWorkspaceFoldersReload(); } });
    targetSelect?.addEventListener("change", () => { if (!this.isWatcherRunning && targetSelect.value) { this.selectedTargetDir = targetSelect.value; chrome.storage.local.set({ savedTargetDir: this.selectedTargetDir }); this.updateCommandPreview(); } });
    reloadFoldersBtn?.addEventListener("click", () => { if (!this.isWatcherRunning) this.loadWorkspaceFolders(); });
    testRunnerInput?.addEventListener("input", () => { if (!this.isWatcherRunning) chrome.storage.local.set({ savedTestRunner: testRunnerInput.value.trim() || this.DEFAULT_TEST_RUNNER }); });
    extraInput?.addEventListener("input", () => { if (!this.isWatcherRunning) this.updateCommandPreview(); });
    this.bindCopyButton("copyPreviewBtn", "previewCommand");
    this.bindCopyButton("copyInstallBtn", "installCommandText");
    this.getEl("startBtn")?.addEventListener("click", () => {
      if (this.isWatcherRunning) return;
      this.showError(""); this.showInstallHelp(null); this.setButtonsBusy(true);
      const rootDir = this.getCleanRootDir(), targetDir = this.getCurrentTargetDir();
      const testRunner = (testRunnerInput?.value || "").trim() || this.DEFAULT_TEST_RUNNER, extraArgs = (extraInput?.value || "").trim();
      chrome.storage.local.set({ savedRootDir: rootDir, savedTargetDir: targetDir, savedTestRunner: testRunner, savedExtraArgs: extraArgs });
      chrome.runtime.sendMessage({ type: "START_WATCHER", targetDir, extraArgs }, (res) => {
        this.setButtonsBusy(false);
        if (!res || !res.ok) { const detail = (res && (res.error || res.response?.error)) || "Échec du lancement natif."; this.showError(`Erreur : ${detail}`); if (res?.missingHost) this.showInstallHelp(this.buildInstallCommand(rootDir)); }
        if (res?.state) this.renderState(res.state);
      });
    });
    this.getEl("stopBtn")?.addEventListener("click", () => { this.showError(""); this.showInstallHelp(null); this.setButtonsBusy(true); chrome.runtime.sendMessage({ type: "STOP_WATCHER" }, (state) => { this.setButtonsBusy(false); if (state) this.renderState(state); }); });
    this.getEl("refreshBtn")?.addEventListener("click", () => { this.showError(""); chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); }); });
  }

  /** Charge les préférences sauvegardées, interroge l'état et lance le rafraîchissement périodique. */
  init() {
    chrome.storage.local.get(["watchClipboardState", "savedRootDir", "savedTargetDir", "savedTestRunner", "savedExtraArgs"], (res) => {
      if (this.getEl("rootDirInput")) this.getEl("rootDirInput").value = res.savedRootDir || this.DEFAULT_ROOT_DIR;
      this.selectedTargetDir = (res.savedTargetDir || ".").trim() || ".";
      if (this.getEl("testRunnerInput")) this.getEl("testRunnerInput").value = res.savedTestRunner || this.DEFAULT_TEST_RUNNER;
      if (this.getEl("extraArgsInput")) this.getEl("extraArgsInput").value = res.savedExtraArgs || "";
      this.view?.renderWorkspaceFolders([], this.selectedTargetDir);
      this.updateCommandPreview();
      if (res.watchClipboardState) this.renderState(res.watchClipboardState);
      this.loadWorkspaceFolders();
    });
    chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); });
    const popupPoll = setInterval(() => chrome.runtime.sendMessage({ type: "REFRESH_STATUS" }, (state) => { if (state) this.renderState(state); }), 1000);
    window.addEventListener("unload", () => clearInterval(popupPoll));
    this.bindEvents();
  }
}
window.GmcPopupController = WatcherPopupController;
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => new WatcherPopupController().init());
