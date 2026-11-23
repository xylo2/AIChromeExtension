const HOST_LOOPBACK = ["127", "0", "0", "1"].join(".");
const BASE_URL = `http://${HOST_LOOPBACK}:18765`;
const ALARM_NAME = "pollWatchClipboardStatus";
const NATIVE_HOST_NAME = "com.watch_clipboard.host";
const FAST_POLL_INTERVAL_MS = 1500;
const DEFAULT_ROOT_DIR = "C:\\git";
const DEFAULT_TEST_RUNNER = "tools/run_tests_clip.py";

let lastKnownSignature = "";
let isChecking = false;

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
      { signal: AbortSignal.timeout(2500), cache: "no-store" },
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

async function waitForExpectedState(expectedRunning, maxWaitMs = 3500) {
  const deadline = Date.now() + maxWaitMs;
  let state = await checkWatchClipboardStatus(true);
  while (state.running !== expectedRunning && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    state = await checkWatchClipboardStatus(true);
  }
  return state;
}

function isMissingHostError(errorMessage) {
  const lower = (errorMessage || "").toLowerCase();
  return lower.includes("native messaging host not found") || lower.includes("forbidden") || lower.includes("host has exited");
}

function generateSessionToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function startWatchClipboard(targetDir, extraArgs) {
  return new Promise(async (resolve) => {
    const apiToken = generateSessionToken();
    await chrome.storage.local.set({ watcherApiToken: apiToken });

    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      {
        action: "start",
        target_dir: targetDir || ".",
        extra_args: extraArgs || "",
        api_token: apiToken,
        allowed_origin: `chrome-extension://${chrome.runtime.id}`
      },
      async (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "Erreur Native Messaging";
          const stored = await chrome.storage.local.get("savedRootDir");
          const rootDir = (stored.savedRootDir || DEFAULT_ROOT_DIR).replace(/[\\/]+$/, "");
          resolve({
            ok: false,
            error: errMsg,
            missingHost: isMissingHostError(errMsg),
            installCommand: `python "${rootDir}\\tools\\watch_clipboard\\install_native_host.py" ${chrome.runtime.id}`
          });
          return;
        }
        const ok = Boolean(response && response.ok);
        const state = ok ? await waitForExpectedState(true, 3500) : await checkWatchClipboardStatus(true);
        resolve({ ok, response, state });
      }
    );
  });
}

async function stopWatchClipboard() {
  try {
    const apiToken = await getApiToken();
    await fetchWithTokenFallback(`${BASE_URL}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1500) }, apiToken);
  } catch (_err) {}
  await chrome.storage.local.remove("watcherApiToken");
  return waitForExpectedState(false, 2000);
}

async function exportProjectFiles() {
  try {
    const apiToken = await getApiToken();
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/export-project`,
      { method: "POST", signal: AbortSignal.timeout(65000) },
      apiToken
    );
    return await response.json();
  } catch (_err) {
    return { ok: false, error: "Impossible de générer l'export du projet." };
  }
}

async function getGitStatus() {
  try {
    const apiToken = await getApiToken();
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/git-status`,
      { signal: AbortSignal.timeout(10000), cache: "no-store" },
      apiToken
    );
    return await response.json();
  } catch (_err) {
    return { ok: false, error: "Impossible de lire git status." };
  }
}
async function getGitDiffSelected(files) {
  try {
    const apiToken = await getApiToken();
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/git-diff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files || [] }),
        signal: AbortSignal.timeout(15000)
      },
      apiToken
    );
    return await response.json();
  } catch (_err) {
    return { ok: false, error: "Impossible de récupérer git diff." };
  }
}

async function executeGitCommit(message, files) {
  try {
    const apiToken = await getApiToken();
    const payload = { message: message || "" };
    if (Array.isArray(files) && files.length > 0) {
      payload.files = files;
    }
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/git-commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      },
      apiToken
    );
    return await response.json();
  } catch (_err) {
    return { ok: false, error: "Impossible d'exécuter git commit." };
  }
}

async function readSavedFile(header) {
  try {
    const apiToken = await getApiToken();
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/read-file?header=${encodeURIComponent(header || "")}`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
      apiToken
    );
    return await response.json();
  } catch (_err) {
    return { ok: false, error: "Impossible de relire le fichier sauvegardé." };
  }
}

