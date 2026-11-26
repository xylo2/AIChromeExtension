// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Utilisateur_A
// Lancer avec : node --test tools/ChromeAI/tests/extension_autosuite_cancel.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("CodeBlockManager active auto-Suite même avec débordement récupéré et annule sur saisie", async () => {
  const docListeners = {}, scheduled = [], cleared = [], bodyChildren = [], insertedPrompts = [];
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
    window: { innerWidth: 1200, innerHeight: 800 }, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => {} } },
    document: { body: { appendChild(el) { bodyChildren.push(el); } }, createElement: makeEl, addEventListener(ev, fn) { docListeners[ev] = fn; }, querySelectorAll: () => [] },
    setTimeout(fn) { const id = scheduled.length + 1; scheduled.push({ id, fn }); return id; },
    clearTimeout(id) { cleared.push(id); }, setInterval: () => 1, clearInterval() {}
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "block_verifier.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const spill = new sandbox.window.GmcSpillDetector();
  const fakeChat = {
    findChatInputElement: () => inputEl, findComposerContainer: () => composerEl,
    getInputText: () => draftText, insertPrompt(txt, auto) { insertedPrompts.push({ txt, auto }); return true; }
  };
  const mgr = new sandbox.window.GmcCodeBlockManager(spill, fakeChat);
  const turnNode = { querySelectorAll: () => [{ textContent: "Réponds Suite pour recevoir la suite." }] };
  const blockEl = { tagName: "PRE", textContent: "x = 1", isConnected: true, attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, classList: { add() {} }, closest: () => turnNode };
  assert.equal(mgr.hasSuitePromptAfterBlock({ el: blockEl }), true);

  draftText = "Attends, j'ai une question";
  assert.equal(mgr.maybeAutoSendSuite({ el: blockEl }), false);

  draftText = "";
  const spilledItem = { el: blockEl, headerName: "a.py", hasSpill: true, spilledNodes: [], purgeButtons: [] };
  mgr.trackedBlocks.push(spilledItem);
  await mgr.copyAndPurge(spilledItem);
  assert.equal(bodyChildren.length, 1);

  docListeners.keydown({ type: "keydown", isTrusted: true, ctrlKey: false, metaKey: false, altKey: false });
  assert.equal(mgr.pendingSuiteTimer, null);
  assert.equal(bodyChildren.length, 0);
  assert.ok(cleared.includes(1));

  mgr.autoSentSuiteForTurn = null;
  assert.equal(mgr.maybeAutoSendSuite({ el: blockEl }), true);
  scheduled.at(-1).fn();
  assert.deepEqual(insertedPrompts, [{ txt: "Suite", auto: true }]);
});
