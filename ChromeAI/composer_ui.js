/**
 * Gestion du positionnement et de l'action contextuelle guidée près du compositeur.
 */
class ComposerQuickButtonsManager {
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

  pickExcuse() { return this.EXCUSES.at(Math.floor(Math.random() * this.EXCUSES.length)); }

  resolveGuidedAction({ watcherState, canCommitMsg, testsPassedForCurrentEvent = false }) {
    if (!watcherState?.running) return null;
    if (watcherState.hasSyntaxError) return { id: "fix_syntax", label: "🚨 Corriger syntaxe", title: "Envoyer l'erreur de syntaxe à l'IA" };
    if (canCommitMsg) return { id: "commit_msg", label: "💬 Générer commit", title: "Demander le message de commit à l'IA" };
    if (!testsPassedForCurrentEvent && watcherState.hasRunTestsClip && /^\[(?:OK|COMPLET)\]/.test(String(watcherState.lastEvent || ""))) {
      return { id: "run_tests", label: "🧪 Vérifier tests", title: "Lancer les tests unitaires sur le fichier assemblé" };
    }
    return null;
  }

  hasStartedConversation() {
    if (document.querySelector("[data-aim-turn], [data-turn-id], message-content, model-response, user-query, .conversation-container")) return true;
    const inputEl = this.chat.findChatInputElement();
    return Boolean(inputEl && this.isBottomComposer(inputEl));
  }

  attachToFloatingBar() {
    this.groupEl.classList.remove("gmc-composer-below");
    if (this.groupEl.parentElement !== this.bottomRow || this.groupEl.nextSibling !== this.exportBtn) {
      this.bottomRow.insertBefore(this.groupEl, this.exportBtn);
    }
  }

  isBottomComposer(inputEl) {
    if (!inputEl || inputEl.closest('form[action="/search"], [role="search"]')) return false;
    if (typeof inputEl.getBoundingClientRect !== "function") return true;
    const rect = inputEl.getBoundingClientRect();
    const viewH = window.innerHeight || 0;
    return rect.height > 0 && (viewH === 0 || rect.top >= viewH * 0.45);
  }

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
