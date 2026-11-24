/**
 * Rendu et évaluation des alertes synchronisées sur l'état global partagé.
 */
class GlobalBreakGuard {
  constructor(options = {}) {
    this.nowFn = options.nowFn || (() => Date.now());
    this.dateFn = options.dateFn || (() => new Date());
    this.onAcknowledge = options.onAcknowledge || (() => {});
    this.onNightShown = options.onNightShown || (() => {});
    this.customStackPos = null;
    this.settings = {
      moveMinutes: options.moveLimitMinutes ?? 30,
      drinkMinutes: options.drinkLimitMinutes ?? 120,
      lunchStartHour: options.lunchStartHour ?? 12,
      lunchEndHour: options.lunchEndHour ?? 14,
      lunchRepeatMinutes: options.lunchRepeatMinutes ?? 30,
      nightStartHour: options.midnightStartHour ?? 0,
      nightEndHour: 6,
      nightEndMinute: 30,
      nightRepeat0h: 10,
      nightRepeat1h: 5,
      nightRepeat2h: 2,
      idleResetMinutes: options.idleResetMinutes ?? 15
    };
    this.state = {
      moveStart: null,
      drinkStart: null,
      lunchWindowStart: null,
      lunchTakenDate: null,
      lastActivity: null,
      snoozeUntil: 0,
      nightAlertCount: 0,
      dismissedTypes: []
    };
  }

  get moveLimitMs() { return this.settings.moveMinutes * 60 * 1000; }
  get drinkLimitMs() { return this.settings.drinkMinutes * 60 * 1000; }
  get lunchRepeatMs() { return this.settings.lunchRepeatMinutes * 60 * 1000; }
  get idleResetMs() { return this.settings.idleResetMinutes * 60 * 1000; }

  formatDuration(minutes) {
    const mins = Math.max(1, Math.round(Number(minutes) || 0));
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    const hLabel = `${hours} h`;
    return rem > 0 ? `${hLabel} ${rem}` : hLabel;
  }

  applySettings(cfg) {
    if (!cfg || typeof cfg !== "object") return;
    this.settings = { ...this.settings, ...cfg };
    this.syncDom();
  }

