// Lancer avec : node --test tools/ChromeAI/tests/extension_composer_attacher.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("ComposerQuickButtonsManager masque les boutons avant le début de la conversation", () => {
  const wireParent = (parent, children) => {
    parent.children = children;
    children.forEach((c, idx) => { c.parentElement = parent; c.nextElementSibling = children.at(idx + 1) || null; c.nextSibling = children.at(idx + 1) || null; });
  };
  const makeEl = (tag) => ({
    tagName: tag, className: "", textContent: "", style: {}, children: [],
    parentElement: null, nextElementSibling: null, nextSibling: null, isConnected: false, removed: false, rectTop: 650,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    getBoundingClientRect() { return { top: this.rectTop, height: 40 }; },
    getAttribute() { return ""; }, closest() { return null; }, remove() { this.removed = true; this.parentElement = null; },
    querySelectorAll(sel) { return sel.includes("button") ? [plusBtn] : []; },
    contains(target) { return target === this || this.children.some((c) => c.contains && c.contains(target)); },
    insertBefore(node, ref) { node.parentElement = this; node.nextSibling = ref || null; node.isConnected = true; const idx = this.children.indexOf(ref); if (idx >= 0) this.children.splice(idx, 0, node); else this.children.push(node); }
  });
  const outerWrapper = makeEl("DIV"), composerBox = makeEl("DIV"), plusBtn = makeEl("BUTTON"), inputWrapper = makeEl("DIV"), inputEl = makeEl("DIV");
  plusBtn.textContent = "+";
  wireParent(inputWrapper, [inputEl]);
  wireParent(composerBox, [plusBtn, inputWrapper]);
  wireParent(outerWrapper, [composerBox]);
  const staleDuplicateGroup = makeEl("DIV"), bottomRow = makeEl("DIV"), gitBtn = makeEl("BUTTON");
  wireParent(bottomRow, [gitBtn]);
  const sandbox = {
    window: { innerHeight: 800, location: { href: "https://www.google.com", pathname: "/webhp" } },
    document: { createElement: (tag) => makeEl(tag), querySelector: () => null, querySelectorAll: () => [staleDuplicateGroup, mgr?.groupEl].filter(Boolean) }
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

test("ChatInjector et ChatFileAttacher gèrent puces, spinner et input file", () => {
  const sandbox = {
    window: {}, document: { querySelectorAll: () => [] },
    File: class FakeFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type || ""; } },
    DataTransfer: class FakeDT { constructor() { this.items = { add: (f) => { this.files = [f]; } }; this.files = []; } },
    Event: class FakeEvent { constructor(type, opts) { this.type = type; this.bubbles = Boolean(opts?.bubbles); } },
    DragEvent: class FakeDragEvent { constructor(type, opts) { this.type = type; this.dataTransfer = opts?.dataTransfer; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "file_attacher.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "chat_injector.js"), "utf-8"), sandbox);
  const injector = new sandbox.window.GmcChatInjector();
  let busyEl = null, chipNodes = [], chipCount = 0;
  const composerParent = { querySelector: (sel) => (sel.includes("progressbar") ? busyEl : null), querySelectorAll: () => [] };
  const composerBox = { parentElement: composerParent, querySelector: (sel) => (sel.includes("button") ? {} : null) };
  const inputEl = { parentElement: composerBox, isConnected: true, tagName: "DIV", textContent: "" };
  injector.queryDeepAll = (sel) => (sel === "*" ? chipNodes : (sel.includes("data-file-name") ? new Array(chipCount).fill({ className: "" }) : []));
  assert.equal(injector.isAttachmentReady(inputEl, ""), true);
  busyEl = { tagName: "DIV" };
  chipNodes = [{ className: "", getAttribute: (k) => (k === "aria-label" ? "git_changes.diff.txt" : "") }];
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), false);
  busyEl = null;
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), true);
  chipNodes = []; injector.baselineAttachmentCount = 1; chipCount = 1;
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), false);
  chipCount = 2;
  assert.equal(injector.isAttachmentReady(inputEl, "git_changes.diff.txt"), true);
  let changeDispatched = false;
  const fakeFileInput = { files: null, dispatchEvent: (ev) => { if (ev.type === "change") changeDispatched = true; } };
  injector.findChatInputElement = () => inputEl;
  injector.queryDeepAll = (sel) => (sel === 'input[type="file"]' ? [fakeFileInput] : []);
  assert.equal(injector.dropFile("git_changes.diff.txt", "diff --git a/x b/x", false), true);
  assert.equal(changeDispatched, true);
  assert.equal(injector.pendingAttachmentName, "git_changes.diff.txt");
});
