/**
 * Script de contenu global pour les alertes santé/sommeil sur tous les onglets.
 */
if (!window.__bgBreakInit) {
  window.__bgBreakInit = true;
  if (window.__bgBreakTimer) clearInterval(window.__bgBreakTimer);

  const syncReply = (res) => {
    if (!res) return;
    if (res.state) guard.setState(res.state, res.settings);
    else if (res.settings) guard.applySettings(res.settings);
    else guard.setState(res);
    updateLunchPill();
  };

  const sendMsg = (payload, cb) => {
    if (!chrome.runtime?.id) return;
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (!chrome.runtime.lastError && cb) cb(res);
      });
    } catch (_e) {}
  };

  const guard = new window.GlobalBreakGuard({
    onAcknowledge: (alertType) => sendMsg({ type: "BREAK_ACK", alertType }, syncReply),
    onNightShown: () => sendMsg({ type: "BREAK_NIGHT_SHOWN" }, syncReply)
  });

  const lunchPill = document.createElement("div");
  lunchPill.className = "gmc-break-lunch-pill";
  lunchPill.title = "Glisser pour déplacer";
  lunchPill.style.display = "none";
  document.body.appendChild(lunchPill);

  let customPillPos = null;
  let wasDragged = false;

  const applyPillPosition = () => {
    if (!customPillPos) {
      lunchPill.style.left = "24px";
      lunchPill.style.bottom = "24px";
      lunchPill.style.top = "auto";
      lunchPill.style.transform = "none";
      return;
    }
    const maxX = Math.max(8, window.innerWidth - lunchPill.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - lunchPill.offsetHeight - 8);
    const clampedX = Math.min(Math.max(8, customPillPos.x), maxX);
    const clampedY = Math.min(Math.max(8, customPillPos.y), maxY);
    lunchPill.style.left = `${clampedX}px`;
    lunchPill.style.top = `${clampedY}px`;
    lunchPill.style.bottom = "auto";
    lunchPill.style.transform = "none";
  };

  chrome.storage?.local?.get(["breakGuardLunchPos", "breakGuardStackPos", "breakGuardSettings"], (res) => {
    if (res?.breakGuardSettings) guard.applySettings(res.breakGuardSettings);
    if (res?.breakGuardLunchPos && typeof res.breakGuardLunchPos.x === "number") {
      customPillPos = res.breakGuardLunchPos;
      applyPillPosition();
    }
    if (res?.breakGuardStackPos) guard.setStackPosition(res.breakGuardStackPos);
  });

  lunchPill.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target?.closest?.("button")) return;
    const rect = lunchPill.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    wasDragged = false;
    lunchPill.classList.add("gmc-dragging");
    if (lunchPill.setPointerCapture) {
      try { lunchPill.setPointerCapture(e.pointerId); } catch (_err) {}
    }

    const onMove = (ev) => {
      if (!wasDragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) wasDragged = true;
      if (!wasDragged) return;
      customPillPos = { x: ev.clientX - offsetX, y: ev.clientY - offsetY };
      applyPillPosition();
    };

    const onUp = (ev) => {
      lunchPill.classList.remove("gmc-dragging");
      lunchPill.removeEventListener("pointermove", onMove);
      lunchPill.removeEventListener("pointerup", onUp);
      lunchPill.removeEventListener("pointercancel", onUp);
      if (lunchPill.releasePointerCapture) {
        try { lunchPill.releasePointerCapture(ev.pointerId); } catch (_err) {}
      }
      if (wasDragged && customPillPos) {
        chrome.storage?.local?.set({ breakGuardLunchPos: customPillPos });
      }
    };

    lunchPill.addEventListener("pointermove", onMove);
    lunchPill.addEventListener("pointerup", onUp);
    lunchPill.addEventListener("pointercancel", onUp);
  });
  window.addEventListener("resize", () => {
    if (lunchPill.style.display !== "none") applyPillPosition();
    const stack = document.querySelector(".gmc-break-stack");
    if (stack) guard.applyStackPosition(stack);
  });
  let lastRenderedLunchState = null;

  const updateLunchPill = () => {
    const eaten = guard.hasEatenToday();
    const hasLunchBanner = guard.getActiveAlerts().some((a) => a.type === "lunch");
    const show = guard.isLunchTime() && !eaten && !hasLunchBanner;
    lunchPill.style.display = show ? "inline-flex" : "none";
    if (!show) {
      lastRenderedLunchState = null;
      return;
    }
    if (lastRenderedLunchState !== "pending") {
      lastRenderedLunchState = "pending";
      lunchPill.innerHTML = "";
      const iconWrap = document.createElement("span");
      iconWrap.className = "gmc-lunch-pill-icon";
      iconWrap.innerHTML = guard.getAlertSvg("lunch");
      const labelSpan = document.createElement("span");
      labelSpan.textContent = "Pause déjeuner";
      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "gmc-lunch-pill-done-btn";
      doneBtn.textContent = "✅ C'est fait";
      doneBtn.title = "Fermer l'alerte pause déjeuner pour aujourd'hui";
      doneBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        sendMsg({ type: "BREAK_ACK", alertType: "lunch" }, syncReply);
      });
      lunchPill.append(iconWrap, labelSpan, doneBtn);
    }
    applyPillPosition();
  };

  let lastActSent = 0;
  const notifyActivity = () => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastActSent < 5000) return;
    lastActSent = now;
    sendMsg({ type: "BREAK_ACTIVITY" }, syncReply);
  };

  ["click", "keydown", "mousemove", "scroll"].forEach((evt) => {
    document.addEventListener(evt, notifyActivity, { passive: true });
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.breakGuardSettings?.newValue) {
      guard.applySettings(changes.breakGuardSettings.newValue);
      updateLunchPill();
    }
    if (changes.breakGuardState?.newValue) {
      guard.setState(changes.breakGuardState.newValue);
      updateLunchPill();
    }
    if (changes.breakGuardLunchPos?.newValue) {
      customPillPos = changes.breakGuardLunchPos.newValue;
      applyPillPosition();
    }
    if (changes.breakGuardStackPos?.newValue) {
      guard.setStackPosition(changes.breakGuardStackPos.newValue);
    }
  });

  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type === "BREAK_STATE_UPDATED") syncReply(msg);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sendMsg({ type: "BREAK_GET_STATE" }, syncReply);
  });

  sendMsg({ type: "BREAK_ACTIVITY" }, syncReply);

  window.__bgBreakTimer = setInterval(() => {
    if (!document.hidden) {
      guard.syncDom();
      updateLunchPill();
    }
  }, 3000);
}
