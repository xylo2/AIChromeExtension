// Lancer avec : node --test tools/ChromeAI/tests/extension_build_package.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("ContentEventsController streame les logs de build_package.py en direct, arrête et envoie les échecs à l'IA", async () => {
  const prompts = [];
  const intervals = [];
  const timers = [];
  let streamSnap = { ok: true, running: true, offset: 1, chunk: "Étape 1: compilation...\n" };
  let startReply = { ok: true, started: true };

  const makeNode = () => ({
    textContent: "", title: "", type: "", className: "", disabled: false, style: {}, scrollTop: 0, scrollHeight: 100, children: [], listeners: {},
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(...cs) { cs.forEach((c) => this.set.delete(c)); }, toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); } },
    append(...items) { this.children.push(...items); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    remove() { this.removed = true; }
  });

  const sandbox = {
    window: {}, globalThis: {},
    AbortSignal: { timeout: () => ({}) },
    document: { addEventListener() {}, createElement: makeNode, body: { appendChild() {} } },
    chrome: { storage: { local: { get: (_k, cb) => cb({}), set() {} } }, runtime: { getPlatformInfo() {} } },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval() {},
    fetch: async () => ({ status: 200, ok: true, json: async () => ({ ok: true, output: "OK" }) })
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "test_panel.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "content_events.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "background.js"), "utf-8"), sandbox);

  const els = {
    statusPill: makeNode(), autoSyntaxBtn: makeNode(), autoTestBtn: makeNode(),
    buildBtn: makeNode(), buildLogBtn: makeNode(), purgeBtn: makeNode(), eventPill: makeNode(),
    commitMsgBtn: makeNode(), gitBtn: makeNode(), exportBtn: makeNode(),
    testsBtn: makeNode(), testLogBtn: makeNode(), yesBtn: makeNode(), nextBtn: makeNode(), excuseBtn: makeNode()
  };
  const setBtnState = (btn, st, lbl) => { btn.state = st; btn.textContent = lbl; };

  const ctrl = new sandbox.window.GmcContentEventsController({
    els,
    blockManager: { resetAutoSuiteQuota() {}, copyAndPurgeAll() {}, purgeAll() {} },
    chatInjector: { insertPrompt: (txt, auto) => { prompts.push({ txt, auto }); return true; } },
    gitManager: { panelEl: null },
    exportMenu: null,
    testActions: { panel: { toggle() {} } },
    composerUi: { pickExcuse: () => "x" },
    sendBgMessage: (msg, cb) => {
      if (msg.type === "START_BUILD_PACKAGE") cb(startReply);
      else if (msg.type === "POLL_BUILD_STREAM") cb(streamSnap);
    },
    setBtnState, triggerProjectExport() {}, updateIndicators() {},
    getWatcherState: () => ({ running: true, hasBuildPackage: true }),
    setWatcherState() {}, isStarting: () => false, setStarting() {}, clearCommitMsgFlag() {}
  });
  ctrl.bindAll();

  els.buildBtn.listeners.click();
  assert.equal(ctrl.buildPanel.isRunning, true);
  intervals.at(-1)();
  assert.ok(ctrl.buildPanel.fullReport.includes("Étape 1: compilation..."));

  streamSnap = { ok: true, running: false, offset: 2, chunk: "Terminé.\n", passed: true, output: "Étape 1: compilation...\nTerminé." };
  intervals.at(-1)();
  assert.equal(els.buildBtn.state, "pass");
  assert.equal(els.buildBtn.textContent, "✅ Build OK");

  startReply = { ok: false, error: "SyntaxError in build_package.py" };
  els.buildBtn.listeners.click();
  assert.equal(els.buildBtn.state, "fail");
  assert.equal(prompts.length, 1);
  assert.ok(prompts.at(0).txt.includes("SyntaxError in build_package.py"));
});
