/**
 * Menu de sélection du type d'export (complet, code sans tests, tests uniquement)
 * et génération du prompt informant l'IA du périmètre exact joint.
 */
class ExportMenuManager {
  constructor() {
    this.menuEl = null;
    this.MODES = [
      { id: "full", label: "📦 Export complet (code + tests)", hint: "Tous les fichiers sources et les tests unitaires" },
      { id: "code", label: "💻 Code uniquement (sans tests)", hint: "Uniquement le code applicatif, sans les dossiers/fichiers de tests" },
      { id: "tests", label: "🧪 Tests uniquement", hint: "Uniquement les suites de tests unitaires" }
    ];
  }

  buildExportPrompt(mode, filename, fileCount, estTokens) {
    const cleanMode = ["full", "code", "tests"].includes(mode) ? mode : "full";
    const tokInfo = estTokens > 0 ? ` (~${estTokens >= 1000 ? `${(estTokens / 1000).toFixed(1)}k` : estTokens} tokens)` : "";
    const countInfo = Number(fileCount) > 0 ? `, ${fileCount} fichier(s)` : "";
    if (cleanMode === "code") {
      return `Fichier joint (\x60${filename}\x60${countInfo}${tokInfo}) — **Export partiel : CODE UNIQUEMENT (sans les fichiers de tests)**.\nLes dossiers et fichiers de tests ont été volontairement exclus de cet export pour économiser le contexte.`;
    }
    if (cleanMode === "tests") {
      return `Fichier joint (\x60${filename}\x60${countInfo}${tokInfo}) — **Export partiel : TESTS UNIQUEMENT**.\nSeuls les fichiers de tests unitaires sont inclus dans cet export (le code applicatif n'est pas joint).`;
    }
    return `Fichier joint (\x60${filename}\x60${countInfo}${tokInfo}) — **Export COMPLET du projet (code + tests)** :`;
  }

  close() {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }

  toggle(onSelectMode) {
    if (this.menuEl) {
      this.close();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "gmc-git-panel gmc-export-menu-panel";
    const header = document.createElement("div");
    header.className = "gmc-git-panel-header";
    header.textContent = "📦 Choisir le périmètre de l'export";
    const list = document.createElement("div");
    list.className = "gmc-git-panel-list";
    for (const item of this.MODES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gmc-git-item-row gmc-export-mode-btn";
      btn.title = item.hint;
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
        onSelectMode(item.id);
      });
      list.appendChild(btn);
    }
    const actions = document.createElement("div");
    actions.className = "gmc-git-panel-actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gmc-git-btn-close";
    closeBtn.textContent = "Fermer";
    closeBtn.addEventListener("click", () => this.close());
    actions.appendChild(closeBtn);
    panel.append(header, list, actions);
    document.body.appendChild(panel);
    this.menuEl = panel;
  }
}
window.GmcExportMenuManager = ExportMenuManager;
