/**
 * Aperçu visuel flottant et téléchargement des blocs contenant une image SVG.
 */
class SvgPreviewManager {
  constructor(spillDetector) {
    this.spill = spillDetector;
    this.tooltipEl = null;
    this.activeTarget = null;
    this.DOWNLOAD_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    this.DONE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  getCanonicalSvgNamespace() {
    return ["http://www", "w3", "org/2000/svg"].join(".");
  }

  ensureTooltip() {
    if (this.tooltipEl && this.tooltipEl.isConnected) return this.tooltipEl;
    const tip = document.createElement("div");
    tip.className = "gmc-svg-preview-tooltip";
    tip.style.display = "none";
    document.body.appendChild(tip);
    this.tooltipEl = tip;
    return tip;
  }

  sanitizeSvgMarkup(rawSvg) {
    let svg = String(rawSvg || "");
    const svgNs = this.getCanonicalSvgNamespace();
    svg = svg.replace(/<svg\b([^>]*)>/i, (_full, attrs) => {
      const cleanedAttrs = String(attrs || "").replace(/\s+xmlns\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      return `<svg${cleanedAttrs} xmlns="${svgNs}">`;
    });
    svg = svg.replace(/<(script|foreignObject|embed|object|iframe|style|set|animate)\b[\s\S]*?<\/\1\s*>/gi, "");
    svg = svg.replace(/<(script|foreignObject|embed|object|iframe|style|set|animate)\b[^>]*\/?>/gi, "");
    svg = svg.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    svg = svg.replace(/\s(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*'|[^\s>]+)/gi, "");
    return svg;
  }

  extractSvgMarkup(rawText) {
    const text = String(rawText || "");
    const startIdx = text.search(/<svg\b[^>]*>/i);
    if (startIdx === -1) return "";
    const endMatch = /<\/svg\s*>/i.exec(text.slice(startIdx));
    if (!endMatch) return "";
    const slice = text.slice(startIdx, startIdx + endMatch.index + endMatch.at(0).length);
    return this.sanitizeSvgMarkup(slice);
  }

  hasSvg(rawText) {
    return Boolean(this.extractSvgMarkup(rawText));
  }

  normalizeDownloadFilename(headerName) {
    const rawBase = String(headerName || "image.svg").split("|").at(0).trim().split(/[\\/]/).filter(Boolean).pop() || "image.svg";
    const safeBase = rawBase.replace(/[^\w.-]/g, "_") || "image.svg";
    return safeBase.toLowerCase().endsWith(".svg") ? safeBase : `${safeBase.replace(/\.[^.]+$/, "")}.svg`;
  }

  downloadSvg(rawText, headerName = "image.svg") {
    const svgMarkup = this.extractSvgMarkup(rawText);
    if (!svgMarkup) return false;
    const filename = this.normalizeDownloadFilename(headerName);
    const payload = `<?xml version="1.0" encoding="UTF-8"?>\n${svgMarkup}\n`;
    const blob = new Blob([payload], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
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

  positionTooltip(event) {
    if (!this.tooltipEl || this.tooltipEl.style.display === "none") return;
    const margin = 14;
    const rect = this.tooltipEl.getBoundingClientRect();
    const w = rect.width || 240;
    const h = rect.height || 200;
    let left = (event?.clientX ?? 20) + margin;
    let top = (event?.clientY ?? 20) + margin;
    if (left + w > window.innerWidth - 10) left = Math.max(10, (event?.clientX ?? 20) - w - margin);
    if (top + h > window.innerHeight - 10) top = Math.max(10, (event?.clientY ?? 20) - h - margin);
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

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

  hide() {
    this.activeTarget = null;
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  bindHoverTarget(targetEl, getSourceText) {
    if (!targetEl || targetEl.getAttribute("data-gmc-svg-bound") === "true") return;
    targetEl.setAttribute("data-gmc-svg-bound", "true");
    targetEl.addEventListener("mouseenter", (e) => this.show(targetEl, getSourceText, e));
    targetEl.addEventListener("mousemove", (e) => {
      if (this.activeTarget === targetEl) this.positionTooltip(e);
    });
    targetEl.addEventListener("mouseleave", () => {
      if (this.activeTarget === targetEl) this.hide();
    });
  }

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
    const nativeCopy = Array.from(wrapper.querySelectorAll?.("button") || []).find((b) => {
      if (String(b.className || "").includes("gmc-")) return false;
      const meta = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""} ${b.textContent || ""}`.toLowerCase();
      return meta.includes("copier") || meta.includes("copy");
    });
    if (nativeCopy?.parentElement) {
      nativeCopy.parentElement.insertBefore(btn, nativeCopy.nextSibling);
    } else if (pre.parentNode) {
      const bar = document.createElement("div");
      bar.className = "gmc-placeholder";
      bar.appendChild(btn);
      pre.parentNode.insertBefore(bar, pre);
    }
  }

  scanStandaloneBlocks() {
    for (const pre of document.querySelectorAll("pre")) {
      if (pre.getAttribute("data-gmc-processed") === "true") continue;
      const raw = this.spill.extractRawCode(pre);
      if (!this.hasSvg(raw)) continue;
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
