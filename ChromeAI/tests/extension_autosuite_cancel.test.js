// Lancer avec : node --test tools/ChromeAI/tests/extension_autosuite_cancel.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("CodeBlockManager annule l'auto-Suite si l'utilisateur tape ou si le champ est non vide", () => {
  const docListeners = {};
  const scheduled = [];
  const cleared = [];
  let insertedPrompts = [];
  let draftText = "";

  const sandbox = {
    window: {},
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    document: {
      addEventListener(ev, fn) { docListeners[ev] = fn; },
      querySelectorAll: () => []
    },
    setTimeout(fn) { const id = scheduled.length + 1; scheduled.push({ id, fn }); return id; },
    clearTimeout(id) { cleared.push(id); }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "block_verifier.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }

  const spill = new sandbox.window.GmcSpillDetector();
  const fakeChat = {
    findChatInputElement: () => ({ tagName: "TEXTAREA" }),
    getInputText: () => draftText,
    insertPrompt(txt, auto) { insertedPrompts.push({ txt, auto }); return true; }
  };
  const mgr = new sandbox.window.GmcCodeBlockManager(spill, fakeChat);
  mgr.hasSuitePromptAfterBlock = () => true;

  // 1. Si le compositeur contient déjà du texte, maybeAutoSendSuite ne démarre pas
  draftText = "Attends, j'ai une question";
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 1 } }), false);
  assert.equal(scheduled.length, 0);

  // 2. Si le compositeur est vide, le minuteur démarre puis est annulé dès une frappe clavier
  draftText = "";
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 2 } }), true);
  assert.equal(scheduled.length, 1);
  assert.ok(mgr.pendingSuiteTimer !== null);

  docListeners.keydown({ type: "keydown", isTrusted: true, ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(mgr.pendingSuiteTimer, null);
  assert.ok(cleared.includes(1));

  // 3. Si l'utilisateur tape pendant le délai avant l'exécution du callback, l'envoi est bloqué
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 3 } }), true);
  draftText = "Ma remarque en cours";
  scheduled.at(-1).fn();
  assert.equal(insertedPrompts.length, 0);

  // 4. Si le champ reste vide et aucune frappe n'intervient, « Suite » est envoyé normalement
  draftText = "";
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 4 } }), true);
  scheduled.at(-1).fn();
  assert.deepEqual(insertedPrompts, [{ txt: "Suite", auto: true }]);
});
