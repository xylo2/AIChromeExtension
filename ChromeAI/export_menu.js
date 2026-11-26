/**
 * Menu de sélection du type d'export, filtrage par dossiers et garde-fou de tokens.
 */
class ExportMenuManager {
  /** Initialise les modes d'export disponibles et le gestionnaire de budget associé. */
  constructor(budgetManager = null) {
    this.budget = budgetManager;
    this.menuEl = null;
    this.lastPreviewModes = {};
    this.MODES = [
      { id: "modified", label: "📝 Modifiés Git uniquement 🟢", hint: "Uniquement les fichiers modifiés/non suivis (économie maximale de tokens)" },
      { id: "skeleton", label: "🦴 Squelette / Signatures 🟢", hint: "Uniquement les imports et signatures (~85% plus léger)" },
      { id: "code", label: "💻 Code uniquement (sans tests) 🟡", hint: "Uniquement le code applicatif, sans les suites de tests" },
      { id: "tests", label: "🧪 Tests uniquement 🟡", hint: "Uniquement les suites de tests unitaires" },
      { id: "full", label: "📦 Export complet (code + tests) 🔴", hint: "Tous les fichiers sources et les tests (à réserver aux nouveaux chats)" }
    ];
  }

  /** Formate le badge de volume estimé en tokens et nombre de fichiers pour un mode. */
  formatTokenBadge(info) {
    if (!info || typeof info.tokens !== "number") return "";
    const tokStr = info.tokens >= 1000 ? `~${(info.tokens / 1000).toFixed(1)}k tok` : `~${info.tokens} tok`;
    return ` (${tokStr}${typeof info.files === "number" ? `, ${info.files} fic.` : ""})`;
  }

  /** Construit le message d'accompagnement envoyé avec le fichier d'export joint. */
  buildExportPrompt(mode, filename, fileCount, estTokens, subpaths = []) {
    const cleanMode = ["full", "code", "tests", "modified", "skeleton"].includes(mode) ? mode : "full";
    const tokInfo = estTokens > 0 ? ` (~${estTokens >= 1000 ? `${(estTokens / 1000).toFixed(1)}k` : estTokens} tokens)` : "";
    const countInfo = Number(fileCount) > 0 ? `, ${fileCount} fichier(s)` : "";
    const subInfo = Array.isArray(subpaths) && subpaths.length > 0 ? ` [Dossiers : ${subpaths.join(", ")}]` : "";
    const budgetWarn = estTokens > 45000 ? "\n⚠️ Contexte volumineux : répondre de façon concise (<= 75 lignes/bloc, max 2 blocs/réponse)." : "";
    const labels = {
      modified: "Export partiel : FICHIERS MODIFIÉS GIT UNIQUEMENT", code: "Export partiel : CODE UNIQUEMENT (sans les fichiers de tests)",
      skeleton: "Export partiel : SQUELETTE / SIGNATURES UNIQUEMENT", tests: "Export partiel : TESTS UNIQUEMENT", full: "Export COMPLET du projet (code + tests)"
    };
    return `Fichier joint (\x60${filename}\x60${countInfo}${tokInfo})${subInfo} — **${labels[cleanMode]}** :${budgetWarn}\nRappel : appliquer strictement INSTRUCTIONS_IA.md (<= 75 lignes/bloc, max 2 blocs/réponse, tests sans warning).`;
  }