  getDateKey(d = this.dateFn()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  isAfterMidnight(d = this.dateFn()) {
    const mins = d.getHours() * 60 + d.getMinutes();
    const startMins = this.settings.nightStartHour * 60;
    const endMins = this.settings.nightEndHour * 60 + this.settings.nightEndMinute;
    if (startMins <= endMins) return mins >= startMins && mins < endMins;
    return mins >= startMins || mins < endMins;
  }

  isLunchTime(d = this.dateFn()) {
    const h = d.getHours();
    return h >= this.settings.lunchStartHour && h < this.settings.lunchEndHour;
  }

  hasEatenToday(d = this.dateFn()) {
    return this.state.lunchTakenDate === this.getDateKey(d);
  }

  getNightRepeatMinutes(d = this.dateFn()) {
    const h = d.getHours();
    if (h >= 2 && h < 12) return this.settings.nightRepeat2h;
    if (h >= 1 && h < 12) return this.settings.nightRepeat1h;
    return this.settings.nightRepeat0h;
  }

  getNightProgress(count) {
    if (count <= 1) return 0;
    return Math.min(1, (count - 1) / 5);
  }

  setState(newState, newSettings = null) {
    if (newSettings && typeof newSettings === "object") {
      this.settings = { ...this.settings, ...newSettings };
    }
    if (newState) {
      this.state = { ...this.state, ...newState };
    }
    this.syncDom();
  }

  getActiveAlerts() {
    const now = this.nowFn();
    const d = this.dateFn();
    const st = this.state;
    const isNight = this.isAfterMidnight(d);
    if (!st.moveStart || !st.lastActivity) return [];
    if (now - st.lastActivity >= this.idleResetMs) return [];
    if (now < (st.snoozeUntil || 0)) return [];
    const dismissed = new Set(st.dismissedTypes || []);
    const alerts = [];
    if (isNight && !dismissed.has("night")) {
      const h = d.getHours();
      alerts.push({
        type: "night",
        message: h >= 1 ? `🌙 Il est ${h}h passées : Va te coucher maintenant !` : "🌙 Il est tard : Va te coucher !"
      });
    }
    if (this.isLunchTime(d) && !this.hasEatenToday(d) && !dismissed.has("lunch")) {
      if (st.lunchWindowStart && now - st.lunchWindowStart >= this.lunchRepeatMs) {
        alerts.push({ type: "lunch", message: "🍽️ Il est l'heure de déjeuner : pense à aller manger !" });
      }
    }
    if (st.drinkStart && now - st.drinkStart >= this.drinkLimitMs && !dismissed.has("drink")) {
      alerts.push({ type: "drink", message: "💧 N'oublie pas de boire" });
    }
    if (!isNight && now - st.moveStart >= this.moveLimitMs && !dismissed.has("move")) {
      alerts.push({ type: "move", message: "🚶 Ton corps a besoin de bouger, même un tout petit peu, lève-toi" });
    }
    return alerts;
  }

  getAlertSvg(type) {
    const svgs = {
      night: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#1e1b4b" stroke="#c084fc" stroke-width="2.5"/><path d="M29.5 13.5C23.5 14.2 19 19.3 19 25.5C19 32.1 24.4 37.5 31 37.5C33.4 37.5 35.6 36.8 37.4 35.6C35.4 38.6 32 40.5 28 40.5C21.6 40.5 16.5 35.4 16.5 29C16.5 22.8 21.3 17.8 27.4 17.5C28.2 16 28.9 14.7 29.5 13.5Z" fill="#fde047"/><path d="M34 12L35 14.5L37.5 15.5L35 16.5L34 19L33 16.5L30.5 15.5L33 14.5L34 12Z" fill="#f472b6"/><circle cx="14" cy="16" r="1.8" fill="#fde047"/></svg>',
      move: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#022c22" stroke="#34d399" stroke-width="2.5"/><circle cx="25" cy="12" r="3.6" fill="#6ee7b7"/><path d="M17 20L24 18L32 15M24 18L22 28L16 37M22 28L29 31L31 38" stroke="#ecfdf5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 39H36" stroke="#10b981" stroke-width="2.5" stroke-linecap="round"/></svg>',
      drink: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#082f49" stroke="#38bdf8" stroke-width="2.5"/><path d="M16 14H32L29.5 36H18.5L16 14Z" stroke="#e0f2fe" stroke-width="2.5" stroke-linejoin="round"/><path d="M17.3 24C20 22.5 23 25.5 26 24C28 23 29.5 23.5 30.7 24L29.5 35H18.5L17.3 24Z" fill="#0ea5e9"/><path d="M35 12C35 12 38 15.2 38 17C38 18.7 36.7 20 35 20C33.3 20 32 18.7 32 17C32 15.2 35 12 35 12Z" fill="#7dd3fc"/></svg>',
      lunch: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#290d02" stroke="#fb923c" stroke-width="2.5"/><circle cx="24" cy="25" r="10.5" fill="#fff7ed" stroke="#fdba74" stroke-width="2"/><circle cx="24" cy="25" r="6" stroke="#ea580c" stroke-width="1.8" stroke-dasharray="2.5 2"/><path d="M10.5 13.5V21C10.5 22.8 11.8 24 13.5 24V36.5M13.5 13.5V21M36.5 13.5V36.5M36.5 13.5C38.8 13.5 39.6 16.2 39.6 19.5C39.6 22.2 38.3 23.8 36.5 23.8" stroke="#fef3c7" stroke-width="2.6" stroke-linecap="round"/></svg>'
    };
    return svgs[type] || svgs.lunch;
  }

  applyStackPosition(stack) {
    if (!stack || stack.querySelector?.(".gmc-break-fullscreen")) return;
    if (!this.customStackPos) {
      stack.style.top = "18px";
      stack.style.right = "20px";
      stack.style.left = "auto";
      return;
    }
    const maxW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const maxH = typeof window !== "undefined" ? window.innerHeight : 800;
    const clampedX = Math.min(Math.max(8, this.customStackPos.x), Math.max(8, maxW - (stack.offsetWidth || 520) - 8));
    const clampedY = Math.min(Math.max(8, this.customStackPos.y), Math.max(8, maxH - (stack.offsetHeight || 160) - 8));
    stack.style.left = `${clampedX}px`;
    stack.style.top = `${clampedY}px`;
    stack.style.right = "auto";
  }

  setStackPosition(pos) {
    this.customStackPos = pos && typeof pos.x === "number" ? pos : null;
    if (typeof document !== "undefined") {
      const stack = document.querySelector(".gmc-break-stack");
      if (stack) this.applyStackPosition(stack);
    }
  }

  makeStackDraggable(stack) {
    if (stack.__gmcDragBound || typeof window === "undefined") return;
    stack.__gmcDragBound = true;
    stack.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target?.closest?.("button") || stack.querySelector(".gmc-break-fullscreen")) return;
      const rect = stack.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      stack.classList.add("gmc-dragging");
      const onMove = (ev) => {
        this.customStackPos = { x: ev.clientX - offsetX, y: ev.clientY - offsetY };
        this.applyStackPosition(stack);
      };
      const onUp = () => {
        stack.classList.remove("gmc-dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (this.customStackPos && typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ breakGuardStackPos: this.customStackPos });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  getContainer() {
    if (typeof document === "undefined" || !document.body) return null;
    let stack = document.querySelector(".gmc-break-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "gmc-break-stack";
      document.body.appendChild(stack);
    }
    this.makeStackDraggable(stack);
    this.applyStackPosition(stack);
    return stack;
  }

  applyNightEscalation(banner, iconEl, msg, resetBtn, count) {
    const p = this.getNightProgress(count);
    const iconSize = Math.round(56 + p * 60);
    banner.classList.add("gmc-break-night");
    banner.style.width = `calc(${Math.round(520 * (1 - p))}px + ${Math.round(p * 100)}vw)`;
    banner.style.maxWidth = "100vw";
    banner.style.minHeight = `${Math.round(p * 100)}vh`;
    banner.style.maxHeight = "100vh";
    banner.style.borderRadius = `${Math.round(16 * (1 - p))}px`;
    iconEl.style.width = `${iconSize}px`;
    iconEl.style.height = `${iconSize}px`;
    msg.style.fontSize = `${Math.round(17 + p * 20)}px`;
    resetBtn.style.fontSize = `${Math.round(15 + p * 6)}px`;
    resetBtn.style.padding = `${Math.round(10 + p * 6)}px ${Math.round(18 + p * 12)}px`;
    if (p >= 1) banner.classList.add("gmc-break-fullscreen");
  }

  renderBanner(alertObj) {
    const container = this.getContainer();
    if (!container) return;
    if (document.querySelector(`.gmc-break-banner[data-gmc-break-type="${alertObj.type}"]`)) return;

    const repeatDelay = this.formatDuration(alertObj.type === "night" ? this.getNightRepeatMinutes() : 10);
    const banner = document.createElement("div");
    banner.className = "gmc-break-banner";
    banner.dataset.gmcBreakType = alertObj.type;
    banner.title = "Glisser la carte pour la déplacer";

    const bodyRow = document.createElement("div");
    bodyRow.className = "gmc-break-body";
    const iconEl = document.createElement("div");
    iconEl.className = "gmc-break-icon";
    iconEl.innerHTML = this.getAlertSvg(alertObj.type);
    const msg = document.createElement("div");
    msg.className = "gmc-break-msg";
    msg.textContent = alertObj.message;
    bodyRow.append(iconEl, msg);

    const actions = document.createElement("div");
    actions.className = "gmc-break-actions";
    const ackLabels = {
      night: `😴 J'y vais (rappel dans ${repeatDelay})`,
      lunch: "🍽️ J'ai mangé",
      drink: `💧 C'est fait (prochain dans ${this.formatDuration(this.settings.drinkMinutes)})`,
      move: `✅ Je me suis levé (prochain dans ${this.formatDuration(this.settings.moveMinutes)})`
    };
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "gmc-break-btn-reset";
    resetBtn.textContent = ackLabels[alertObj.type] || "✅ OK";
    resetBtn.addEventListener("click", () => {
      banner.remove();
      this.onAcknowledge(alertObj.type);
    });

    if (alertObj.type === "night") {
      const nextCount = (this.state.nightAlertCount || 0) + 1;
      this.applyNightEscalation(banner, iconEl, msg, resetBtn, nextCount);
      this.onNightShown();
    }
    actions.append(resetBtn);
    banner.append(bodyRow, actions);
    container.appendChild(banner);
    this.applyStackPosition(container);
  }

  syncDom() {
    if (typeof document === "undefined" || !document.querySelectorAll) return;
    const alerts = this.getActiveAlerts();
    const activeTypes = new Set(alerts.map((a) => a.type));
    document.querySelectorAll(".gmc-break-banner").forEach((el) => {
      const t = el.dataset?.gmcBreakType;
      if (t && !activeTypes.has(t)) el.remove();
    });
    alerts.forEach((a) => this.renderBanner(a));
  }
}
window.GlobalBreakGuard = GlobalBreakGuard;
