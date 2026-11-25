/**
 * Panneau de sélection Git status, génération du diff, commit et push origin HEAD.
 */
class GitPanelManager {
  constructor(spillDetector, chatInjector) {
    this.spill = spillDetector;
    this.chat = chatInjector;
    this.uiHelper = window.GmcGitCommitUiHelper ? new window.GmcGitCommitUiHelper(chatInjector) : null;
    this.panelEl = null;
    this.lastValidatedFiles = [];
  }

  buildVerifyPrompt(selectedFiles, diffFilename) {
    const count = Array.isArray(selectedFiles) ? selectedFiles.length : 0;
    return [
      `Analyse le diff complet joint dans \x60${diffFilename}\x60 (${count} fichier(s) sélectionné(s)).`,
      "**Vérification du diff** : contrôle qu'il n'y a pas de problème (code supprimé par erreur, régression, troncature, secret ou fichier indésirable) et précise explicitement en une ou deux phrases si **tout va bien** ou s'il y a une anomalie (sans générer de message de commit)."
    ].join("\n");
  }

  buildCommitPrompt(selectedFiles, diffFilename) {
    const count = Array.isArray(selectedFiles) ? selectedFiles.length : 0;
    return [
      `Analyse le diff complet joint dans \x60${diffFilename}\x60 (${count} fichier(s) sélectionné(s)).`,
      "1. **Vérification du diff** : contrôle qu'il n'y a pas de problème (code supprimé par erreur, régression, troncature, secret ou fichier indésirable) et précise explicitement en une ou deux phrases si **tout va bien** ou s'il y a une anomalie.",
      "2. **Message de commit** : propose ensuite un bloc de code contenant `=== COMMIT_MESSAGE ===` en toute première ligne (sans balise `=== FILE ===`), suivi directement du message de commit prêt à être exécuté structuré ainsi :",
      "   - **Titre** : format Conventional Commits en français, concis, expliquant **fonctionnellement** ce qui a été fait.",
      "   - **Corps (en dessous, après une ligne vide)** : si pertinent, 2 ou 3 lignes supplémentaires décrivant l'apport **fonctionnel**, suivies de quelques puces concises avec les détails **techniques** (composants modifiés, impacts Git, mention des tests unitaires)."
    ].join("\n");
  }

  close() {
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }

  toggle(entries) {
    if (this.panelEl) { this.close(); return; }
    this.open(entries);
  }

  submitSelection(checkboxes, triggerBtn, actionBtns, mode) {
    const selected = checkboxes.filter((c) => c.checked).map((c) => c.dataset.path);
    if (selected.length === 0) return;
    this.lastValidatedFiles = [...selected];
    if (chrome.storage?.local) chrome.storage.local.set({ savedGitSelectedFiles: this.lastValidatedFiles });
    const origLabels = actionBtns.map((b) => b.textContent);
    actionBtns.forEach((b) => { b.disabled = true; });
    triggerBtn.textContent = "⏳ Diff en cours...";
    chrome.runtime.sendMessage({ type: "GIT_DIFF_SELECTED", files: selected }, (res) => {
      if (!res?.ok) {
        actionBtns.forEach((b, i) => { b.disabled = false; b.textContent = origLabels.at(i); });
        triggerBtn.textContent = "❌ Erreur diff";
        return;
      }
      const diffName = res.filename || "git_changes.diff.txt";
      const diffContent = String(res.content || res.diff || "");
      if (diffContent) this.chat.dropFile(diffName, diffContent, false);
      const prompt = mode === "verify" ? this.buildVerifyPrompt(selected, diffName) : this.buildCommitPrompt(selected, diffName);
      this.chat.insertPrompt(prompt, { minDelayMs: 1800, maxWaitMs: 7500, waitForFile: diffContent ? diffName : "" });
      this.close();
    });
  }
  open(entries) {
    this.close();
    const panel = document.createElement("div");
    panel.className = "gmc-git-panel";
    const header = document.createElement("div");
    header.className = "gmc-git-panel-header";
    header.textContent = `Fichiers modifiés (${entries.length}) — Cochez ceux à inclure :`;
    const listEl = document.createElement("div");
    listEl.className = "gmc-git-panel-list";
    const checkboxes = [];
    for (const entry of entries) {
      const row = document.createElement("label");
      row.className = "gmc-git-item-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.path = entry.path;
      checkboxes.push(cb);
      const badge = document.createElement("span");
      badge.className = "gmc-git-status-code";
      badge.textContent = entry.status || "M";
      const pathSpan = document.createElement("span");
      pathSpan.className = "gmc-git-item-path";
      pathSpan.textContent = entry.path;
      row.append(cb, badge, pathSpan);
      listEl.appendChild(row);
    }
    const actions = document.createElement("div");
    actions.className = "gmc-git-panel-actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gmc-git-btn-close";
    closeBtn.textContent = "Fermer";
    closeBtn.addEventListener("click", () => this.close());
    const verifyBtn = document.createElement("button");
    verifyBtn.type = "button";
    verifyBtn.className = "gmc-git-btn-verify";
    verifyBtn.textContent = "Soumettre pour vérification";
    const commitBtn = document.createElement("button");
    commitBtn.type = "button";
    commitBtn.className = "gmc-git-btn-validate";
    commitBtn.textContent = "Soumettre pour commit";
    verifyBtn.addEventListener("click", () => this.submitSelection(checkboxes, verifyBtn, [verifyBtn, commitBtn], "verify"));
    commitBtn.addEventListener("click", () => this.submitSelection(checkboxes, commitBtn, [verifyBtn, commitBtn], "commit"));
    actions.append(closeBtn, verifyBtn, commitBtn);
    panel.append(header, listEl, actions);
    document.body.appendChild(panel);
    this.panelEl = panel;
  }

