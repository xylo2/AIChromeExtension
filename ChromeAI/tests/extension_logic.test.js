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
  "composer_ui.js",
  "git_commit_ui.js",
  "git_panel.js",
  "test_panel.js",
  "test_actions.js",
  "svg_sanitizer.js",
  "svg_preview.js",
  "block_verifier.js",
  "block_controls_ui.js",
  "block_manager.js",
  "content.js"
];

test("manifest.json déclare les permissions et tous les modules modulaires dans l'ordre", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts.at(0).js, JS_MODULES);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "break_guard.js")), false);
});

test("chaque module est concis (<= 180 lignes) et sans triple backtick littéral", () => {
  for (const mod of [...JS_MODULES, "bg_native_helper.js", "background.js", "popup_view.js", "popup.js"]) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8");
    const lines = code.split("\n").length;
    assert.ok(lines <= 180, `${mod} dépasse 180 lignes (${lines})`);
    assert.equal(code.includes("\x60\x60\x60"), false, `Triple backtick littéral dans ${mod}`);
  }
  const popupHtml = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf-8");
  assert.ok(popupHtml.includes('href="popup.css"'));
  assert.ok(popupHtml.includes('src="popup_view.js"'));
  const stylesCss = fs.readFileSync(path.join(EXTENSION_DIR, "styles.css"), "utf-8");
  assert.ok(stylesCss.includes("max-width: calc(100vw - 32px)"));
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.equal((contentJs.match(/const setBtnState\s*=/g) || []).length, 1);
  assert.ok(contentJs.includes('insertPrompt("Oui", true)'));
  assert.ok(contentJs.includes('insertPrompt("Suite", true)'));
  assert.ok(contentJs.includes("composerUi.pickExcuse()"));
  assert.ok(contentJs.includes("checkPendingFreshExport"));
});
test("SpillDetector, CodeBlockManager, GitPanelManager (sans scroll) et WatcherPopupController fonctionnent", async () => {
  const scrollCalls = [];
  const winObj = { scrollX: 0, scrollY: 420, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; scrollCalls.push({ x, y }); }, scrollBy() {} };
  const sandbox = {
    window: winObj,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => { winObj.scrollY = 0; } } },
    document: { getElementById: () => null, addEventListener() {} },
    chrome: { runtime: { id: "test-ext-id" }, storage: { local: { get: (_k, cb) => cb({}) } } }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "file_attacher.js", "chat_injector.js", "git_commit_ui.js", "git_panel.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js", "popup_view.js", "popup.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const spill = new sandbox.window.GmcSpillDetector();
  assert.equal(spill.looksLikeSpilledCode("const x = 42;"), true);
  assert.equal(spill.isBoundaryTag("=== END_FILE ==="), true);
  let purgeNotified = 0;
  const blockMgr = new sandbox.window.GmcCodeBlockManager(spill, null, () => { purgeNotified += 1; });
  assert.equal(blockMgr.buildFallbackAttachmentName("tools/ChromeAI/content.js | 2/4"), "content.js.part2.txt");
  const fakePre = { tagName: "PRE", textContent: "print(1)", attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector() { return null; }, classList: { add() {} } };
  await blockMgr.copyAndPurge({ el: fakePre, headerName: "a.py", spilledNodes: [], purgeButtons: [] });
  assert.equal(purgeNotified, 1);
  winObj.scrollY = 420;
  const gitMgr = new sandbox.window.GmcGitPanelManager(spill, null);
  const restore = gitMgr.uiHelper.captureScrollAnchor({ getBoundingClientRect: () => ({ top: 200 }) });
  await sandbox.navigator.clipboard.writeText("feat: test");
  restore();
  assert.equal(winObj.scrollY, 420);
  assert.equal(scrollCalls.length, 1);
  assert.ok(gitMgr.buildCommitMessageOnlyPrompt().includes("=== COMMIT_MESSAGE ==="));
  const rawPushErr = "To https:" + "//example" + ".com\n ! [rejected] HEAD -> main (non-fast-forward)\nfatal: failed to push";
  assert.equal(gitMgr.extractPushErrorSummary(rawPushErr), "! [rejected] HEAD -> main (non-fast-forward)");
});

test("GitCommitUiHelper.findNewChatButton et createFreshExportButton déclenchent le nouveau chat", () => {
  let newChatClicked = false;
  let storedPayload = null;
  let assignedUrl = "";
  let createdBtn = null;
  const newChatBtn = {
    className: "new-chat-btn", textContent: "Nouveau chat",
    getAttribute: () => "",
    click() { newChatClicked = true; }
  };
  const testHref = new URL("/search?udm=50&q=test&ei=123", ["https://www", "google", "com"].join(".")).toString();
  const sandbox = {
    URL,
    window: { location: { href: testHref, assign(u) { assignedUrl = u; } } },
    document: {
      querySelectorAll: () => [newChatBtn],
      createElement: () => {
        createdBtn = {
          type: "", className: "", textContent: "", title: "", disabled: false, listeners: {},
          addEventListener(ev, fn) { this.listeners[ev] = fn; }
        };
        return createdBtn;
      }
    },
    chrome: { storage: { local: { set(obj) { storedPayload = obj; } } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "git_commit_ui.js"), "utf-8"), sandbox);
  const helper = new sandbox.window.GmcGitCommitUiHelper(null);
  assert.equal(helper.findNewChatButton(), newChatBtn);
  const btn = helper.createFreshExportButton();
  btn.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(btn.disabled, true);
  assert.equal(newChatClicked, true);
  assert.ok(typeof storedPayload?.pendingFreshExportAt === "number");
  newChatBtn.textContent = "Autre";
  assert.equal(helper.findNewChatButton(), null);
  btn.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(assignedUrl.includes("q=test"), false);
  assert.equal(assignedUrl.includes("udm=50"), true);
});