  /** Ferme et détruit le panneau du menu d'export s'il est ouvert. */
  close() { if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; } }
  /** Interroge EXPORT_PREVIEW pour mettre à jour dynamiquement les estimations de tokens. */
  refreshDynamicEstimates(modeBtnsById, folderCheckboxes) {
    if (typeof chrome === "undefined" || !chrome.runtime?.id || typeof chrome.runtime.sendMessage !== "function") return;
    const checked = folderCheckboxes.filter((c) => c.checked).map((c) => c.dataset.folder);
    const subpaths = folderCheckboxes.length > 0 && checked.length < folderCheckboxes.length ? checked : [];
    const recMode = this.budget ? this.budget.getRecommendedExportMode() : "full";
    for (const item of this.MODES) { if (modeBtnsById[item.id]) modeBtnsById[item.id].textContent = `${item.id === recMode ? "⭐ " : ""}${item.label} (…)`; }
    try {
      chrome.runtime.sendMessage({ type: "EXPORT_PREVIEW", subpaths }, (res) => {
        this.lastPreviewModes = res?.ok && res.modes ? res.modes : {};
        for (const item of this.MODES) {
          const btn = modeBtnsById[item.id];
          if (btn) btn.textContent = `${item.id === recMode ? "⭐ " : ""}${item.label}${this.formatTokenBadge(this.lastPreviewModes[item.id])}`;
        }
      });
    } catch (_err) {}
  }

  /** Ouvre ou ferme le panneau de choix du périmètre et du mode d'export. */
  toggle(onSelectMode, folders = []) {
    if (this.menuEl) { this.close(); return; }
    const panel = document.createElement("div"); panel.className = "gmc-git-panel gmc-export-menu-panel";
    const header = document.createElement("div"); header.className = "gmc-git-panel-header"; header.textContent = "📦 Périmètre d'export (⭐ = recommandé pour ce chat)";
    const folderCheckboxes = [], modeBtnsById = {}, folderBox = document.createElement("div"); folderBox.className = "gmc-export-folders-box";
    if (Array.isArray(folders) && folders.length > 0) {
      const fTitle = document.createElement("div"); fTitle.className = "gmc-export-sublabel"; fTitle.textContent = "Dossiers à inclure :"; folderBox.appendChild(fTitle);
      const grid = document.createElement("div"); grid.className = "gmc-export-folders-grid";
      for (const dirName of folders) {
        const lbl = document.createElement("label"); lbl.className = "gmc-export-folder-chip";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.dataset.folder = dirName;
        cb.addEventListener("change", () => this.refreshDynamicEstimates(modeBtnsById, folderCheckboxes));
        folderCheckboxes.push(cb); lbl.append(cb, document.createTextNode(` ${dirName}`)); grid.appendChild(lbl);
      }
      folderBox.appendChild(grid);
    }
    const list = document.createElement("div"); list.className = "gmc-git-panel-list";
    for (const item of this.MODES) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "gmc-git-item-row gmc-export-mode-btn";
      btn.title = item.hint; btn.textContent = item.label; modeBtnsById[item.id] = btn;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const est = Number(this.lastPreviewModes?.[item.id]?.tokens || 0);
        if (this.budget?.shouldConfirmHeavyExport(est) && typeof window.confirm === "function" && !window.confirm(`Cet export pèse ~${(est / 1000).toFixed(1)}k tokens et risque de saturer la conversation.\nContinuer quand même ?`)) return;
        const checked = folderCheckboxes.filter((c) => c.checked).map((c) => c.dataset.folder);
        const subpaths = folderCheckboxes.length > 0 && checked.length < folderCheckboxes.length ? checked : [];
        this.close(); onSelectMode(item.id, subpaths);
      });
      list.appendChild(btn);
    }
    const actions = document.createElement("div"); actions.className = "gmc-git-panel-actions";
    const closeBtn = document.createElement("button"); closeBtn.type = "button"; closeBtn.className = "gmc-git-btn-close"; closeBtn.textContent = "Fermer"; closeBtn.addEventListener("click", () => this.close());
    actions.appendChild(closeBtn); panel.append(header, ...(folderCheckboxes.length > 0 ? [folderBox] : []), list, actions);
    document.body.appendChild(panel); this.menuEl = panel; this.refreshDynamicEstimates(modeBtnsById, folderCheckboxes);
  }
}
window.GmcExportMenuManager = ExportMenuManager;
