/**
 * Garde-fou : mouvement (30m), hydratation (2h), déjeuner (12h-14h) et coucher (0h-6h).
 */
class BreakGuard {
  constructor(options = {}) {
    this.MIDNIGHT_START_HOUR = options.midnightStartHour ?? 0;
    this.MIDNIGHT_END_HOUR = options.midnightEndHour ?? 6;
    this.LUNCH_START_HOUR = options.lunchStartHour ?? 12;
    this.LUNCH_END_HOUR = options.lunchEndHour ?? 14;
    this.MOVE_LIMIT_MS = (options.moveLimitMinutes ?? 30) * 60 * 1000;
    this.DRINK_LIMIT_MS = (options.drinkLimitMinutes ?? 120) * 60 * 1000;
    this.LUNCH_REPEAT_MS = (options.lunchRepeatMinutes ?? 30) * 60 * 1000;
    this.MIDNIGHT_REPEAT_MS = (options.midnightRepeatMinutes ?? 10) * 60 * 1000;
    this.IDLE_RESET_MS = (options.idleResetMinutes ?? 15) * 60 * 1000;
    this.nowFn = options.nowFn || (() => Date.now());
    this.dateFn = options.dateFn || (() => new Date());

    this.moveStart = null;
    this.drinkStart = null;
    this.lunchWindowStart = null;
    this.lunchTakenDate = null;
    this.lastActivity = null;
    this.snoozeUntil = 0;
    this.activeType = null;
    this.bannerEl = null;
  }

  getDateKey(dateObj = this.dateFn()) {
    return `${dateObj.getFullYear()}-${dateObj.getMonth() + 1}-${dateObj.getDate()}`;
  }

  isAfterMidnight(dateObj = this.dateFn()) {
    const h = dateObj.getHours();
    return h >= this.MIDNIGHT_START_HOUR && h < this.MIDNIGHT_END_HOUR;
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
    }
    if (!this.drinkStart) this.drinkStart = now;
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
    this.activeType = null;
    this.showBanner({
      type: "lunch_done",
      isNight: false,
      message: "🍽️ Bon appétit ! Compteurs réinitialisés, tu as indiqué avoir mangé."
    });
  }

  acknowledge() {
    const now = this.nowFn();
    this.lastActivity = now;
    if (this.activeType === "lunch") {
      this.takeLunchBreak();
      return;
    }
    if (this.activeType === "night") {
      this.moveStart = now;
      this.snoozeUntil = now + this.MIDNIGHT_REPEAT_MS;
    } else if (this.activeType === "drink") {
      this.drinkStart = now;
      if (this.moveStart && now - this.moveStart >= this.MOVE_LIMIT_MS) this.moveStart = now;
      this.snoozeUntil = 0;
    } else {
      this.moveStart = now;
      this.snoozeUntil = 0;
    }
    this.activeType = null;
    this.hideBanner();
  }

  snooze(minutes = 10) {
    this.snoozeUntil = this.nowFn() + minutes * 60 * 1000;
    this.hideBanner();
  }
  getStatus() {
    const now = this.nowFn();
    const dateObj = this.dateFn();
    const isNight = this.isAfterMidnight(dateObj);
    if (!this.moveStart || !this.lastActivity) {
      return { shouldWarn: false, type: null, isNight, message: "" };
    }
    if (now - this.lastActivity >= this.IDLE_RESET_MS) {
      this.moveStart = null;
      this.lunchWindowStart = null;
      this.lastActivity = null;
      return { shouldWarn: false, type: null, isNight, message: "" };
    }
    if (now < this.snoozeUntil) {
      return { shouldWarn: false, type: null, isNight, message: "" };
    }
    if (isNight) {
      return {
        shouldWarn: true,
        type: "night",
        isNight: true,
        message: "🌙 Il est minuit passé : Va te coucher !"
      };
    }
    if (this.isLunchTime(dateObj) && !this.hasEatenToday(dateObj)) {
      if (!this.lunchWindowStart) this.lunchWindowStart = now;
      if (now - this.lunchWindowStart >= this.LUNCH_REPEAT_MS) {
        return {
          shouldWarn: true,
          type: "lunch",
          isNight: false,
          message: "🍽️ Il est l'heure de déjeuner : pense à aller manger !"
        };
      }
    }
    if (this.drinkStart && now - this.drinkStart >= this.DRINK_LIMIT_MS) {
      return {
        shouldWarn: true,
        type: "drink",
        isNight: false,
        message: "💧 N'oublie pas de boire"
      };
    }
    if (now - this.moveStart >= this.MOVE_LIMIT_MS) {
      return {
        shouldWarn: true,
        type: "move",
        isNight: false,
        message: "🚶 Ton corps a besoin de bouger, même un tout petit peu, lève-toi"
      };
    }
    return { shouldWarn: false, type: null, isNight: false, message: "" };
  }

  hideBanner() {
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
  }

  showBanner(status) {
    if (this.bannerEl && this.activeType === status.type) return;
    this.hideBanner();
    this.activeType = status.type;

    const banner = document.createElement("div");
    banner.className = "gmc-break-banner";
    const msg = document.createElement("div");
    msg.className = "gmc-break-msg";
    msg.textContent = status.message;

    const actions = document.createElement("div");
    actions.className = "gmc-break-actions";
    if (status.type !== "lunch_done") {
      const snoozeBtn = document.createElement("button");
      snoozeBtn.type = "button";
      snoozeBtn.className = "gmc-break-btn-snooze";
      snoozeBtn.textContent = "Rappel dans 10 min";
      snoozeBtn.addEventListener("click", () => this.snooze(10));
      actions.append(snoozeBtn);
    }

    const ackLabels = {
      night: "😴 J'y vais (10 min)",
      lunch: "🍽️ J'ai mangé",
      drink: "💧 C'est fait (2h)",
      move: "✅ Je me suis levé (30 min)",
      lunch_done: "👍 Fermer"
    };
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "gmc-break-btn-reset";
    resetBtn.textContent = ackLabels[status.type] || "✅ OK";
    resetBtn.addEventListener("click", () => (status.type === "lunch_done" ? this.hideBanner() : this.acknowledge()));

    actions.append(resetBtn);
    banner.append(msg, actions);
    document.body.appendChild(banner);
    this.bannerEl = banner;
  }

  tick() {
    const status = this.getStatus();
    if (status.shouldWarn) this.showBanner(status);
    return status;
  }
}
window.GmcBreakGuard = BreakGuard;
