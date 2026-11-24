const HOST_LOOPBACK = ["127", "0", "0", "1"].join(".");
const BASE_URL = `http://${HOST_LOOPBACK}:18765`;
const ALARM_NAME = "pollWatchClipboardStatus";
const NATIVE_HOST_NAME = "com.watch_clipboard.host";
const FAST_POLL_INTERVAL_MS = 1500;
const DEFAULT_ROOT_DIR = "C:\\git";
const DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";

let lastKnownSignature = "";
let isChecking = false;
let activeStartPromise = null;

function extractWorkspaceRoot(fullPath) {
  if (!fullPath || typeof fullPath !== "string") return null;
  const normalized = fullPath.replace(/[\\/]+$/, "");
  const toolsIdx = normalized.search(/[\\/]tools(?:[\\/]|$)/i);
  if (toolsIdx > 0) {
    return normalized.slice(0, toolsIdx);
  }
  const lastSep = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (lastSep <= 0) return null;
  if (lastSep === 2 && normalized.charAt(1) === ":") {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, lastSep);
}

async function getApiToken() {
  const stored = await chrome.storage.local.get("watcherApiToken");
  return stored.watcherApiToken || "";
}

async function broadcastStateToTabs(state) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "WATCHER_STATE_CHANGED",
          state
        }).catch(() => {});
      }
    }
  } catch (_err) {}
}

async function fetchWithTokenFallback(url, options, apiToken) {
  const baseHeaders = { ...(options.headers || {}) };
  if (apiToken) {
    baseHeaders["X-Watcher-Token"] = apiToken;
  }
  let response = await fetch(url, { ...options, headers: baseHeaders });
  if (response.status === 401 && apiToken) {
    const retryHeaders = { ...(options.headers || {}) };
    response = await fetch(url, { ...options, headers: retryHeaders });
    if (response.ok) {
      await chrome.storage.local.remove("watcherApiToken");
    }
  }
  return response;
}
async function checkWatchClipboardStatus(forceBroadcast = false) {
  if (isChecking) {
    const stored = await chrome.storage.local.get("watchClipboardState");
    return stored.watchClipboardState || { running: false };
  }
  isChecking = true;

  const storedPrefs = await chrome.storage.local.get(["savedTestRunner", "watcherApiToken"]);
  const customRunner = (storedPrefs.savedTestRunner || "").trim();
  const apiToken = storedPrefs.watcherApiToken || "";

  const state = {
    running: false,
    targetDir: null,
    pid: null,
    command: null,
    hasRunTestsClip: false,
    hasExporter: false,
    hasGit: false,
    testRunnerPath: null,
    lastEvent: null,
    configuredTestRunner: customRunner || DEFAULT_TEST_RUNNER,
    checkedAt: new Date().toLocaleTimeString()
  };

  try {
    const query = customRunner ? `?test_runner=${encodeURIComponent(customRunner)}` : "";
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/status${query}`,
      { signal: AbortSignal.timeout(4500), cache: "no-store" },
      apiToken
    );

    if (response.ok) {
      const data = await response.json();
      if (data && data.status === "running") {
        state.running = true;
        state.targetDir = data.target_dir || "";
        state.pid = data.pid || null;
        state.command = data.command || null;
        state.hasRunTestsClip = Boolean(data.has_run_tests_clip);
        state.hasExporter = Boolean(data.has_exporter);
        state.hasGit = Boolean(data.has_git);
        state.testRunnerPath = data.test_runner_path || null;
        state.lastEvent = data.last_event || null;
        if (data.configured_test_runner) {
          state.configuredTestRunner = data.configured_test_runner;
        }
        const detectedRoot = extractWorkspaceRoot(state.targetDir);
        if (detectedRoot) {
          await chrome.storage.local.set({ savedRootDir: detectedRoot });
        }
      }
    }
  } catch (_err) {
    state.running = false;
  } finally {
    isChecking = false;
  }
  const signature = `${state.running}|${state.targetDir}|${state.pid}|${state.hasRunTestsClip}|${state.hasExporter}|${state.hasGit}|${state.lastEvent}`;
  await chrome.storage.local.set({ watchClipboardState: state });
  updateBadge(state.running);

  if (forceBroadcast || lastKnownSignature !== signature) {
    lastKnownSignature = signature;
    await broadcastStateToTabs(state);
  }
  return state;
}

function updateBadge(isRunning) {
  chrome.action.setBadgeText({ text: isRunning ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: isRunning ? "#16a34a" : "#dc2626" });
}

async function waitForExpectedState(expectedRunning, maxWaitMs = 4500) {
  const deadline = Date.now() + maxWaitMs;
  let state = await checkWatchClipboardStatus(true);
  while (state.running !== expectedRunning && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    state = await checkWatchClipboardStatus(true);
  }
  return state;
}

function isMissingHostError(errorMessage) {
  const lower = (errorMessage || "").toLowerCase();
  return (
    lower.includes("native messaging host not found") ||
    lower.includes("forbidden") ||
    lower.includes("host has exited") ||
    lower.includes("communicating with the native messaging host")
  );
}

function generateSessionToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function startWatchClipboard(targetDir, extraArgs) {
  if (activeStartPromise) return activeStartPromise;
  activeStartPromise = (async () => {
    try {
      const current = await checkWatchClipboardStatus(false);
      if (current && current.running) return { ok: true, alreadyRunning: true, state: current };
      const apiToken = generateSessionToken();
      await chrome.storage.local.set({ watcherApiToken: apiToken });
      return await new Promise((resolve) => {
        chrome.runtime.sendNativeMessage(
          NATIVE_HOST_NAME,
          { action: "start", target_dir: targetDir || ".", extra_args: extraArgs || "", api_token: apiToken, allowed_origin: `chrome-extension://${chrome.runtime.id}` },
          async (response) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || "Erreur Native Messaging";
              const stored = await chrome.storage.local.get("savedRootDir");
              const rootDir = (stored.savedRootDir || DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
              resolve({ ok: false, error: errMsg, missingHost: isMissingHostError(errMsg), installCommand: `python "${rootDir}\\tools\\watch_clipboard\\install_native_host.py" ${chrome.runtime.id}` });
              return;
            }
            const ok = Boolean(response && response.ok);
            const state = ok ? await waitForExpectedState(true, 4500) : await checkWatchClipboardStatus(true);
            resolve({ ok, response, state });
          }
        );
      });
    } finally { activeStartPromise = null; }
  })();
  return activeStartPromise;
}

