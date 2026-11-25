/**
 * Dépôt de pièces jointes et vérification de leur disponibilité dans le compositeur.
 */
class ChatFileAttacher {
  constructor(injector) {
    this.injector = injector;
    this.pendingAttachmentName = "";
    this.baselineAttachmentCount = 0;
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
    return this.injector.queryDeepAll(sel, container).filter((n) => !String(n.className || "").includes("gmc-")).length;
  }

  isAttachmentReady(inputEl, filename) {
    if (!filename) return true;
    const container = this.findComposerContainer(inputEl);
    if (container.querySelector('[role="progressbar"], [aria-busy="true"], .loading, .spinner')) return false;
    const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
    const lowerName = filename.toLowerCase();
    const nodes = this.injector.queryDeepAll("*", container);
    const hasMetaMatch = nodes.some((n) => {
      if (String(n.className || "").includes("gmc-")) return false;
      const blob = `${n.getAttribute?.("data-file-name") || ""} ${n.getAttribute?.("aria-label") || ""} ${n.getAttribute?.("title") || ""} ${n.textContent || ""}`.toLowerCase();
      return blob.includes(lowerName) || (stem.length >= 4 && blob.includes(stem));
    });
    if (hasMetaMatch) return true;
    return this.countAttachmentChips(container) > this.baselineAttachmentCount;
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
    const inputEl = this.injector.findChatInputElement();
    const composerEl = this.findComposerContainer(inputEl);
    this.pendingAttachmentName = filename || "";
    this.baselineAttachmentCount = this.countAttachmentChips(composerEl);
    const compatibleInput = this.selectCompatibleFileInput(this.injector.queryDeepAll('input[type="file"]'));
    let inputAttached = false;
    if (compatibleInput) {
      try { compatibleInput.files = dt.files; compatibleInput.dispatchEvent(new Event("change", { bubbles: true })); inputAttached = true; } catch (_err) {}
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
      if (!this.injector.getInputText(inputEl)) this.injector.insertPrompt(`Fichier joint (\x60${filename}\x60) :`, false);
      this.injector.waitAndSubmit(inputEl, 1000, 5000, filename);
    }
    return true;
  }
}
window.GmcChatFileAttacher = ChatFileAttacher;
