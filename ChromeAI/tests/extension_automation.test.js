// Lancer avec : node --test tools/ChromeAI/tests/extension_automation.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("Commit 1-clic compositeur, Auto-tests, anti-boucle et compaction DOM", async () => {
  const prompts = []; const dropped = []; let testsClicked = 0; let canCommitMsg = false;
  const makeBtn = () => ({ textContent: "", disabled: false, style: {}, listeners: {}, classList: { set: new Set(), toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); }, remove() {}, add() {} }, addEventListener(ev, fn) { this.listeners[ev] = fn; }, click() { testsClicked += 1; } });
  const sandbox = {
    window: {}, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => {} } },
    document: { addEventListener() {}, createElement: makeBtn, body: { appendChild() {} }, querySelectorAll: () => [] },
    chrome: { storage: { local: { get: (_k, cb) => cb({ gmcAutoTest: true }), set() {} } } },
    setTimeout: () => {}, clearTimeout: () => {}
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "git_panel.js", "test_panel.js", "test_actions.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js", "content_events.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const els = { statusPill: makeBtn(), autoSyntaxBtn: makeBtn(), autoTestBtn: makeBtn(), copyPurgeAllBtn: makeBtn(), purgeBtn: makeBtn(), eventPill: makeBtn(), commitMsgBtn: makeBtn(), composerCommitBtn: makeBtn(), gitBtn: makeBtn(), exportBtn: makeBtn(), testsBtn: makeBtn(), testLogBtn: makeBtn(), yesBtn: makeBtn(), nextBtn: makeBtn(), excuseBtn: makeBtn() };
  const fakeChat = { insertPrompt: (txt, auto) => { prompts.push({ txt, auto }); return true; }, insertTestResults: (txt, auto) => { prompts.push({ txt, auto }); return true; }, dropFile: (n, c) => dropped.push({ n, c }) };
  const gitMgr = new sandbox.window.GmcGitPanelManager(new sandbox.window.GmcSpillDetector(), fakeChat);
  let state = { running: true, hasGit: true, hasRunTestsClip: true, hasSyntaxError: false, lastEvent: "[OK] app.py" };
  const ctrl = new sandbox.window.GmcContentEventsController({
    els, blockManager: { resetAutoSuiteQuota() {}, copyAndPurgeAll() {}, purgeAll() {} }, chatInjector: fakeChat, gitManager: gitMgr,
    exportMenu: null, testActions: { panel: { toggle() {}, isRunning: false } }, composerUi: { pickExcuse: () => "x" },
    sendBgMessage: (msg, cb) => {
      if (msg.type === "GIT_STATUS") cb({ ok: true, entries: [{ status: "M", path: "app.py" }] });
      else if (msg.type === "GIT_DIFF_SELECTED") cb({ ok: true, filename: "git_changes.diff.txt", content: "diff --git a/app.py b/app.py" });
    },
    setBtnState() {}, triggerProjectExport() {}, updateIndicators() {}, getWatcherState: () => state, setWatcherState: (s) => { state = s; },
    isStarting: () => false, setStarting() {}, canRequestCommitMsg: () => canCommitMsg, clearCommitMsgFlag: () => { canCommitMsg = false; }
  });
  ctrl.bindAll();
  assert.equal(ctrl.autoTestEnabled, true);
  ctrl.handleStateUpdate(state);
  ctrl.handleStateUpdate(state);
  assert.equal(testsClicked, 1);
  els.composerCommitBtn.listeners.click();
  assert.equal(dropped.at(0).n, "git_changes.diff.txt");
  assert.ok(prompts.at(0).txt.includes("=== COMMIT_MESSAGE ==="));
  canCommitMsg = true;
  els.composerCommitBtn.listeners.click();
  assert.equal(prompts.length, 2);

  const testCtrl = new sandbox.window.GmcTestActionsController(fakeChat, () => {}, () => {}, { testsBtn: makeBtn(), coverageBtn: makeBtn() }, () => state, () => {});
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: "FAIL: test_x" });
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: "FAIL: test_x" });
  assert.equal(prompts.length, 3);

  const blockMgr = new sandbox.window.GmcCodeBlockManager(new sandbox.window.GmcSpillDetector(), fakeChat);
  for (let i = 0; i < 6; i += 1) {
    const pre = { tagName: "PRE", textContent: `x = ${i}`, isConnected: true, attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, classList: { add() {} } };
    blockMgr.trackedBlocks.push({ el: pre, headerName: `f${i}.py`, spilledNodes: [], purgeButtons: [] });
  }
  assert.equal(blockMgr.compactExcessDomBlocks(), 2);
  assert.equal(blockMgr.getUnpurgedCount(), 4);
});
