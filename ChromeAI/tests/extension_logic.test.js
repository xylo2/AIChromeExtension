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

test("chaque module est concis (<= 175 lignes) et sans triple backtick littéral", () => {
  for (const mod of JS_MODULES) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8");
    const lines = code.split("\n").length;
    assert.ok(lines <= 175, `${mod} dépasse 175 lignes (${lines})`);
    assert.equal(code.includes("\x60\x60\x60"), false, `Triple backtick littéral dans ${mod}`);
  }
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.ok(contentJs.indexOf("let floatingBar") < contentJs.indexOf("const makeBtn"));
  assert.ok(contentJs.includes('insertPrompt("Oui", true)'));
  assert.ok(contentJs.includes('insertPrompt("Suite", true)'));
  assert.ok(contentJs.includes("pickDevExcuse()"));
  assert.ok(contentJs.includes("takeLunchBreak()"));
});

test("BreakGuard gère déjeuner (12h-14h), mouvement (30m), hydratation (2h) et coucher (0h-6h)", () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "break_guard.js"), "utf-8"), sandbox);

  let fakeNow = 1_000_000;
  let fakeHour = 12;
  const guard = new sandbox.window.GmcBreakGuard({
    nowFn: () => fakeNow,
    dateFn: () => ({ getHours: () => fakeHour, getFullYear: () => 2026, getMonth: () => 10, getDate: () => 24 })
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

  fakeHour = 2;
  assert.equal(guard.getStatus().type, "night");
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
  const prompt = gitMgr.buildCommitPrompt(["tools/a.py", "tools/b.js"], "git_changes.diff.txt");
  assert.ok(prompt.includes("=== COMMIT_MESSAGE ==="));
  assert.ok(prompt.includes("Vérification du diff"));
  assert.ok(prompt.includes("apport **fonctionnel**"));
  assert.ok(prompt.includes("tests unitaires"));
  assert.ok(prompt.includes("- tools/a.py"));

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
