// Lancer avec : node --test tools/ChromeAI/tests/extension_panels.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("TestOutputPanelManager streame, arrête, copie, envoie à l'IA et ferme le panneau", () => {
  const appended = []; let copiedText = ""; let sentPayload = null; let stopCalls = 0; let sendCalls = 0;
  const makeDomNode = (tag) => ({
    tagName: tag, className: "", textContent: "", title: "", type: "", disabled: false, style: {}, scrollTop: 0, scrollHeight: 150, children: [], listeners: {}, removed: false,
    append(...items) { this.children.push(...items); }, addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() { this.removed = true; }
  });
  const sandbox = {
    window: {}, navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    document: { createElement: makeDomNode, body: { appendChild(n) { appended.push(n); } } }, setTimeout: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "test_panel.js"), "utf-8"), sandbox);
  const mgr = new sandbox.window.GmcTestOutputPanelManager(
    { insertTestResults(txt, auto) { sentPayload = { txt, auto }; } },
    () => { stopCalls += 1; },
    () => { sendCalls += 1; }
  );
  mgr.open("⏳ Exécution...", "", true);
  assert.equal(mgr.stopBtnEl.style.display, "inline-flex");
  mgr.stopBtnEl.listeners.click();
  assert.equal(stopCalls, 1);
  mgr.appendChunk("[watch_clipboard] OK (44 tests)\n");
  mgr.finish(true, "[watch_clipboard] OK (44 tests)\n\nCOUVERTURE GLOBALE : 98.5%");
  assert.equal(mgr.stopBtnEl.style.display, "none");
  const actions = appended.at(0).children.at(2);
  actions.children.at(1).listeners.click();
  assert.ok(copiedText.includes("COUVERTURE GLOBALE : 98.5%"));
  actions.children.at(2).listeners.click();
  assert.equal(sentPayload.auto, true);
  assert.equal(sendCalls, 1);
  assert.equal(mgr.panelEl, null);
});

test("TestActionsController.preserveWindowScroll et ChatInjector.insertPrompt figent le scroll", () => {
  const rafCallbacks = [];
  const scrollHistory = [];
  const makeBtn = () => ({ classList: { remove() {}, add() {}, toggle() {} }, style: {}, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; } });
  const fakeTextarea = {
    tagName: "TEXTAREA", value: "", selectionStart: 0, selectionEnd: 0, isConnected: true, disabled: false, readOnly: false,
    getBoundingClientRect: () => ({ width: 300, height: 40, top: 600 }),
    closest: () => null,
    focus() { sandbox.window.scrollY = 999; },
    dispatchEvent() {}
  };
  const sandbox = {
    window: {
      innerHeight: 800, scrollX: 12, scrollY: 350,
      scrollTo(x, y) { this.scrollX = x; this.scrollY = y; scrollHistory.push({ x, y }); },
      requestAnimationFrame(cb) { rafCallbacks.push(cb); }
    },
    document: { querySelectorAll: () => [fakeTextarea], createElement: makeBtn, body: { appendChild() {} } },
    Event: class FakeEvent { constructor(t) { this.type = t; } },
    setTimeout: () => {}, clearTimeout: () => {}
  };
  vm.createContext(sandbox);
  for (const mod of ["file_attacher.js", "chat_injector.js", "test_panel.js", "test_actions.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const injector = new sandbox.window.GmcChatInjector();
  injector.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  sandbox.window.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  assert.equal(injector.insertPrompt("Bonjour", false), true);
  assert.equal(sandbox.window.scrollY, 350);

  const ctrl = new sandbox.window.GmcTestActionsController(injector, () => {}, () => {}, { testsBtn: makeBtn(), coverageBtn: makeBtn() }, () => ({}), () => {});
  ctrl.preserveWindowScroll(() => { sandbox.window.scrollY = 1200; });
  assert.equal(sandbox.window.scrollY, 350);
  sandbox.window.scrollY = 1200;
  rafCallbacks.forEach((cb) => cb());
  assert.equal(sandbox.window.scrollY, 350);
  assert.ok(scrollHistory.length >= 2);
});
test("SvgPreviewManager normalise xmlns, télécharge le SVG et ajoute le bouton sur <pre> autonome", () => {
  const appended = []; const downloaded = [];
  const makeNode = (tag) => ({
    tagName: tag, className: "", textContent: "", src: "", alt: "", href: "", download: "", isConnected: true, style: {}, attrs: {}, children: [], listeners: {}, parentNode: null, parentElement: null, nextSibling: null,
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; },
    querySelector(sel) { return sel === ".gmc-svg-standalone-dl" ? this.children.find((c) => String(c.className || "").includes("gmc-svg-standalone-dl")) || null : null; },
    querySelectorAll(sel) { return sel === "button" ? this.children.filter((c) => c.tagName === "BUTTON") : []; },
    appendChild(item) { item.parentNode = this; item.parentElement = this; this.children.push(item); return item; },
    insertBefore(item, ref) { item.parentNode = this; item.parentElement = this; const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, item); else this.children.push(item); return item; },
    append(...items) { items.forEach((it) => this.appendChild(it)); }, addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) this.listeners.click({ stopPropagation() {} }); else downloaded.push({ href: this.href, download: this.download }); }, remove() {},
    getBoundingClientRect() { return { width: 200, height: 180 }; }
  });
  const wrapperNode = makeNode("DIV"); const copyBtn = makeNode("BUTTON"); copyBtn.textContent = "Copier";
  const preNode = makeNode("PRE");
  preNode.textContent = '<svg viewBox="0 0 10 10" xmlns="http://w3.org"><script>alert(1)</script><circle onclick="x()" cx="5" cy="5" r="4"/></svg>';
  wrapperNode.append(copyBtn, preNode);
  const sandbox = {
    window: { innerWidth: 1200, innerHeight: 800 }, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Blob: class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } },
    URL: { createObjectURL: () => "blob:mock-svg", revokeObjectURL: () => {} }, setTimeout: () => {},
    document: { createElement: makeNode, body: { appendChild(n) { appended.push(n); } }, querySelectorAll: () => [preNode] }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "spill_heuristics.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "spill_detector.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "svg_sanitizer.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "svg_preview.js"), "utf-8"), sandbox);
  const preview = new sandbox.window.GmcSvgPreviewManager(new sandbox.window.GmcSpillDetector());
  preview.scanStandaloneBlocks();
  wrapperNode.querySelector(".gmc-svg-standalone-dl").click();
  assert.equal(downloaded.at(0).download, "image.svg");
  preNode.listeners.mouseenter({ clientX: 100, clientY: 120 });
  assert.equal(preview.tooltipEl.style.display, "flex");
});

