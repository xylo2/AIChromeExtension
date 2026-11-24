// Lancer avec : node --test tools/BreakGuardAI/tests/break_guard.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXT_DIR = path.resolve(__dirname, "..");

test("manifest.json déclare popup.html et les content_scripts dans l'ordre", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(manifest.content_scripts.at(0).matches, ["<all_urls>"]);
  assert.deepEqual(manifest.content_scripts.at(0).js, ["break_guard.js", "content.js"]);
});

test("pastille pause déjeuner dispose d'un bouton C'est fait et évite la superposition", () => {
  const css = fs.readFileSync(path.join(EXT_DIR, "styles.css"), "utf-8");
  const guardJs = fs.readFileSync(path.join(EXT_DIR, "break_guard.js"), "utf-8");
  const contentJs = fs.readFileSync(path.join(EXT_DIR, "content.js"), "utf-8");
  const popupHtml = fs.readFileSync(path.join(EXT_DIR, "popup.html"), "utf-8");
  const popupJs = fs.readFileSync(path.join(EXT_DIR, "popup.js"), "utf-8");
  assert.ok(css.includes(".gmc-lunch-pill-done-btn"));
  assert.ok(css.includes("white-space: nowrap;"));
  assert.ok(css.includes("width: max-content;"));
  assert.ok(guardJs.includes('fill="#290d02"'));
  assert.ok(contentJs.includes("C'est fait"));
  assert.ok(contentJs.includes("const hasLunchBanner = guard.getActiveAlerts().some((a) => a.type === \"lunch\");"));
  assert.ok(contentJs.includes("const show = guard.isLunchTime() && !eaten && !hasLunchBanner;"));
  assert.ok(popupHtml.includes('id="resetPosBtn"'));
  assert.ok(popupJs.includes("breakGuardLunchPos"));
});

test("background.js valide et applique les paramètres personnalisés (horaires et délais)", () => {
  const bgCode = fs.readFileSync(path.join(EXT_DIR, "background.js"), "utf-8");
  const cutIdx = bgCode.indexOf("async function reinjectAllTabs()");
  const sandbox = {
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { query: async () => [] }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(bgCode.slice(0, cutIdx), sandbox);

  const custom = sandbox.sanitizeSettings({
    moveMinutes: 45,
    drinkMinutes: 90,
    lunchStartHour: 11,
    lunchEndHour: 15,
    lunchRepeatMinutes: 20,
    nightStartHour: 23,
    nightEndHour: 7,
    nightEndMinute: 0,
    nightRepeat0h: 15,
    nightRepeat1h: 6,
    nightRepeat2h: 3,
    idleResetMinutes: 20
  });
  assert.equal(custom.moveMinutes, 45);
  assert.equal(custom.lunchStartHour, 11);
  assert.equal(sandbox.isAfterMidnight(new Date(2026, 10, 24, 23, 30, 0), custom), true);
  assert.equal(sandbox.isLunchTime(new Date(2026, 10, 24, 11, 15, 0), custom), true);

  let state = { ...sandbox.DEFAULT_STATE };
  let now = 1_000_000;
  const nightDate = new Date(2026, 10, 24, 1, 15, 0);
  state = sandbox.applyActivity(state, now, nightDate, custom);
  state = sandbox.applyAcknowledge(state, "night", now, nightDate, custom);
  assert.equal(state.snoozeUntil, now + 6 * 60 * 1000);
});
test("GlobalBreakGuard applique dynamiquement les horaires, délais et durées lisibles", () => {
  const allNodes = [];
  const makeNode = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      className: "",
      textContent: "",
      innerHTML: "",
      dataset: {},
      style: {},
      children: [],
      classList: { set: new Set(), add(c) { this.set.add(c); }, contains(c) { return this.set.has(c); } },
      append(...n) { this.children.push(...n); },
      appendChild(c) { this.children.push(c); },
      addEventListener() {},
      remove() { this.removed = true; }
    };
    allNodes.push(node);
    return node;
  };
  const body = makeNode("body");
  const sandbox = {
    window: {},
    document: {
      body,
      createElement: (t) => makeNode(t),
      querySelector: (sel) => allNodes.find((n) => !n.removed && (sel === ".gmc-break-stack" ? n.className === "gmc-break-stack" : sel.includes(`"${n.dataset.gmcBreakType}"`))) || null,
      querySelectorAll: () => allNodes.filter((n) => !n.removed && n.className === "gmc-break-banner")
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT_DIR, "break_guard.js"), "utf-8"), sandbox);

  let fakeNow = 1_000_000;
  const guard = new sandbox.window.GlobalBreakGuard({
    nowFn: () => fakeNow,
    dateFn: () => new Date(2026, 10, 24, 15, 0, 0)
  });

  assert.equal(guard.formatDuration(30), "30 min");
  assert.equal(guard.formatDuration(120), "2 h");
  assert.equal(guard.formatDuration(90), "1 h 30");

  guard.setState(
    { moveStart: fakeNow - 20 * 60 * 1000, drinkStart: fakeNow, lastActivity: fakeNow },
    { moveMinutes: 15 }
  );
  const alerts = guard.getActiveAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts.at(0).type, "move");
});
