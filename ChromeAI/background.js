try { if (typeof importScripts === "function") importScripts("bg_native_helper.js"); } catch (_err) {}

/**
 * Service Worker orienté objet pilotant watch_clipboard et la réinjection des onglets.
 */
class WatcherBackgroundService {
  constructor() {
    this.HOST_LOOPBACK = ["127", "0", "0", "1"].join(".");
    this.BASE_URL = `http://${this.HOST_LOOPBACK}:18765`;
    this.ALARM_NAME = "pollWatchClipboardStatus";
    this.NATIVE_HOST_NAME = "com.watch_clipboard.host";
    this.FAST_POLL_INTERVAL_MS = 1500;
    this.DEFAULT_ROOT_DIR = "C:\\git";
    this.DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";
    this.nativeHelper = globalThis.GmcBgNativeHelper ? new globalThis.GmcBgNativeHelper(this.NATIVE_HOST_NAME, this.DEFAULT_ROOT_DIR) : null;
    this.lastKnownSignature = "";
    this.isChecking = false;
    this.activeStartPromise = null;
  }

  extractWorkspaceRoot(fullPath) {
    if (!fullPath || typeof fullPath !== "string") return null;
    const normalized = fullPath.replace(/[\\/]+$/, "");
    const toolsIdx = normalized.search(/[\\/]tools(?:[\\/]|$)/i);
    if (toolsIdx > 0) return normalized.slice(0, toolsIdx);
    const lastSep = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
    return lastSep <= 0 ? null : (lastSep === 2 && normalized.charAt(1) === ":" ? normalized.slice(0, 3) : normalized.slice(0, lastSep));
  }

