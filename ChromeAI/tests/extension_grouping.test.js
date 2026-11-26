// Lancer avec : node --test tools/ChromeAI/tests/extension_grouping.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("CodeBlockManager regroupe les blocs d'un tour en lignes individuelles avec langages combinés et vérification unitaire", async () => {
  let copiedText = "";
  const droppedFiles = [];
  const sentPrompts = [];

  const collectPres = (node) => {
    const out = [];
    for (const c of node.children || []) {
      if (c.tagName === "PRE") out.push(c);
      out.push(...collectPres(c));
    }
    return out;
  };
  const collectLeaves = (node) => {
    const out = [];
    for (const c of node.children || []) {
      if (!c.children || c.children.length === 0) out.push(c);
      out.push(...collectLeaves(c));
    }
    return out;
  };

  const makeEl = (tag) => ({
    tagName: tag, className: "", textContent: "", title: "", type: "", innerHTML: "",
    disabled: false, style: {}, attrs: {}, dataset: {}, children: [], listeners: {},
    parentNode: null, parentElement: null, nextSibling: null, isConnected: true,
    classList: {
      set: new Set(),
      add(...cs) { cs.forEach((c) => this.set.add(c)); },
      remove(...cs) { cs.forEach((c) => this.set.delete(c)); },
      toggle(c, f) { if (f === undefined) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); return this.set.has(c); } f ? this.set.add(c) : this.set.delete(c); return f; },
      contains(c) { return this.set.has(c); }
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] || null; },
    removeAttribute(k) { delete this.attrs[k]; },
    matches(sel) { return sel.includes("model-response") && this.tagName === "MODEL-RESPONSE"; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === "pre") return collectPres(this);
      if (sel === "span, div") return collectLeaves(this).filter((n) => n.tagName === "SPAN" || n.tagName === "DIV");
      return [];
    },
    append(...items) { items.forEach((it) => this.appendChild(it)); },
    appendChild(it) { it.parentNode = this; it.parentElement = this; this.children.push(it); return it; },
    insertBefore(it, ref) {
      it.parentNode = this; it.parentElement = this;
      const idx = this.children.indexOf(ref);
      if (idx >= 0) this.children.splice(idx, 0, it);
      else this.children.push(it);
      return it;
    },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    remove() {}
  });

  const turnEl = makeEl("MODEL-RESPONSE");
  const wrap1 = makeEl("DIV");
  const langSpan = makeEl("SPAN"); langSpan.textContent = "javascript";
  const pre1 = makeEl("PRE"); pre1.textContent = "=== FILE: tools/ChromeAI/a.js ===\nconst a = 1;\n";
  wrap1.append(langSpan, pre1);
  const wrap2 = makeEl("DIV");
  const pre2 = makeEl("PRE"); pre2.textContent = "=== FILE: tools/ChromeAI/b.css ===\nbody { margin: 0; }\n";
  wrap2.appendChild(pre2);
  turnEl.append(wrap1, wrap2);

  const sandbox = {
    window: {},
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    document: {
      body: makeEl("BODY"), addEventListener() {}, createElement: makeEl,
      querySelectorAll: (sel) => (sel === "pre" ? [pre1, pre2] : [])
    },
    setTimeout: () => {}, clearTimeout: () => {}
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const fakeChat = {
    dropFile: (name, content) => droppedFiles.push({ name, content }),
    insertPrompt: (txt, auto) => { sentPrompts.push({ txt, auto }); return true; }
  };
  const mgr = new sandbox.window.GmcCodeBlockManager(new sandbox.window.GmcSpillDetector(), fakeChat);
  mgr.scan(false);

  const lead = mgr.trackedBlocks.at(0);
  const sec = mgr.trackedBlocks.at(1);
  assert.equal(lead.groupItems.length, 2);
  assert.equal(sec.isSecondaryInGroup, true);
  assert.equal(sec.placeholderEl.style.display, "none");
  assert.equal(langSpan.textContent, "javascript et css");
  assert.equal(lead.batchRow.style.display, "none");
  assert.equal(lead.groupListEl.children.length, 2);
  assert.ok(lead.groupListEl.children.at(0).children.at(0).textContent.includes("[JS] tools/ChromeAI/a.js"));
  assert.ok(lead.groupListEl.children.at(1).children.at(0).textContent.includes("[CSS] tools/ChromeAI/b.css"));

  sec.toggleBtn.listeners.click();
  assert.equal(wrap2.classList.contains("gmc-grouped-secondary-block"), false);
  sec.toggleBtn.listeners.click();
  assert.equal(wrap2.classList.contains("gmc-grouped-secondary-block"), true);

  await mgr.verifyWithAi(sec);
  assert.equal(droppedFiles.at(0).name, "b.css.txt");
  assert.ok(droppedFiles.at(0).content.includes("body { margin: 0; }"));

  await mgr.copyAndPurge(lead);
  assert.ok(copiedText.includes("const a = 1;"));
  assert.ok(copiedText.includes("body { margin: 0; }"));
  assert.equal(mgr.getUnpurgedCount(), 0);
});

