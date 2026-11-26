/**
 * Injection de prompts et délégation des pièces jointes dans la zone de saisie du chat.
 */
class ChatInjector {
  /** Initialise le marqueur triple backtick et le gestionnaire de pièces jointes. */
  constructor() {
    this.TRIPLE_BACKTICK = "\x60\x60\x60";
    this.attacher = window.GmcChatFileAttacher ? new window.GmcChatFileAttacher(this) : null;
  }

  /** Retourne le nom de la pièce jointe en attente de validation dans le DOM. */
  get pendingAttachmentName() { return this.attacher ? this.attacher.pendingAttachmentName : ""; }
  /** Définit le nom de la pièce jointe en attente de chargement. */
  set pendingAttachmentName(v) { if (this.attacher) this.attacher.pendingAttachmentName = v; }
  /** Retourne le nombre initial de puces de fichiers avant l'ajout courant. */
  get baselineAttachmentCount() { return this.attacher ? this.attacher.baselineAttachmentCount : 0; }
  /** Mémorise le compteur initial de puces de fichiers dans le compositeur. */
  set baselineAttachmentCount(v) { if (this.attacher) this.attacher.baselineAttachmentCount = v; }

  /** Vérifie qu'un élément DOM est connecté, visible et possède une surface non nulle. */
  isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  /** Recherche tous les nœuds correspondant au sélecteur, y compris dans les Shadow DOM. */
  queryDeepAll(selector, root = document) {
    const results = Array.from(root.querySelectorAll(selector));
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) results.push(...this.queryDeepAll(selector, host.shadowRoot));
    }
    return results;
  }

  /** Localise la zone de saisie active du chat en privilégiant le compositeur inférieur. */
  findChatInputElement() {
    const selectors = [
      'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][role="combobox"]', 'div[contenteditable="true"][aria-label*="question" i]',
      'div[contenteditable="true"][aria-label*="poser" i]', 'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="message" i]', 'textarea[aria-label*="question" i]',
      'textarea[placeholder*="question" i]', 'div[contenteditable="true"]', "textarea"
    ];
    let fallbackEl = null;
    for (const sel of selectors) {
      const matches = this.queryDeepAll(sel);
      for (let idx = matches.length - 1; idx >= 0; idx--) {
        const el = matches.at(idx);
        if (!el || el.disabled || el.readOnly || el.closest(".gmc-floating-bar") || !this.isElementVisible(el)) continue;
        if (el.getBoundingClientRect().top >= window.innerHeight * 0.25) return el;
        if (!fallbackEl) fallbackEl = el;
      }
    }
    return fallbackEl;
  }
  /** Recherche le bouton d'envoi actif associé à la zone de saisie. */
  findSubmitButton(inputEl) {
    const keywords = ["envoyer", "send", "submit", "valider", "ask", "poser", "rechercher"];
    const matchesBtn = (btn) => {
      if (!btn || (btn.className && String(btn.className).includes("gmc-"))) return false;
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true" || !this.isElementVisible(btn)) return false;
      if (btn.getAttribute("type") === "submit") return true;
      const meta = [btn.getAttribute("aria-label") || "", btn.getAttribute("title") || "", btn.getAttribute("data-testid") || "", btn.textContent || ""].join(" ").toLowerCase();
      return keywords.some((kw) => meta.includes(kw));
    };
    let container = inputEl ? inputEl.parentElement : document.body;
    for (let depth = 0; depth < 8 && container; depth++) {
      for (const btn of this.queryDeepAll("button, [role='button']", container)) { if (matchesBtn(btn)) return btn; }
      container = container.parentElement;
    }
    const allButtons = this.queryDeepAll("button, [role='button']");
    for (let idx = allButtons.length - 1; idx >= 0; idx--) { if (matchesBtn(allButtons.at(idx))) return allButtons.at(idx); }
    return null;
  }

  /** Délègue la détection du conteneur du compositeur. */
  findComposerContainer(inputEl) { return this.attacher ? this.attacher.findComposerContainer(inputEl) : document.body; }
  /** Délègue le comptage des puces de pièces jointes. */
  countAttachmentChips(container) { return this.attacher ? this.attacher.countAttachmentChips(container) : 0; }
  /** Délègue la vérification de disponibilité d'une pièce jointe. */
  isAttachmentReady(inputEl, filename) { return this.attacher ? this.attacher.isAttachmentReady(inputEl, filename) : true; }
  /** Délègue la sélection d'un champ input[type="file"] compatible texte. */
  selectCompatibleFileInput(fileInputs) { return this.attacher ? this.attacher.selectCompatibleFileInput(fileInputs) : null; }
  /** Délègue l'ajout d'un fichier texte virtuel dans le compositeur. */
  dropFile(filename, textContent, autoSubmit = true) { return this.attacher ? this.attacher.dropFile(filename, textContent, autoSubmit) : false; }
  /** Extrait le texte nettoyé actuellement saisi dans le champ de chat. */
  getInputText(inputEl) { return !inputEl ? "" : (inputEl.tagName === "TEXTAREA" ? inputEl.value : inputEl.textContent || "").trim(); }
  /** Donne le focus à l'élément sans provoquer de défilement automatique de la page. */
  focusWithoutScroll(el) { if (el && typeof el.focus === "function") { try { el.focus({ preventScroll: true }); } catch (_e) { el.focus(); } } }

  /** Soumet le message via le bouton d'envoi ou l'événement clavier Entrée. */
  submitChatBox(inputEl) {
    const targetInput = inputEl || this.findChatInputElement();
    if (!targetInput) return false;
    const submitBtn = this.findSubmitButton(targetInput);
    if (submitBtn) { submitBtn.click(); return true; }
    if (this.getInputText(targetInput) === "") return false;
    this.focusWithoutScroll(targetInput);
    const enterInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    targetInput.dispatchEvent(new KeyboardEvent("keydown", enterInit));
    targetInput.dispatchEvent(new KeyboardEvent("keypress", enterInit));
    targetInput.dispatchEvent(new KeyboardEvent("keyup", enterInit));
    return true;
  }

  /** Attend l'activation du bouton d'envoi et le chargement de la pièce jointe avant soumission. */
  waitAndSubmit(inputEl, minDelayMs = 600, maxWaitMs = 4000, waitForFile = "") {
    const startedAt = Date.now();
    const expectedFile = waitForFile || this.pendingAttachmentName;
    let clickedOnce = false;
    const trySubmit = () => {
      const targetInput = (inputEl && inputEl.isConnected) ? inputEl : this.findChatInputElement();
      const elapsed = Date.now() - startedAt;
      if (clickedOnce) { this.pendingAttachmentName = ""; return; }
      const readyBtn = this.findSubmitButton(targetInput);
      const fileOk = !expectedFile || this.isAttachmentReady(targetInput, expectedFile);
      if (readyBtn && elapsed >= minDelayMs && fileOk) { clickedOnce = true; this.pendingAttachmentName = ""; readyBtn.click(); return; }
      if (elapsed < maxWaitMs) { setTimeout(trySubmit, 220); return; }
      this.pendingAttachmentName = "";
      this.submitChatBox(targetInput);
    };
    setTimeout(trySubmit, Math.min(minDelayMs, 250));
  }

  /** Insère un texte dans le compositeur et déclenche optionnellement son envoi différé. */
  insertPrompt(promptText, autoSubmit = false) {
    const inputEl = this.findChatInputElement();
    if (!inputEl || !promptText) return false;
    this.focusWithoutScroll(inputEl);
    const prefix = inputEl.tagName === "TEXTAREA" ? (inputEl.value.trim() ? "\n\n" : "") : (inputEl.textContent.trim() ? "\n\n" : "");
    const payload = prefix + promptText;
    if (inputEl.tagName === "TEXTAREA") {
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      inputEl.value = inputEl.value.slice(0, start) + payload + inputEl.value.slice(end);
      inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (!document.execCommand("insertText", false, payload)) inputEl.textContent = (inputEl.textContent || "") + payload;
      inputEl.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: payload }));
    }
    if (autoSubmit) {
      const minDelay = typeof autoSubmit === "object" ? (autoSubmit.minDelayMs ?? 400) : 400;
      const maxWait = typeof autoSubmit === "object" ? (autoSubmit.maxWaitMs ?? 3500) : 3500;
      const waitFile = typeof autoSubmit === "object" ? (autoSubmit.waitForFile ?? "") : "";
      this.waitAndSubmit(inputEl, minDelay, maxWait, waitFile);
    }
    return true;
  }

  /** Encapsule un rapport de tests dans un bloc Markdown et l'insère dans le chat. */
  insertTestResults(textToInsert, autoSubmit = false) {
    return this.insertPrompt("Résultats des tests :\n" + this.TRIPLE_BACKTICK + "text\n" + textToInsert + "\n" + this.TRIPLE_BACKTICK + "\n", autoSubmit);
  }
}
window.GmcChatInjector = ChatInjector;
