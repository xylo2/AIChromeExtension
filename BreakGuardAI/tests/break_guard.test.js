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

test("pastille repas gère déjeuner et dîner sans superposition", () => {
  const css = fs.readFileSync(path.join(EXT_DIR, "styles.css"), "utf-8");
  const contentJs = fs.readFileSync(path.join(EXT_DIR, "content.js"), "utf-8");
  const popupHtml = fs.readFileSync(path.join(EXT_DIR, "popup.html"), "utf-8");
  assert.ok(css.includes(".gmc-lunch-pill-done-btn"));
  assert.ok(css.includes(".gmc-break-btn-timer"));
  assert.ok(contentJs.includes("Pause déjeuner"));
  assert.ok(contentJs.includes("Pause dîner"));
  assert.ok(popupHtml.includes('id="eyesMinutes"'));
  assert.ok(popupHtml.includes('id="postureMinutes"'));
  assert.ok(popupHtml.includes('id="dinnerStartHour"'));
  assert.ok(popupHtml.includes('id="windDownHour"'));
});

test("background.js gère toutes les alertes (yeux, posture, dîner, fin de journée, nuit)", () => {
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
    eyesMinutes: 25,
    postureMinutes: 50,
    dinnerStartHour: 19,
    dinnerEndHour: 22,
    nightStartHour: 23,
    nightEndHour: 7,
    nightEndMinute: 0,
    nightRepeat0h: 15,
    nightRepeat1h: 6,
    nightRepeat2h: 3
  });
  assert.equal(custom.eyesMinutes, 25);
  assert.equal(custom.postureMinutes, 50);
  assert.equal(sandbox.isDinnerTime(new Date(2026, 10, 24, 20, 15, 0), custom), true);

  let state = { ...sandbox.DEFAULT_STATE };
  let now = 1_000_000;
  const eveningDate = new Date(2026, 10, 24, 23, 15, 0);
  state = sandbox.applyActivity(state, now, eveningDate, custom);
  state = sandbox.applyAcknowledge(state, "night", now, eveningDate, custom);
  assert.equal(state.snoozeUntil, now + 15 * 60 * 1000);

  state = sandbox.applyAcknowledge(state, "dinner", now, eveningDate, custom);
  assert.equal(state.dinnerTakenDate, "2026-11-24");
  state = sandbox.applyAcknowledge(state, "winddown", now, eveningDate, custom);
  assert.equal(state.windDownDoneDate, "2026-11-24");
});
test("GlobalBreakGuard déclenche yeux 20-20-20, posture, dîner et fin de journée", () => {
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
    dateFn: () => new Date(2026, 10, 24, 20, 35, 0)
  });

  assert.equal(guard.formatDuration(120), "2 h");
  guard.setState({
    moveStart: fakeNow - 5 * 60 * 1000,
    drinkStart: fakeNow,
    eyesStart: fakeNow - 21 * 60 * 1000,
    postureStart: fakeNow - 46 * 60 * 1000,
    dinnerWindowStart: fakeNow - 35 * 60 * 1000,
    lastActivity: fakeNow
  });
  const types = guard.getActiveAlerts().map((a) => a.type);
  assert.ok(types.includes("eyes"));
  assert.ok(types.includes("posture"));
  assert.ok(types.includes("dinner"));
  assert.ok(types.includes("winddown"));
});
