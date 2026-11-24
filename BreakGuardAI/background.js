const STORAGE_KEY = "breakGuardState";
const SETTINGS_KEY = "breakGuardSettings";
const ALARM_NAME = "breakGuardTick";

const DEFAULT_SETTINGS = {
  moveMinutes: 30,
  drinkMinutes: 120,
  lunchStartHour: 12,
  lunchEndHour: 14,
  lunchRepeatMinutes: 30,
  nightStartHour: 0,
  nightEndHour: 6,
  nightEndMinute: 30,
  nightRepeat0h: 10,
  nightRepeat1h: 5,
  nightRepeat2h: 2,
  idleResetMinutes: 15
};

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

function sanitizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const clamp = (val, min, max, fallback) => {
    const n = Number(val);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const lunchStart = clamp(src.lunchStartHour, 0, 23, DEFAULT_SETTINGS.lunchStartHour);
  const lunchEnd = clamp(src.lunchEndHour, lunchStart + 1, 24, Math.max(lunchStart + 1, DEFAULT_SETTINGS.lunchEndHour));
  return {
    moveMinutes: clamp(src.moveMinutes, 1, 480, DEFAULT_SETTINGS.moveMinutes),
    drinkMinutes: clamp(src.drinkMinutes, 1, 720, DEFAULT_SETTINGS.drinkMinutes),
    lunchStartHour: lunchStart,
    lunchEndHour: lunchEnd,
    lunchRepeatMinutes: clamp(src.lunchRepeatMinutes, 1, 180, DEFAULT_SETTINGS.lunchRepeatMinutes),
    nightStartHour: clamp(src.nightStartHour, 0, 23, DEFAULT_SETTINGS.nightStartHour),
    nightEndHour: clamp(src.nightEndHour, 0, 12, DEFAULT_SETTINGS.nightEndHour),
    nightEndMinute: clamp(src.nightEndMinute, 0, 59, DEFAULT_SETTINGS.nightEndMinute),
    nightRepeat0h: clamp(src.nightRepeat0h, 1, 120, DEFAULT_SETTINGS.nightRepeat0h),
    nightRepeat1h: clamp(src.nightRepeat1h, 1, 120, DEFAULT_SETTINGS.nightRepeat1h),
    nightRepeat2h: clamp(src.nightRepeat2h, 1, 120, DEFAULT_SETTINGS.nightRepeat2h),
    idleResetMinutes: clamp(src.idleResetMinutes, 1, 240, DEFAULT_SETTINGS.idleResetMinutes)
  };
}

function getDateKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isAfterMidnight(d = new Date(), cfg = DEFAULT_SETTINGS) {
  const s = sanitizeSettings(cfg);
  const mins = d.getHours() * 60 + d.getMinutes();
  const startMins = s.nightStartHour * 60;
  const endMins = s.nightEndHour * 60 + s.nightEndMinute;
  if (startMins <= endMins) return mins >= startMins && mins < endMins;
  return mins >= startMins || mins < endMins;
}

function isLunchTime(d = new Date(), cfg = DEFAULT_SETTINGS) {
  const s = sanitizeSettings(cfg);
  const h = d.getHours();
  return h >= s.lunchStartHour && h < s.lunchEndHour;
}

function getNightRepeatMs(d = new Date(), cfg = DEFAULT_SETTINGS) {
  const s = sanitizeSettings(cfg);
  const h = d.getHours();
  if (h >= 2 && h <= s.nightEndHour) return s.nightRepeat2h * 60 * 1000;
  if (h === 1) return s.nightRepeat1h * 60 * 1000;
  return s.nightRepeat0h * 60 * 1000;
}

async function loadSettings() {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(res[SETTINGS_KEY]);
}

async function loadState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_STATE, ...(res[STORAGE_KEY] || {}) };
}

async function broadcastPayload(state, settings) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "BREAK_STATE_UPDATED", state, settings }).catch(() => {});
      }
    }
  } catch (_err) {}
}

async function saveState(state, settings) {
  const cfg = settings || (await loadSettings());
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await broadcastPayload(state, cfg);
  return state;
}
function applyActivity(state, now = Date.now(), d = new Date(), cfg = DEFAULT_SETTINGS) {
  const s = sanitizeSettings(cfg);
  const idleResetMs = s.idleResetMinutes * 60 * 1000;
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
  if (!isAfterMidnight(d, s)) {
    state.nightAlertCount = 0;
    state.dismissedTypes = state.dismissedTypes.filter((t) => t !== "night");
  }
  if (isLunchTime(d, s) && state.lunchTakenDate !== getDateKey(d)) {
    if (!state.lunchWindowStart || isIdle) state.lunchWindowStart = now;
  } else {
    state.lunchWindowStart = null;
    state.dismissedTypes = state.dismissedTypes.filter((t) => t !== "lunch");
  }
  state.lastActivity = now;
  return state;
}

function applyAcknowledge(state, type, now = Date.now(), d = new Date(), cfg = DEFAULT_SETTINGS) {
  const s = sanitizeSettings(cfg);
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
    state.snoozeUntil = now + getNightRepeatMs(d, s);
  } else if (type === "drink") {
    state.drinkStart = now;
    if (state.moveStart && now - state.moveStart >= s.moveMinutes * 60 * 1000) {
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
  const cfg = await loadSettings();
  let state = await loadState();
  const now = Date.now();
  const d = new Date();
  if (msg.type === "BREAK_ACTIVITY") {
    state = applyActivity(state, now, d, cfg);
    return { state: await saveState(state, cfg), settings: cfg };
  }
  if (msg.type === "BREAK_ACK") {
    state = applyAcknowledge(state, msg.alertType, now, d, cfg);
    return { state: await saveState(state, cfg), settings: cfg };
  }
  if (msg.type === "BREAK_NIGHT_SHOWN") {
    state.nightAlertCount = (state.nightAlertCount || 0) + 1;
    state.dismissedTypes = (state.dismissedTypes || []).filter((t) => t !== "night");
    return { state: await saveState(state, cfg), settings: cfg };
  }
  if (msg.type === "BREAK_SAVE_SETTINGS") {
    const nextCfg = sanitizeSettings(msg.settings);
    await chrome.storage.local.set({ [SETTINGS_KEY]: nextCfg });
    await broadcastPayload(state, nextCfg);
    return { state, settings: nextCfg };
  }
  return { state, settings: cfg };
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
    const [st, cfg] = await Promise.all([loadState(), loadSettings()]);
    await broadcastPayload(st, cfg);
  }
});
chrome.tabs.onActivated.addListener(async () => {
  const [st, cfg] = await Promise.all([loadState(), loadSettings()]);
  await broadcastPayload(st, cfg);
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !String(msg.type || "").startsWith("BREAK_")) return;
  handleAction(msg).then(sendResponse);
  return true;
});