test("BlockVerificationHelper détecte un conteneur générique multi-blocs et déclenche auto-Suite même sur blocs > 75 lignes", async () => {
  const timers = [];
  const sentPrompts = [];
  const collectByTag = (node, tags) => {
    const out = [];
    for (const c of node.children || []) {
      if (tags.includes(c.tagName)) out.push(c);
      out.push(...collectByTag(c, tags));
    }
    return out;
  };
  const makeEl = (tag) => ({
    tagName: tag, nodeType: 1, className: "", textContent: "", title: "", type: "", innerHTML: "",
    disabled: false, style: {}, attrs: {}, dataset: {}, children: [], listeners: {},
    parentNode: null, parentElement: null, nextSibling: null, isConnected: true,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); return f; }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; }, removeAttribute(k) { delete this.attrs[k]; },
    matches: () => false, closest: () => null, querySelector: () => null,
    querySelectorAll(sel) { return sel === "pre" ? collectByTag(this, ["PRE"]) : (sel.includes("p") ? collectByTag(this, ["P", "DIV", "SPAN"]) : []); },
    append(...items) { items.forEach((it) => this.appendChild(it)); },
    appendChild(it) { it.parentNode = this; it.parentElement = this; const prev = this.children.at(-1); if (prev) prev.nextSibling = it; this.children.push(it); return it; },
    insertBefore(it, ref) { it.parentNode = this; it.parentElement = this; const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, it); else this.children.push(it); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() {}
  });

  const genericTurnDiv = makeEl("DIV");
  const longCode = Array.from({ length: 85 }, (_, i) => `const line_${i} = ${i};`).join("\n");
  const preA = makeEl("PRE"); preA.textContent = `=== FILE_PART: tools/a.js | 1/2 ===\n${longCode}\n`;
  const preB = makeEl("PRE"); preB.textContent = `=== FILE_PART: tools/b.js | 1/2 ===\nconst b = 2;\n`;
  const hintP = makeEl("P"); hintP.textContent = "Réponds « Suite » pour la suite.";
  genericTurnDiv.append(preA, preB, hintP);

  const sandbox = {
    window: {}, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async () => {} } },
    document: { body: makeEl("BODY"), addEventListener() {}, createElement: makeEl, querySelectorAll: (sel) => (sel === "pre" ? [preA, preB] : []) },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const fakeChat = { insertPrompt: (txt, auto) => { sentPrompts.push({ txt, auto }); return true; } };
  const mgr = new sandbox.window.GmcCodeBlockManager(new sandbox.window.GmcSpillDetector(), fakeChat);
  mgr.scan(false);
  assert.equal(mgr.trackedBlocks.at(0).groupItems.length, 2);
  await mgr.copyAndPurge(mgr.trackedBlocks.at(0));
  assert.equal(timers.length, 1);
  timers.at(0)();
  assert.deepEqual(sentPrompts, [{ txt: "Suite", auto: true }]);
});
