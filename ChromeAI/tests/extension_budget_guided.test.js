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
    window: { location: { href: baseSearch + "?udm=50&mstk=thread1" } },
    document: { querySelectorAll: () => turnNodes, querySelector: () => mainNode },
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

  sandbox.window.location.href = baseSearch + "?udm=50";
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 0);
  budget.recordPayload("z".repeat(400), 130500);
  assert.equal(storageData.gmcPendingBudget.tokens, 130500);

  sandbox.window.location.href = baseSearch + "?udm=50&mstk=newThread";
  const newThreadKey = budget.getConversationKey();
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 130500);
  assert.equal(storageData.gmcPendingBudget, undefined);
  assert.equal(storageData.gmcTokenBudgets[newThreadKey], 130500);

  sandbox.window.location.href = baseSearch + "?udm=50&mstk=thread2";
  budget.syncFromStorage();
  assert.equal(budget.sessionTokens, 0);
  turnNodes = [{ textContent: "z".repeat(800) }];
  assert.equal(budget.estimateConversationDomTokens(), 200);
});
test("ExportMenuManager (confirm export lourd), TestActionsController (brouillon préservé, relance KO) et action guidée", async () => {
  let turnCount = 3, confirmCalls = 0, confirmReply = false, userDraft = "";
  const prompts = [], timers = [], bgMsgs = [];
  const makeNode = () => ({
    type: "", className: "", textContent: "", title: "", disabled: false, checked: false, dataset: {}, style: {}, scrollTop: 0, scrollHeight: 100, children: [], listeners: {},
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

  const fakeChat = {
    findChatInputElement: () => ({}),
    getInputText: () => userDraft,
    insertPrompt: (t, auto) => { prompts.push({ t, auto }); return true; },
    insertTestResults: (t, auto) => { prompts.push({ t, auto }); return true; }
  };
  const testsBtn = makeNode();
  const rerunBtn = makeNode();
  let testCtrl = null;
  testCtrl = new sandbox.window.GmcTestActionsController(
    fakeChat, (msg) => { bgMsgs.push(msg); }, () => {},
    { testsBtn, rerunFailedBtn: rerunBtn, coverageBtn: makeNode() },
    () => ({ running: true, hasRunTestsClip: true, lastEvent: "[OK] a.py" }),
    () => { testCtrl?.renderCoverageIndicator(); }, budget
  );
  userDraft = "Mon message en cours";
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: "FAIL: test_draft (t.S)" });
  assert.equal(prompts.at(0).auto, false);
  assert.equal(rerunBtn.style.display, "inline-flex");
  assert.equal(rerunBtn.textContent, "🎯 Relancer KO (1)");

  userDraft = "";
  testCtrl.panel.open("Tests KO", "", true);
  const koReport = "FAIL: test_alpha (tests.test_mod.Suite)\n✖ test_beta (12.4ms)\n" + "E".repeat(7000);
  await testCtrl.finalizeTestRun({ ok: true, passed: false, output: koReport });
  assert.equal(testCtrl.hasPendingFailure(), true);
  assert.equal(Array.from(testCtrl.getFailedTests()).join("|"), "test_alpha (tests.test_mod.Suite)|test_beta");
  assert.equal(rerunBtn.style.display, "inline-flex");
  assert.equal(rerunBtn.textContent, "🎯 Relancer KO (2)");
  assert.ok(prompts.at(1).t.includes("caractères tronqués"));
  assert.notEqual(prompts.at(1).auto, false);
  assert.equal(testCtrl.panel.panelEl, null);

  rerunBtn.listeners.click({ isTrusted: true });
  const lastBg = bgMsgs.at(-1);
  assert.equal(lastBg.type, "START_PROJECT_TESTS");
  assert.equal(Array.from(lastBg.failedTests).join("|"), "test_alpha (tests.test_mod.Suite)|test_beta");
  await testCtrl.finalizeTestRun({ ok: true, passed: true, output: "OK" });
  assert.equal(testCtrl.getFailedTests().length, 0);
  assert.equal(rerunBtn.style.display, "none");
  timers.at(-1).fn();

  const composerUi = new sandbox.window.GmcComposerQuickButtonsManager(fakeChat, makeNode(), makeNode());
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: true }, canCommitMsg: true }).id, "fix_syntax");
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, canCommitMsg: false }), null);
  assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false }, canCommitMsg: true }).id, "commit_msg");
assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false, hasRunTestsClip: true, lastEvent: "[OK] app.py" }, canCommitMsg: false, failedTestsCount: 2 }).id, "rerun_failed");
assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false, hasRunTestsClip: true, lastEvent: "[OK] app.py" }, canCommitMsg: false }).id, "run_tests");
assert.equal(composerUi.resolveGuidedAction({ watcherState: { running: true, hasSyntaxError: false, hasRunTestsClip: true, lastEvent: "[OK] app.py" }, canCommitMsg: false, testsPassedForCurrentEvent: true }), null);
});
