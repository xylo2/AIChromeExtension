/**
 * Rendu et évaluation des alertes synchronisées sur l'état global partagé.
 */
class GlobalBreakGuard {
  constructor(options = {}) {
    this.MIDNIGHT_START_HOUR = options.midnightStartHour ?? 0;
    this.MIDNIGHT_END_MINUTES = options.midnightEndMinutes ?? (6 * 60 + 30);
    this.LUNCH_START_HOUR = options.lunchStartHour ?? 12;
    this.LUNCH_END_HOUR = options.lunchEndHour ?? 14;
    this.MOVE_LIMIT_MS = (options.moveLimitMinutes ?? 30) * 60 * 1000;
    this.DRINK_LIMIT_MS = (options.drinkLimitMinutes ?? 120) * 60 * 1000;
    this.LUNCH_REPEAT_MS = (options.lunchRepeatMinutes ?? 30) * 60 * 1000;
    this.IDLE_RESET_MS = (options.idleResetMinutes ?? 15) * 60 * 1000;
    this.nowFn = options.nowFn || (() => Date.now());
    this.dateFn = options.dateFn || (() => new Date());
    this.onAcknowledge = options.onAcknowledge || (() => {});
    this.onNightShown = options.onNightShown || (() => {});
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

  getDateKey(d = this.dateFn()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  isAfterMidnight(d = this.dateFn()) {
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= this.MIDNIGHT_START_HOUR * 60 && mins < this.MIDNIGHT_END_MINUTES;
  }

  isLunchTime(d = this.dateFn()) {
    const h = d.getHours();
    return h >= this.LUNCH_START_HOUR && h < this.LUNCH_END_HOUR;
  }

  hasEatenToday(d = this.dateFn()) {
    return this.state.lunchTakenDate === this.getDateKey(d);
  }

  getNightRepeatMinutes(d = this.dateFn()) {
    const h = d.getHours();
    if (h >= 2) return 2;
    if (h >= 1) return 5;
    return 10;
  }

  getNightProgress(count) {
    if (count <= 1) return 0;
    return Math.min(1, (count - 1) / 5);
  }

  setState(newState) {
    if (!newState) return;
    this.state = { ...this.state, ...newState };
    this.syncDom();
  }

  getActiveAlerts() {
    const now = this.nowFn();
    const d = this.dateFn();
    const st = this.state;
    const isNight = this.isAfterMidnight(d);
    if (!st.moveStart || !st.lastActivity) return [];
    if (now - st.lastActivity >= this.IDLE_RESET_MS) return [];
    if (now < (st.snoozeUntil || 0)) return [];
    const dismissed = new Set(st.dismissedTypes || []);
    const alerts = [];

    if (isNight && !dismissed.has("night")) {
      const h = d.getHours();
      alerts.push({
        type: "night",
        message: h >= 1 ? `🌙 Il est ${h}h passées : Va te coucher maintenant !` : "🌙 Il est minuit passé : Va te coucher !"
      });
    }
    if (this.isLunchTime(d) && !this.hasEatenToday(d) && !dismissed.has("lunch")) {
      if (st.lunchWindowStart && now - st.lunchWindowStart >= this.LUNCH_REPEAT_MS) {
        alerts.push({ type: "lunch", message: "🍽️ Il est l'heure de déjeuner : pense à aller manger !" });
      }
    }
    if (st.drinkStart && now - st.drinkStart >= this.DRINK_LIMIT_MS && !dismissed.has("drink")) {
      alerts.push({ type: "drink", message: "💧 N'oublie pas de boire" });
    }
    if (!isNight && now - st.moveStart >= this.MOVE_LIMIT_MS && !dismissed.has("move")) {
      alerts.push({ type: "move", message: "🚶 Ton corps a besoin de bouger, même un tout petit peu, lève-toi" });
    }
    return alerts;
  }
  getAlertSvg(type) {
    const svgs = {
      night: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#3b0764" stroke="#f43f5e" stroke-width="2"/><path d="M29.5 13.5C23.5 14.2 19 19.3 19 25.5C19 32.1 24.4 37.5 31 37.5C33.4 37.5 35.6 36.8 37.4 35.6C35.4 38.6 32 40.5 28 40.5C21.6 40.5 16.5 35.4 16.5 29C16.5 22.8 21.3 17.8 27.4 17.5C28.2 16 28.9 14.7 29.5 13.5Z" fill="#fde047"/><path d="M34 12L35 14.5L37.5 15.5L35 16.5L34 19L33 16.5L30.5 15.5L33 14.5L34 12Z" fill="#fda4af"/><circle cx="14" cy="16" r="1.5" fill="#fde047"/></svg>',
      move: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/><circle cx="25" cy="12" r="3.5" fill="#a5b4fc"/><path d="M17 20L24 18L32 15M24 18L22 28L16 37M22 28L29 31L31 38" stroke="#e0e7ff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 39H36" stroke="#6366f1" stroke-width="2" stroke-linecap="round"/></svg>',
      drink: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/><path d="M16 14H32L29.5 36H18.5L16 14Z" stroke="#bae6fd" stroke-width="2.2" stroke-linejoin="round"/><path d="M17.3 24C20 22.5 23 25.5 26 24C28 23 29.5 23.5 30.7 24L29.5 35H18.5L17.3 24Z" fill="#38bdf8" fill-opacity="0.75"/><path d="M35 12C35 12 38 15.2 38 17C38 18.7 36.7 20 35 20C33.3 20 32 18.7 32 17C32 15.2 35 12 35 12Z" fill="#7dd3fc"/></svg>',
      lunch: '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#431407" stroke="#fb923c" stroke-width="2"/><circle cx="24" cy="25" r="9.5" stroke="#fed7aa" stroke-width="2.2"/><circle cx="24" cy="25" r="5.5" stroke="#fdba74" stroke-width="1.4" stroke-dasharray="2 2"/><path d="M11 14V21C11 22.7 12.3 24 14 24V36M14 14V21M36 14V36M36 14C38.2 14 39 16.5 39 19.5C39 22 37.8 23.5 36 23.5" stroke="#ffedd5" stroke-width="2" stroke-linecap="round"/></svg>'
    };
    return svgs[type] || svgs.lunch;
  }

  getContainer() {
    if (typeof document === "undefined" || !document.body) return null;
    let stack = document.querySelector(".gmc-break-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "gmc-break-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  applyNightEscalation(banner, iconEl, msg, resetBtn, count) {
    const p = this.getNightProgress(count);
    const iconSize = Math.round(42 + p * 66);
    banner.classList.add("gmc-break-night");
    banner.style.width = `calc(${Math.round(420 * (1 - p))}px + ${Math.round(p * 100)}vw)`;
    banner.style.maxWidth = "100vw";
    banner.style.minHeight = `${Math.round(p * 100)}vh`;
    banner.style.maxHeight = "100vh";
    banner.style.borderRadius = `${Math.round(12 * (1 - p))}px`;
    iconEl.style.width = `${iconSize}px`;
    iconEl.style.height = `${iconSize}px`;
    msg.style.fontSize = `${Math.round(14 + p * 22)}px`;
    resetBtn.style.fontSize = `${Math.round(13 + p * 7)}px`;
    resetBtn.style.padding = `${Math.round(8 + p * 6)}px ${Math.round(14 + p * 12)}px`;
    if (p >= 1) banner.classList.add("gmc-break-fullscreen");
  }

  renderBanner(alertObj) {
    const container = this.getContainer();
    if (!container) return;
    if (document.querySelector(`.gmc-break-banner[data-gmc-break-type="${alertObj.type}"]`)) return;

    const repeatMin = alertObj.type === "night" ? this.getNightRepeatMinutes() : 10;
    const banner = document.createElement("div");
    banner.className = "gmc-break-banner";
    banner.dataset.gmcBreakType = alertObj.type;

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
      night: `😴 J'y vais (${repeatMin} min)`,
      lunch: "🍽️ J'ai mangé",
      drink: "💧 C'est fait (2h)",
      move: "✅ Je me suis levé (30 min)"
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
