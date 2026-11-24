/**
 * Script de contenu global pour les alertes santé/sommeil sur tous les onglets.
 */
if (!window.__bgBreakInit) {
  window.__bgBreakInit = true;
  if (window.__bgBreakTimer) clearInterval(window.__bgBreakTimer);

  const sendMsg = (payload, cb) => {
    if (!chrome.runtime?.id) return;
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (!chrome.runtime.lastError && cb) cb(res);
      });
    } catch (_e) {}
  };

  const guard = new window.GlobalBreakGuard({
    onAcknowledge: (alertType) => sendMsg({ type: "BREAK_ACK", alertType }, (st) => guard.setState(st)),
    onNightShown: () => sendMsg({ type: "BREAK_NIGHT_SHOWN" }, (st) => guard.setState(st))
  });

  const lunchPill = document.createElement("button");
  lunchPill.type = "button";
  lunchPill.className = "gmc-break-lunch-pill";
  lunchPill.title = "Indiquer que la pause déjeuner est prise (12h-14h)";
  lunchPill.style.display = "none";
  document.body.appendChild(lunchPill);

  const updateLunchPill = () => {
    const show = guard.isLunchTime();
    lunchPill.style.display = show ? "inline-flex" : "none";
    if (show) {
      lunchPill.textContent = guard.hasEatenToday() ? "✅ Déjeuner pris" : "🍽️ Pause déjeuner";
    }
  };

  lunchPill.addEventListener("click", () => {
    sendMsg({ type: "BREAK_ACK", alertType: "lunch" }, (st) => {
      guard.setState(st);
      updateLunchPill();
    });
  });

  let lastActSent = 0;
  const notifyActivity = () => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastActSent < 5000) return;
    lastActSent = now;
    sendMsg({ type: "BREAK_ACTIVITY" }, (st) => {
      guard.setState(st);
      updateLunchPill();
    });
  };

  ["click", "keydown", "mousemove", "scroll"].forEach((evt) => {
    document.addEventListener(evt, notifyActivity, { passive: true });
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.breakGuardState?.newValue) {
      guard.setState(changes.breakGuardState.newValue);
      updateLunchPill();
    }
  });

  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type === "BREAK_STATE_UPDATED" && msg.state) {
      guard.setState(msg.state);
      updateLunchPill();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      sendMsg({ type: "BREAK_GET_STATE" }, (st) => {
        guard.setState(st);
        updateLunchPill();
      });
    }
  });

  sendMsg({ type: "BREAK_ACTIVITY" }, (st) => {
    guard.setState(st);
    updateLunchPill();
  });

  window.__bgBreakTimer = setInterval(() => {
    if (!document.hidden) {
      guard.syncDom();
      updateLunchPill();
    }
  }, 3000);
}
