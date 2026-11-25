/**
 * Rendu DOM et gestion des interactions visuelles de la popup ChromeAI.
 */
class WatcherPopupView {
  constructor(configInputIds) {
    this.CONFIG_INPUT_IDS = configInputIds;
  }

  getEl(id) { return document.getElementById(id); }

  setConfigInputsLocked(locked) {
    const isLocked = Boolean(locked);
    for (const id of this.CONFIG_INPUT_IDS) {
      const inputEl = this.getEl(id);
      if (inputEl) {
        inputEl.disabled = isLocked;
        inputEl.title = isLocked ? "Arrêtez watch_clipboard avant de modifier ce paramètre." : "";
      }
    }
    const notice = this.getEl("configLockNotice");
    if (notice) notice.style.display = isLocked ? "block" : "none";
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

  renderState(state, onSavedRootLoaded) {
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
      if (this.getEl("activeTargetDir")) this.getEl("activeTargetDir").textContent = state.targetDir || "-";
      if (this.getEl("pid")) this.getEl("pid").textContent = state.pid ? String(state.pid) : "-";
      if (startBtn) startBtn.style.display = "none";
      if (stopBtn) stopBtn.style.display = "block";
      this.showInstallHelp(null);
      chrome.storage.local.get("savedRootDir", (res) => {
        if (res.savedRootDir && this.getEl("rootDirInput")) {
          this.getEl("rootDirInput").value = res.savedRootDir;
          onSavedRootLoaded();
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
}
window.GmcPopupView = WatcherPopupView;
