const STORAGE_KEY = "breakGuardState";
const ALARM_NAME = "breakGuardTick";

const DEFAULT_STATE = {
  moveStart: null,
  drinkStart: null,
  lunchWindowStart: null,
  lunchTakenDate: null,
  lastActivity: null,
  snoozeUntil: 0,
  nightAlertCount: 0,
  dismissedTypes: []
};

function getDateKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isAfterMidnight(d = new Date()) {
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 0 && mins < (6 * 60 + 30);
}

function isLunchTime(d = new Date()) {
  const h = d.getHours();
  return h >= 12 && h < 14;
}

function getNightRepeatMs(d = new Date()) {
  const h = d.getHours();
  if (h >= 2) return 2 * 60 * 1000;
  if (h >= 1) return 5 * 60 * 1000;
  return 10 * 60 * 1000;
}

async function loadState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_STATE, ...(res[STORAGE_KEY] || {}) };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await broadcastState(state);
  return state;
}

async function broadcastState(state) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "BREAK_STATE_UPDATED", state }).catch(() => {});
      }
    }
  } catch (_err) {}
}

function applyActivity(state, now = Date.now(), d = new Date()) {
  const idleResetMs = 15 * 60 * 1000;
  const isIdle = state.lastActivity && (now - state.lastActivity >= idleResetMs);
  if (!state.moveStart || isIdle) {
    state.moveStart = now;
    state.snoozeUntil = 0;
    if (isIdle) {
      state.nightAlertCount = 0;
      state.dismissedTypes = [];
    }
  }
  if (!state.drinkStart) state.drinkStart = now;
  if (!isAfterMidnight(d)) {
    state.nightAlertCount = 0;
    state.dismissedTypes = state.dismissedTypes.filter((t) => t !== "night");
  }
  if (isLunchTime(d) && state.lunchTakenDate !== getDateKey(d)) {
    if (!state.lunchWindowStart || isIdle) state.lunchWindowStart = now;
  } else {
    state.lunchWindowStart = null;
    state.dismissedTypes = state.dismissedTypes.filter((t) => t !== "lunch");
  }
  state.lastActivity = now;
  return state;
}

function applyAcknowledge(state, type, now = Date.now(), d = new Date()) {
  state.lastActivity = now;
  const dismissed = new Set(state.dismissedTypes || []);
  dismissed.add(type);
  if (type === "lunch") {
    state.moveStart = now;
    state.drinkStart = now;
    state.lunchWindowStart = null;
    state.lunchTakenDate = getDateKey(d);
    state.snoozeUntil = 0;
    state.nightAlertCount = 0;
    dismissed.add("move");
    dismissed.add("drink");
  } else if (type === "night") {
    state.moveStart = now;
    state.snoozeUntil = now + getNightRepeatMs(d);
  } else if (type === "drink") {
    state.drinkStart = now;
    if (state.moveStart && now - state.moveStart >= 30 * 60 * 1000) {
      state.moveStart = now;
      dismissed.add("move");
    }
    state.snoozeUntil = 0;
  } else if (type === "move") {
    state.moveStart = now;
    state.snoozeUntil = 0;
  }
  state.dismissedTypes = Array.from(dismissed);
  return state;
}

async function handleAction(msg) {
  let state = await loadState();
  const now = Date.now();
  const d = new Date();
  if (msg.type === "BREAK_ACTIVITY") {
    state = applyActivity(state, now, d);
    return saveState(state);
  }
  if (msg.type === "BREAK_ACK") {
    state = applyAcknowledge(state, msg.alertType, now, d);
    return saveState(state);
  }
  if (msg.type === "BREAK_NIGHT_SHOWN") {
    state.nightAlertCount = (state.nightAlertCount || 0) + 1;
    state.dismissedTypes = (state.dismissedTypes || []).filter((t) => t !== "night");
    return saveState(state);
  }
  return state;
}

async function reinjectAllTabs() {
  if (!chrome.scripting) return;
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__bgBreakInit = false;
            document.querySelectorAll(".gmc-break-stack, .gmc-break-lunch-pill").forEach((n) => n.remove());
          }
        });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["break_guard.js", "content.js"] });
      } catch (_e) {}
    }
  } catch (_err) {}
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  reinjectAllTabs();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const st = await loadState();
    await broadcastState(st);
  }
});
chrome.tabs.onActivated.addListener(async () => {
  const st = await loadState();
  await broadcastState(st);
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !String(msg.type || "").startsWith("BREAK_")) return;
  handleAction(msg).then(sendResponse);
  return true;
});
