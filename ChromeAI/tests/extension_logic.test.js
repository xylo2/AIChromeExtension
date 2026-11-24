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
  "git_panel.js",
  "test_panel.js",
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

test("chaque module est concis (<= 360 lignes) et sans triple backtick littéral", () => {
  for (const mod of JS_MODULES) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8");
    const lines = code.split("\n").length;
    assert.ok(lines <= 360, `${mod} dépasse 360 lignes (${lines})`);
    assert.equal(code.includes("\x60\x60\x60"), false, `Triple backtick littéral dans ${mod}`);
  }
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.equal((contentJs.match(/const setBtnState\s*=/g) || []).length, 1);
  assert.ok(contentJs.indexOf("let floatingBar") < contentJs.indexOf("const makeBtn"));
  assert.ok(contentJs.includes("gmc-floating-row-top"));
  assert.ok(contentJs.includes("gmc-floating-row-bottom"));
  assert.ok(contentJs.indexOf("statusPill =") < contentJs.indexOf("eventPill ="));
  assert.ok(contentJs.indexOf("eventPill =") < contentJs.indexOf("purgeBtn ="));
  assert.ok(contentJs.indexOf("exportBtn =") < contentJs.indexOf("gitBtn ="));
  assert.ok(contentJs.indexOf("gitBtn =") < contentJs.indexOf("coverageBtn ="));
  assert.ok(contentJs.indexOf("coverageBtn =") < contentJs.indexOf("testsBtn ="));
  assert.ok(contentJs.includes('insertPrompt("Oui", true)'));
  assert.ok(contentJs.includes('insertPrompt("Suite", true)'));
  assert.ok(contentJs.includes("pickDevExcuse()"));
  assert.ok(contentJs.includes("gmc-global-coverage-btn"));
  assert.ok(contentJs.includes("gmc-global-testlog-btn"));
  assert.ok(contentJs.includes("GmcTestOutputPanelManager"));
  assert.ok(contentJs.includes("START_PROJECT_TESTS"));
  assert.ok(contentJs.includes("POLL_TEST_STREAM"));
  assert.ok(contentJs.includes("parseCoveragePercent"));
  assert.equal(contentJs.includes("GmcBreakGuard"), false);
  assert.ok(contentJs.includes("gmc-composer-below"));
  assert.ok(contentJs.includes("isBottomConversationComposer"));
});
test("mountQuickButtonsNearPlus garde les boutons stables si le compositeur n'est pas en bas", () => {
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  const start = contentJs.indexOf("const isAiConversationPage = () => {");
  const end = contentJs.indexOf("const parseCoveragePercent =");
  const fnCode = contentJs.slice(start, end);

  const wireParent = (parent, children) => {
    parent.children = children;
    children.forEach((c, idx) => {
      c.parentElement = parent;
      c.nextElementSibling = children.at(idx + 1) || null;
      c.nextSibling = children.at(idx + 1) || null;
    });
  };
  const makeEl = (tag) => ({
    tagName: tag,
    className: "",
    textContent: "",
    style: {},
    children: [],
    parentElement: null,
    nextElementSibling: null,
    nextSibling: null,
    isConnected: false,
    removed: false,
    rectTop: 650,
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    },
    getBoundingClientRect() { return { top: this.rectTop, height: 40 }; },
    getAttribute() { return ""; },
    closest() { return null; },
    remove() { this.removed = true; },
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

  const quickReplyGroup = makeEl("DIV");
  const staleDuplicateGroup = makeEl("DIV");
  const floatingBar = makeEl("DIV");
  const gitBtn = makeEl("BUTTON");
  const exportBtn = makeEl("BUTTON");
  const bottomRow = makeEl("DIV");
  wireParent(bottomRow, [exportBtn, gitBtn]);
  wireParent(floatingBar, [bottomRow]);
  const sandbox = {
    window: { innerHeight: 800, location: { href: "https://www.google.com", pathname: "/search" } },
    document: {
      querySelector: () => ({}),
      querySelectorAll: () => [staleDuplicateGroup, quickReplyGroup]
    },
    chatInjector: { findChatInputElement: () => inputEl },
    quickReplyGroup,
    floatingBar,
    bottomRow,
    exportBtn,
    gitBtn
  };
  vm.createContext(sandbox);

  inputEl.rectTop = 220;
  vm.runInContext(`${fnCode}\nmountQuickButtonsNearPlus();`, sandbox);
  assert.equal(staleDuplicateGroup.removed, true);
  assert.equal(quickReplyGroup.parentElement, bottomRow);

  inputEl.rectTop = 650;
  vm.runInContext("mountQuickButtonsNearPlus();", sandbox);
  assert.equal(quickReplyGroup.parentElement, outerWrapper);
  assert.equal(quickReplyGroup.classList.contains("gmc-composer-below"), true);
});
test("TestOutputPanelManager streame, copie, envoie à l'IA et ferme le panneau", () => {
  const appended = [];
  let copiedText = "";
  let sentPayload = null;

  const makeDomNode = (tag) => ({
    tagName: tag,
    className: "",
    textContent: "",
    type: "",
    scrollTop: 0,
    scrollHeight: 150,
    children: [],
    listeners: {},
    removed: false,
    append(...items) { this.children.push(...items); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    remove() { this.removed = true; }
  });

  const sandbox = {
    window: {},
    navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    document: {
      createElement: makeDomNode,
      body: { appendChild(n) { appended.push(n); } }
    },
    setTimeout: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "test_panel.js"), "utf-8"), sandbox);

  const mgr = new sandbox.window.GmcTestOutputPanelManager({
    insertTestResults(txt, auto) { sentPayload = { txt, auto }; }
  });
  mgr.open();
  assert.equal(appended.length, 1);
  mgr.appendChunk("[watch_clipboard] OK (44 tests)\n");
  assert.equal(mgr.preEl.textContent, "[watch_clipboard] OK (44 tests)\n");
  assert.equal(mgr.preEl.scrollTop, 150);

  mgr.finish(true, "[watch_clipboard] OK (44 tests)\n\nCOUVERTURE GLOBALE : 98.5%");
  assert.ok(mgr.headerEl.textContent.includes("Rapport complet des tests"));

  const actions = appended.at(0).children.at(2);
  actions.children.at(0).listeners.click();
  assert.ok(copiedText.includes("COUVERTURE GLOBALE : 98.5%"));

  actions.children.at(1).listeners.click();
  assert.equal(sentPayload.auto, true);
  assert.equal(mgr.panelEl, null);
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
    nodeType: 1,
    tagName: "P",
    textContent: txt,
    childNodes: [{ nodeType: 3, textContent: txt }],
    classList: { contains: () => false },
    querySelector: () => null,
    nextSibling: next
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
    tagName: "PRE",
    textContent: "print(1)",
    attrs: {},
    getAttribute(k) { return this.attrs[k] || null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector() { return null; },
    classList: { add() {} }
  };
  await blockMgr.copyAndPurge({ el: fakePre, headerName: "a.py", spilledNodes: [], purgeButtons: [] });
  assert.equal(purgeNotified, 1);

  const gitMgr = new sandbox.window.GmcGitPanelManager(spill, null);
  const verifyPrompt = gitMgr.buildVerifyPrompt(["tools/a.py"], "git_changes.diff.txt");
  assert.ok(verifyPrompt.includes("Vérification du diff"));
  assert.equal(verifyPrompt.includes("=== COMMIT_MESSAGE ==="), false);
  assert.ok(verifyPrompt.includes("sans générer de message de commit"));

  const commitPrompt = gitMgr.buildCommitPrompt(["tools/a.py", "tools/b.js"], "git_changes.diff.txt");
  assert.ok(commitPrompt.includes("=== COMMIT_MESSAGE ==="));
  assert.ok(commitPrompt.includes("Vérification du diff"));
  assert.ok(commitPrompt.includes("apport **fonctionnel**"));
  assert.ok(commitPrompt.includes("tests unitaires"));
  assert.ok(commitPrompt.includes("- tools/a.py"));

  const msg = gitMgr.extractCommitMessage({
    tagName: "CODE",
    textContent: "=== COMMIT_MESSAGE ===\nfeat(ui): modularisation en classes"
  });
  assert.equal(msg, "feat(ui): modularisation en classes");
  assert.equal(typeof gitMgr.createPushButton, "function");

  const rawPushErr = "To https://example.com\n ! [rejected] HEAD -> main (non-fast-forward)\nfatal: failed to push";
  assert.equal(gitMgr.extractPushErrorSummary(rawPushErr), "! [rejected] HEAD -> main (non-fast-forward)");
});
test("popup.js verrouille les champs et masque commande en cours et tests dans la popup", () => {
  const popupHtml = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf-8");
  const popupCode = fs.readFileSync(path.join(EXTENSION_DIR, "popup.js"), "utf-8");
  assert.equal(popupHtml.includes("activeCommand"), false);
  assert.equal(popupHtml.includes("runTestsBtn"), false);
  assert.equal(popupCode.includes("activeCommand"), false);
  assert.equal(popupCode.includes("runTestsBtn"), false);

  const endIdx = popupCode.indexOf('document.addEventListener("DOMContentLoaded"');
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "",
        disabled: false,
        title: "",
        textContent: "",
        className: "",
        style: {},
        classList: { remove() {}, add() {} }
      });
    }
    return elements.get(id);
  };
  const sandbox = {
    document: { getElementById: getEl },
    chrome: {
      runtime: { id: "test-ext-id" },
      storage: { local: { get: (_k, cb) => cb({}) } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(popupCode.slice(0, endIdx), sandbox);

  const inputIds = ["rootDirInput", "targetDirInput", "testRunnerInput", "extraArgsInput"];
  sandbox.renderState({ running: true, targetDir: "C:\\git\\tools", pid: 1234 });
  for (const id of inputIds) {
    assert.equal(getEl(id).disabled, true, `${id} doit être verrouillé quand running=true`);
  }
  assert.equal(getEl("configLockNotice").style.display, "block");

  sandbox.renderState({ running: false });
  for (const id of inputIds) {
    assert.equal(getEl(id).disabled, false, `${id} doit être déverrouillé quand running=false`);
  }
  assert.equal(getEl("configLockNotice").style.display, "none");
});

test("background.js purge le jeton périmé après un 401 suivi d'un 200 OK", async () => {
  const bgCode = fs.readFileSync(path.join(EXTENSION_DIR, "background.js"), "utf-8");
  const startIdx = bgCode.indexOf("async function fetchWithTokenFallback(");
  const endIdx = bgCode.indexOf("async function checkWatchClipboardStatus(");

  let removedKey = null;
  let calls = 0;
  const sandbox = {
    chrome: { storage: { local: { remove: async (k) => { removedKey = k; } } } },
    fetch: async (_url, opts) => {
      calls += 1;
      if (calls === 1 && opts.headers["X-Watcher-Token"]) return { status: 401, ok: false };
      return { status: 200, ok: true };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(bgCode.slice(startIdx, endIdx), sandbox);

  const resp = await sandbox.fetchWithTokenFallback("http://localhost:18765/status", {}, "stale-token");
  assert.equal(resp.ok, true);
  assert.equal(removedKey, "watcherApiToken");
});