test("CodeBlockManager (copyAndPurgeAll) et WatcherBackgroundService (resyncApiToken 401)", async () => {
  const scrolled = []; let removedKey = null; let savedObj = null; let calls = 0; const clickedLinks = []; let copiedBatch = "";
  const makeEl = (tag) => ({
    tagName: tag, type: "", className: "", title: "", innerHTML: "", href: "", download: "", style: {}, listeners: {},
    classList: { add() {}, remove() {} }, addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { clickedLinks.push(this.download); }, remove() {}
  });
  const sandbox = {
    window: { scrollBy(x, y) { scrolled.push({ x, y }); } }, globalThis: {}, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Blob: class FakeBlob { constructor(parts) { this.parts = parts; } }, URL: { createObjectURL: () => "blob:test-svg", revokeObjectURL: () => {} },
    document: { createElement: makeEl, body: { appendChild() {} } }, setTimeout: () => {},
    navigator: { clipboard: { writeText: async (t) => { copiedBatch = t; } } },
    chrome: { storage: { local: { remove: async (k) => { removedKey = k; }, set: async (o) => { savedObj = o; } } } },
    fetch: async (_u, opts) => {
      calls += 1;
      if (calls === 1 && opts.headers["X-Watcher-Token"] === "stale-tok") return { status: 401, ok: false };
      if (calls === 2 && opts.headers["X-Watcher-Token"] === "fresh-tok") return { status: 200, ok: true };
      return opts.headers["X-Watcher-Token"] ? { status: 401, ok: false } : { status: 200, ok: true };
    }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "file_attacher.js", "chat_injector.js", "git_commit_ui.js", "git_panel.js", "svg_sanitizer.js", "svg_preview.js", "block_verifier.js", "block_controls_ui.js", "block_manager.js", "bg_native_helper.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const spill = new sandbox.window.GmcSpillDetector();
  const blockMgr = new sandbox.window.GmcCodeBlockManager(spill, { insertPrompt() {} }, null, new sandbox.window.GmcSvgPreviewManager(spill));
  const dlBtn = blockMgr.createDownloadBtn({ el: { tagName: "PRE", textContent: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', getAttribute: () => null, querySelector: () => null }, headerName: "dragon.svg" });
  dlBtn.listeners.click({ stopPropagation() {} });
  assert.deepEqual(clickedLinks, ["dragon.svg"]);
  const makePre = (txt) => ({ tagName: "PRE", textContent: txt, isConnected: true, attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, classList: { add() {} } });
  blockMgr.trackedBlocks.push({ el: makePre("=== FILE: a.py ===\nx = 1"), headerName: "a.py", spilledNodes: [], purgeButtons: [] });
  assert.equal(await blockMgr.copyAndPurgeAll(), 1);
  assert.equal(copiedBatch, "=== FILE: a.py ===\nx = 1");
  const bgSvc = new sandbox.globalThis.GmcBackgroundService();
  bgSvc.nativeHelper.fetchSessionToken = async () => "fresh-tok";
  assert.equal((await bgSvc.fetchWithTokenFallback("http://localhost:18765/status", {}, "stale-tok")).ok, true);
  assert.deepEqual(savedObj, { watcherApiToken: "fresh-tok" });
  bgSvc.nativeHelper.fetchSessionToken = async () => null;
  assert.equal((await bgSvc.fetchWithTokenFallback("http://localhost:18765/status", {}, "old-tok")).ok, true);
  assert.equal(removedKey, "watcherApiToken");
});
