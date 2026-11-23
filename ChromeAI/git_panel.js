/**
 * Panneau de sélection Git status, génération du diff, commit et push origin HEAD.
 */
class GitPanelManager {
  constructor(spillDetector, chatInjector) {
    this.spill = spillDetector;
    this.chat = chatInjector;
    this.panelEl = null;
    this.lastValidatedFiles = [];
  }

  buildCommitPrompt(selectedFiles, diffFilename) {
    const fileList = selectedFiles.map((f) => `- ${f}`).join("\n");
    return [
      `Rédige un message de commit Git clair et concis en français (Conventional Commits) pour toutes les modifications apportées depuis le dernier commit sur les fichiers sélectionnés ci-dessous (diff complet joint dans \x60${diffFilename}\x60) :`,
      fileList,
      "",
      "Réponds **uniquement** avec un bloc de code contenant `=== COMMIT_MESSAGE ===` en toute première ligne (sans balise `=== FILE ===`), suivi directement du message de commit prêt à être exécuté."
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

    const validateBtn = document.createElement("button");
    validateBtn.type = "button";
    validateBtn.className = "gmc-git-btn-validate";
    validateBtn.textContent = "Valider la sélection (→ IA)";
    validateBtn.addEventListener("click", () => {
      const selected = checkboxes.filter((c) => c.checked).map((c) => c.dataset.path);
      if (selected.length === 0) return;
      this.lastValidatedFiles = [...selected];
      if (chrome.storage?.local) chrome.storage.local.set({ savedGitSelectedFiles: this.lastValidatedFiles });
      validateBtn.disabled = true;
      validateBtn.textContent = "⏳ Diff en cours...";
      chrome.runtime.sendMessage({ type: "GIT_DIFF_SELECTED", files: selected }, (res) => {
        if (!res?.ok) { validateBtn.disabled = false; validateBtn.textContent = "❌ Erreur diff"; return; }
        const diffName = res.filename || "git_changes.diff.txt";
        if (res.content) this.chat.dropFile(diffName, res.content, false);
        this.chat.insertPrompt(this.buildCommitPrompt(selected, diffName), { minDelayMs: 1100, maxWaitMs: 5000 });
        this.close();
      });
    });

    actions.append(closeBtn, validateBtn);
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
    const keyLine = lines.find((l) => /^(?:fatal:|error:|!\s*\[|remote:\s*error|permission denied)/i.test(l));
    return keyLine || lines.at(0);
  }

  renderGitErrorBox(bar, titleText, fullErrorText) {
    let box = bar.querySelector(".gmc-git-error-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "gmc-git-error-box";
      bar.appendChild(box);
    }
    box.innerHTML = "";
    const topRow = document.createElement("div");
    topRow.className = "gmc-git-error-header";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = `❌ ${titleText}`;

    const btnGroup = document.createElement("div");
    btnGroup.className = "gmc-git-error-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "gmc-git-error-btn";
    copyBtn.textContent = "📋 Copier l'erreur";
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(fullErrorText); } catch (_err) {}
      copyBtn.textContent = "✅ Copié !";
      setTimeout(() => { copyBtn.textContent = "📋 Copier l'erreur"; }, 1400);
    });

    const askAiBtn = document.createElement("button");
    askAiBtn.type = "button";
    askAiBtn.className = "gmc-git-error-btn";
    askAiBtn.textContent = "→ Envoyer à l'IA";
    askAiBtn.addEventListener("click", () => {
      if (this.chat) {
        const prompt = `Voici l'erreur Git rencontrée (${titleText}) :\n` + "\x60\x60\x60text\n" + fullErrorText + "\n\x60\x60\x60\nComment la résoudre ?\n";
        this.chat.insertPrompt(prompt, true);
      }
    });

    btnGroup.append(copyBtn, askAiBtn);
    topRow.append(titleSpan, btnGroup);

    const preDetail = document.createElement("pre");
    preDetail.className = "gmc-git-error-detail";
    preDetail.textContent = String(fullErrorText || "Erreur inconnue.");

    box.append(topRow, preDetail);
  }

  createPushButton(bar) {
    const pushBtn = document.createElement("button");
    pushBtn.type = "button";
    pushBtn.className = "gmc-git-push-btn";
    pushBtn.textContent = "🚀 git push origin HEAD";
    pushBtn.title = "Pousse la branche courante vers origin";
    pushBtn.addEventListener("click", () => {
      pushBtn.disabled = true;
      pushBtn.classList.remove("state-fail", "state-pass");
      pushBtn.textContent = "⏳ Push en cours...";
      chrome.runtime.sendMessage({ type: "GIT_PUSH", remote: "origin", branch: "HEAD" }, async (res) => {
        if (res?.ok) {
          pushBtn.textContent = "✅ Push origin OK";
          pushBtn.title = res.output || "Push effectué";
          pushBtn.classList.add("state-pass");
          const oldErr = bar.querySelector(".gmc-git-error-box");
          if (oldErr) oldErr.remove();
        } else {
          const fullErr = res?.error || "Erreur git push (aucun détail reçu du serveur local).";
          const shortErr = this.extractPushErrorSummary(fullErr);
          try { await navigator.clipboard.writeText(fullErr); } catch (_err) {}
          pushBtn.disabled = false;
          pushBtn.textContent = `❌ ${shortErr.slice(0, 75)}`;
          pushBtn.classList.add("state-fail");
          this.renderGitErrorBox(bar, "Détail de l'erreur git push", fullErr);
        }
      });
    });
    return pushBtn;
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
        if (!msgText) return;
        commitBtn.disabled = true;
        commitBtn.textContent = "⏳ Commit en cours...";
        try { await navigator.clipboard.writeText(msgText); } catch (_err) {}
        const stored = chrome.storage?.local ? await chrome.storage.local.get("savedGitSelectedFiles") : {};
        const filesToCommit = this.lastValidatedFiles.length > 0 ? this.lastValidatedFiles : (stored.savedGitSelectedFiles || []);
        chrome.runtime.sendMessage({ type: "GIT_COMMIT", message: msgText, files: filesToCommit }, (res) => {
          if (res?.ok) {
            commitBtn.textContent = "✅ Commit effectué & copié";
            commitBtn.classList.add("state-pass");
            const oldErr = bar.querySelector(".gmc-git-error-box");
            if (oldErr) oldErr.remove();
            if (!bar.querySelector(".gmc-git-push-btn")) bar.appendChild(this.createPushButton(bar));
          } else {
            const fullErr = res?.error || "Erreur git commit inconnue.";
            commitBtn.disabled = false;
            commitBtn.textContent = "❌ Échec git commit";
            commitBtn.classList.add("state-fail");
            this.renderGitErrorBox(bar, "Détail de l'erreur git commit", fullErr);
          }
        });
      });
      bar.appendChild(commitBtn);
      pre.parentNode.insertBefore(bar, pre.nextSibling);
    }
  }
}
window.GmcGitPanelManager = GitPanelManager;
