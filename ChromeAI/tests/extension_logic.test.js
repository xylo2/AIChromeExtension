// Lancer avec : node --test tools/ChromeAI/tests/extension_logic.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");
const JS_MODULES = [
  "spill_detector.js",
  "chat_injector.js",
  "composer_ui.js",
  "git_panel.js",
  "test_panel.js",
  "svg_preview.js",
  "block_manager.js",
  "content.js"
];

test("manifest.json déclare les permissions et les modules dans l'ordre sans break_guard", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts.at(0).js, JS_MODULES);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "break_guard.js")), false);
});

test("chaque module est concis (<= 310 lignes) et sans triple backtick littéral", () => {
  for (const mod of JS_MODULES) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8");
    const lines = code.split("\n").length;
    assert.ok(lines <= 310, `${mod} dépasse 310 lignes (${lines})`);
    assert.equal(code.includes("\x60\x60\x60"), false, `Triple backtick littéral dans ${mod}`);
  }
  const stylesCss = fs.readFileSync(path.join(EXTENSION_DIR, "styles.css"), "utf-8");
  assert.ok(stylesCss.includes("max-width: calc(100vw - 32px)"));
  assert.ok(stylesCss.includes("bottom: 124px"));
  const eventPillBlock = stylesCss.match(/\.gmc-global-event-pill\s*\{[^}]*\}/)?.at(0) || "";
  assert.equal(eventPillBlock.includes("display:"), false);
  assert.ok(eventPillBlock.includes("max-width: none"));
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.equal((contentJs.match(/const setBtnState\s*=/g) || []).length, 1);
  assert.ok(contentJs.indexOf("let floatingBar") < contentJs.indexOf("const makeBtn"));
  assert.ok(contentJs.includes("gmc-floating-row-status"));
  assert.ok(contentJs.includes("gmc-floating-row-actions"));
  assert.ok(contentJs.includes("gmc-floating-row-tests"));
  assert.ok(contentJs.indexOf("statusPill =") < contentJs.indexOf("purgeBtn ="));
  assert.ok(contentJs.indexOf("eventPill =") < contentJs.indexOf("gitBtn ="));
  assert.ok(contentJs.indexOf("gitBtn =") < contentJs.indexOf("exportBtn ="));
  assert.ok(contentJs.includes('insertPrompt("Oui", true)'));
  assert.ok(contentJs.includes('insertPrompt("Suite", true)'));
  assert.ok(contentJs.includes("composerUi.pickExcuse()"));
  assert.ok(contentJs.includes("gmc-global-coverage-btn"));
  assert.ok(contentJs.includes("gmc-global-testlog-btn"));
  assert.ok(contentJs.includes("GmcTestOutputPanelManager"));
  assert.ok(contentJs.includes("START_PROJECT_TESTS"));
  assert.ok(contentJs.includes("POLL_TEST_STREAM"));
  assert.ok(contentJs.includes("testsBtn.disabled = Boolean(testPanel.isRunning)"));
  assert.ok(contentJs.includes("startPollingTestStream"));
  assert.ok(contentJs.includes("parseCoveragePercent"));
  assert.ok(contentJs.includes("res.uncovered"));
  assert.equal(contentJs.includes("GmcBreakGuard"), false);
  const composerJs = fs.readFileSync(path.join(EXTENSION_DIR, "composer_ui.js"), "utf-8");
  assert.ok(composerJs.includes("gmc-composer-below"));
  assert.ok(composerJs.includes("hasStartedConversation"));
});
test("ComposerQuickButtonsManager masque les boutons avant le début de la conversation", () => {
  const wireParent = (parent, children) => {
    parent.children = children;
    children.forEach((c, idx) => {
      c.parentElement = parent;
      c.nextElementSibling = children.at(idx + 1) || null;
      c.nextSibling = children.at(idx + 1) || null;
    });
  };
  const makeEl = (tag) => ({
    tagName: tag, className: "", textContent: "", style: {}, children: [],
    parentElement: null, nextElementSibling: null, nextSibling: null,
    isConnected: false, removed: false, rectTop: 650,
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    },
    getBoundingClientRect() { return { top: this.rectTop, height: 40 }; },
    getAttribute() { return ""; },
    closest() { return null; },
    remove() { this.removed = true; this.parentElement = null; },
    querySelectorAll(sel) { return sel.includes("button") ? [plusBtn] : []; },
    contains(target) {
      if (target === this) return true;
      return this.children.some((c) => c.contains && c.contains(target));
    },
    insertBefore(node, ref) {
      node.parentElement = this;
      node.nextSibling = ref || null;
      node.isConnected = true;
      const idx = this.children.indexOf(ref);
      if (idx >= 0) this.children.splice(idx, 0, node);
      else this.children.push(node);
    }
  });

  const outerWrapper = makeEl("DIV");
  const composerBox = makeEl("DIV");
  const plusBtn = makeEl("BUTTON");
  plusBtn.textContent = "+";
  const inputWrapper = makeEl("DIV");
  const inputEl = makeEl("DIV");
  wireParent(inputWrapper, [inputEl]);
  wireParent(composerBox, [plusBtn, inputWrapper]);
  wireParent(outerWrapper, [composerBox]);

  const staleDuplicateGroup = makeEl("DIV");
  const bottomRow = makeEl("DIV");
  const gitBtn = makeEl("BUTTON");
  wireParent(bottomRow, [gitBtn]);
  const sandbox = {
    window: { innerHeight: 800, location: { href: "https://www.google.com", pathname: "/webhp" } },
    document: {
      createElement: (tag) => makeEl(tag),
      querySelector: () => null,
      querySelectorAll: () => [staleDuplicateGroup, mgr?.groupEl].filter(Boolean)
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "composer_ui.js"), "utf-8"), sandbox);
  const mgr = new sandbox.window.GmcComposerQuickButtonsManager({ findChatInputElement: () => inputEl }, bottomRow, gitBtn);

  inputEl.rectTop = 220;
  mgr.mount();
  assert.equal(staleDuplicateGroup.removed, true);
  assert.equal(mgr.groupEl.parentElement, null);

  inputEl.rectTop = 650;
  mgr.mount();
  assert.equal(mgr.groupEl.parentElement, outerWrapper);
  assert.equal(mgr.groupEl.classList.contains("gmc-composer-below"), true);
});
test("ChatInjector.isAttachmentReady et dropFile gèrent puces, spinner et input file", () => {
  const sandbox = {
    window: {},
    document: { querySelectorAll: () => [] },
    File: class FakeFile {
      constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type || ""; }
    },
    DataTransfer: class FakeDT {
      constructor() { this.items = { add: (f) => { this.files = [f]; } }; this.files = []; }
    },
    Event: class FakeEvent {
      constructor(type, opts) { this.type = type; this.bubbles = Boolean(opts?.bubbles); }
    },
    DragEvent: class FakeDragEvent {
      constructor(type, opts) { this.type = type; this.dataTransfer = opts?.dataTransfer; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "chat_injector.js"), "utf-8"), sandbox);

  const injector = new sandbox.window.GmcChatInjector();
  let busyEl = null;
  let chipNodes = [];
  let chipCount = 0;
  const composerParent = {
    querySelector: (sel) => (sel.includes("progressbar") ? busyEl : null),
    querySelectorAll: () => []
  };
  const composerBox = {
    parentElement: composerParent,
    querySelector: (sel) => (sel.includes("button") ? {} : null)
  };
  const inputEl = { parentElement: composerBox, isConnected: true, tagName: "DIV", textContent: "" };

  injector.queryDeepAll = (sel) => {
    if (sel === "*") return chipNodes;
    if (sel.includes("data-file-name")) return new Array(chipCount).fill({ className: "" });
    return [];
  };

  assert.equal(injector.isAttachmentReady(inputEl, ""), true);
  busyEl = { tagName: "DIV" };
  chipNodes = [{ className: "", getAttribute: (k) => (k === "aria-label" ? "git_changes.diff.txt" : "") }];
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), false);
  busyEl = null;
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), true);

  chipNodes = [];
  injector.baselineAttachmentCount = 1;
  chipCount = 1;
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), false);
  chipCount = 2;
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), true);

  let changeDispatched = false;
  const fakeFileInput = {
    files: null,
    dispatchEvent: (ev) => { if (ev.type === "change") changeDispatched = true; }
  };
  injector.findChatInputElement = () => inputEl;
  injector.queryDeepAll = (sel) => (sel === 'input[type="file"]' ? [fakeFileInput] : []);
  assert.equal(injector.dropFile("git_changes.diff.txt", "diff --git a/x b/x", false), true);
  assert.equal(changeDispatched, true);
  assert.equal(injector.pendingAttachmentName, "git_changes.diff.txt");
});

