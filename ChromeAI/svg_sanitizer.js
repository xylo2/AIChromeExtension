// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Utilisateur_A

/**
 * Extraction, assainissement (avec animations autorisées) et téléchargement SVG.
 */
class SvgSanitizerHelper {
  /** Construit l'URI canonique de l'espace de noms XML SVG. */
  getCanonicalSvgNamespace() {
    return ["http://www", "w3", "org/2000/svg"].join(".");
  }

  /** Nettoie un bloc CSS interne en conservant keyframes/animations sans import externe. */
  sanitizeCssBlock(cssText) {
    return String(cssText || "")
      .replace(/@import\b[^;]*;?/gi, "")
      .replace(/expression\s*\([^)]*\)/gi, "")
      .replace(/(?:javascript|vbscript)\s*:/gi, "")
      .replace(/url\s*\(\s*['"]?\s*(?:https?:|\/\/|data:)[^)]*\)/gi, "none");
  }

  /** Normalise xmlns et supprime scripts/objets actifs tout en préservant les animations. */
  sanitizeSvgMarkup(rawSvg) {
    let svg = String(rawSvg || "");
    const svgNs = this.getCanonicalSvgNamespace();
    svg = svg.replace(/<svg\b([^>]*)>/i, (_full, attrs) => {
      const cleanedAttrs = String(attrs || "").replace(/\s+xmlns\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      return `<svg${cleanedAttrs} xmlns="${svgNs}">`;
    });
    svg = svg.replace(/<(script|foreignObject|embed|object|iframe)\b[\s\S]*?<\/\1\s*>/gi, "");
    svg = svg.replace(/<(script|foreignObject|embed|object|iframe)\b[^>]*\/?>/gi, "");
    svg = svg.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_m, attrs, css) => `<style${attrs}>${this.sanitizeCssBlock(css)}</style>`);
    svg = svg.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    svg = svg.replace(/\s(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*'|[^\s>]+)/gi, "");
    return svg;
  }

  /** Extrait et assainit le premier bloc complet <svg>...</svg> présent dans rawText. */
  extractSvgMarkup(rawText) {
    const text = String(rawText || "");
    const startIdx = text.search(/<svg\b[^>]*>/i);
    if (startIdx === -1) return "";
    const endMatch = /<\/svg\s*>/i.exec(text.slice(startIdx));
    if (!endMatch) return "";
    return this.sanitizeSvgMarkup(text.slice(startIdx, startIdx + endMatch.index + endMatch.at(0).length));
  }

  /** Nettoie l'en-tête pour produire un nom de fichier .svg valide. */
  normalizeDownloadFilename(headerName) {
    const rawBase = String(headerName || "image.svg").split("|").at(0).trim().split(/[\\/]/).filter(Boolean).pop() || "image.svg";
    const safeBase = rawBase.replace(/[^\w.-]/g, "_") || "image.svg";
    return safeBase.toLowerCase().endsWith(".svg") ? safeBase : `${safeBase.replace(/\.[^.]+$/, "")}.svg`;
  }

  /** Génère un fichier XML SVG et déclenche son téléchargement local. */
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
}
window.GmcSvgSanitizerHelper = SvgSanitizerHelper;