async function runProjectTests(injectIntoActiveTab = true) {
  try {
    const stored = await chrome.storage.local.get(["savedTestRunner", "watcherApiToken"]);
    const testRunner = (stored.savedTestRunner || "").trim();
    const apiToken = stored.watcherApiToken || "";
    const response = await fetchWithTokenFallback(
      `${BASE_URL}/run-tests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_runner: testRunner }),
        signal: AbortSignal.timeout(185000)
      },
      apiToken
    );
    const result = await response.json();
    if (result && result.ok && result.output && injectIntoActiveTab) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs.at(0);
      if (activeTab && activeTab.id) {
        try {
          const tabReply = await chrome.tabs.sendMessage(activeTab.id, {
            type: "INSERT_TEST_RESULT",
            output: result.output,
            passed: Boolean(result.passed)
          });
          result.insertedInPage = Boolean(tabReply && tabReply.inserted);
        } catch (_err) {
          result.insertedInPage = false;
        }
      }
    }
    return result;
  } catch (_err) {
    return { ok: false, error: "Impossible de contacter watch_clipboard ou délai dépassé." };
  }
}

async function reinjectContentScriptsIntoOpenTabs() {
  if (!chrome.scripting) return;
  try {
    const tabs = await chrome.tabs.query({ url: ["*://*://*", "*://*.google.fr/*"] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__gmcInitialized = false;
            document.querySelectorAll(".gmc-floating-bar, .gmc-placeholder, .gmc-purge-btn, .gmc-git-panel, .gmc-commit-action-bar").forEach((n) => n.remove());
            document.querySelectorAll("[data-gmc-processed], [data-gmc-commit-processed]").forEach((el) => {
              el.removeAttribute("data-gmc-processed");
              el.removeAttribute("data-gmc-commit-processed");
              el.classList.remove("gmc-collapsed-code");
            });
            document.querySelectorAll("[data-gmc-has-purge], [data-gmc-copy-watched]").forEach((el) => {
              el.removeAttribute("data-gmc-has-purge");
              el.removeAttribute("data-gmc-copy-watched");
            });
          }
        });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["spill_detector.js", "chat_injector.js", "git_panel.js", "block_manager.js", "content.js"]
        });
      } catch (_tabErr) {}
    }
  } catch (_err) {}
}

setInterval(() => checkWatchClipboardStatus(), FAST_POLL_INTERVAL_MS);
chrome.runtime.onInstalled.addListener(() => {
  checkWatchClipboardStatus(true);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  reinjectContentScriptsIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => { checkWatchClipboardStatus(true); chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 }); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) checkWatchClipboardStatus(true); });
chrome.tabs.onActivated.addListener(() => checkWatchClipboardStatus(true));
chrome.windows.onFocusChanged.addListener((windowId) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) checkWatchClipboardStatus(true); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;
  if (message.type === "REFRESH_STATUS") { checkWatchClipboardStatus(true).then(sendResponse); return true; }
  if (message.type === "START_WATCHER") { startWatchClipboard(message.targetDir, message.extraArgs).then(sendResponse); return true; }
  if (message.type === "STOP_WATCHER") { stopWatchClipboard().then(sendResponse); return true; }
  if (message.type === "EXPORT_PROJECT") { exportProjectFiles().then(sendResponse); return true; }
  if (message.type === "GIT_STATUS") { getGitStatus().then(sendResponse); return true; }
  if (message.type === "GIT_DIFF_SELECTED") { getGitDiffSelected(message.files).then(sendResponse); return true; }
  if (message.type === "GIT_COMMIT") { executeGitCommit(message.message, message.files).then(sendResponse); return true; }
  if (message.type === "READ_SAVED_FILE") { readSavedFile(message.header).then(sendResponse); return true; }
  if (message.type === "RUN_PROJECT_TESTS") { runProjectTests(message.injectIntoActiveTab !== false).then(sendResponse); return true; }
});
