/**
 * Garde-fou : mouvement (30m), hydratation (2h), déjeuner (12h-14h) et coucher (0h-6h30).
 */
class BreakGuard {
  constructor(options = {}) {
    this.MIDNIGHT_START_HOUR = options.midnightStartHour ?? 0;
    this.MIDNIGHT_END_MINUTES = options.midnightEndMinutes ?? (6 * 60 + 30);
    this.LUNCH_START_HOUR = options.lunchStartHour ?? 12;
    this.LUNCH_END_HOUR = options.lunchEndHour ?? 14;
    this.MOVE_LIMIT_MS = (options.moveLimitMinutes ?? 30) * 60 * 1000;
    this.DRINK_LIMIT_MS = (options.drinkLimitMinutes ?? 120) * 60 * 1000;
    this.LUNCH_REPEAT_MS = (options.lunchRepeatMinutes ?? 30) * 60 * 1000;
    this.MIDNIGHT_REPEAT_MS = (options.midnightRepeatMinutes ?? 10) * 60 * 1000;
    this.LATE_NIGHT_REPEAT_MS = (options.lateNightRepeatMinutes ?? 5) * 60 * 1000;
    this.VERY_LATE_NIGHT_REPEAT_MS = (options.veryLateNightRepeatMinutes ?? 2) * 60 * 1000;
    this.IDLE_RESET_MS = (options.idleResetMinutes ?? 15) * 60 * 1000;
    this.nowFn = options.nowFn || (() => Date.now());
    this.dateFn = options.dateFn || (() => new Date());

    this.moveStart = null;
    this.drinkStart = null;
    this.lunchWindowStart = null;
    this.lunchTakenDate = null;
    this.lastActivity = null;
    this.snoozeUntil = 0;
    this.nightAlertCount = 0;
    this.activeType = null;
    this.bannerEl = null;
  }

  getDateKey(dateObj = this.dateFn()) {
    return `${dateObj.getFullYear()}-${dateObj.getMonth() + 1}-${dateObj.getDate()}`;
  }

  isAfterMidnight(dateObj = this.dateFn()) {
    const h = dateObj.getHours();
    const m = typeof dateObj.getMinutes === "function" ? dateObj.getMinutes() : 0;
    const totalMinutes = h * 60 + m;
    return totalMinutes >= this.MIDNIGHT_START_HOUR * 60 && totalMinutes < this.MIDNIGHT_END_MINUTES;
  }

  getNightRepeatMinutes(dateObj = this.dateFn()) {
    const h = dateObj.getHours();
    if (h >= 2) return 2;
    if (h >= 1) return 5;
    return 10;
  }

  getNightRepeatMs(dateObj = this.dateFn()) {
    const h = dateObj.getHours();
    if (h >= 2) return this.VERY_LATE_NIGHT_REPEAT_MS;
    if (h >= 1) return this.LATE_NIGHT_REPEAT_MS;
    return this.MIDNIGHT_REPEAT_MS;
  }

  getNightProgress(count = this.nightAlertCount) {
    if (count <= 1) return 0;
    return Math.min(1, (count - 1) / 5);
  }

  isLunchTime(dateObj = this.dateFn()) {
    const h = dateObj.getHours();
    return h >= this.LUNCH_START_HOUR && h < this.LUNCH_END_HOUR;
  }

  hasEatenToday(dateObj = this.dateFn()) {
    return this.lunchTakenDate === this.getDateKey(dateObj);
  }

  recordActivity() {
    const now = this.nowFn();
    const dateObj = this.dateFn();
    const isIdle = this.lastActivity && now - this.lastActivity >= this.IDLE_RESET_MS;
    if (!this.moveStart || isIdle) {
      this.moveStart = now;
      this.snoozeUntil = 0;
      if (isIdle) this.nightAlertCount = 0;
    }
    if (!this.drinkStart) this.drinkStart = now;
    if (!this.isAfterMidnight(dateObj)) this.nightAlertCount = 0;
    if (this.isLunchTime(dateObj) && !this.hasEatenToday(dateObj)) {
      if (!this.lunchWindowStart || isIdle) this.lunchWindowStart = now;
    } else {
      this.lunchWindowStart = null;
    }
    this.lastActivity = now;
  }
  takeLunchBreak() {
    const now = this.nowFn();
    this.moveStart = now;
    this.drinkStart = now;
    this.lastActivity = now;
    this.lunchWindowStart = null;
    this.lunchTakenDate = this.getDateKey();
    this.snoozeUntil = 0;
    this.nightAlertCount = 0;
    this.hideBanner("lunch");
    this.showBanner({
      type: "lunch_done",
      isNight: false,
      message: "🍽️ Bon appétit ! Compteurs réinitialisés, tu as indiqué avoir mangé."
    });
  }

  acknowledge(type = this.activeType) {
    const now = this.nowFn();
    this.lastActivity = now;
    if (type === "lunch") {
      this.takeLunchBreak();
      return;
    }
    if (type === "night") {
      this.moveStart = now;
      this.snoozeUntil = now + this.getNightRepeatMs();
    } else if (type === "drink") {
      this.drinkStart = now;
      if (this.moveStart && now - this.moveStart >= this.MOVE_LIMIT_MS) this.moveStart = now;
      this.snoozeUntil = 0;
    } else if (type === "move") {
      this.moveStart = now;
      this.snoozeUntil = 0;
    }
    this.hideBanner(type);
  }

