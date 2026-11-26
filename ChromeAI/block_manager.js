/**
 * Gestion du repliage, du regroupement par tour, de la purge DOM et de l'auto-Suite.
 */
class CodeBlockManager {
  /** Initialise les détecteurs, les seuils de compaction DOM et l'écouteur clavier. */
  constructor(spillDetector, chatInjector, onPurgeCallback = null, svgPreview = null) {
    this.spill = spillDetector; this.chat = chatInjector; this.onPurge = onPurgeCallback; this.svgPreview = svgPreview;
    this.verifier = window.GmcBlockVerificationHelper ? new window.GmcBlockVerificationHelper(chatInjector, spillDetector) : null;
    this.controlsUi = window.GmcBlockControlsUiHelper ? new window.GmcBlockControlsUiHelper(spillDetector, svgPreview) : null;
    this.MAX_SAFE_LINES = 75; this.MAX_ACTIVE_DOM_BLOCKS = 4; this.MAX_VISIBLE_TURNS = 4;
    this.TURN_SELECTOR = "[data-aim-turn], [data-turn-id], message-content, model-response, user-query";
    this.AUTO_SUITE_DELAY_MS = 2800; this.MAX_CONSECUTIVE_AUTO_SUITE = 2;
    this.trackedBlocks = []; this.autoSentSuiteForTurn = null; this.consecutiveAutoSuiteCount = 0; this.pendingSuiteTimer = null;
    this.bindUserTypingCancelsAutoSuite();
  }
  /** Annule automatiquement le compte à rebours auto-Suite dès que l'utilisateur saisit du texte. */
  bindUserTypingCancelsAutoSuite() {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    const cancel = (ev) => { if (ev?.isTrusted !== false && !(ev?.type === "keydown" && (ev.ctrlKey || ev.metaKey || ev.altKey)) && this.pendingSuiteTimer) this.resetAutoSuiteQuota(); };
    ["keydown", "beforeinput", "input", "paste"].forEach((evtName) => document.addEventListener(evtName, cancel, true));
  }
  /** Indique si la zone de saisie du compositeur contient déjà un brouillon non vide. */
  isComposerNonEmpty() { const inputEl = this.chat?.findChatInputElement?.(); return Boolean(inputEl && this.chat?.getInputText?.(inputEl) !== ""); }
  /** Vérifie si un bloc suivi a déjà été purgé du DOM. */
  isItemPurged(item) { return Boolean(item?.purged || item?.el?.getAttribute?.("data-gmc-purged") === "true"); }
  /** Retourne la liste des blocs suivis encore connectés et non purgés. */
  getUnpurgedBlocks() { return this.trackedBlocks.filter((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b)); }
  /** Retourne tous les blocs non purgés à partir de startItem jusqu'à la fin de la page. */
  getUnpurgedBlocksFrom(startItem) {
    const idx = this.trackedBlocks.indexOf(startItem);
    return (idx >= 0 ? this.trackedBlocks.slice(idx) : this.trackedBlocks).filter((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b));
  }
  /** Compte le nombre total de blocs actifs non purgés. */
  getUnpurgedCount() { return this.getUnpurgedBlocks().length; }
  /** Masque la bannière flottante du compte à rebours auto-Suite. */
  hideSuiteBanner() { this.verifier?.hideSuiteBanner(); }
  /** Affiche la bannière d'auto-Suite avec bouton d'annulation. */
  showSuiteBanner(delayMs) { this.verifier?.showSuiteBanner(delayMs, () => this.resetAutoSuiteQuota()); }
  /** Réinitialise le quota d'envois automatiques et annule tout minuteur en attente. */
  resetAutoSuiteQuota() { this.consecutiveAutoSuiteCount = 0; if (this.pendingSuiteTimer) { clearTimeout(this.pendingSuiteTimer); this.pendingSuiteTimer = null; } this.hideSuiteBanner(); }
  /** Exécute une mutation DOM sans déclencher de défilement automatique. */
  preserveScrollAround(_targetEl, mutatorFn) { return mutatorFn(); }
  /** Formate le libellé d'état d'un bloc (normal, >75 lignes, débordement ou SVG). */
  formatLabel(headerName, lineCount, hasSpill, hasSvg = false) {
    const svgTag = hasSvg ? " [SVG — survoler pour aperçu]" : "";
    if (hasSpill) return `🚨 ${headerName}${svgTag} (${lineCount} lignes — débordement hors bloc récupéré)`;
    if (lineCount > this.MAX_SAFE_LINES) return `⚠️ ${headerName}${svgTag} (${lineCount} lignes — bloc long > 75)`;
    return `${hasSvg ? "🖼️" : "📄"} ${headerName}${svgTag} (${lineCount} lignes)`;
  }
  /** Extrait et met en cache le code complet d'un bloc unique en incluant les débordements. */
  extractSingleItemCode(item) {
    if (this.isItemPurged(item) && item.cachedCombinedCode) return item.cachedCombinedCode;
    const baseCode = this.spill.extractRawCode(item.el), sp = this.spill.collect(item.el);
    item.spilledNodes = sp.nodes;
    const combined = [sp.beforeText, baseCode, sp.afterText].filter(Boolean).join("\n");
    if (combined) item.cachedCombinedCode = combined;
    return combined;
  }
  /** Extrait le code complet d'un bloc ou de l'ensemble des blocs regroupés d'un tour. */
  extractCombinedCode(item) { return (Array.isArray(item?.groupItems) && item.groupItems.length > 1) ? item.groupItems.map((m) => this.extractSingleItemCode(m)).filter(Boolean).join("\n\n") : this.extractSingleItemCode(item); }
  /** Remplace le contenu DOM d'un bloc et de ses débordements par un marqueur léger. */
  purgeDomOnly(item, customMessage = "Contenu copié et purgé") {
    const { el, labelEl, purgeButtons, verifyBtn, headerName, spilledNodes } = item;
    if (!el || this.isItemPurged(item)) return false;
    if (!item.cachedCombinedCode) this.extractSingleItemCode(item);
    return this.preserveScrollAround(el.parentElement || el, () => {
      const codeNode = el.tagName === "CODE" ? el : (el.querySelector("code") || el);
      codeNode.textContent = headerName ? `${headerName} — ${customMessage}` : customMessage;
      item.purged = true; el.setAttribute("data-gmc-purged", "true"); el.classList.add("gmc-purged-code");
      (spilledNodes || []).forEach((n) => n.remove()); item.spilledNodes = [];
      if (labelEl) labelEl.textContent = `✅ ${headerName || "Bloc"} — ${customMessage}`;
      (purgeButtons || []).forEach((btn) => { btn.disabled = true; btn.classList.add("gmc-purged-btn"); });
      if (verifyBtn && !verifyBtn.disabled) verifyBtn.title = "Transmettre ce bloc à l'IA pour vérification (sans copier ni purger)";
      return true;
    });
  }
  /** Indique si le bloc présente un débordement détecté hors de la balise <pre>. */
  isSpilledItem(item) { return Boolean(item?.hasSpill || item?.spilledNodes?.length > 0 || item?.cardEl?.classList?.contains?.("gmc-spilled") || item?.placeholderEl?.classList?.contains?.("gmc-spilled")); }
  /** Purge tous les blocs suivis sans les copier dans le presse-papiers. */
  purgeAll() { let any = false; this.trackedBlocks.forEach((b) => { if (this.purgeDomOnly(b, "Purge manuelle")) any = true; }); if (any && typeof this.onPurge === "function") this.onPurge(); }
  /** Allège automatiquement les blocs les plus anciens au-delà du quota actif autorisé. */
  compactExcessDomBlocks() { const active = this.getUnpurgedBlocks(); if (active.length <= this.MAX_ACTIVE_DOM_BLOCKS) return 0; let count = 0; for (const oldItem of active.slice(0, active.length - this.MAX_ACTIVE_DOM_BLOCKS)) { if (this.purgeDomOnly(oldItem, "Auto-allégé (DOM)")) count += 1; } return count; }
  /** Extrait un aperçu textuel court d'un tour de conversation replié. */
  extractTurnPreview(turn) { const raw = String(turn?.textContent || "").replace(/\s+/g, " ").trim(); return !raw ? "" : (raw.length > 50 ? `${raw.slice(0, 50).trim()}…` : raw); }
  /** Replie les tours de conversation les plus anciens pour alléger le rendu DOM. */
  compactOldConversationTurns() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return 0;
    const allTurns = Array.from(document.querySelectorAll(this.TURN_SELECTOR));
    const topTurns = allTurns.filter((el) => !allTurns.some((other) => other !== el && other.contains?.(el)));
    if (topTurns.length <= this.MAX_VISIBLE_TURNS) return 0;
    let collapsed = 0;
    for (const turn of topTurns.slice(0, topTurns.length - this.MAX_VISIBLE_TURNS)) {
      if (turn.getAttribute?.("data-gmc-turn-state") || turn.querySelector?.("textarea, [contenteditable='true'], pre:not([data-gmc-purged='true'])")) continue;
      turn.setAttribute("data-gmc-turn-state", "collapsed"); turn.classList?.add?.("gmc-collapsed-turn");
      if (turn.parentNode && typeof document.createElement === "function") {
        const pill = document.createElement("div"); pill.className = "gmc-placeholder gmc-turn-placeholder";
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "gmc-toggle-btn";
        const preview = this.extractTurnPreview(turn);
        btn.textContent = preview ? `💬 Tour ancien masqué : « ${preview} » (Afficher)` : "💬 Tour ancien masqué (Afficher)";
        btn.addEventListener("click", () => { turn.setAttribute("data-gmc-turn-state", "expanded"); turn.classList?.remove?.("gmc-collapsed-turn"); pill.remove(); });
        pill.appendChild(btn); turn.parentNode.insertBefore(pill, turn);
      }
      collapsed += 1;
    }
    return collapsed;
  }
  /** Copie le code combiné d'une liste de cibles, les purge du DOM et déclenche auto-Suite si pertinent. */
  async copyAndPurgeTargets(targets) {
    if (targets.length === 0) return 0;
    const chunks = targets.map((it) => this.extractSingleItemCode(it)).filter(Boolean);
    if (chunks.length > 0) { try { await navigator.clipboard.writeText(chunks.join("\n\n")); } catch (_err) {} }
    let purgedCount = 0, hasAlertItem = false;
    for (const item of targets) { if (this.isSpilledItem(item)) hasAlertItem = true; if (this.purgeDomOnly(item)) purgedCount += 1; }
    if (purgedCount > 0) { if (typeof this.onPurge === "function") this.onPurge(); const lastItem = targets.at(-1); if (lastItem && !hasAlertItem) this.maybeAutoSendSuite(lastItem); }
    return purgedCount;
  }
  /** Copie et purge l'ensemble des blocs actifs restants dans la page. */
  async copyAndPurgeAll() { return this.copyAndPurgeTargets(this.getUnpurgedBlocks()); }
  /** Copie et purge tous les blocs à partir de startItem inclus. */
  async copyAndPurgeFrom(startItem) { return this.copyAndPurgeTargets(this.getUnpurgedBlocksFrom(startItem)); }
  /** Copie uniquement le code d'un bloc (ou groupe) dans le presse-papiers sans purger. */
  async copyOnly(item) { const text = this.extractCombinedCode(item); try { await navigator.clipboard.writeText(text); } catch (_err) {} return text; }
  /** Localise l'élément conteneur du tour parent d'un nœud DOM. */
  findTurnContainer(el) { return this.verifier ? this.verifier.findTurnContainer(el) : (el?.parentElement || null); }
  /** Vérifie si le texte qui suit le bloc demande l'envoi de « Suite ». */
  hasSuitePromptAfterBlock(item) { return this.verifier ? this.verifier.hasSuitePromptAfterBlock(item) : false; }
  /** Planifie l'envoi différé de « Suite » si le champ est vide et le quota disponible. */
  maybeAutoSendSuite(item) { if (!this.chat || typeof this.chat.insertPrompt !== "function" || this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE || this.getUnpurgedCount() > 0 || this.isComposerNonEmpty()) return false; const turnKey = this.findTurnContainer(item.el) || item.el; if (this.autoSentSuiteForTurn === turnKey || !this.hasSuitePromptAfterBlock(item)) return false; this.autoSentSuiteForTurn = turnKey; if (this.pendingSuiteTimer) clearTimeout(this.pendingSuiteTimer); this.showSuiteBanner(this.AUTO_SUITE_DELAY_MS); this.pendingSuiteTimer = setTimeout(() => { this.pendingSuiteTimer = null; this.hideSuiteBanner(); if (this.consecutiveAutoSuiteCount >= this.MAX_CONSECUTIVE_AUTO_SUITE || this.isComposerNonEmpty()) return; this.consecutiveAutoSuiteCount += 1; this.chat.insertPrompt("Suite", true); }, this.AUTO_SUITE_DELAY_MS); return true; }
  /** Indique s'il subsiste un bloc principal non purgé après currentItem. */
  hasNextUnpurgedBlock(currentItem) { const startIdx = this.trackedBlocks.indexOf(currentItem); return startIdx >= 0 && this.trackedBlocks.slice(startIdx + 1).some((b) => b?.el && b.el.isConnected !== false && !this.isItemPurged(b) && !b.isSecondaryInGroup); }
  /** Copie et purge un bloc unitaire ou tous les membres d'un tour regroupé. */
  async copyAndPurge(item) { const members = Array.isArray(item?.groupItems) && item.groupItems.length > 1 ? item.groupItems : [item]; const hasSpill = members.some((m) => this.isSpilledItem(m)) || this.isSpilledItem(item); await this.copyOnly(item); let anyPurged = false; for (const m of members) { if (this.purgeDomOnly(m)) anyPurged = true; } if (anyPurged) { if (typeof this.onPurge === "function") this.onPurge(); const lastMember = members.at(-1) || item; if (!this.hasNextUnpurgedBlock(lastMember) && !hasSpill) this.maybeAutoSendSuite(lastMember); } }
  /** Affiche ou masque le code brut d'un bloc replié (y compris les blocs secondaires groupés). */
  toggleBlockDisplay(item) {
    const collapsed = item.el.classList.toggle("gmc-collapsed-code");
    if (item.toggleBtn) item.toggleBtn.textContent = collapsed ? "Afficher" : "Masquer";
    const leadItem = item.groupLeadRef || item;
    if (item.isSecondaryInGroup && leadItem.el?.parentNode && typeof leadItem.el.parentNode.insertBefore === "function") {
      if (!collapsed && item.el.parentNode !== leadItem.el.parentNode) { if (!item.origParent) { item.origParent = item.el.parentNode; item.origNextSibling = item.el.nextSibling; } leadItem.el.parentNode.insertBefore(item.el, leadItem.el.nextSibling); }
      else if (collapsed && item.origParent && item.el.parentNode === leadItem.el.parentNode) { item.origParent.insertBefore(item.el, item.origNextSibling || null); }
      const wrapper = this.spill.findCodeBlockWrapper(item.el);
      if (wrapper && wrapper !== item.el && wrapper !== this.spill.findCodeBlockWrapper(leadItem.el)) wrapper.classList.toggle("gmc-grouped-secondary-block", collapsed);
    }
    this.syncItem(leadItem); this.attachHeaderControls(leadItem.el, leadItem);
  }
  /** Regroupe visuellement les blocs FILE/FILE_PART appartenant au même tour de réponse. */
  groupTurnBlocks() {
    const byTurn = new Map();
    for (const item of this.trackedBlocks) { if (!item?.el || item.el.isConnected === false) continue; const turn = this.findTurnContainer(item.el); if (!turn || turn === document.body) { item.groupItems = null; item.isSecondaryInGroup = false; item.groupLeadRef = null; continue; } if (!byTurn.has(turn)) byTurn.set(turn, []); byTurn.get(turn).push(item); }
    for (const items of byTurn.values()) {
      if (items.length <= 1) { const s = items.at(0); if (s) { s.groupItems = null; s.isSecondaryInGroup = false; s.groupLeadRef = null; } continue; }
      const lead = items.at(0); lead.groupItems = items; lead.isSecondaryInGroup = false; lead.groupLeadRef = null;
      const leadWrapper = this.spill.findCodeBlockWrapper(lead.el);
      for (let i = 1; i < items.length; i += 1) { const sec = items.at(i); sec.groupItems = null; sec.isSecondaryInGroup = true; sec.groupLeadRef = lead; const wrapper = this.spill.findCodeBlockWrapper(sec.el); if (wrapper && wrapper !== sec.el && wrapper !== leadWrapper) wrapper.classList.toggle("gmc-grouped-secondary-block", sec.el.classList.contains("gmc-collapsed-code")); }
    }
  }
  /** Génère le nom de pièce jointe de repli à partir de l'en-tête du bloc. */
  buildFallbackAttachmentName(headerName) { return this.verifier ? this.verifier.buildFallbackAttachmentName(headerName) : (headerName || "bloc.txt") + ".txt"; }
  /** Transmet un bloc ou un tour complet à l'IA pour vérification d'intégrité. */
  async verifyWithAi(item) { if (!this.verifier) return; this.resetAutoSuiteQuota(); await this.verifier.verifyWithAi(item, (it) => this.extractSingleItemCode(it)); }
  /** Synchronise l'état visuel et les boutons d'un élément suivi. */
  syncItem(item) { if (item?.el && this.controlsUi) { item._mgrRef = this; this.controlsUi.syncItemVisuals(item, this); } }
  /** Délègue la création du bouton de copie et purge. */
  createPurgeBtn(item) { return this.controlsUi ? this.controlsUi.createPurgeBtn(item, (it) => this.copyAndPurge(it)) : document.createElement("button"); }
  /** Délègue la création du bouton de téléchargement SVG. */
  createDownloadBtn(item) { return this.controlsUi ? this.controlsUi.createDownloadBtn(item, (it) => this.extractCombinedCode(it)) : document.createElement("button"); }
  /** Délègue l'injection des boutons de contrôle dans l'en-tête natif du bloc. */
  attachHeaderControls(pre, item) { this.controlsUi?.attachHeaderControls(pre, item, (it) => this.copyAndPurge(it), (it) => this.extractCombinedCode(it)); }
  /** Extrait l'en-tête FILE/FILE_PART ou détecte un bloc SVG autonome. */
  detectHeaderName(rawCode) { const m = this.spill.findFirstNonEmptyLine(rawCode).match(this.spill.FILE_TAG_REGEX); return m ? m.at(1) : (this.svgPreview?.hasSvg(rawCode) ? "image.svg" : null); }
  /** Analyse les nouveaux blocs <pre> du DOM, les replie et met à jour les groupes. */
  scan(preExisting = false) {
    for (const pre of document.querySelectorAll("pre")) { if (pre.getAttribute("data-gmc-processed") === "true") continue; const rawCode = this.spill.extractRawCode(pre); if (!rawCode.includes("\n") && !preExisting) continue; const headerName = this.detectHeaderName(rawCode); if (!headerName || !this.controlsUi) continue; pre.setAttribute("data-gmc-processed", "true"); const item = this.controlsUi.buildTrackedBlockItem(pre, headerName, preExisting, this); this.trackedBlocks.push(item); this.preserveScrollAround(pre.parentElement || pre, () => { pre.parentNode.insertBefore(item.placeholderEl, pre); pre.classList.add("gmc-collapsed-code"); }); }
    this.groupTurnBlocks(); this.compactExcessDomBlocks(); this.compactOldConversationTurns();
    for (const item of this.trackedBlocks) { this.attachHeaderControls(item.el, item); this.syncItem(item); }
  }
}
window.GmcCodeBlockManager = CodeBlockManager;
