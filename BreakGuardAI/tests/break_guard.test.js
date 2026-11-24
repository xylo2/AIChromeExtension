// Lancer avec : node --test tools/BreakGuardAI/tests/break_guard.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXT_DIR = path.resolve(__dirname, "..");

test("manifest.json de BreakGuardAI couvre toutes les URLs et charge break_guard.js puis content.js", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts.at(0).matches, ["<all_urls>"]);
  assert.deepEqual(manifest.content_scripts.at(0).js, ["break_guard.js", "content.js"]);
});

test("état partagé : fermer une alerte empêche sa réapparition au changement d'onglet", () => {
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

  let state = { ...sandbox.DEFAULT_STATE };
  let now = 1_000_000;
  const dayDate = new Date(2026, 10, 24, 15, 0, 0);

  state = sandbox.applyActivity(state, now, dayDate);
  now += 35 * 60 * 1000;
  state = sandbox.applyAcknowledge(state, "move", now, dayDate);
  assert.equal(state.dismissedTypes.includes("move"), true);

  const clientGuard = new (vm.runInNewContext(
    fs.readFileSync(path.join(EXT_DIR, "break_guard.js"), "utf-8") + "; GlobalBreakGuard",
    { window: {} }
  ))({ nowFn: () => now + 1000, dateFn: () => dayDate });

  clientGuard.setState(state);
  assert.equal(clientGuard.getActiveAlerts().length, 0);
});

test("GlobalBreakGuard gère déjeuner (12h-14h), hydratation (2h) et escalade nocturne", () => {
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
  let fakeHour = 1;
  let nightShownCalls = 0;
  const guard = new sandbox.window.GlobalBreakGuard({
    nowFn: () => fakeNow,
    dateFn: () => ({ getHours: () => fakeHour, getMinutes: () => 10, getFullYear: () => 2026, getMonth: () => 10, getDate: () => 24 }),
    onNightShown: () => { nightShownCalls += 1; }
  });

  guard.setState({ moveStart: fakeNow, drinkStart: fakeNow, lastActivity: fakeNow, nightAlertCount: 5 });
  assert.equal(nightShownCalls, 1);
  const banner = allNodes.find((n) => n.className === "gmc-break-banner");
  assert.equal(banner.style.minHeight, "100vh");
  assert.equal(banner.classList.contains("gmc-break-fullscreen"), true);
});