  async getApiToken() { return (await chrome.storage.local.get("watcherApiToken")).watcherApiToken || ""; }
  async broadcastStateToTabs(state) { try { for (const tab of await chrome.tabs.query({})) { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "WATCHER_STATE_CHANGED", state }).catch(() => {}); } } catch (_err) {} }

  async resyncApiToken(currentToken) {
    if (!this.nativeHelper || typeof this.nativeHelper.fetchSessionToken !== "function") return null;
    const nativeTok = await this.nativeHelper.fetchSessionToken();
    if (nativeTok === null || nativeTok === currentToken) return null;
    if (nativeTok) await chrome.storage.local.set({ watcherApiToken: nativeTok });
    else await chrome.storage.local.remove("watcherApiToken");
    return nativeTok;
  }

  async fetchWithTokenFallback(url, options, apiToken) {
    const sendWith = (tok) => fetch(url, { ...options, headers: { ...(options.headers || {}), ...(tok ? { "X-Watcher-Token": tok } : {}) } });
    let response = await sendWith(apiToken);
    if (response.status !== 401) return response;
    const syncedToken = await this.resyncApiToken(apiToken);
    if (syncedToken !== null) { response = await sendWith(syncedToken); if (response.status !== 401) return response; }
    if (apiToken) { response = await sendWith(""); if (response.ok) await chrome.storage.local.remove("watcherApiToken"); }
    return response;
  }

  updateBadge(isRunning) { chrome.action.setBadgeText({ text: isRunning ? "ON" : "OFF" }); chrome.action.setBadgeBackgroundColor({ color: isRunning ? "#16a34a" : "#dc2626" }); }
  async checkStatus(forceBroadcast = false) {
    if (this.isChecking) return (await chrome.storage.local.get("watchClipboardState")).watchClipboardState || { running: false };
    this.isChecking = true;
    const storedPrefs = await chrome.storage.local.get(["savedTestRunner", "watcherApiToken"]);
    const customRunner = (storedPrefs.savedTestRunner || "").trim();
    const state = { running: false, targetDir: null, pid: null, command: null, hasRunTestsClip: false, hasExporter: false, hasBuildPackage: false, hasGit: false, hasSyntaxError: false, testRunnerPath: null, lastEvent: null, recentEvents: [], configuredTestRunner: customRunner || this.DEFAULT_TEST_RUNNER, checkedAt: new Date().toLocaleTimeString() };
    try {
      const query = customRunner ? `?test_runner=${encodeURIComponent(customRunner)}` : "";
      const response = await this.fetchWithTokenFallback(`${this.BASE_URL}/status${query}`, { signal: AbortSignal.timeout(4500), cache: "no-store" }, storedPrefs.watcherApiToken || "");
      if (response.ok) {
        const data = await response.json();
        if (data?.status === "running") {
          Object.assign(state, { running: true, targetDir: data.target_dir || "", pid: data.pid || null, command: data.command || null, hasRunTestsClip: Boolean(data.has_run_tests_clip), hasExporter: Boolean(data.has_exporter), hasBuildPackage: Boolean(data.has_build_package), hasGit: Boolean(data.has_git), hasSyntaxError: Boolean(data.has_syntax_error), testRunnerPath: data.test_runner_path || null, lastEvent: data.last_event || null, recentEvents: Array.isArray(data.recent_events) ? data.recent_events : [] });
          if (data.configured_test_runner) state.configuredTestRunner = data.configured_test_runner;
          const detectedRoot = this.extractWorkspaceRoot(state.targetDir);
          if (detectedRoot) await chrome.storage.local.set({ savedRootDir: detectedRoot });
        }
      }
    } catch (_err) { state.running = false; } finally { this.isChecking = false; }
    const signature = `${state.running}|${state.targetDir}|${state.pid}|${state.hasRunTestsClip}|${state.hasExporter}|${state.hasBuildPackage}|${state.hasGit}|${state.hasSyntaxError}|${state.lastEvent}|${state.recentEvents.join(";")}`;
    await chrome.storage.local.set({ watchClipboardState: state });
    this.updateBadge(state.running);
    if (forceBroadcast || this.lastKnownSignature !== signature) { this.lastKnownSignature = signature; await this.broadcastStateToTabs(state); }
    return state;
  }
  async waitForExpectedState(expectedRunning, maxWaitMs = 4500) {
    const deadline = Date.now() + maxWaitMs;
    let state = await this.checkStatus(true);
    while (state.running !== expectedRunning && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 250)); state = await this.checkStatus(true); }
    return state;
  }

  startWatcher(targetDir, extraArgs) {
    if (this.activeStartPromise) return this.activeStartPromise;
    this.activeStartPromise = (async () => {
      try {
        const current = await this.checkStatus(false);
        if (current?.running) return { ok: true, alreadyRunning: true, state: current };
        const apiToken = this.nativeHelper ? this.nativeHelper.generateSessionToken() : "";
        await chrome.storage.local.set({ watcherApiToken: apiToken });
        return await new Promise((resolve) => {
          this.nativeHelper.sendStartNativeMessage(targetDir, extraArgs, apiToken, async (res) => {
            if (!res.ok) { resolve(res); return; }
            resolve({ ok: true, response: res.response, state: await this.waitForExpectedState(true, 4500) });
          });
        });
      } finally { this.activeStartPromise = null; }
    })();
    return this.activeStartPromise;
  }

  async stopWatcher() {
    try { await this.fetchWithTokenFallback(`${this.BASE_URL}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1500) }, await this.getApiToken()); } catch (_err) {}
    await chrome.storage.local.remove("watcherApiToken");
    return this.waitForExpectedState(false, 2000);
  }

  async postJson(endpoint, bodyObj, timeoutMs = 15000, errFallback = "Erreur serveur.") {
    try {
      const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(timeoutMs) };
      return await (await this.fetchWithTokenFallback(`${this.BASE_URL}${endpoint}`, opts, await this.getApiToken())).json();
    } catch (err) { return { ok: false, error: `${errFallback} (${err?.message || "réseau"})` }; }
  }
  async getJson(endpoint, timeoutMs = 10000, errFallback = "Erreur lecture.") {
    try { return await (await this.fetchWithTokenFallback(`${this.BASE_URL}${endpoint}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }, await this.getApiToken())).json(); }
    catch (_err) { return { ok: false, error: errFallback }; }
  }

  async runTests(injectIntoActiveTab = true) {
    const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 15000);
    try {
      const stored = await chrome.storage.local.get(["savedTestRunner", "watcherApiToken"]);
      const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test_runner: (stored.savedTestRunner || "").trim() }), signal: AbortSignal.timeout(185000) };
      const result = await (await this.fetchWithTokenFallback(`${this.BASE_URL}/run-tests`, opts, stored.watcherApiToken || "")).json();
      if (result?.ok && result.output && injectIntoActiveTab) {
        const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))?.at(0);
        if (activeTab?.id) {
          try { result.insertedInPage = Boolean((await chrome.tabs.sendMessage(activeTab.id, { type: "INSERT_TEST_RESULT", output: result.output, passed: Boolean(result.passed) }))?.inserted); }
          catch (_err) { result.insertedInPage = false; }
        }
      }
      return result;
    } catch (err) { return { ok: false, error: `Impossible d'exécuter les tests (${err?.message || "délai dépassé"}).` }; }
    finally { clearInterval(keepAlive); }
  }
  handleMessage(message, sendResponse) {
    if (!message) return false;
    const enc = encodeURIComponent;
    const routes = {
      REFRESH_STATUS: () => this.checkStatus(true), START_WATCHER: () => this.startWatcher(message.targetDir, message.extraArgs), STOP_WATCHER: () => this.stopWatcher(),
      BUILD_PACKAGE: () => { const ka = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 15000); return this.postJson("/build-package", {}, 185000, "Impossible d'exécuter build_package.py.").finally(() => clearInterval(ka)); },
      START_BUILD_PACKAGE: () => this.postJson("/build-package-start", {}, 10000, "Impossible de démarrer build_package.py."),
      STOP_BUILD_PACKAGE: () => this.postJson("/build-package-stop", {}, 8000, "Impossible d'arrêter build_package.py."),
      POLL_BUILD_STREAM: () => this.getJson("/build-stream?offset=" + Number(message.offset || 0), 5000, "Erreur flux build."),
      EXPORT_FOLDERS: () => this.getJson("/export-folders", 5000, "Impossible de lister les dossiers."),
      EXPORT_PREVIEW: () => { const subs = Array.isArray(message.subpaths) && message.subpaths.length > 0 ? `?subpaths=${enc(message.subpaths.join(","))}` : ""; return this.getJson(`/export-preview${subs}`, 15000, "Aperçu indisponible."); },
      EXPORT_PROJECT: () => this.postJson("/export-project", { mode: message.mode || "full", subpaths: Array.isArray(message.subpaths) ? message.subpaths : [] }, 65000, "Impossible de générer l'export du projet."),
      GIT_STATUS: () => this.getJson("/git-status", 10000, "Impossible de lire git status."),
      GIT_DIFF_SELECTED: () => this.postJson("/git-diff", { files: message.files || [] }, 15000, "Impossible de récupérer git diff."),
      GIT_COMMIT: () => this.postJson("/git-commit", Array.isArray(message.files) && message.files.length > 0 ? { message: message.message || "", files: message.files } : { message: message.message || "" }, 15000, "Impossible d'exécuter git commit."),
      READ_SAVED_FILE: () => this.getJson("/read-file?header=" + enc(message.header || ""), 5000, "Impossible de relire le fichier sauvegardé."),
      GET_SYNTAX_ERROR: () => this.getJson("/last-syntax-error", 5000, "Impossible de lire l'erreur de syntaxe."),
      RUN_PROJECT_TESTS: () => this.runTests(message.injectIntoActiveTab !== false), STOP_PROJECT_TESTS: () => this.postJson("/run-tests-stop", {}, 8000, "Impossible d'arrêter les tests."),
      POLL_TEST_STREAM: () => this.getJson("/test-stream?offset=" + Number(message.offset || 0), 5000, "Erreur flux tests.")
    };
    const handler = routes[message.type];
    if (handler) { handler().then(sendResponse); return true; }
    if (message.type === "START_PROJECT_TESTS") { chrome.storage.local.get("savedTestRunner", (s) => { this.postJson("/run-tests-start", { test_runner: (s.savedTestRunner || "").trim() }, 10000, "Impossible de démarrer les tests.").then(sendResponse); }); return true; }
    if (message.type === "GIT_PUSH") { const ka = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 15000); this.postJson("/git-push", { remote: message.remote || "origin", branch: message.branch || "HEAD" }, 65000, "Impossible d'exécuter git push").then(sendResponse).finally(() => clearInterval(ka)); return true; }
    return false;
  }

  start() {
    setInterval(() => this.checkStatus(), this.FAST_POLL_INTERVAL_MS);
    this.checkStatus(true);
    chrome.runtime.onInstalled.addListener(() => { this.checkStatus(true); chrome.alarms.create(this.ALARM_NAME, { periodInMinutes: 0.5 }); this.nativeHelper?.reinjectContentScripts(); });
    chrome.runtime.onStartup.addListener(() => { this.checkStatus(true); chrome.alarms.create(this.ALARM_NAME, { periodInMinutes: 0.5 }); });
    chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === this.ALARM_NAME) this.checkStatus(true); });
    chrome.tabs.onActivated.addListener(() => this.checkStatus(true));
    chrome.windows.onFocusChanged.addListener((windowId) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) this.checkStatus(true); });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => this.handleMessage(msg, sendResponse));
  }
}
globalThis.GmcBackgroundService = WatcherBackgroundService;
if (typeof chrome !== "undefined" && chrome.runtime?.id) new WatcherBackgroundService().start();
