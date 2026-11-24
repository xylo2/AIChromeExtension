// Lancer avec : node --test tools/BreakGuardAI/tests/break_guard.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXT_DIR = path.resolve(__dirname, "..");

test("manifest.json utilise les permissions minimales et les locales i18n", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.default_locale, "fr");
  assert.deepEqual(manifest.permissions, ["alarms", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(manifest.content_scripts.at(0).js, ["break_guard.js", "content.js"]);

  const fr = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "_locales", "fr", "messages.json"), "utf-8"));
  const en = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "_locales", "en", "messages.json"), "utf-8"));
  assert.ok(fr.extName.message.includes("Break Guard"));
  assert.ok(en.extName.message.includes("Break Guard"));
});

test("popup et content.js intègrent les interrupteurs par alerte et le mode Ne pas déranger", () => {
  const css = fs.readFileSync(path.join(EXT_DIR, "styles.css"), "utf-8");
  const contentJs = fs.readFileSync(path.join(EXT_DIR, "content.js"), "utf-8");
  const popupHtml = fs.readFileSync(path.join(EXT_DIR, "popup.html"), "utf-8");
  const popupJs = fs.readFileSync(path.join(EXT_DIR, "popup.js"), "utf-8");
  assert.ok(css.includes(".gmc-break-btn-timer"));
  assert.ok(contentJs.includes("guard.isDndActive()"));
  assert.ok(popupHtml.includes('id="dnd1hBtn"'));
  assert.ok(popupHtml.includes('id="enableEyes"'));
  assert.ok(popupHtml.includes('id="enableNight"'));
  assert.ok(popupJs.includes("BREAK_SET_DND"));
});

test("background.js gère toutes les alertes et le mode Ne pas déranger", async () => {
  const bgCode = fs.readFileSync(path.join(EXT_DIR, "background.js"), "utf-8");
  const cutIdx = bgCode.indexOf("chrome.runtime.onInstalled.addListener");
  let savedStore = {};
  const sandbox = {
    chrome: {
      storage: {
        local: {
          get: async () => savedStore,
          set: async (obj) => { savedStore = { ...savedStore, ...obj }; }
        }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(bgCode.slice(0, cutIdx), sandbox);

  const custom = sandbox.sanitizeSettings({
    enableMove: false,
    eyesMinutes: 25,
    postureMinutes: 50,
    nightStartHour: 23,
    nightEndHour: 7,
    nightRepeat0h: 15
  });
  assert.equal(custom.enableMove, false);
  assert.equal(custom.eyesMinutes, 25);

  const dndRes = await sandbox.handleAction({ type: "BREAK_SET_DND", minutes: 60 });
  assert.ok(dndRes.state.dndUntil > Date.now());
});
test("GlobalBreakGuard respecte les interrupteurs individuels et le mode DND", () => {
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

  guard.setState(
    {
      moveStart: fakeNow - 40 * 60 * 1000,
      drinkStart: fakeNow,
      eyesStart: fakeNow - 21 * 60 * 1000,
      postureStart: fakeNow - 46 * 60 * 1000,
      dinnerWindowStart: fakeNow - 35 * 60 * 1000,
      lastActivity: fakeNow
    },
    { enableMove: false, enableDinner: false }
  );
  const types = guard.getActiveAlerts().map((a) => a.type);
  assert.equal(types.includes("move"), false);
  assert.equal(types.includes("dinner"), false);
  assert.ok(types.includes("eyes"));
  assert.ok(types.includes("posture"));
  assert.ok(types.includes("winddown"));

  guard.setState({ dndUntil: fakeNow + 3600_000 });
  assert.equal(guard.getActiveAlerts().length, 0);
});
