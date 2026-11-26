// Lancer avec : node --test tools/ChromeAI/tests/extension_budget_guided.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("TokenBudgetManager, ExportMenuManager (confirm export lourd), TestActionsController (troncature) et action guidée", async () => {
  let turnCount = 0;
  let confirmCalls = 0;
  let confirmReply = false;
  const prompts = [];
  const timers = [];
  const makeNode = () => ({
    type: "", className: "", textContent: "", title: "", disabled: false, checked: false, dataset: {}, style: {}, children: [], listeners: {},
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    append(...items) { this.children.push(...items); }, appendChild(n) { this.children.push(n); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() {}
  });
  const sandbox = {
    window: { confirm: () => { confirmCalls += 1; return confirmReply; } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    document: { createElement: makeNode, createTextNode: (t) => ({ textContent: t }), body: { appendChild() {} }, querySelectorAll: () => new Array(turnCount).fill({}) },
    chrome: {
      runtime: {
        id: "ext-id",
        sendMessage(msg, cb) {
          if (msg.type === "EXPORT_PREVIEW") cb({ ok: true, modes: { modified: { files: 1, tokens: 400 }, skeleton: { files: 10, tokens: 2000 }, code: { files: 10, tokens: 20000 }, tests: { files: 5, tokens: 10000 }, full: { files: 15, tokens: 65000 } } });
        }
      }
    }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "token_budget.js", "composer_ui.js", "export_menu.js", "test_panel.js", "test_actions.js", "block_controls_ui.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const budget = new sandbox.window.GmcTokenBudgetManager();
  assert.equal(budget.getRecommendedExportMode(), "full");
  turnCount = 3;
  assert.equal(budget.getRecommendedExportMode(), "modified");
  assert.equal(budget.shouldConfirmHeavyExport(65000), true);
  budget.recordPayload("x".repeat(260000));
  assert.equal(budget.formatBadgeState().level, "running");
  budget.recordPayload("x".repeat(120000));
  assert.equal(budget.formatBadgeState().level, "fail");
  budget.reset();
  assert.equal(budget.sessionTokens, 0);
  let selectedMode = null;
  const menu = new sandbox.window.GmcExportMenuManager(budget);
  menu.toggle((m) => { selectedMode = m; }, []);
  const fullBtn = menu.menuEl.children.at(1).children.at(4);
  assert.ok(menu.menuEl.children.at(1).children.at(0).textContent.startsWith("⭐ "));
  fullBtn.listeners.click({ stopPropagation() {} });
  assert.equal(confirmCalls, 1);
  assert.equal(selectedMode, null);
  confirmReply = true;
  fullBtn.listeners.click({ stopPropagation() {} });
  assert.equal(selectedMode, "full");

  const fakeChat = { insertPrompt: (t) => { prompts.push(t); return true; }, insertTestResults: (t) => { prompts.push(t); return true; } };
  const testCtrl = new sandbox.window.GmcTestActionsController(fakeChat, () => {}, () => {}, { testsBtn: makeNode(), coverageBtn: makeNode() }, () => ({ lastEvent: "[OK] a.py" }), () => {}, budget);
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: "E".repeat(4500) });
  assert.equal(testCtrl.hasPendingFailure(), true);
  assert.ok(prompts.at(0).includes("caractères tronqués"));

  testCtrl.panel.open("Tests", "", true);
  await testCtrl.finalizeTestRun({ ok: true, passed: true, output: "OK" });
  assert.ok(testCtrl.panel.panelEl !== null);
  timers.at(-1).fn();
  assert.equal(testCtrl.panel.panelEl, null);

  const spill = new sandbox.window.GmcSpillDetector();
  const controlsUi = new sandbox.window.GmcBlockControlsUiHelper(spill);
  const endMarkerNode = makeNode();
  endMarkerNode.nodeType = 1;
  endMarkerNode.textContent = "=== END_FILE ===";
  const preNode = { nextSibling: endMarkerNode, parentElement: null };
  controlsUi.hideTrailingEndMarker(preNode);
  assert.equal(endMarkerNode.classList.contains("gmc-spilled-hidden"), true);

  const composerUi = new sandbox.window.GmcComposerQuickButtonsManager(fakeChat, makeNode(), makeNode());
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: true }, unpurgedCount: 2, hasTestFailure: true, canCommitMsg: true }).id, "fix_syntax");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, unpurgedCount: 2, hasTestFailure: true, canCommitMsg: true }).id, "fix_tests");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, unpurgedCount: 2, hasTestFailure: false, canCommitMsg: true }).id, "copy_suite");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, unpurgedCount: 0, hasTestFailure: false, canCommitMsg: true }).id, "commit_msg");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false, hasRunTestsClip: true, lastEvent: "[OK] app.py" }, unpurgedCount: 0, hasTestFailure: false, canCommitMsg: false }).id, "run_tests");
});
