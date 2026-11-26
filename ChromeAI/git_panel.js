/** Panneau de sélection Git status, génération du diff, commit et push origin HEAD. */
class GitPanelManager {
  constructor(spillDetector, chatInjector, onVerifySubmitted = null) {
    this.spill = spillDetector; this.chat = chatInjector; this.onVerifySubmitted = onVerifySubmitted;
    this.uiHelper = window.GmcGitCommitUiHelper ? new window.GmcGitCommitUiHelper(chatInjector) : null;
    this.panelEl = null; this.lastValidatedFiles = [];
  }
  buildVerifyPrompt(selectedFiles, diffFilename) {
    const count = Array.isArray(selectedFiles) ? selectedFiles.length : 0;
    return `Analyse le diff complet joint dans \x60${diffFilename}\x60 (${count} fichier(s) sélectionné(s)).\n**Vérification du diff** : contrôle qu'il n'y a pas de problème (code supprimé par erreur, régression, troncature, secret ou fichier indésirable) et précise explicitement en une ou deux phrases si **tout va bien** ou s'il y a une anomalie (sans générer de message de commit).`;
  }
  buildCommitMessageOnlyPrompt() {
    return "Génère maintenant uniquement le **message de commit** correspondant aux modifications vérifiées ci-dessus, dans un bloc de code contenant \x60=== COMMIT_MESSAGE ===\x60 en toute première ligne (sans balise \x60=== FILE ===\x60), structuré avec un **Titre** Conventional Commits en français (apport fonctionnel) et un **Corps** décrivant l'apport fonctionnel puis les détails techniques (tests unitaires).";
  }
  buildCommitPrompt(selectedFiles, diffFilename) {
    const count = Array.isArray(selectedFiles) ? selectedFiles.length : 0;
    return `Analyse le diff complet joint dans \x60${diffFilename}\x60 (${count} fichier(s) sélectionné(s)).\n1. **Vérification du diff** : contrôle qu'il n'y a pas de problème et précise en une ou deux phrases si **tout va bien** ou s'il y a une anomalie.\n2. **Message de commit** : propose ensuite un bloc de code contenant \x60=== COMMIT_MESSAGE ===\x60 en toute première ligne suivi du message Conventional Commits en français (titre fonctionnel + corps fonctionnel et technique).`;
  }
  extractCommitMessage(pre) {
    const lines = this.spill.extractRawCode(pre).split("\n");
    if (lines.length > 0 && this.spill.COMMIT_TAG_REGEX.test(lines.at(0).trim())) lines.shift();
    if (lines.length > 0 && this.spill.END_FILE_REGEX.test(lines.at(-1).trim())) lines.pop();
    return lines.join("\n").trim();
  }
  extractPushErrorSummary(rawError) {
    const lines = String(rawError || "").split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.find((l) => /^(?:! \[|fatal:|error:|remote: error)/i.test(l)) || lines.at(0) || "Erreur git push";
  }
  close() { if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; } }
  toggle(entries) { if (this.panelEl) { this.close(); return; } this.open(entries); }
  open(entries) {
    this.close();
    const panel = document.createElement("div"); panel.className = "gmc-git-panel";
    const header = document.createElement("div"); header.className = "gmc-git-panel-header"; header.textContent = `🔀 Fichiers modifiés (${entries.length})`;
    const list = document.createElement("div"); list.className = "gmc-git-panel-list";
    const checkboxes = entries.map((entry) => {
      const row = document.createElement("label"); row.className = "gmc-git-item-row";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.dataset.path = entry.path;
      const code = document.createElement("span"); code.className = "gmc-git-status-code"; code.textContent = entry.status;
      const pathSpan = document.createElement("span"); pathSpan.className = "gmc-git-item-path"; pathSpan.textContent = entry.path;
      row.append(cb, code, pathSpan); list.appendChild(row); return cb;
    });
    const actions = document.createElement("div"); actions.className = "gmc-git-panel-actions";
    const closeBtn = document.createElement("button"); closeBtn.type = "button"; closeBtn.className = "gmc-git-btn-close"; closeBtn.textContent = "Fermer"; closeBtn.addEventListener("click", () => this.close());
    const verifyBtn = document.createElement("button"); verifyBtn.type = "button"; verifyBtn.className = "gmc-git-btn-verify"; verifyBtn.textContent = "🔍 Vérifier diff";
    const validateBtn = document.createElement("button"); validateBtn.type = "button"; validateBtn.className = "gmc-git-btn-validate"; validateBtn.textContent = "✅ Diff + Commit msg";
    verifyBtn.addEventListener("click", () => this.submitSelection(checkboxes, verifyBtn, [verifyBtn, validateBtn], "verify"));
    validateBtn.addEventListener("click", () => this.submitSelection(checkboxes, validateBtn, [verifyBtn, validateBtn], "commit"));
    actions.append(closeBtn, verifyBtn, validateBtn); panel.append(header, list, actions); document.body.appendChild(panel); this.panelEl = panel;
  }
  submitSelection(checkboxes, triggerBtn, actionBtns, mode) {
    const selected = checkboxes.filter((c) => c.checked).map((c) => c.dataset.path); if (selected.length === 0) return;
    this.lastValidatedFiles = [...selected]; if (chrome.storage?.local?.set) chrome.storage.local.set({ savedGitSelectedFiles: this.lastValidatedFiles });
    const origLabels = actionBtns.map((b) => b.textContent); actionBtns.forEach((b) => { b.disabled = true; }); triggerBtn.textContent = "⏳ Diff en cours...";
    chrome.runtime.sendMessage({ type: "GIT_DIFF_SELECTED", files: selected }, (res) => {
      if (!res?.ok) { actionBtns.forEach((b, i) => { b.disabled = false; b.textContent = origLabels.at(i); }); triggerBtn.textContent = "❌ Erreur diff"; return; }
      const diffName = res.filename || "git_changes.diff.txt", diffContent = String(res.content || res.diff || "");
      if (diffContent) this.chat.dropFile(diffName, diffContent, false);
      this.chat.insertPrompt(mode === "verify" ? this.buildVerifyPrompt(selected, diffName) : this.buildCommitPrompt(selected, diffName), { minDelayMs: 1800, maxWaitMs: 7500, waitForFile: diffContent ? diffName : "" });
      if (typeof this.onVerifySubmitted === "function") this.onVerifySubmitted(mode === "verify"); this.close();
    });
  }
  scanCommitBlocks() {
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.getAttribute("data-gmc-commit-processed") === "true" || pre.getAttribute("data-gmc-purged") === "true") continue;
      if (!this.spill.COMMIT_TAG_REGEX.test(this.spill.findFirstNonEmptyLine(this.spill.extractRawCode(pre)))) continue;
      pre.setAttribute("data-gmc-commit-processed", "true");
      const bar = document.createElement("div"); bar.className = "gmc-commit-action-bar";
      const commitBtn = document.createElement("button"); commitBtn.type = "button"; commitBtn.className = "gmc-git-commit-btn"; commitBtn.textContent = "📋✅ Copier & git commit";
      commitBtn.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation(); const msgText = this.extractCommitMessage(pre); if (!msgText || !this.uiHelper) return;
        const restoreScroll = this.uiHelper.captureScrollAnchor(bar); commitBtn.disabled = true; commitBtn.textContent = "⏳ Commit en cours...";
        try { await navigator.clipboard.writeText(msgText); } catch (_err) {} restoreScroll();
        let filesToCommit = this.lastValidatedFiles; if (filesToCommit.length === 0 && chrome.storage?.local?.get && chrome.runtime?.id) { try { filesToCommit = (await chrome.storage.local.get("savedGitSelectedFiles")).savedGitSelectedFiles || []; } catch (_e) {} }
        this.uiHelper.sendRuntimeSafe({ type: "GIT_COMMIT", message: msgText, files: filesToCommit }, (res) => {
          if (res?.ok) {
            this.lastValidatedFiles = []; if (chrome.storage?.local?.remove) chrome.storage.local.remove("savedGitSelectedFiles").catch?.(() => {});
            commitBtn.textContent = "✅ Commit effectué & copié"; commitBtn.classList.add("state-pass"); bar.querySelector(".gmc-git-error-box")?.remove();
            if (!bar.querySelector(".gmc-git-push-btn")) bar.appendChild(this.uiHelper.createPushButton(bar, this));
            if (!bar.querySelector(".gmc-git-fresh-export-btn")) { const fb = this.uiHelper.createFreshExportButton(); fb.classList.add("gmc-git-fresh-export-btn"); bar.appendChild(fb); }
          } else { commitBtn.disabled = false; commitBtn.textContent = "❌ Échec git commit"; commitBtn.classList.add("state-fail"); this.uiHelper.renderErrorBox(bar, "Détail de l'erreur git commit", res?.error || "Erreur git commit inconnue."); }
          restoreScroll();
        }, 30000);
      }); bar.appendChild(commitBtn); pre.parentNode.insertBefore(bar, pre.nextSibling);
    }
  }
}
window.GmcGitPanelManager = GitPanelManager;
