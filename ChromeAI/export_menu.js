/**
 * Menu de sélection du type d'export, filtrage par dossiers et prompt enrichi.
 */
class ExportMenuManager {
  constructor() {
    this.menuEl = null;
    this.MODES = [
      { id: "modified", label: "📝 Modifiés Git uniquement", hint: "Uniquement les fichiers modifiés/non suivis (économie maximale de tokens)" },
      { id: "code", label: "💻 Code uniquement (sans tests)", hint: "Uniquement le code applicatif, sans les dossiers/fichiers de tests" },
      { id: "skeleton", label: "🦴 Squelette / Signatures", hint: "Uniquement les imports et signatures de classes/fonctions" },
      { id: "tests", label: "🧪 Tests uniquement", hint: "Uniquement les suites de tests unitaires" },
      { id: "full", label: "📦 Export complet (code + tests)", hint: "Tous les fichiers sources et les tests unitaires" }
    ];
  }

  buildExportPrompt(mode, filename, fileCount, estTokens, subpaths = []) {
    const cleanMode = ["full", "code", "tests", "modified", "skeleton"].includes(mode) ? mode : "full";
    const tokInfo = estTokens > 0 ? ` (~${estTokens >= 1000 ? `${(estTokens / 1000).toFixed(1)}k` : estTokens} tokens)` : "";
    const countInfo = Number(fileCount) > 0 ? `, ${fileCount} fichier(s)` : "";
    const subInfo = Array.isArray(subpaths) && subpaths.length > 0 ? ` [Dossiers : ${subpaths.join(", ")}]` : "";
    const ruleHint = "\nRappel : appliquer strictement INSTRUCTIONS_IA.md (<= 75 lignes/bloc, max 2 blocs/réponse, tests sans warning).";
    const labels = {
      modified: "Export partiel : FICHIERS MODIFIÉS GIT UNIQUEMENT",
      code: "Export partiel : CODE UNIQUEMENT (sans les fichiers de tests)",
      skeleton: "Export partiel : SQUELETTE / SIGNATURES UNIQUEMENT",
      tests: "Export partiel : TESTS UNIQUEMENT",
      full: "Export COMPLET du projet (code + tests)"
    };
    return `Fichier joint (\x60${filename}\x60${countInfo}${tokInfo})${subInfo} — **${labels[cleanMode]}** :${ruleHint}`;
  }

  close() { if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; } }

  toggle(onSelectMode, folders = []) {
    if (this.menuEl) { this.close(); return; }
    const panel = document.createElement("div");
    panel.className = "gmc-git-panel gmc-export-menu-panel";
    const header = document.createElement("div");
    header.className = "gmc-git-panel-header";
    header.textContent = "📦 Choisir le périmètre de l'export";
    const folderCheckboxes = [];
    const folderBox = document.createElement("div");
    folderBox.className = "gmc-export-folders-box";
    if (Array.isArray(folders) && folders.length > 0) {
      const fTitle = document.createElement("div");
      fTitle.className = "gmc-export-sublabel";
      fTitle.textContent = "Dossiers à inclure :";
      folderBox.appendChild(fTitle);
      const grid = document.createElement("div");
      grid.className = "gmc-export-folders-grid";
      for (const dirName of folders) {
        const lbl = document.createElement("label");
        lbl.className = "gmc-export-folder-chip";
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = true; cb.dataset.folder = dirName;
        folderCheckboxes.push(cb);
        lbl.append(cb, document.createTextNode(` ${dirName}`));
        grid.appendChild(lbl);
      }
      folderBox.appendChild(grid);
    }
    const list = document.createElement("div");
    list.className = "gmc-git-panel-list";
    for (const item of this.MODES) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "gmc-git-item-row gmc-export-mode-btn";
      btn.title = item.hint; btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const checked = folderCheckboxes.filter((c) => c.checked).map((c) => c.dataset.folder);
        const subpaths = folderCheckboxes.length > 0 && checked.length < folderCheckboxes.length ? checked : [];
        this.close();
        onSelectMode(item.id, subpaths);
      });
      list.appendChild(btn);
    }
    const actions = document.createElement("div");
    actions.className = "gmc-git-panel-actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.className = "gmc-git-btn-close"; closeBtn.textContent = "Fermer";
    closeBtn.addEventListener("click", () => this.close());
    actions.appendChild(closeBtn);
    panel.append(header, ...(folderCheckboxes.length > 0 ? [folderBox] : []), list, actions);
    document.body.appendChild(panel);
    this.menuEl = panel;
  }
}
window.GmcExportMenuManager = ExportMenuManager;
