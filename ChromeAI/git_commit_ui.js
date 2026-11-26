/**
 * Rendu des erreurs Git, maintien de position de scroll et boutons commit / push / nouveau chat.
 */
class GitCommitUiHelper {
  /** Initialise l'assistant UI avec l'injecteur de chat pour l'envoi d'erreurs. */
  constructor(chatInjector) {
    this.chat = chatInjector;
  }

  /** Capture la position courante de scroll de la fenêtre et des conteneurs parents. */
  captureScrollState(anchorEl) {
    const winX = typeof window !== "undefined" ? (window.scrollX || 0) : 0;
    const winY = typeof window !== "undefined" ? (window.scrollY || 0) : 0;
    const scrollers = [];
    let curr = anchorEl;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (typeof curr.scrollTop === "number" && curr.scrollHeight > curr.clientHeight) {
        scrollers.push([curr, curr.scrollTop, curr.scrollLeft || 0]);
      }
      curr = curr.parentElement;
    }
    return { winX, winY, scrollers };
  }

  /** Restaure immédiatement et à la frame suivante une position de scroll capturée. */
  restoreScrollState(snapshot) {
    if (!snapshot) return;
    const apply = () => {
      for (const [el, top, left] of snapshot.scrollers) { el.scrollTop = top; el.scrollLeft = left; }
      if (typeof window !== "undefined" && typeof window.scrollTo === "function" && (window.scrollY !== snapshot.winY || window.scrollX !== snapshot.winX)) {
        window.scrollTo(snapshot.winX, snapshot.winY);
      }
    };
    apply();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  }

  /** Exécute une mutation DOM en figeant le scroll de la fenêtre et des conteneurs parents. */
  preserveScroll(anchorEl, mutatorFn, existingSnapshot = null) {
    const snap = existingSnapshot || this.captureScrollState(anchorEl);
    const res = mutatorFn();
    this.restoreScrollState(snap);
    return res;
  }

  /** Affiche un encadré d'erreur Git détaillé avec boutons de copie et d'envoi à l'IA. */
  renderErrorBox(bar, titleText, fullErrorText, existingSnapshot = null) {
    this.preserveScroll(bar, () => {
      let box = bar.querySelector(".gmc-git-error-box");
      if (!box) { box = document.createElement("div"); box.className = "gmc-git-error-box"; bar.appendChild(box); }
      box.innerHTML = "";
      const topRow = document.createElement("div"); topRow.className = "gmc-git-error-header";
      const titleSpan = document.createElement("span"); titleSpan.textContent = "❌ " + titleText;
      const btnGroup = document.createElement("div"); btnGroup.className = "gmc-git-error-actions";
      const copyBtn = document.createElement("button"); copyBtn.type = "button"; copyBtn.className = "gmc-git-error-btn"; copyBtn.textContent = "📋 Copier l'erreur";
      copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(fullErrorText); } catch (_err) {}
        copyBtn.textContent = "✅ Copié !";
        setTimeout(() => { copyBtn.textContent = "📋 Copier l'erreur"; }, 1400);
      });
      const askAiBtn = document.createElement("button"); askAiBtn.type = "button"; askAiBtn.className = "gmc-git-error-btn"; askAiBtn.textContent = "→ Envoyer à l'IA";
      askAiBtn.addEventListener("click", () => {
        if (this.chat) this.chat.insertPrompt("Voici l'erreur Git rencontrée (" + titleText + ") :\n" + "\x60\x60\x60text\n" + fullErrorText + "\n\x60\x60\x60\nComment la résoudre ?\n", true);
      });
      btnGroup.append(copyBtn, askAiBtn); topRow.append(titleSpan, btnGroup);
      const preDetail = document.createElement("pre"); preDetail.className = "gmc-git-error-detail"; preDetail.textContent = String(fullErrorText || "Erreur inconnue.");
      box.append(topRow, preDetail);
    }, existingSnapshot);
  }
  /** Envoie un message au service worker avec gestion du délai d'expiration et de l'invalidation. */
  sendRuntimeSafe(payload, onDone, timeoutMs = 20000) {
    if (!chrome.runtime?.id) { onDone({ ok: false, error: "Extension rechargée : actualisez la page (F5) puis réessaie." }); return; }
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; onDone({ ok: false, error: "Délai dépassé (" + Math.round(timeoutMs / 1000) + "s) sans réponse de l'extension." }); } }, timeoutMs);
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (chrome.runtime.lastError) { onDone({ ok: false, error: chrome.runtime.lastError.message || "Erreur de communication extension." }); return; }
        onDone(res || { ok: false, error: "Réponse vide du service worker." });
      });
    } catch (err) {
      if (!settled) { settled = true; clearTimeout(timer); onDone({ ok: false, error: err?.message || "Contexte d'extension invalidé (F5 requis)." }); }
    }
  }

  /** Construit l'URL d'une nouvelle conversation AI vierge en conservant le mode udm/hl. */
  buildFreshChatUrl(currentHref) {
    const url = new URL(currentHref);
    if (url.pathname.startsWith("/search")) {
      const udm = url.searchParams.get("udm") || "50";
      const hl = url.searchParams.get("hl");
      url.search = "?udm=" + encodeURIComponent(udm) + (hl ? "&hl=" + encodeURIComponent(hl) : "");
      url.hash = "";
      return url.toString();
    }
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  /** Crée le bouton ouvrant un nouveau chat vierge avec déclenchement automatique d'export. */
  createFreshExportButton() {
    const freshBtn = document.createElement("button"); freshBtn.type = "button"; freshBtn.className = "gmc-git-btn-verify";
    freshBtn.textContent = "🆕 Nouveau chat & Exporter"; freshBtn.title = "Ouvre une nouvelle conversation vierge et y réexporte le projet à jour";
    freshBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      freshBtn.blur?.();
      freshBtn.disabled = true; freshBtn.textContent = "⏳ Nouveau chat...";
      const targetUrl = this.buildFreshChatUrl(window.location.href);
      const navigate = () => { window.location.href = targetUrl; };
      if (chrome.storage?.local) chrome.storage.local.set({ pendingFreshExportAt: Date.now() }, navigate);
      else navigate();
    });
    return freshBtn;
  }

  /** Crée le bouton d'envoi de la branche courante vers le dépôt distant origin. */
  createPushButton(bar, manager) {
    const pushBtn = document.createElement("button"); pushBtn.type = "button"; pushBtn.className = "gmc-git-push-btn";
    pushBtn.textContent = "🚀 git push origin HEAD"; pushBtn.title = "Pousse la branche courante vers origin";
    pushBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      pushBtn.blur?.();
      this.preserveScroll(bar, () => {
        pushBtn.disabled = true; pushBtn.classList.remove("state-fail", "state-pass"); pushBtn.textContent = "⏳ Push en cours...";
      });
      this.sendRuntimeSafe({ type: "GIT_PUSH", remote: "origin", branch: "HEAD" }, async (res) => {
        if (res?.ok) {
          this.preserveScroll(bar, () => {
            pushBtn.textContent = "✅ Push origin OK"; pushBtn.title = res.output || "Push effectué"; pushBtn.classList.add("state-pass");
            bar.querySelector(".gmc-git-error-box")?.remove();
          });
        } else {
          const fullErr = res?.error || "Erreur git push (aucun détail reçu du serveur local).";
          const shortErr = manager.extractPushErrorSummary(fullErr);
          try { await navigator.clipboard.writeText(fullErr); } catch (_err) {}
          this.preserveScroll(bar, () => {
            pushBtn.disabled = false; pushBtn.textContent = "❌ " + shortErr.slice(0, 75); pushBtn.classList.add("state-fail");
          });
          this.renderErrorBox(bar, "Détail de l'erreur git push", fullErr);
        }
      }, 68000);
    });
    return pushBtn;
  }
}
window.GmcGitCommitUiHelper = GitCommitUiHelper;
