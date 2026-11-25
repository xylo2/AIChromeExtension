/**
 * Injection de prompts et dépôt de pièces jointes dans la zone de saisie du chat.
 */
class ChatInjector {
  constructor() {
    this.TRIPLE_BACKTICK = "\x60\x60\x60";
    this.pendingAttachmentName = "";
    this.baselineAttachmentCount = 0;
  }

  isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  queryDeepAll(selector, root = document) {
    const results = Array.from(root.querySelectorAll(selector));
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) results.push(...this.queryDeepAll(selector, host.shadowRoot));
    }
    return results;
  }

  findChatInputElement() {
    const selectors = [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][role="combobox"]',
      'div[contenteditable="true"][aria-label*="question" i]',
      'div[contenteditable="true"][aria-label*="poser" i]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'textarea[aria-label*="question" i]',
      'textarea[placeholder*="question" i]',
      'div[contenteditable="true"]',
      "textarea"
    ];
    let fallbackEl = null;
    for (const sel of selectors) {
      const matches = this.queryDeepAll(sel);
      for (let idx = matches.length - 1; idx >= 0; idx--) {
        const el = matches.at(idx);
        if (!el || el.disabled || el.readOnly || el.closest(".gmc-floating-bar")) continue;
        if (!this.isElementVisible(el)) continue;
        if (el.getBoundingClientRect().top >= window.innerHeight * 0.25) return el;
        if (!fallbackEl) fallbackEl = el;
      }
    }
    return fallbackEl;
  }

  findSubmitButton(inputEl) {
    const keywords = ["envoyer", "send", "submit", "valider", "ask", "poser", "rechercher"];
    const matchesBtn = (btn) => {
      if (!btn || (btn.className && String(btn.className).includes("gmc-"))) return false;
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true" || !this.isElementVisible(btn)) return false;
      if (btn.getAttribute("type") === "submit") return true;
      const meta = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.getAttribute("data-testid") || ""} ${btn.textContent || ""}`.toLowerCase();
      return keywords.some((kw) => meta.includes(kw));
    };
    let container = inputEl ? inputEl.parentElement : document.body;
    for (let depth = 0; depth < 8 && container; depth++) {
      for (const btn of this.queryDeepAll("button, [role='button']", container)) {
        if (matchesBtn(btn)) return btn;
      }
      container = container.parentElement;
    }
    const allButtons = this.queryDeepAll("button, [role='button']");
    for (let idx = allButtons.length - 1; idx >= 0; idx--) {
      const btn = allButtons.at(idx);
      if (matchesBtn(btn)) return btn;
    }
    return null;
  }
  findComposerContainer(inputEl) {
    let container = inputEl ? inputEl.parentElement : document.body;
    for (let depth = 0; depth < 6 && container?.parentElement; depth++) {
      const parent = container.parentElement;
      const tag = String(parent.tagName || "").toUpperCase();
      if (["BODY", "HTML", "MAIN", "ARTICLE"].includes(tag)) break;
      if (parent.querySelector?.("[data-aim-turn], [data-turn-id]")) break;
      container = parent;
    }
    return container || document.body;
  }

  countAttachmentChips(container) {
    if (!container) return 0;
    const sel = '[data-file-name], [data-testid*="file"], [data-testid*="attachment"], button[aria-label*="supprimer" i], button[aria-label*="retirer" i], button[aria-label*="remove" i]';
    return this.queryDeepAll(sel, container).filter((n) => !String(n.className || "").includes("gmc-")).length;
  }

  isAttachmentReady(inputEl, filename) {
    if (!filename) return true;
    const container = this.findComposerContainer(inputEl);
    if (container.querySelector('[role="progressbar"], [aria-busy="true"], .loading, .spinner')) return false;
    const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
    const lowerName = filename.toLowerCase();
    const nodes = this.queryDeepAll("*", container);
    const hasMetaMatch = nodes.some((n) => {
      if (String(n.className || "").includes("gmc-")) return false;
      const blob = `${n.getAttribute?.("data-file-name") || ""} ${n.getAttribute?.("aria-label") || ""} ${n.getAttribute?.("title") || ""} ${n.textContent || ""}`.toLowerCase();
      return blob.includes(lowerName) || (stem.length >= 4 && blob.includes(stem));
    });
    if (hasMetaMatch) return true;
    return this.countAttachmentChips(container) > this.baselineAttachmentCount;
  }

  getInputText(inputEl) {
    if (!inputEl) return "";
    return (inputEl.tagName === "TEXTAREA" ? inputEl.value : inputEl.textContent || "").trim();
  }

  focusWithoutScroll(el) {
    if (!el || typeof el.focus !== "function") return;
    try { el.focus({ preventScroll: true }); } catch (_err) { el.focus(); }
  }

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

  waitAndSubmit(inputEl, minDelayMs = 600, maxWaitMs = 4000, waitForFile = "") {
    const startedAt = Date.now();
    const expectedFile = waitForFile || this.pendingAttachmentName;
    let clickedOnce = false;
    const trySubmit = () => {
      const targetInput = (inputEl && inputEl.isConnected) ? inputEl : this.findChatInputElement();
      const elapsed = Date.now() - startedAt;
      if (clickedOnce) {
        this.pendingAttachmentName = "";
        return;
      }
      const readyBtn = this.findSubmitButton(targetInput);
      const fileOk = !expectedFile || this.isAttachmentReady(targetInput, expectedFile);
      if (readyBtn && elapsed >= minDelayMs && fileOk) {
        clickedOnce = true;
        this.pendingAttachmentName = "";
        readyBtn.click();
        return;
      }
      if (elapsed < maxWaitMs) { setTimeout(trySubmit, 220); return; }
      this.pendingAttachmentName = "";
      this.submitChatBox(targetInput);
    };
    setTimeout(trySubmit, Math.min(minDelayMs, 250));
  }

  selectCompatibleFileInput(fileInputs) {
    for (let idx = fileInputs.length - 1; idx >= 0; idx--) {
      const inp = fileInputs.at(idx);
      const accept = String(inp?.getAttribute?.("accept") || "").toLowerCase();
      const isImageOnly = accept.includes("image/") && !accept.includes("text/") && !accept.includes(".txt") && !accept.includes("*/*");
      if (!isImageOnly) return inp;
    }
    return null;
  }

  dropFile(filename, textContent, autoSubmit = true) {
    const file = new File([textContent], filename, { type: "text/plain;charset=utf-8" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const inputEl = this.findChatInputElement();
    const composerEl = this.findComposerContainer(inputEl);
    this.pendingAttachmentName = filename || "";
    this.baselineAttachmentCount = this.countAttachmentChips(composerEl);
    const compatibleInput = this.selectCompatibleFileInput(this.queryDeepAll('input[type="file"]'));
    let inputAttached = false;
    if (compatibleInput) {
      try {
        compatibleInput.files = dt.files;
        compatibleInput.dispatchEvent(new Event("change", { bubbles: true }));
        inputAttached = true;
      } catch (_err) {}
    }
    if (!inputAttached) {
      for (const target of [inputEl, inputEl?.parentElement, composerEl, document.body].filter(Boolean)) {
        let dropHandled = false;
        for (const evtName of ["dragenter", "dragover", "drop"]) {
          const evt = new DragEvent(evtName, { bubbles: true, cancelable: true, dataTransfer: dt });
          if (evtName === "drop" && !target.dispatchEvent(evt)) dropHandled = true;
        }
        if (dropHandled) break;
      }
    }
    if (autoSubmit) {
      const existing = this.getInputText(inputEl);
      if (!existing) this.insertPrompt(`Fichier joint (\x60${filename}\x60) :`, false);
      this.waitAndSubmit(inputEl, 1000, 5000, filename);
    }
    return true;
  }
  insertPrompt(promptText, autoSubmit = false) {
    const inputEl = this.findChatInputElement();
    if (!inputEl || !promptText) return false;
    this.focusWithoutScroll(inputEl);
    const prefix = inputEl.tagName === "TEXTAREA" ? (inputEl.value.trim() ? "\n\n" : "") : (inputEl.textContent.trim() ? "\n\n" : "");
    const payload = `${prefix}${promptText}`;
    if (inputEl.tagName === "TEXTAREA") {
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      inputEl.value = inputEl.value.slice(0, start) + payload + inputEl.value.slice(end);
      inputEl.selectionStart = inputEl.selectionEnd = 0;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (!document.execCommand("insertText", false, payload)) inputEl.textContent = (inputEl.textContent || "") + payload;
      inputEl.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: payload }));
    }
    this.scrollComposerToTop(inputEl);
    if (autoSubmit) {
      const minDelay = typeof autoSubmit === "object" ? (autoSubmit.minDelayMs ?? 400) : 400;
      const maxWait = typeof autoSubmit === "object" ? (autoSubmit.maxWaitMs ?? 3500) : 3500;
      const waitFile = typeof autoSubmit === "object" ? (autoSubmit.waitForFile ?? "") : "";
      this.waitAndSubmit(inputEl, minDelay, maxWait, waitFile);
    }
    return true;
  }

  scrollComposerToTop(inputEl) {
    let curr = inputEl;
    for (let i = 0; i < 5 && curr; i++) {
      if (typeof curr.scrollTop === "number" && curr.scrollTop > 0) curr.scrollTop = 0;
      curr = curr.parentElement;
    }
  }

  insertTestResults(textToInsert, autoSubmit = false) {
    const fenced = "Résultats des tests :\n" + this.TRIPLE_BACKTICK + "text\n" + textToInsert + "\n" + this.TRIPLE_BACKTICK + "\n";
    return this.insertPrompt(fenced, autoSubmit);
  }
}
window.GmcChatInjector = ChatInjector;
