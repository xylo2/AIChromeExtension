// Lancer avec : node --test tools/ChromeAI/tests/extension_events.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("ContentEventsController active Auto-fix par défaut, gère Alt+P/S/T et export dossiers", () => {
  const docListeners = {};
  const prompts = [];
  const bgCalls = [];
  let purgeAllCalls = 0, resetQuotaCalls = 0, testsClicked = 0, exportArgs = null;
  let state = { running: true, hasSyntaxError: false, lastEvent: "[OK] a.py" };

  const makeBtn = () => ({
    textContent: "", disabled: false, listeners: {},
    classList: { set: new Set(), toggle(c, force) { force ? this.set.add(c) : this.set.delete(c); } },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { testsClicked += 1; }
  });

  const sandbox = {
    window: {},
    document: { addEventListener(ev, fn) { docListeners[ev] = fn; } },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set() {} } } },
    setTimeout: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "content_events.js"), "utf-8"), sandbox);

  const els = {
    statusPill: makeBtn(), autoSyntaxBtn: makeBtn(), copyPurgeAllBtn: makeBtn(),
    purgeBtn: makeBtn(), eventPill: makeBtn(), commitMsgBtn: makeBtn(),
    gitBtn: makeBtn(), exportBtn: makeBtn(), testsBtn: makeBtn(),
    testLogBtn: makeBtn(), yesBtn: makeBtn(), nextBtn: makeBtn(), excuseBtn: makeBtn()
  };

  const ctrl = new sandbox.window.GmcContentEventsController({
    els,
    blockManager: { copyAndPurgeAll: () => { purgeAllCalls += 1; }, purgeAll: () => {}, resetAutoSuiteQuota: () => { resetQuotaCalls += 1; } },
    chatInjector: { insertPrompt: (txt, auto) => prompts.push({ txt, auto }) },
    gitManager: { panelEl: null, buildCommitMessageOnlyPrompt: () => "COMMIT" },
    exportMenu: { menuEl: null, toggle: (cb, folders) => cb("modified", folders.slice(0, 1)) },
    testActions: { panel: { toggle: () => {} } },
    composerUi: { pickExcuse: () => "Excuse" },
    sendBgMessage: (msg, cb) => {
      bgCalls.push(msg);
      if (msg.type === "GET_SYNTAX_ERROR") cb({ ok: true, syntax_error: { file: "app.py", message: "SyntaxError", snippet: "> 1: def x(" } });
      else if (msg.type === "EXPORT_FOLDERS") cb({ ok: true, folders: ["ChromeAI", "export"] });
    },
    setBtnState: () => {},
    triggerProjectExport: (m, sub) => { exportArgs = { m, sub }; },
    updateIndicators: () => {},
    getWatcherState: () => state,
    setWatcherState: (s) => { state = s; },
    isStarting: () => false,
    setStarting: () => {},
    clearCommitMsgFlag: () => {}
  });
  ctrl.bindAll();

  assert.equal(ctrl.autoFixEnabled, true);
  ctrl.handleStateUpdate({ running: true, hasSyntaxError: true, lastEvent: "[SYNTAXE] app.py (ligne 1)" });
  assert.equal(prompts.length, 1);
  assert.ok(prompts.at(0).txt.includes("app.py"));

  els.autoSyntaxBtn.listeners.click();
  assert.equal(ctrl.autoFixEnabled, false);

  els.exportBtn.listeners.click();
  assert.deepEqual(exportArgs, { m: "modified", sub: ["ChromeAI"] });

  docListeners.keydown({ altKey: true, ctrlKey: false, metaKey: false, key: "p", preventDefault() {} });
  docListeners.keydown({ altKey: true, ctrlKey: false, metaKey: false, key: "s", preventDefault() {} });
  docListeners.keydown({ altKey: true, ctrlKey: false, metaKey: false, key: "t", preventDefault() {} });
  assert.equal(purgeAllCalls, 1);
  assert.equal(testsClicked, 1);
  assert.ok(resetQuotaCalls >= 2);
});