test("SpillDetector (END_FILE), CodeBlockManager et GitPanelManager fonctionnent", async () => {
  const sandbox = {
    window: {},
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => {} } }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_detector.js", "chat_injector.js", "git_panel.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }

  const spill = new sandbox.window.GmcSpillDetector();
  assert.equal(spill.looksLikeSpilledCode("const x = 42;"), true);
  assert.equal(spill.looksLikeSpilledCode("Voici une phrase explicative normale."), false);
  assert.equal(spill.looksLikeSpilledCode("=== END_FILE ==="), false);
  assert.equal(spill.isBoundaryTag("=== END_FILE ==="), true);

  const makeNode = (txt, next = null) => ({
    nodeType: 1, tagName: "P", textContent: txt,
    childNodes: [{ nodeType: 3, textContent: txt }],
    classList: { contains: () => false }, querySelector: () => null, nextSibling: next
  });
  const afterBoundary = makeNode("def should_not_be_collected(): pass");
  const boundaryNode = makeNode("=== END_FILE ===", afterBoundary);
  const spilledNode = makeNode("return x + 1;", boundaryNode);
  const scanned = spill.scanDirection(spilledNode, "next");
  assert.deepEqual([...scanned.chunks], ["return x + 1;"]);

  let purgeNotified = 0;
  const blockMgr = new sandbox.window.GmcCodeBlockManager(spill, null, () => { purgeNotified += 1; });
  assert.equal(blockMgr.buildFallbackAttachmentName("tools/ChromeAI/content.js | 2/4"), "content.js.part2.txt");
  assert.equal(blockMgr.buildFallbackAttachmentName("tools/ChromeAI/manifest.json"), "manifest.json.txt");
  assert.ok(blockMgr.formatLabel("a.py", 10, true).startsWith("🚨"));

  const fakePre = {
    tagName: "PRE", textContent: "print(1)", attrs: {},
    getAttribute(k) { return this.attrs[k] || null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector() { return null; }, classList: { add() {} }
  };
  await blockMgr.copyAndPurge({ el: fakePre, headerName: "a.py", spilledNodes: [], purgeButtons: [] });
  assert.equal(purgeNotified, 1);

  const gitMgr = new sandbox.window.GmcGitPanelManager(spill, null);
  const verifyPrompt = gitMgr.buildVerifyPrompt(["tools/a.py"], "git_changes.diff.txt");
  assert.ok(verifyPrompt.includes("Vérification du diff"));
  assert.equal(verifyPrompt.includes("=== COMMIT_MESSAGE ==="), false);

  const commitPrompt = gitMgr.buildCommitPrompt(["tools/a.py", "tools/b.js"], "git_changes.diff.txt");
  assert.ok(commitPrompt.includes("=== COMMIT_MESSAGE ==="));
  assert.ok(commitPrompt.includes("Vérification du diff"));
  assert.ok(commitPrompt.includes("tests unitaires"));

  const msg = gitMgr.extractCommitMessage({
    tagName: "CODE",
    textContent: "=== COMMIT_MESSAGE ===\nfeat(ui): modularisation en classes"
  });
  assert.equal(msg, "feat(ui): modularisation en classes");
  assert.equal(typeof gitMgr.createPushButton, "function");

  const rawPushErr = "To https:" + "//example" + ".com\n ! [rejected] HEAD -> main (non-fast-forward)\nfatal: failed to push";
  assert.equal(gitMgr.extractPushErrorSummary(rawPushErr), "! [rejected] HEAD -> main (non-fast-forward)");
});

