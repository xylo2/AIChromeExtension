/**
 * Gestion du positionnement et de l'action contextuelle guidée près du compositeur.
 */
class ComposerQuickButtonsManager {
  /** Initialise la liste d'excuses et le conteneur des boutons rapides. */
  constructor(chatInjector, bottomRow, exportBtn) {
    this.chat = chatInjector;
    this.bottomRow = bottomRow;
    this.exportBtn = exportBtn;
    this.EXCUSES = [
      "Ça marchait pourtant sur ma branche avant le rebase quantique.",
      "Ce n'est pas un bug, c'est une fonctionnalité non documentée en phase bêta.",
      "Le cache du presse-papiers a décidé de prendre sa pause café.",
      "Les rayons cosmiques ont dû inverser un bit dans le service worker.",
      "C'est un comportement nominal sous un alignement défavorable de Saturne.",
      "Chez moi ça compile, le problème vient sûrement de la gravité locale.",
      "J'avais prévu de corriger ça juste après la conquête du monde."
    ];
    this.groupEl = document.createElement("div");
    this.groupEl.className = "gmc-composer-quick-group";
  }

  /** Tire aléatoirement une excuse humoristique de développeur. */
  pickExcuse() { return this.EXCUSES.at(Math.floor(Math.random() * this.EXCUSES.length)); }

  /** Détermine l'action prioritaire suggérée selon l'état du watcher et des tests. */
  resolveGuidedAction({ watcherState, canCommitMsg, testsPassedForCurrentEvent = false, failedTestsCount = 0 }) {
    if (!watcherState?.running) return null;
    if (watcherState.hasSyntaxError) return { id: "fix_syntax", label: "🚨 Corriger syntaxe", title: "Envoyer l'erreur de syntaxe à l'IA" };
    if (canCommitMsg) return { id: "commit_msg", label: "💬 Générer commit", title: "Demander le message de commit à l'IA" };
    const isFileAssembled = /^\[(?:OK|COMPLET)\]/.test(String(watcherState.lastEvent || ""));
    if (!testsPassedForCurrentEvent && watcherState.hasRunTestsClip && isFileAssembled) {
      if (Number(failedTestsCount) > 0) {
        return {
          id: "rerun_failed",
          label: `🎯 Relancer KO (${failedTestsCount})`,
          title: "Relancer uniquement les tests qui ont échoué lors de la dernière exécution"
        };
      }
      return { id: "run_tests", label: "🧪 Vérifier tests", title: "Lancer les tests unitaires sur le fichier assemblé" };
    }
    return null;
  }

  /** Indique si la conversation AI est démarrée ou si le compositeur est en bas de page. */
  hasStartedConversation() {
    if (document.querySelector("[data-scope-id='turn'], [data-aim-turn], [data-turn-id], message-content, model-response, user-query, .conversation-container")) return true;
    const inputEl = this.chat.findChatInputElement();
    return Boolean(inputEl && this.isBottomComposer(inputEl));
  }
  /** Insère le groupe de boutons rapides dans la barre flottante en repli. */
  attachToFloatingBar() {
    this.groupEl.classList.remove("gmc-composer-below");
    if (this.groupEl.parentElement !== this.bottomRow || this.groupEl.nextSibling !== this.exportBtn) {
      this.bottomRow.insertBefore(this.groupEl, this.exportBtn);
    }
  }

  /** Vérifie que le champ de saisie appartient bien au compositeur inférieur du chat. */
  isBottomComposer(inputEl) {
    if (!inputEl || inputEl.closest('form[action="/search"], [role="search"]')) return false;
    if (typeof inputEl.getBoundingClientRect !== "function") return true;
    const rect = inputEl.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    if (rect.height === 0 && document.hidden) return true;
    return rect.height > 0 && (viewH === 0 || rect.top >= viewH * 0.45);
  }

  /** Monte ou replace les boutons rapides près du bouton + du compositeur actif. */
  mount() {
    document.querySelectorAll(".gmc-composer-quick-group").forEach((el) => { if (el !== this.groupEl) el.remove(); });
    if (!this.hasStartedConversation()) { if (this.groupEl.parentElement) this.groupEl.remove(); return; }
    this.groupEl.style.display = "inline-flex";
    const inputEl = this.chat.findChatInputElement();
    if (!this.isBottomComposer(inputEl)) { this.attachToFloatingBar(); return; }
    let box = inputEl.parentElement;
    for (let depth = 0; depth < 7 && box; depth++) {
      const plusBtn = Array.from(box.querySelectorAll("button, [role='button']")).find((btn) => {
        if (btn.closest(".gmc-composer-quick-group") || String(btn.className || "").includes("gmc-")) return false;
        const meta = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.textContent || ""}`.toLowerCase();
        return meta.includes("ajouter") || meta.includes("importer") || meta.includes("plus") || meta.includes("upload") || btn.textContent.trim() === "+";
      });
      if (plusBtn?.parentElement && box.contains(plusBtn)) {
        let anchor = plusBtn;
        while (anchor.parentElement && anchor.parentElement !== box && anchor.parentElement.children.length <= 2 && !anchor.parentElement.contains(inputEl)) anchor = anchor.parentElement;
        const rowContainer = anchor.parentElement, siblingInputBox = anchor.nextElementSibling;
        if (siblingInputBox && siblingInputBox.contains(inputEl) && box.parentElement) {
          if (this.groupEl.parentElement !== box.parentElement || box.nextSibling !== this.groupEl) { this.groupEl.classList.add("gmc-composer-below"); box.parentElement.insertBefore(this.groupEl, box.nextSibling); }
          return;
        }
        if (rowContainer && (this.groupEl.parentElement !== rowContainer || anchor.nextSibling !== this.groupEl)) { this.groupEl.classList.remove("gmc-composer-below"); rowContainer.insertBefore(this.groupEl, anchor.nextSibling); }
        return;
      }
      box = box.parentElement;
    }
    this.attachToFloatingBar();
  }
}
window.GmcComposerQuickButtonsManager = ComposerQuickButtonsManager;
