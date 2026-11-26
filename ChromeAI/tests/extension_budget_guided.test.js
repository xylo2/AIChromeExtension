// Lancer avec : node --test tools/ChromeAI/tests/extension_budget_guided.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("TokenBudgetManager persiste par conversation, migre un export récent vers la nouvelle URL et utilise le repli DOM main", () => {
  const baseSearch = ["https:/", "://google.com", "search"].join("/");
  let storageData = { gmcTokenBudgets: {} };
  let turnNodes = [];
  const mainNode = { textContent: "x".repeat(400) };

  const sandbox = {
    window: { location: { href: `${baseSearch}?udm=50&mstk=thread1` } },
    document: {
      querySelectorAll: () => turnNodes,
      querySelector: () => mainNode
    },
    chrome: {
      storage: {
        local: {
          get: (_k, cb) => cb({ ...storageData }),
          set: (obj) => { Object.assign(storageData, obj); },
          remove: (k) => { delete storageData[k]; }
        }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "token_budget.js"), "utf-8"), sandbox);

  const budget = new sandbox.window.GmcTokenBudgetManager();
  const thread1Key = budget.getConversationKey();
  storageData.gmcTokenBudgets[thread1Key] = 12000;
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 12000);
  assert.equal(budget.estimateConversationDomTokens(), 100);
  assert.equal(budget.getTotalEstimatedTokens(), 12100);

  budget.recordPayload("y".repeat(400));
  assert.equal(storageData.gmcTokenBudgets[thread1Key], 12100);

  // Simulation d'un export massif sur l'URL générique (?udm=50) suivi d'une redirection vers ?udm=50&mstk=newThread
  sandbox.window.location.href = `${baseSearch}?udm=50`;
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 0);
  budget.recordPayload("z".repeat(400), 130500);
  assert.equal(storageData.gmcPendingBudget.tokens, 130500);

  sandbox.window.location.href = `${baseSearch}?udm=50&mstk=newThread`;
  const newThreadKey = budget.getConversationKey();
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 130500);
  assert.equal(storageData.gmcPendingBudget, undefined);
  assert.equal(storageData.gmcTokenBudgets[newThreadKey], 130500);

  // Une autre conversation ultérieure sans export récent repart bien à 0
  sandbox.window.location.href = `${baseSearch}?udm=50&mstk=thread2`;
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 0);
  turnNodes = [{ textContent: "z".repeat(800) }];
  assert.equal(budget.estimateConversationDomTokens(), 200);
});
test("ExportMenuManager (confirm export lourd), TestActionsController (troncature) et action guidée", async () => {
  let turnCount = 3, confirmCalls = 0, confirmReply = false;
  const prompts = [], timers = [];
  const makeNode = () => ({
    type: "", className: "", textContent: "", title: "", disabled: false, checked: false, dataset: {}, style: {}, children: [], listeners: {},
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    append(...items) { this.children.push(...items); }, appendChild(n) { this.children.push(n); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() {}
  });
  const sandbox = {
    window: { confirm: () => { confirmCalls += 1; return confirmReply; } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    document: { createElement: makeNode, createTextNode: (t) => ({ textContent: t }), body: { appendChild() {} }, querySelectorAll: () => new Array(turnCount).fill({}) },
    chrome: { runtime: { id: "ext-id", sendMessage(msg, cb) { if (msg.type === "EXPORT_PREVIEW") cb({ ok: true, modes: { modified: { files: 1, tokens: 400 }, skeleton: { files: 10, tokens: 2000 }, code: { files: 10, tokens: 20000 }, tests: { files: 5, tokens: 10000 }, full: { files: 15, tokens: 65000 } } }); } } }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "token_budget.js", "composer_ui.js", "export_menu.js", "test_panel.js", "test_actions.js", "block_controls_ui.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const budget = new sandbox.window.GmcTokenBudgetManager();
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
  timers.at(-1).fn();
  assert.equal(testCtrl.panel.panelEl, null);

  const composerUi = new sandbox.window.GmcComposerQuickButtonsManager(fakeChat, makeNode(), makeNode());
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: true }, canCommitMsg: true }).id, "fix_syntax");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, canCommitMsg: false }), null);
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, canCommitMsg: true }).id, "commit_msg");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false, hasRunTestsClip: true, lastEvent: "[OK] app.py" }, canCommitMsg: false }).id, "run_tests");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false, hasRunTestsClip: true, lastEvent: "[OK] app.py" }, canCommitMsg: false, testsPassedForCurrentEvent: true }), null);
});
