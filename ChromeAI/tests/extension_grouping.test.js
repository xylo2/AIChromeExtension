// Lancer avec : node --test tools/ChromeAI/tests/extension_grouping.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("CodeBlockManager regroupe les blocs d'un tour malgré des data-turn-id individuels et masque la 2e carte", async () => {
  let copiedText = "";
  const droppedFiles = [];
  const sentPrompts = [];

  const collectBy = (node, pred) => {
    const out = [];
    for (const c of node.children || []) {
      if (pred(c)) out.push(c);
      out.push(...collectBy(c, pred));
    }
    return out;
  };
  const syncSiblings = (parent) => {
    parent.children.forEach((c, idx) => { c.nextSibling = parent.children.at(idx + 1) || null; });
  };

  const makeEl = (tag) => ({
    tagName: tag, className: "", textContent: "", title: "", type: "", innerHTML: "",
    disabled: false, style: {}, attrs: {}, dataset: {}, children: [], listeners: {},
    parentNode: null, parentElement: null, nextSibling: null, isConnected: true,
    get firstChild() { return this.children.at(0) || null; },
    get previousSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return i > 0 ? this.parentNode.children.at(i - 1) : null; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); syncSiblings(this); return c; },
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
    matches(sel) { return (sel.includes("model-response") && this.tagName === "MODEL-RESPONSE") || (sel.includes("data-turn-id") && Boolean(this.attrs["data-turn-id"])); },
    contains(target) { return target === this || this.children.some((c) => c === target || c.contains?.(target)); },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === "pre") return collectBy(this, (n) => n.tagName === "PRE");
      if (sel.includes("model-response")) return collectBy(this, (n) => n.tagName === "MODEL-RESPONSE");
      if (sel.includes("user-query")) return collectBy(this, (n) => n.tagName === "USER-QUERY");
      if (sel === "span, div" || sel === "div, p, span") return collectBy(this, (n) => (!n.children || n.children.length === 0) && ["SPAN", "DIV", "P"].includes(n.tagName));
      return [];
    },
    append(...items) { items.forEach((it) => this.appendChild(it)); },
    appendChild(it) {
      if (it.parentNode && it.parentNode !== this) { it.parentNode.children = it.parentNode.children.filter((x) => x !== it); syncSiblings(it.parentNode); }
      it.parentNode = this; it.parentElement = this; this.children.push(it); syncSiblings(this); return it;
    },
    insertBefore(it, ref) {
      if (it.parentNode) { it.parentNode.children = it.parentNode.children.filter((x) => x !== it); syncSiblings(it.parentNode); }
      it.parentNode = this; it.parentElement = this;
      const idx = this.children.indexOf(ref);
      if (idx >= 0) this.children.splice(idx, 0, it);
      else this.children.push(it);
      syncSiblings(this); return it;
    },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter((x) => x !== p); syncSiblings(p); } this.parentNode = null; this.parentElement = null; }
  });
  const turnEl = makeEl("MODEL-RESPONSE");
  const headerBar = makeEl("DIV");
  const wrap1 = makeEl("DIV");
  const langSpan = makeEl("SPAN"); langSpan.textContent = "code";
  const spacer = makeEl("DIV");
  headerBar.append(langSpan, spacer);
  const pre1 = makeEl("PRE"); pre1.textContent = "=== FILE: tools/ChromeAI/a.py ===\ndef a(): return 1\n";
  const footerCaution = makeEl("DIV"); footerCaution.textContent = "Utilisez le code avec précaution.";
  wrap1.append(headerBar, pre1, footerCaution);
  const outerSecCard = makeEl("DIV"); outerSecCard.setAttribute("data-turn-id", "sub-block-2");
  const wrap2 = makeEl("DIV");
  const pre2 = makeEl("PRE"); pre2.textContent = "=== FILE: tools/ChromeAI/b.css ===\nbody { margin: 0; }\n";
  wrap2.appendChild(pre2);
  outerSecCard.appendChild(wrap2);
  turnEl.append(wrap1, outerSecCard);

  const sandbox = {
    window: {}, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    document: { body: makeEl("BODY"), addEventListener() {}, createElement: makeEl, querySelectorAll: (sel) => (sel === "pre" ? [pre1, pre2] : []) },
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
  assert.equal(outerSecCard.classList.contains("gmc-grouped-secondary-block"), true);
  assert.equal(headerBar.classList.contains("gmc-code-header-compact"), true);
  assert.equal(langSpan.textContent, "python et css");
  assert.equal(footerCaution.classList.contains("gmc-hidden-native-footer"), true);
  const batchIdx = headerBar.children.indexOf(lead.batchBtn);
  const verifyIdx = headerBar.children.indexOf(lead.verifyBtn);
  assert.equal(batchIdx, 1);
  assert.equal(verifyIdx, 2);
  assert.equal(lead.headerPurgeBtn, null);
  assert.equal(lead.groupListEl.children.length, 2);

  sec.toggleBtn.listeners.click();
  assert.equal(pre2.parentNode, wrap1);
  sec.toggleBtn.listeners.click();
  assert.equal(pre2.parentNode, wrap2);

  await mgr.verifyWithAi(lead);
  assert.equal(droppedFiles.at(0).name, "verification_tour.txt");
  assert.ok(droppedFiles.at(0).content.includes("--- tools/ChromeAI/a.py ---"));
  assert.ok(droppedFiles.at(0).content.includes("--- tools/ChromeAI/b.css ---"));
  assert.ok(sentPrompts.at(0).txt.includes("l'ensemble des 2 blocs représentés dans cette carte"));

  await mgr.copyAndPurge(lead);
  assert.ok(copiedText.includes("def a(): return 1"));
  assert.ok(copiedText.includes("body { margin: 0; }"));
  assert.equal(mgr.getUnpurgedCount(), 0);
});
test("BlockVerificationHelper détecte un conteneur générique multi-blocs", async () => {
  const timers = []; const sentPrompts = [];
  const collectByTag = (node, tags) => {
    const out = [];
    for (const c of node.children || []) {
      if (tags.includes(c.tagName)) out.push(c);
      out.push(...collectByTag(c, tags));
    }
    return out;
  };
  const makeEl = (tag) => ({
    tagName: tag, nodeType: 1, className: "", textContent: "", title: "", type: "",
    innerHTML: "", disabled: false, style: {}, attrs: {}, dataset: {},
    children: [], listeners: {}, parentNode: null, parentElement: null,
    nextSibling: null, isConnected: true,
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
