/**
 * Assistant Native Messaging et réinjection des content scripts pour le Service Worker.
 */
class BgNativeHelper {
  constructor(nativeHostName, defaultRootDir) {
    this.NATIVE_HOST_NAME = nativeHostName;
    this.DEFAULT_ROOT_DIR = defaultRootDir;
  }

  isMissingHostError(errorMessage) {
    const lower = (errorMessage || "").toLowerCase();
    return ["native messaging host not found", "forbidden", "host has exited", "communicating with the native messaging host"].some((k) => lower.includes(k));
  }

  generateSessionToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  fetchSessionToken() {
    return new Promise((resolve) => {
      if (!chrome.runtime?.sendNativeMessage) { resolve(null); return; }
      try {
        chrome.runtime.sendNativeMessage(this.NATIVE_HOST_NAME, { action: "get_token" }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) { resolve(null); return; }
          resolve(typeof response.api_token === "string" ? response.api_token.trim() : "");
        });
      } catch (_err) { resolve(null); }
    });
  }

  listWorkspaceFolders(rootDir) {
    return new Promise((resolve) => {
      if (!chrome.runtime?.sendNativeMessage) { resolve({ ok: false, folders: [], error: "API Native Messaging indisponible." }); return; }
      try {
        chrome.runtime.sendNativeMessage(this.NATIVE_HOST_NAME, { action: "list_folders", root_dir: rootDir || "" }, (response) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || "Erreur Native Messaging";
            resolve({ ok: false, folders: [], error: errMsg, missingHost: this.isMissingHostError(errMsg) });
            return;
          }
          resolve({ ok: Boolean(response?.ok), folders: Array.isArray(response?.folders) ? response.folders : [], rootDir: response?.root_dir || rootDir || "", error: response?.error || "" });
        });
      } catch (err) { resolve({ ok: false, folders: [], error: err?.message || "Erreur lecture dossiers." }); }
    });
  }

  sendStartNativeMessage(targetDir, extraArgs, apiToken, onDone) {
    chrome.runtime.sendNativeMessage(
      this.NATIVE_HOST_NAME,
      { action: "start", target_dir: targetDir || ".", extra_args: extraArgs || "", api_token: apiToken, allowed_origin: `chrome-extension://${chrome.runtime.id}` },
      async (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "Erreur Native Messaging";
          const stored = await chrome.storage.local.get("savedRootDir");
          const rootDir = (stored.savedRootDir || this.DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
          onDone({ ok: false, error: errMsg, missingHost: this.isMissingHostError(errMsg), installCommand: `python "${rootDir}\\tools\\watch_clipboard\\install_native_host.py" ${chrome.runtime.id}` });
          return;
        }
        onDone({ ok: Boolean(response?.ok), response });
      }
    );
  }

  async reinjectContentScripts() {
    if (!chrome.scripting) return;
    try {
      const tabs = await chrome.tabs.query({ url: ["com/*", "fr/*"].map((tld) => `*://*.google.${tld}`) });
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__gmcInitialized = false; document.querySelectorAll(".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-purge-btn, .gmc-git-panel, .gmc-commit-action-bar, .gmc-svg-preview-tooltip, .gmc-autosuite-banner").forEach((n) => n.remove()); document.querySelectorAll("[data-gmc-processed], [data-gmc-commit-processed], [data-gmc-svg-bound]").forEach((el) => { el.removeAttribute("data-gmc-processed"); el.removeAttribute("data-gmc-commit-processed"); el.removeAttribute("data-gmc-svg-bound"); el.classList.remove("gmc-collapsed-code"); }); document.querySelectorAll("[data-gmc-has-purge], [data-gmc-copy-watched]").forEach((el) => { el.removeAttribute("data-gmc-has-purge"); el.removeAttribute("data-gmc-copy-watched"); }); } });
          await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["spill_heuristics.js", "spill_detector.js", "file_attacher.js", "chat_injector.js", "token_budget.js", "composer_ui.js", "export_menu.js", "git_commit_ui.js", "git_panel.js", "test_panel.js", "test_actions.js", "svg_sanitizer.js", "svg_preview.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js", "content_events.js", "content.js"] });
        } catch (_tabErr) {}
      }
    } catch (_err) {}
  }
}
globalThis.GmcBgNativeHelper = BgNativeHelper;