  getActiveAlerts() {
    const now = this.nowFn();
    const dateObj = this.dateFn();
    const isNight = this.isAfterMidnight(dateObj);
    if (!this.moveStart || !this.lastActivity) return [];
    if (now - this.lastActivity >= this.IDLE_RESET_MS) {
      this.moveStart = null;
      this.lunchWindowStart = null;
      this.lastActivity = null;
      this.nightAlertCount = 0;
      return [];
    }
    if (now < this.snoozeUntil) return [];
    const alerts = [];
    if (isNight) {
      const h = dateObj.getHours();
      alerts.push({
        shouldWarn: true,
        type: "night",
        isNight: true,
        message: h >= 1 ? `🌙 Il est ${h}h passées : Va te coucher maintenant !` : "🌙 Il est minuit passé : Va te coucher !"
      });
    }
    if (this.isLunchTime(dateObj) && !this.hasEatenToday(dateObj)) {
      if (!this.lunchWindowStart) this.lunchWindowStart = now;
      if (now - this.lunchWindowStart >= this.LUNCH_REPEAT_MS) {
        alerts.push({ shouldWarn: true, type: "lunch", isNight: false, message: "🍽️ Il est l'heure de déjeuner : pense à aller manger !" });
      }
    }
    if (this.drinkStart && now - this.drinkStart >= this.DRINK_LIMIT_MS) {
      alerts.push({ shouldWarn: true, type: "drink", isNight: false, message: "💧 N'oublie pas de boire" });
    }
    if (!isNight && now - this.moveStart >= this.MOVE_LIMIT_MS) {
      alerts.push({ shouldWarn: true, type: "move", isNight: false, message: "🚶 Ton corps a besoin de bouger, même un tout petit peu, lève-toi" });
    }
    return alerts;
  }

  getStatus() {
    const alerts = this.getActiveAlerts();
    if (alerts.length > 0) return alerts.at(0);
    return { shouldWarn: false, type: null, isNight: this.isAfterMidnight(), message: "" };
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
    let stack = document.querySelector ? document.querySelector(".gmc-break-stack") : null;
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "gmc-break-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  hideBanner(type = null) {
    if (typeof document === "undefined" || !document.querySelectorAll) {
      this.bannerEl = null;
      this.activeType = null;
      return;
    }
    const sel = type ? `.gmc-break-banner[data-gmc-break-type="${type}"]` : ".gmc-break-banner";
    document.querySelectorAll(sel).forEach((el) => el.remove());
    const remaining = document.querySelectorAll(".gmc-break-banner");
    this.bannerEl = remaining.length > 0 ? (remaining.item ? remaining.item(0) : Array.from(remaining).at(0)) : null;
    this.activeType = this.bannerEl?.dataset?.gmcBreakType || null;
  }

  applyNightEscalation(banner, iconEl, msg, resetBtn) {
    this.nightAlertCount += 1;
    const p = this.getNightProgress(this.nightAlertCount);
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

  showBanner(status) {
    const container = this.getContainer();
    if (!container) return;
    if (document.querySelector && document.querySelector(`.gmc-break-banner[data-gmc-break-type="${status.type}"]`)) return;

    const repeatMin = status.type === "night" ? this.getNightRepeatMinutes() : 10;
    const banner = document.createElement("div");
    banner.className = "gmc-break-banner";
    banner.dataset.gmcBreakType = status.type;

    const bodyRow = document.createElement("div");
    bodyRow.className = "gmc-break-body";
    const iconEl = document.createElement("div");
    iconEl.className = "gmc-break-icon";
    iconEl.innerHTML = this.getAlertSvg(status.type);
    const msg = document.createElement("div");
    msg.className = "gmc-break-msg";
    msg.textContent = status.message;
    bodyRow.append(iconEl, msg);

    const actions = document.createElement("div");
    actions.className = "gmc-break-actions";
    const ackLabels = {
      night: `😴 J'y vais (${repeatMin} min)`,
      lunch: "🍽️ J'ai mangé",
      drink: "💧 C'est fait (2h)",
      move: "✅ Je me suis levé (30 min)",
      lunch_done: "👍 Fermer"
    };
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "gmc-break-btn-reset";
    resetBtn.textContent = ackLabels[status.type] || "✅ OK";
    resetBtn.addEventListener("click", () => (status.type === "lunch_done" ? this.hideBanner("lunch_done") : this.acknowledge(status.type)));

    if (status.type === "night") this.applyNightEscalation(banner, iconEl, msg, resetBtn);
    actions.append(resetBtn);
    banner.append(bodyRow, actions);
    container.appendChild(banner);
    this.bannerEl = banner;
    this.activeType = status.type;
  }

  tick() {
    const alerts = this.getActiveAlerts();
    alerts.forEach((st) => this.showBanner(st));
    return alerts.at(0) || { shouldWarn: false, type: null, isNight: this.isAfterMidnight(), message: "" };
  }
}
window.GmcBreakGuard = BreakGuard;
