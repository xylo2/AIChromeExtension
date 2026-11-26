// Lancer avec : node --test tools/ChromeAI/tests/extension_logic.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");
const JS_MODULES = [
  "spill_heuristics.js",
  "spill_detector.js",
  "file_attacher.js",
  "chat_injector.js",
  "token_budget.js",
  "composer_ui.js",
  "export_menu.js",
  "git_commit_ui.js",
  "git_panel.js",
  "test_panel.js",
  "test_actions.js",
  "svg_sanitizer.js",
  "svg_preview.js",
  "block_verifier.js",
  "block_controls_ui.js",
  "block_manager.js",
  "content_events.js",
  "content.js"
];

test("manifest.json déclare les permissions et tous les modules modulaires dans l'ordre", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts.at(0).js, JS_MODULES);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "break_guard.js")), false);
});

test("chaque module est concis (<= 180 lignes), sans triple backtick littéral ni scroll auto", () => {
  for (const mod of [...JS_MODULES, "bg_native_helper.js", "background.js", "popup_view.js", "popup.js"]) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8");
    const lines = code.split("\n").length;
    assert.ok(lines <= 180, `${mod} dépasse 180 lignes (${lines})`);
    assert.equal(code.includes("\x60\x60\x60"), false, `Triple backtick littéral dans ${mod}`);
    assert.equal(/\b(?:scrollIntoView|scrollTo|scrollBy)\b/.test(code), false, `Scroll auto interdit dans ${mod}`);
  }
  const popupHtml = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf-8");
  assert.ok(popupHtml.includes('href="popup.css"'));
  assert.ok(popupHtml.includes('src="popup_view.js"'));
  const stylesCss = fs.readFileSync(path.join(EXTENSION_DIR, "styles.css"), "utf-8");
  assert.ok(stylesCss.includes("max-width: calc(100vw - 32px)"));
  assert.ok(stylesCss.includes(".gmc-offline-bar"));
  assert.ok(stylesCss.includes(".gmc-floating-row:empty"));
  assert.ok(stylesCss.includes(".gmc-code-header-btn"));
  assert.ok(/\.gmc-global-status-pill\s*\{[^}]*margin-right:\s*auto/s.test(stylesCss));
  assert.ok(/\.gmc-global-event-pill\s*\{[^}]*margin-right:\s*auto/s.test(stylesCss));
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.equal((contentJs.match(/const setBtnState\s*=/g) || []).length, 1);
  assert.ok(contentJs.includes("GmcContentEventsController"));
  assert.ok(contentJs.includes("checkPendingFreshExport"));
  assert.ok(contentJs.includes('floatingBar.classList.toggle("gmc-offline-bar", !running)'));
  assert.ok(contentJs.includes('statusPill: makeBtn("gmc-global-status-pill offline", "🔴 Watcher OFF", "", false, serviceRow)'));
  assert.equal(contentJs.includes("copyPurgeAllBtn"), false);
  const eventsJs = fs.readFileSync(path.join(EXTENSION_DIR, "content_events.js"), "utf-8");
  assert.ok(eventsJs.includes('insertPrompt("Oui", true)'));
  assert.ok(eventsJs.includes('insertPrompt("Suite", true)'));
  assert.ok(eventsJs.includes("composerUi.pickExcuse()"));
  assert.ok(eventsJs.includes("exportMenu.toggle"));
});
test("SpillDetector, CodeBlockManager, GitPanelManager (sans scroll, 2 boutons) et WatcherPopupController fonctionnent", async () => {
  const makeNode = (tag) => ({
    tagName: tag, className: "", textContent: "", type: "", checked: false, dataset: {}, children: [], listeners: {},
    append(...items) { this.children.push(...items); }, appendChild(n) { this.children.push(n); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() {}
  });
  const sandbox = {
    window: {},
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => {} } },
    document: { getElementById: () => null, addEventListener() {}, createElement: makeNode, body: makeNode("BODY"), querySelectorAll: () => [{ textContent: "x".repeat(400) }] },
    chrome: { runtime: { id: "test-ext-id" }, storage: { local: { get: (_k, cb) => cb({}) } } }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "file_attacher.js", "chat_injector.js", "token_budget.js", "git_commit_ui.js", "git_panel.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js", "content_events.js", "popup_view.js", "popup.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const budget = new sandbox.window.GmcTokenBudgetManager();
  assert.equal(budget.getTotalEstimatedTokens(), 100);
  const spill = new sandbox.window.GmcSpillDetector();
  assert.equal(spill.looksLikeSpilledCode("const x = 42;"), true);
  assert.equal(spill.isBoundaryTag("=== END_FILE ==="), true);
  let purgeNotified = 0;
  const blockMgr = new sandbox.window.GmcCodeBlockManager(spill, null, () => { purgeNotified += 1; });
  assert.equal(blockMgr.MAX_SAFE_LINES, 75);
  assert.equal(blockMgr.buildFallbackAttachmentName("tools/ChromeAI/content.js | 2/4"), "content.js.part2.txt");
  const fakePre = { tagName: "PRE", textContent: "print(1)", attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector() { return null; }, classList: { add() {} } };
  await blockMgr.copyAndPurge({ el: fakePre, headerName: "a.py", spilledNodes: [], purgeButtons: [] });
  assert.equal(purgeNotified, 1);
  const btnStub = () => ({ textContent: "", disabled: false, classList: { toggle() {} }, addEventListener() {} });
  const eventsCtrl = new sandbox.window.GmcContentEventsController({
    els: { statusPill: btnStub(), purgeBtn: btnStub(), eventPill: btnStub(), commitMsgBtn: btnStub(), gitBtn: btnStub(), exportBtn: btnStub(), testsBtn: btnStub(), testLogBtn: btnStub(), yesBtn: btnStub(), nextBtn: btnStub(), excuseBtn: btnStub() },
    blockManager: blockMgr, chatInjector: { insertPrompt() {} }, gitManager: { panelEl: null }, exportMenu: null,
    testActions: { panel: { toggle() {} } }, composerUi: { pickExcuse: () => "x" }, sendBgMessage() {}, setBtnState() {},
    triggerProjectExport() {}, updateIndicators() {}, getWatcherState: () => ({ running: false }), setWatcherState() {},
    isStarting: () => false, setStarting() {}, clearCommitMsgFlag() {}
  });
  eventsCtrl.bindAll();
  const gitMgr = new sandbox.window.GmcGitPanelManager(spill, null);
  gitMgr.open([{ status: "M", path: "app.py" }]);
  const actionBtns = gitMgr.panelEl.children.at(2).children;
  assert.deepEqual(actionBtns.map((b) => b.textContent), ["Fermer", "📤 Transmettre à l'IA"]);
  gitMgr.close();
  assert.equal(typeof gitMgr.uiHelper.captureScrollAnchor, "undefined");
  const commitPrompt = gitMgr.buildCommitPrompt(["app.py"], "git_changes.diff.txt");
  assert.ok(commitPrompt.includes("correction"));
  assert.ok(commitPrompt.includes("=== COMMIT_MESSAGE ==="));
  assert.ok(gitMgr.buildCommitMessageOnlyPrompt().includes("=== COMMIT_MESSAGE ==="));
  const rawPushErr = "To https:" + "//example" + ".com\n ! [rejected] HEAD -> main (non-fast-forward)\nfatal: failed to push";
  assert.equal(gitMgr.extractPushErrorSummary(rawPushErr), "! [rejected] HEAD -> main (non-fast-forward)");
});
