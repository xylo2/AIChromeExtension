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
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.ok(contentJs.indexOf("let floatingBar") < contentJs.indexOf("const makeBtn"));
  assert.ok(contentJs.includes('insertPrompt("Oui", true)'));
  assert.ok(contentJs.includes('insertPrompt("Suite", true)'));
  assert.ok(contentJs.includes("pickDevExcuse()"));
  assert.ok(contentJs.includes("gmc-global-coverage-btn"));
  assert.ok(contentJs.includes("parseCoveragePercent"));
  assert.ok(contentJs.includes("res.uncovered"));
  assert.equal(contentJs.includes("GmcBreakGuard"), false);
  assert.ok(contentJs.includes("gmc-composer-below"));
  assert.ok(contentJs.includes("isBottomConversationComposer"));
});

test("mountQuickButtonsNearPlus garde les boutons stables si le compositeur n'est pas en bas", () => {
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  const start = contentJs.indexOf("const isAiConversationPage = () => {");
  const end = contentJs.indexOf("const setBtnState =");
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
  wireParent(floatingBar, [gitBtn]);
  const sandbox = {
    window: { innerHeight: 800, location: { href: "https://www.google.com", pathname: "/search" } },
    document: {
      querySelector: () => ({}),
      querySelectorAll: () => [staleDuplicateGroup, quickReplyGroup]
    },
    chatInjector: { findChatInputElement: () => inputEl },
    quickReplyGroup,
    floatingBar,
    gitBtn
  };
  vm.createContext(sandbox);

  inputEl.rectTop = 220;
  vm.runInContext(`${fnCode}\nmountQuickButtonsNearPlus();`, sandbox);
  assert.equal(staleDuplicateGroup.removed, true);
  assert.equal(quickReplyGroup.parentElement, floatingBar);

  inputEl.rectTop = 650;
  vm.runInContext("mountQuickButtonsNearPlus();", sandbox);
  assert.equal(quickReplyGroup.parentElement, outerWrapper);
  assert.equal(quickReplyGroup.classList.contains("gmc-composer-below"), true);
});
test("SpillDetector, CodeBlockManager et GitPanelManager fonctionnent en isolation", () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const mod of ["spill_detector.js", "chat_injector.js", "git_panel.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }

  const spill = new sandbox.window.GmcSpillDetector();
  assert.equal(spill.looksLikeSpilledCode("const x = 42;"), true);
  assert.equal(spill.looksLikeSpilledCode("Voici une phrase explicative normale."), false);

  const blockMgr = new sandbox.window.GmcCodeBlockManager(spill, null);
  assert.equal(blockMgr.buildFallbackAttachmentName("tools/ChromeAI/content.js | 2/4"), "content.js.part2.txt");
  assert.equal(blockMgr.buildFallbackAttachmentName("tools/ChromeAI/manifest.json"), "manifest.json.txt");
  assert.ok(blockMgr.formatLabel("a.py", 10, true).startsWith("🚨"));

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