  extractCommitMessage(preEl) {
    const raw = this.spill.extractRawCode(preEl);
    const lines = raw.split("\n");
    const first = lines.at(0) ? lines.at(0).trim() : "";
    return this.spill.COMMIT_TAG_REGEX.test(first) ? lines.slice(1).join("\n").trim() : raw;
  }

  extractPushErrorSummary(fullErr) {
    const lines = String(fullErr || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return "erreur git";
    return lines.find((l) => /^(?:fatal:|error:|!\s*\[|remote:\s*error|permission denied)/i.test(l)) || lines.at(0);
  }

  scanCommitBlocks() {
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.getAttribute("data-gmc-commit-processed") === "true" || pre.getAttribute("data-gmc-purged") === "true") continue;
      if (!this.spill.COMMIT_TAG_REGEX.test(this.spill.findFirstNonEmptyLine(this.spill.extractRawCode(pre)))) continue;
      pre.setAttribute("data-gmc-commit-processed", "true");
      const bar = document.createElement("div");
      bar.className = "gmc-commit-action-bar";
      const commitBtn = document.createElement("button");
      commitBtn.type = "button";
      commitBtn.className = "gmc-git-commit-btn";
      commitBtn.textContent = "📋✅ Copier & git commit";
      commitBtn.title = "Copie le message de commit suggéré et exécute git commit";
      commitBtn.addEventListener("click", async () => {
        const msgText = this.extractCommitMessage(pre);
        if (!msgText || !this.uiHelper) return;
        commitBtn.disabled = true;
        commitBtn.textContent = "⏳ Commit en cours...";
        try { await navigator.clipboard.writeText(msgText); } catch (_err) {}
        let filesToCommit = this.lastValidatedFiles;
        if (filesToCommit.length === 0 && chrome.storage?.local && chrome.runtime?.id) {
          try { filesToCommit = (await chrome.storage.local.get("savedGitSelectedFiles")).savedGitSelectedFiles || []; } catch (_e) {}
        }
        this.uiHelper.sendRuntimeSafe({ type: "GIT_COMMIT", message: msgText, files: filesToCommit }, (res) => {
          if (res?.ok) {
            this.lastValidatedFiles = [];
            if (chrome.storage?.local) chrome.storage.local.remove("savedGitSelectedFiles").catch?.(() => {});
            commitBtn.textContent = "✅ Commit effectué & copié";
            commitBtn.classList.add("state-pass");
            bar.querySelector(".gmc-git-error-box")?.remove();
            if (!bar.querySelector(".gmc-git-push-btn")) bar.appendChild(this.uiHelper.createPushButton(bar, this));
          } else {
            commitBtn.disabled = false;
            commitBtn.textContent = "❌ Échec git commit";
            commitBtn.classList.add("state-fail");
            this.uiHelper.renderErrorBox(bar, "Détail de l'erreur git commit", res?.error || "Erreur git commit inconnue.");
          }
        }, 30000);
      });
      bar.appendChild(commitBtn);
      pre.parentNode.insertBefore(bar, pre.nextSibling);
    }
  }
}
window.GmcGitPanelManager = GitPanelManager;