async function stopWatchClipboard() {
  try {
    const apiToken = await getApiToken();
    await fetchWithTokenFallback(`${BASE_URL}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1500) }, apiToken);
  } catch (_err) {}
  await chrome.storage.local.remove("watcherApiToken");
  return waitForExpectedState(false, 2000);
}

async function postJsonEndpoint(endpoint, bodyObj, timeoutMs = 15000, errFallback = "Erreur serveur.") {
  try {
    const apiToken = await getApiToken();
    const res = await fetchWithTokenFallback(`${BASE_URL}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(timeoutMs) }, apiToken);
    return await res.json();
  } catch (err) { return { ok: false, error: `${errFallback} (${err?.message || "réseau"})` }; }
}

async function getJsonEndpoint(endpoint, timeoutMs = 10000, errFallback = "Erreur lecture.") {
  try {
    const apiToken = await getApiToken();
    const res = await fetchWithTokenFallback(`${BASE_URL}${endpoint}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }, apiToken);
    return await res.json();
  } catch (_err) { return { ok: false, error: errFallback }; }
}

async function runProjectTests(injectIntoActiveTab = true) {
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 15000);
  try {
    const stored = await chrome.storage.local.get(["savedTestRunner", "watcherApiToken"]);
    const res = await fetchWithTokenFallback(`${BASE_URL}/run-tests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test_runner: (stored.savedTestRunner || "").trim() }), signal: AbortSignal.timeout(185000) }, stored.watcherApiToken || "");
    const result = await res.json();
    if (result?.ok && result.output && injectIntoActiveTab) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs?.at(0);
      if (activeTab?.id) {
        try {
          const reply = await chrome.tabs.sendMessage(activeTab.id, { type: "INSERT_TEST_RESULT", output: result.output, passed: Boolean(result.passed) });
          result.insertedInPage = Boolean(reply?.inserted);
        } catch (_err) { result.insertedInPage = false; }
      }
    }
    return result;
  } catch (err) { return { ok: false, error: `Impossible d'exécuter les tests (${err?.message || "délai dépassé"}).` }; }
  finally { clearInterval(keepAlive); }
}

