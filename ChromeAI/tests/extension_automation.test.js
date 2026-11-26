// Lancer avec : node --test tools/ChromeAI/tests/extension_automation.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("Commit 1-clic, Auto-tests, anti-boucle Auto-fix (max 2) et compaction DOM/tours", async () => {
  const prompts = []; const dropped = []; let testsClicked = 0; let canCommitMsg = false;
  const makeBtn = () => ({ textContent: "", disabled: false, style: {}, listeners: {}, classList: { set: new Set(), toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); }, remove() {}, add() {} }, addEventListener(ev, fn) { this.listeners[ev] = fn; }, click() { testsClicked += 1; } });
  const sandbox = {
    window: {}, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => {} } },
    document: { addEventListener() {}, createElement: makeBtn, body: { appendChild() {} }, querySelectorAll: () => [] },
    chrome: { storage: { local: { get: (_k, cb) => cb({ gmcAutoTest: true, gmcAutoFix: true }), set() {} } } },
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
      else if (msg.type === "GET_SYNTAX_ERROR") cb({ ok: true, syntax_error: { file: "bad.py", message: "SyntaxError", snippet: "> 1: def x(" } });
    },
    setBtnState() {}, triggerProjectExport() {}, updateIndicators() {}, getWatcherState: () => state, setWatcherState: (s) => { state = s; },
    isStarting: () => false, setStarting() {}, canRequestCommitMsg: () => canCommitMsg, clearCommitMsgFlag: () => { canCommitMsg = false; }
  });
  ctrl.bindAll();
  assert.equal(ctrl.autoTestEnabled, true);
  ctrl.handleStateUpdate(state);
  ctrl.handleStateUpdate(state);
  assert.equal(testsClicked, 1);

  // Anti-boucle Auto-fix : max 2 tentatives consécutives sur le même fichier, réinitialisé au clic manuel sur eventPill
  ctrl.handleStateUpdate({ running: true, hasSyntaxError: true, lastEvent: "[SYNTAXE] bad.py (ligne 1)" });
  ctrl.handleStateUpdate({ running: true, hasSyntaxError: true, lastEvent: "[SYNTAXE] bad.py (ligne 2)" });
  ctrl.handleStateUpdate({ running: true, hasSyntaxError: true, lastEvent: "[SYNTAXE] bad.py (ligne 3)" });
  assert.equal(prompts.length, 2);
  assert.ok(els.autoSyntaxBtn.textContent.includes("max"));
  els.eventPill.listeners.click();
  assert.equal(ctrl.autoSyntaxAttemptsByFile.has("bad.py"), false);
  assert.equal(prompts.length, 3);
  ctrl.handleStateUpdate({ running: true, hasSyntaxError: true, lastEvent: "[SYNTAXE] bad.py (ligne 4)" });
  assert.equal(prompts.length, 4);
  els.composerCommitBtn.listeners.click();
  assert.equal(dropped.at(0).n, "git_changes.diff.txt");
  assert.ok(prompts.at(4).txt.includes("=== COMMIT_MESSAGE ==="));
  canCommitMsg = true;
  els.composerCommitBtn.listeners.click();
  assert.equal(prompts.length, 6);

  const testCtrl = new sandbox.window.GmcTestActionsController(fakeChat, () => {}, () => {}, { testsBtn: makeBtn(), coverageBtn: makeBtn() }, () => state, () => {});
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: "FAIL: test_x" });
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: "FAIL: test_x" });
  assert.equal(prompts.length, 7);

  // Compaction DOM des blocs <pre> (> 4) et des anciens tours (user-query inclus, aperçu 50 car., bouton Afficher)
  let lastTurnSelector = "";
  const insertedPills = [];
  const makeTurn = (idx, txt) => ({
    id: idx, textContent: txt, attrs: {},
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; },
    contains: () => false, querySelector: () => null,
    parentNode: { insertBefore(pill) { insertedPills.push(pill); } }
  });
  const turns = Array.from({ length: 6 }, (_, i) => makeTurn(i, i === 0 ? "Question utilisateur très longue dépassant cinquante caractères pour vérifier la troncature" : `Tour ${i}`));
  sandbox.document.createElement = () => ({ className: "", textContent: "", type: "", children: [], listeners: {}, appendChild(c) { this.children.push(c); }, addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() { this.removed = true; } });
  sandbox.document.querySelectorAll = (sel) => { lastTurnSelector = sel; return sel.includes("user-query") ? turns : []; };

  const blockMgr = new sandbox.window.GmcCodeBlockManager(new sandbox.window.GmcSpillDetector(), fakeChat);
  for (let i = 0; i < 6; i += 1) {
    const pre = { tagName: "PRE", textContent: `x = ${i}`, isConnected: true, attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, classList: { add() {} } };
    blockMgr.trackedBlocks.push({ el: pre, headerName: `f${i}.py`, spilledNodes: [], purgeButtons: [] });
  }
  assert.equal(blockMgr.compactExcessDomBlocks(), 2);
  assert.equal(blockMgr.getUnpurgedCount(), 4);
  assert.equal(blockMgr.compactOldConversationTurns(), 2);
  assert.ok(lastTurnSelector.includes("user-query"));
  assert.equal(turns.at(0).classList.contains("gmc-collapsed-turn"), true);
  assert.equal(turns.at(5).classList.contains("gmc-collapsed-turn"), false);
  const firstPillBtn = insertedPills.at(0).children.at(0);
  assert.ok(firstPillBtn.textContent.includes("Question utilisateur très longue dépassant cinquante…"));
  firstPillBtn.listeners.click();
  assert.equal(turns.at(0).classList.contains("gmc-collapsed-turn"), false);
  assert.equal(insertedPills.at(0).removed, true);
});

test("ExportMenuManager affiche dynamiquement les estimations de tokens via EXPORT_PREVIEW", () => {
  const appended = [];
  const makeNode = () => ({
    type: "", className: "", textContent: "", title: "", disabled: false, checked: false, dataset: {}, children: [], listeners: {},
    append(...items) { this.children.push(...items); }, appendChild(n) { this.children.push(n); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() {}
  });
  const sandbox = {
    window: {},
    document: { createElement: makeNode, createTextNode: (t) => ({ textContent: t }), body: { appendChild(n) { appended.push(n); } } },
    chrome: {
      runtime: {
        id: "ext-id",
        sendMessage(msg, cb) {
          if (msg.type === "EXPORT_PREVIEW") {
            cb({ ok: true, modes: { modified: { files: 2, tokens: 850 }, code: { files: 40, tokens: 32400 }, skeleton: { files: 40, tokens: 4800 }, tests: { files: 25, tokens: 18200 }, full: { files: 65, tokens: 50600 } } });
          }
        }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "export_menu.js"), "utf-8"), sandbox);
  const menu = new sandbox.window.GmcExportMenuManager();
  menu.toggle(() => {}, []);
  const modeButtons = appended.at(0).children.at(1).children;
  assert.ok(modeButtons.at(0).textContent.includes("(~850 tok, 2 fic.)"));
  assert.ok(modeButtons.at(1).textContent.includes("(~32.4k tok, 40 fic.)"));
  assert.ok(modeButtons.at(4).textContent.includes("(~50.6k tok, 65 fic.)"));
});
