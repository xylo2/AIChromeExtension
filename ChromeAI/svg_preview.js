/**
 * Aperçu visuel flottant et téléchargement des blocs contenant une image SVG.
 */
class SvgPreviewManager {
  /** Initialise le détecteur de débordement, l'assainisseur SVG et les icônes. */
  constructor(spillDetector) {
    this.spill = spillDetector;
    this.sanitizer = window.GmcSvgSanitizerHelper ? new window.GmcSvgSanitizerHelper() : null;
    this.tooltipEl = null;
    this.activeTarget = null;
    this.DOWNLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    this.DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  /** Crée ou retourne l'infobulle flottante dédiée à l'aperçu SVG. */
  ensureTooltip() {
    if (this.tooltipEl && this.tooltipEl.isConnected) return this.tooltipEl;
    const tip = document.createElement("div");
    tip.className = "gmc-svg-preview-tooltip";
    tip.style.display = "none";
    document.body.appendChild(tip);
    this.tooltipEl = tip;
    return tip;
  }

  /** Délègue l'assainissement d'un balisage SVG brut. */
  sanitizeSvgMarkup(rawSvg) { return this.sanitizer ? this.sanitizer.sanitizeSvgMarkup(rawSvg) : String(rawSvg || ""); }

  /** Extrait le balisage SVG assaini depuis un texte source. */
  extractSvgMarkup(rawText) { return this.sanitizer ? this.sanitizer.extractSvgMarkup(rawText) : ""; }

  /** Indique si le texte contient une balise SVG exploitable. */
  hasSvg(rawText) { return Boolean(this.extractSvgMarkup(rawText)); }

  /** Télécharge le contenu SVG au format .svg. */
  downloadSvg(rawText, headerName = "image.svg") { return this.sanitizer ? this.sanitizer.downloadSvg(rawText, headerName) : false; }

  /** Construit le conteneur d'aperçu DOM sécurisé à partir du code SVG assaini. */
  buildSvgPreviewNode(svgMarkup) {
    const stage = document.createElement("div");
    stage.className = "gmc-svg-preview-stage";
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
        const parsedSvg = doc.documentElement;
        if (parsedSvg && parsedSvg.nodeName.toLowerCase() === "svg" && !doc.querySelector("parsererror")) {
          parsedSvg.querySelectorAll("script, foreignObject, embed, object, iframe, style, set, animate").forEach((n) => n.remove());
          parsedSvg.removeAttribute("width");
          parsedSvg.removeAttribute("height");
          parsedSvg.classList.add("gmc-svg-preview-svg");
          stage.appendChild(document.importNode(parsedSvg, true));
          return stage;
        }
      } catch (_err) {}
    }
    const img = document.createElement("img");
    img.className = "gmc-svg-preview-img";
    img.alt = "Aperçu SVG";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    stage.appendChild(img);
    return stage;
  }
  /** Positionne l'infobulle d'aperçu près du curseur sans déborder de la fenêtre. */
  positionTooltip(event) {
    if (!this.tooltipEl || this.tooltipEl.style.display === "none") return;
    const margin = 14;
    const rect = this.tooltipEl.getBoundingClientRect();
    const w = rect.width || 240, h = rect.height || 200;
    let left = (event?.clientX ?? 20) + margin, top = (event?.clientY ?? 20) + margin;
    if (left + w > window.innerWidth - 10) left = Math.max(10, (event?.clientX ?? 20) - w - margin);
    if (top + h > window.innerHeight - 10) top = Math.max(10, (event?.clientY ?? 20) - h - margin);
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  /** Affiche l'aperçu SVG au survol de l'élément cible. */
  show(targetEl, getSourceText, event) {
    const svgMarkup = this.extractSvgMarkup(getSourceText());
    if (!svgMarkup) return this.hide();
    const tip = this.ensureTooltip();
    this.activeTarget = targetEl;
    tip.innerHTML = "";
    const header = document.createElement("div");
    header.className = "gmc-svg-preview-header";
    header.textContent = "🖼️ Aperçu SVG";
    tip.append(header, this.buildSvgPreviewNode(svgMarkup));
    tip.style.display = "flex";
    this.positionTooltip(event);
  }

  /** Masque l'infobulle d'aperçu flottante. */
  hide() { this.activeTarget = null; if (this.tooltipEl) this.tooltipEl.style.display = "none"; }

  /** Attache les écouteurs de survol souris sur un bloc contenant du SVG. */
  bindHoverTarget(targetEl, getSourceText) {
    if (!targetEl || targetEl.getAttribute("data-gmc-svg-bound") === "true") return;
    targetEl.setAttribute("data-gmc-svg-bound", "true");
    targetEl.addEventListener("mouseenter", (e) => this.show(targetEl, getSourceText, e));
    targetEl.addEventListener("mousemove", (e) => { if (this.activeTarget === targetEl) this.positionTooltip(e); });
    targetEl.addEventListener("mouseleave", () => { if (this.activeTarget === targetEl) this.hide(); });
  }

  /** Ajoute un bouton de téléchargement .svg dans l'en-tête d'un bloc <pre> autonome. */
  attachStandaloneDownloadButton(pre, getSourceText) {
    const wrapper = this.spill.findCodeBlockWrapper(pre) || pre;
    if (wrapper.querySelector?.(".gmc-svg-standalone-dl")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gmc-verify-btn gmc-svg-download-btn gmc-svg-standalone-dl";
    btn.title = "Télécharger l'image SVG (.svg)";
    btn.innerHTML = this.DOWNLOAD_SVG;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.downloadSvg(getSourceText(), "image.svg")) {
        btn.innerHTML = this.DONE_SVG;
        btn.classList.add("gmc-verified-btn");
        setTimeout(() => { btn.innerHTML = this.DOWNLOAD_SVG; btn.classList.remove("gmc-verified-btn"); }, 1400);
      }
    });
    const nativeCopy = Array.from(wrapper.querySelectorAll?.("button") || []).find((b) => !String(b.className || "").includes("gmc-") && /copier|copy/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`));
    if (nativeCopy?.parentElement) nativeCopy.parentElement.insertBefore(btn, nativeCopy.nextSibling);
    else if (pre.parentNode) { const bar = document.createElement("div"); bar.className = "gmc-placeholder"; bar.appendChild(btn); pre.parentNode.insertBefore(bar, pre); }
  }

  /** Détecte les blocs <pre> SVG sans balise FILE et leur associe aperçu et téléchargement. */
  scanStandaloneBlocks() {
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.getAttribute("data-gmc-processed") === "true") continue;
      if (!this.hasSvg(this.spill.extractRawCode(pre))) continue;
      const getText = () => this.spill.extractRawCode(pre);
      this.attachStandaloneDownloadButton(pre, getText);
      if (pre.getAttribute("data-gmc-svg-bound") === "true") continue;
      this.bindHoverTarget(pre, getText);
      const wrapper = this.spill.findCodeBlockWrapper(pre);
      if (wrapper && wrapper !== pre) this.bindHoverTarget(wrapper, getText);
    }
  }
}
window.GmcSvgPreviewManager = SvgPreviewManager;
