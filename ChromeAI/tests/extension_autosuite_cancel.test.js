// Lancer avec : node --test tools/ChromeAI/tests/extension_autosuite_cancel.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("CodeBlockManager affiche la bannière flottante au-dessus du compositeur et annule sur saisie", () => {
  const docListeners = {};
  const scheduled = [];
  const cleared = [];
  const bodyChildren = [];
  let insertedPrompts = [];
  let draftText = "";

  const makeEl = (tag) => ({
    tagName: tag, className: "", textContent: "", type: "", style: {}, children: [], listeners: {},
    append(...items) { this.children.push(...items); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    remove() { const i = bodyChildren.indexOf(this); if (i >= 0) bodyChildren.splice(i, 1); }
  });

  const composerEl = { getBoundingClientRect: () => ({ top: 680, left: 200, width: 600, height: 80 }) };
  const inputEl = { tagName: "TEXTAREA", parentElement: composerEl };

  const sandbox = {
    window: { innerWidth: 1200, innerHeight: 800 },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    document: {
      body: { appendChild(el) { bodyChildren.push(el); } },
      createElement: makeEl,
      addEventListener(ev, fn) { docListeners[ev] = fn; },
      querySelectorAll: () => []
    },
    setTimeout(fn) { const id = scheduled.length + 1; scheduled.push({ id, fn }); return id; },
    clearTimeout(id) { cleared.push(id); },
    setInterval: () => 1,
    clearInterval() {}
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "block_verifier.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }

  const spill = new sandbox.window.GmcSpillDetector();
  const fakeChat = {
    findChatInputElement: () => inputEl,
    findComposerContainer: () => composerEl,
    getInputText: () => draftText,
    insertPrompt(txt, auto) { insertedPrompts.push({ txt, auto }); return true; }
  };
  const mgr = new sandbox.window.GmcCodeBlockManager(spill, fakeChat);
  mgr.hasSuitePromptAfterBlock = () => true;

  // 1. Si le compositeur contient déjà du texte, maybeAutoSendSuite ne démarre pas
  draftText = "Attends, j'ai une question";
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 1 } }), false);
  assert.equal(scheduled.length, 0);

  // 2. La bannière est montée en flottant dans document.body juste au-dessus du compositeur
  draftText = "";
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 2 } }), true);
  assert.equal(bodyChildren.length, 1);
  assert.equal(bodyChildren.at(0).style.bottom, "128px");
  assert.equal(bodyChildren.at(0).style.left, "500px");

  // 3. Une frappe clavier annule le minuteur et retire la bannière flottante
  docListeners.keydown({ type: "keydown", isTrusted: true, ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(mgr.pendingSuiteTimer, null);
  assert.equal(bodyChildren.length, 0);
  assert.ok(cleared.includes(1));

  // 4. Si le champ reste vide et aucune frappe n'intervient, « Suite » est envoyé normalement
  assert.equal(mgr.maybeAutoSendSuite({ el: { id: 3 } }), true);
  scheduled.at(-1).fn();
  assert.deepEqual(insertedPrompts, [{ txt: "Suite", auto: true }]);
});
