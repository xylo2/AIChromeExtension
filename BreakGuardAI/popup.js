const DEFAULT_SETTINGS = {
  enableMove: true,
  enableDrink: true,
  enableEyes: true,
  enablePosture: true,
  enableLunch: true,
  enableDinner: true,
  enableWindDown: true,
  enableNight: true,
  moveMinutes: 30,
  drinkMinutes: 120,
  eyesMinutes: 20,
  postureMinutes: 45,
  lunchStartHour: 12,
  lunchEndHour: 14,
  lunchRepeatMinutes: 30,
  dinnerStartHour: 19,
  dinnerEndHour: 22,
  dinnerRepeatMinutes: 30,
  windDownHour: 20,
  windDownMinute: 0,
  nightStartHour: 23,
  nightEndHour: 6,
  nightEndMinute: 30,
  nightRepeat0h: 10,
  nightRepeat1h: 5,
  nightRepeat2h: 2,
  idleResetMinutes: 15
};

const BOOL_IDS = ["enableMove", "enableDrink", "enableEyes", "enablePosture", "enableLunch", "enableDinner", "enableWindDown", "enableNight"];
const NUM_IDS = Object.keys(DEFAULT_SETTINGS).filter((k) => !BOOL_IDS.includes(k));

function fillForm(cfg) {
  const merged = { ...DEFAULT_SETTINGS, ...(cfg || {}) };
  for (const id of BOOL_IDS) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(merged[id]);
  }
  for (const id of NUM_IDS) {
    const el = document.getElementById(id);
    if (el) el.value = String(merged[id]);
  }
}

function readForm() {
  const out = {};
  for (const id of BOOL_IDS) {
    const el = document.getElementById(id);
    out[id] = el ? Boolean(el.checked) : DEFAULT_SETTINGS[id];
  }
  for (const id of NUM_IDS) {
    const el = document.getElementById(id);
    const val = Number(el?.value);
    out[id] = Number.isFinite(val) ? val : DEFAULT_SETTINGS[id];
  }
  return out;
}

function renderDnd(state) {
  const statusEl = document.getElementById("dndStatus");
  const offBtn = document.getElementById("dndOffBtn");
  const dndUntil = Number(state?.dndUntil || 0);
  if (dndUntil > Date.now()) {
    const remMin = Math.max(1, Math.ceil((dndUntil - Date.now()) / 60000));
    statusEl.textContent = `🔕 Pause active (${remMin} min)`;
    offBtn.style.display = "inline-block";
  } else {
    statusEl.textContent = "🔔 Alertes actives";
    offBtn.style.display = "none";
  }
}

function showStatus(text) {
  const box = document.getElementById("statusMsg");
  box.textContent = text;
  if (text) {
    setTimeout(() => {
      if (box.textContent === text) box.textContent = "";
    }, 2200);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["breakGuardSettings", "breakGuardState"], (res) => {
    fillForm(res?.breakGuardSettings);
    renderDnd(res?.breakGuardState);
  });

  document.getElementById("dnd1hBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "BREAK_SET_DND", minutes: 60 }, (res) => renderDnd(res?.state));
  });
  document.getElementById("dnd2hBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "BREAK_SET_DND", minutes: 120 }, (res) => renderDnd(res?.state));
  });
  document.getElementById("dndOffBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "BREAK_SET_DND", minutes: 0 }, (res) => renderDnd(res?.state));
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "BREAK_SAVE_SETTINGS", settings: readForm() }, (res) => {
      if (res?.settings) fillForm(res.settings);
      showStatus("✅ Réglages enregistrés !");
    });
  });

  document.getElementById("resetPosBtn").addEventListener("click", () => {
    chrome.storage.local.remove(["breakGuardLunchPos", "breakGuardStackPos"], () => {
      showStatus("📍 Positions réinitialisées");
    });
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "BREAK_SAVE_SETTINGS", settings: DEFAULT_SETTINGS }, (res) => {
      fillForm(res?.settings || DEFAULT_SETTINGS);
      showStatus("↺ Valeurs par défaut restaurées");
    });
  });
});
