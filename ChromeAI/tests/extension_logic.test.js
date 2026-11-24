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
  "break_guard.js",
  "content.js"
];

test("manifest.json déclare les permissions et les modules dans l'ordre", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf-8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts.at(0).js, JS_MODULES);
});

test("chaque module est concis (<= 215 lignes) et sans triple backtick littéral", () => {
  for (const mod of JS_MODULES) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8");
    const lines = code.split("\n").length;
    assert.ok(lines <= 215, `${mod} dépasse 215 lignes (${lines})`);
    assert.equal(code.includes("\x60\x60\x60"), false, `Triple backtick littéral dans ${mod}`);
  }
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.ok(contentJs.indexOf("let floatingBar") < contentJs.indexOf("const makeBtn"));
  assert.ok(contentJs.includes('insertPrompt("Oui", true)'));
  assert.ok(contentJs.includes('insertPrompt("Suite", true)'));
  assert.ok(contentJs.includes("pickDevExcuse()"));
  assert.ok(contentJs.includes("takeLunchBreak()"));
  assert.ok(contentJs.includes("gmc-composer-below"));
});

test("BreakGuard gère déjeuner (12h-14h), mouvement (30m), hydratation (2h) et coucher (10m/5m/2m jusqu'à 6h30)", () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "break_guard.js"), "utf-8"), sandbox);

  let fakeNow = 1_000_000;
  let fakeHour = 12;
  let fakeMinute = 0;
  const guard = new sandbox.window.GmcBreakGuard({
    nowFn: () => fakeNow,
    dateFn: () => ({
      getHours: () => fakeHour,
      getMinutes: () => fakeMinute,
      getFullYear: () => 2026,
      getMonth: () => 10,
      getDate: () => 24
    })
  });

  guard.recordActivity();
  assert.equal(guard.isLunchTime(), true);
  fakeNow += 30 * 60 * 1000;
  assert.equal(guard.getStatus().type, "lunch");

  guard.takeLunchBreak();
  assert.equal(guard.hasEatenToday(), true);
  assert.equal(guard.getStatus().shouldWarn, false);

  fakeHour = 15;
  fakeNow += 30 * 60 * 1000;
  guard.recordActivity();
  assert.equal(guard.getStatus().type, "move");

  fakeHour = 0;
  assert.equal(guard.getStatus().type, "night");
  guard.activeType = "night";
  guard.acknowledge();
  assert.equal(guard.snoozeUntil - fakeNow, 10 * 60 * 1000);

  fakeHour = 1;
  fakeNow += 11 * 60 * 1000;
  guard.recordActivity();
  assert.equal(guard.getStatus().type, "night");
  guard.activeType = "night";
  guard.acknowledge();
  assert.equal(guard.snoozeUntil - fakeNow, 5 * 60 * 1000);

  fakeHour = 2;
  fakeNow += 6 * 60 * 1000;
  guard.recordActivity();
  assert.equal(guard.getStatus().type, "night");
  guard.activeType = "night";
  guard.acknowledge();
  assert.equal(guard.snoozeUntil - fakeNow, 2 * 60 * 1000);

  fakeHour = 6;
  fakeMinute = 29;
  assert.equal(guard.isAfterMidnight(), true);

  fakeMinute = 30;
  assert.equal(guard.isAfterMidnight(), false);
  assert.equal(guard.getStatus().shouldWarn, false);
});
test("BreakGuard empile les alertes en décalé avec SVG dédiés et agrandit l'alerte nocturne", () => {
  const allNodes = [];
  const makeNode = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      className: "",
      textContent: "",
      innerHTML: "",
      dataset: {},
      style: {},
      children: [],
      isConnected: true,
      classList: {
        set: new Set(),
        add(c) { this.set.add(c); },
        contains(c) { return this.set.has(c); }
      },
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); },
      addEventListener() {},
      remove() { this.isConnected = false; }
    };
    allNodes.push(node);
    return node;
  };
  const body = makeNode("body");
  const findConnected = (pred) => allNodes.filter((n) => n.isConnected && pred(n));
  const sandbox = {
    window: {},
    document: {
      body,
      createElement: (tag) => makeNode(tag),
      querySelector: (sel) => {
        if (sel === ".gmc-break-stack") return findConnected((n) => n.className === "gmc-break-stack").at(0) || null;
        return findConnected((n) => n.className === "gmc-break-banner" && sel.includes(`"${n.dataset.gmcBreakType}"`)).at(0) || null;
      },
      querySelectorAll: (sel) => {
        return findConnected((n) => n.className === "gmc-break-banner" && (!sel.includes("=") || sel.includes(`"${n.dataset.gmcBreakType}"`)));
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "break_guard.js"), "utf-8"), sandbox);

  let fakeNow = 1_000_000;
  let fakeHour = 15;
  const guard = new sandbox.window.GmcBreakGuard({
    nowFn: () => fakeNow,
    dateFn: () => ({ getHours: () => fakeHour, getMinutes: () => 10, getFullYear: () => 2026, getMonth: () => 10, getDate: () => 24 })
  });
  guard.recordActivity();
  fakeNow += 120 * 60 * 1000;
  guard.tick();
  guard.tick();

  const stack = body.children.at(0);
  assert.equal(stack.className, "gmc-break-stack");
  assert.equal(stack.children.length, 2);
  assert.deepEqual(stack.children.map((b) => b.dataset.gmcBreakType), ["drink", "move"]);
  assert.ok(stack.children.at(0).children.at(0).children.at(0).innerHTML.includes("<svg"));

  guard.acknowledge("drink");
  assert.equal(findConnected((n) => n.className === "gmc-break-banner").length, 1);
  guard.acknowledge("move");
  assert.equal(findConnected((n) => n.className === "gmc-break-banner").length, 0);

  fakeHour = 1;
  for (let step = 1; step <= 6; step++) {
    guard.tick();
    const banner = findConnected((n) => n.className === "gmc-break-banner").at(-1);
    assert.equal(banner.children.at(1).children.length, 1);
    if (step === 6) {
      assert.equal(banner.style.minHeight, "100vh");
      assert.equal(banner.classList.contains("gmc-break-fullscreen"), true);
    }
    guard.acknowledge("night");
    fakeNow += 6 * 60 * 1000;
  }
});

test("mountQuickButtonsNearPlus place les boutons sous le compositeur étroit", () => {
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  const start = contentJs.indexOf("const mountQuickButtonsNearPlus = () => {");
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
    children: [],
    parentElement: null,
    nextElementSibling: null,
    nextSibling: null,
    isConnected: false,
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    },
    getAttribute() { return ""; },
    closest() { return null; },
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
  const floatingBar = makeEl("DIV");
  const gitBtn = makeEl("BUTTON");
  const sandbox = {
    chatInjector: { findChatInputElement: () => inputEl },
    quickReplyGroup,
    floatingBar,
    gitBtn
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fnCode}\nmountQuickButtonsNearPlus();`, sandbox);

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