test("WatcherPopupController verrouille les champs et masque commande en cours et tests dans la popup", () => {
  const popupHtml = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf-8");
  const popupCode = fs.readFileSync(path.join(EXTENSION_DIR, "popup.js"), "utf-8");
  assert.equal(popupHtml.includes("activeCommand"), false);
  assert.equal(popupHtml.includes("runTestsBtn"), false);
  assert.equal(popupCode.includes("activeCommand"), false);
  assert.equal(popupCode.includes("runTestsBtn"), false);

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, value: "", disabled: false, title: "", textContent: "",
        className: "", style: {}, classList: { remove() {}, add() {} }
      });
    }
    return elements.get(id);
  };
  const sandbox = {
    window: {},
    document: { getElementById: getEl, addEventListener() {} },
    chrome: { runtime: { id: "test-ext-id" }, storage: { local: { get: (_k, cb) => cb({}) } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(popupCode, sandbox);
  const ctrl = new sandbox.window.GmcPopupController();

  const inputIds = ["rootDirInput", "targetDirInput", "testRunnerInput", "extraArgsInput"];
  ctrl.renderState({ running: true, targetDir: "C:\\git\\tools", pid: 1234 });
  for (const id of inputIds) {
    assert.equal(getEl(id).disabled, true, `${id} doit être verrouillé quand running=true`);
  }
  assert.equal(getEl("configLockNotice").style.display, "block");

  ctrl.renderState({ running: false });
  for (const id of inputIds) {
    assert.equal(getEl(id).disabled, false, `${id} doit être déverrouillé quand running=false`);
  }
  assert.equal(getEl("configLockNotice").style.display, "none");
});