async function reinjectContentScriptsIntoOpenTabs() {
  if (!chrome.scripting) return;
  try {
    const patterns = ["com/*", "fr/*"].map((tld) => `*://*.google.${tld}`);
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__gmcInitialized = false;
            document.querySelectorAll(".gmc-floating-bar, .gmc-composer-quick-group, .gmc-placeholder, .gmc-purge-btn, .gmc-git-panel, .gmc-commit-action-bar").forEach((n) => n.remove());
            document.querySelectorAll("[data-gmc-processed], [data-gmc-commit-processed]").forEach((el) => { el.removeAttribute("data-gmc-processed"); el.removeAttribute("data-gmc-commit-processed"); el.classList.remove("gmc-collapsed-code"); });
            document.querySelectorAll("[data-gmc-has-purge], [data-gmc-copy-watched]").forEach((el) => { el.removeAttribute("data-gmc-has-purge"); el.removeAttribute("data-gmc-copy-watched"); });
          }
        });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["spill_detector.js", "chat_injector.js", "git_panel.js", "block_manager.js", "content.js"] });
      } catch (_tabErr) {}
    }
  } catch (_err) {}
}

setInterval(() => checkWatchClipboardStatus(), FAST_POLL_INTERVAL_MS);
checkWatchClipboardStatus(true);
chrome.runtime.onInstalled.addListener(() => { checkWatchClipboardStatus(true); chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 }); reinjectContentScriptsIntoOpenTabs(); });
chrome.runtime.onStartup.addListener(() => { checkWatchClipboardStatus(true); chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 }); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) checkWatchClipboardStatus(true); });
chrome.tabs.onActivated.addListener(() => checkWatchClipboardStatus(true));
chrome.windows.onFocusChanged.addListener((windowId) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) checkWatchClipboardStatus(true); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;
  if (message.type === "REFRESH_STATUS") { checkWatchClipboardStatus(true).then(sendResponse); return true; }
  if (message.type === "START_WATCHER") { startWatchClipboard(message.targetDir, message.extraArgs).then(sendResponse); return true; }
  if (message.type === "STOP_WATCHER") { stopWatchClipboard().then(sendResponse); return true; }
  if (message.type === "EXPORT_PROJECT") { postJsonEndpoint("/export-project", {}, 65000, "Impossible de générer l'export du projet.").then(sendResponse); return true; }
  if (message.type === "GIT_STATUS") { getJsonEndpoint("/git-status", 10000, "Impossible de lire git status.").then(sendResponse); return true; }
  if (message.type === "GIT_DIFF_SELECTED") { postJsonEndpoint("/git-diff", { files: message.files || [] }, 15000, "Impossible de récupérer git diff.").then(sendResponse); return true; }
  if (message.type === "GIT_COMMIT") { postJsonEndpoint("/git-commit", Array.isArray(message.files) && message.files.length > 0 ? { message: message.message || "", files: message.files } : { message: message.message || "" }, 15000, "Impossible d'exécuter git commit.").then(sendResponse); return true; }
  if (message.type === "GIT_PUSH") { const ka = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 15000); postJsonEndpoint("/git-push", { remote: message.remote || "origin", branch: message.branch || "HEAD" }, 65000, "Impossible d'exécuter git push").then(sendResponse).finally(() => clearInterval(ka)); return true; }
  if (message.type === "READ_SAVED_FILE") { getJsonEndpoint(`/read-file?header=${encodeURIComponent(message.header || "")}`, 5000, "Impossible de relire le fichier sauvegardé.").then(sendResponse); return true; }
  if (message.type === "RUN_PROJECT_TESTS") { runProjectTests(message.injectIntoActiveTab !== false).then(sendResponse); return true; }
});
