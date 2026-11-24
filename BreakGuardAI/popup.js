const DEFAULT_SETTINGS = {
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

const FIELD_IDS = Object.keys(DEFAULT_SETTINGS);

function fillForm(cfg) {
  const merged = { ...DEFAULT_SETTINGS, ...(cfg || {}) };
  for (const id of FIELD_IDS) {
    const el = document.getElementById(id);
    if (el) el.value = String(merged[id]);
  }
}

function readForm() {
  const out = {};
  for (const id of FIELD_IDS) {
    const el = document.getElementById(id);
    const val = Number(el?.value);
    out[id] = Number.isFinite(val) ? val : DEFAULT_SETTINGS[id];
  }
  return out;
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
  chrome.storage.local.get("breakGuardSettings", (res) => {
    fillForm(res?.breakGuardSettings);
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    const payload = readForm();
    chrome.runtime.sendMessage({ type: "BREAK_SAVE_SETTINGS", settings: payload }, (res) => {
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
