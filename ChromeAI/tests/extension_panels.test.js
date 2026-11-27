// Lancer avec : node --test tools/ChromeAI/tests/extension_panels.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("TestOutputPanelManager streame, déplace, arrête, copie, envoie et ferme le panneau", () => {
  const appended = []; let copiedText = ""; let sentPayload = null; let stopCalls = 0; let sendCalls = 0;
  const docListeners = {};
  const makeDomNode = (tag) => ({
    tagName: tag, className: "", textContent: "", title: "", type: "", disabled: false, style: {}, scrollTop: 0, scrollHeight: 150, children: [], listeners: {}, removed: false,
    getBoundingClientRect: () => ({ left: 600, top: 200, width: 580, height: 240 }),
    append(...items) { this.children.push(...items); }, addEventListener(ev, fn) { this.listeners[ev] = fn; }, remove() { this.removed = true; }
  });
  const sandbox = {
    window: { innerWidth: 1280, innerHeight: 800 }, navigator: { clipboard: { writeText: async (t) => { copiedText = t; } } },
    document: {
      createElement: makeDomNode, body: { appendChild(n) { appended.push(n); } },
      addEventListener(ev, fn) { docListeners[ev] = fn; },
      removeEventListener(ev, fn) { if (docListeners[ev] === fn) delete docListeners[ev]; }
    }, setTimeout: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "test_panel.js"), "utf-8"), sandbox);
  const mgr = new sandbox.window.GmcTestOutputPanelManager(
    { insertTestResults(txt, auto) { sentPayload = { txt, auto }; } },
    () => { stopCalls += 1; },
    () => { sendCalls += 1; }
  );
  mgr.open("⏳ Exécution...", "", true);
  mgr.headerEl.listeners.mousedown({ button: 0, clientX: 650, clientY: 220, preventDefault() {} });
  docListeners.mousemove({ clientX: 450, clientY: 120 });
  docListeners.mouseup();
  assert.equal(mgr.panelEl.style.left, "400px");
  assert.equal(mgr.panelEl.style.top, "100px");
  assert.equal(mgr.savedPosition.left, 400);
  assert.equal(mgr.savedPosition.top, 100);

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

  mgr.open("Nouveau rapport", "OK", false);
  assert.equal(mgr.panelEl.style.left, "400px");
  assert.equal(mgr.panelEl.style.top, "100px");
});
test("ChatInjector.insertPrompt utilise focus({ preventScroll: true }) sans scrollTo", () => {
  const scrollHistory = [];
  let focusOpts = null;
  const fakeTextarea = {
    tagName: "TEXTAREA", value: "", selectionStart: 0, selectionEnd: 0, isConnected: true, disabled: false, readOnly: false,
    getBoundingClientRect: () => ({ width: 300, height: 40, top: 600 }),
    closest: () => null,
    focus(opts) { focusOpts = opts; },
    dispatchEvent() {}
  };
  const sandbox = {
    window: { innerHeight: 800, scrollX: 12, scrollY: 350, scrollTo(x, y) { scrollHistory.push({ x, y }); } },
    document: { querySelectorAll: () => [fakeTextarea], body: { appendChild() {} } },
    Event: class FakeEvent { constructor(t) { this.type = t; } },
    setTimeout: () => {}, clearTimeout: () => {}
  };
  vm.createContext(sandbox);
  for (const mod of ["file_attacher.js", "chat_injector.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const injector = new sandbox.window.GmcChatInjector();
  injector.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  sandbox.window.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  assert.equal(injector.insertPrompt("Bonjour", false), true);
  assert.equal(focusOpts?.preventScroll, true);
  assert.equal(scrollHistory.length, 0);
});

test("SvgPreviewManager préserve les animations SVG/CSS tout en bloquant scripts et onclick", () => {
  const appended = []; const downloaded = [];
  const makeNode = (tag) => ({
    tagName: tag, nodeName: tag, className: "", textContent: "", src: "", alt: "", href: "", download: "", isConnected: true, style: {}, attrs: {}, children: [], listeners: {}, parentNode: null, parentElement: null, nextSibling: null,
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelector(sel) { return sel === ".gmc-svg-standalone-dl" ? this.children.find((c) => String(c.className || "").includes("gmc-svg-standalone-dl")) || null : null; },
    querySelectorAll(sel) { return sel === "button" ? this.children.filter((c) => c.tagName === "BUTTON") : []; },
    appendChild(item) { item.parentNode = this; item.parentElement = this; this.children.push(item); return item; },
    insertBefore(item, ref) { item.parentNode = this; item.parentElement = this; const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, item); else this.children.push(item); return item; },
    append(...items) { items.forEach((it) => this.appendChild(it)); }, addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) this.listeners.click({ stopPropagation() {} }); else downloaded.push({ href: this.href, download: this.download }); }, remove() {},
    getBoundingClientRect() { return { width: 200, height: 180 }; }
  });
  const parsedSvgMock = makeNode("svg");
  const wrapperNode = makeNode("DIV"); const copyBtn = makeNode("BUTTON"); copyBtn.textContent = "Copier";
  const preNode = makeNode("PRE");
  preNode.textContent = '<svg viewBox="0 0 540 280"><style>@keyframes k{0%{opacity:0}100%{opacity:1}}@import "https://evil.invalid";</style><script>alert(1)</script><animateTransform/><circle onclick="x()" cx="5" cy="5" r="4"/></svg>';
  wrapperNode.append(copyBtn, preNode);
  const sandbox = {
    window: { innerWidth: 1200, innerHeight: 800 }, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    DOMParser: class FakeParser { parseFromString() { return { documentElement: parsedSvgMock, querySelector: () => null }; } },
    Blob: class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } },
    URL: { createObjectURL: () => "blob:mock-svg", revokeObjectURL: () => {} }, setTimeout: () => {},
    document: { createElement: makeNode, importNode: (n) => n, body: { appendChild(n) { appended.push(n); } }, querySelectorAll: () => [preNode] }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "svg_sanitizer.js", "svg_preview.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const preview = new sandbox.window.GmcSvgPreviewManager(new sandbox.window.GmcSpillDetector());
  const sanitized = preview.extractSvgMarkup(preNode.textContent);
  assert.ok(sanitized.includes("<animateTransform/>"));
  assert.ok(sanitized.includes("@keyframes k"));
  assert.equal(sanitized.includes("<script>"), false);
  assert.equal(sanitized.includes("onclick="), false);
  assert.equal(sanitized.includes("@import"), false);
  preview.scanStandaloneBlocks();
  wrapperNode.querySelector(".gmc-svg-standalone-dl").click();
  assert.equal(downloaded.at(0).download, "image.svg");
  preNode.listeners.mouseenter({ clientX: 100, clientY: 120 });
  assert.equal(preview.tooltipEl.style.display, "flex");
  assert.equal(parsedSvgMock.getAttribute("width"), "240");
});
test("CodeBlockManager garde un bouton Copier le reste après copie partielle d'un tour", async () => {
  const scrolled = []; let removedKey = null; let savedJson = ""; let badgeTxt = ""; let calls = 0; const clickedLinks = []; let copiedBatch = "";
  const makeEl = (tag) => ({
    tagName: tag, type: "", className: "", title: "", textContent: "", innerHTML: "", href: "", download: "",
    isConnected: true, attrs: {}, dataset: {}, style: {}, children: [], listeners: {}, parentNode: null, parentElement: null,
    get firstChild() { return this.children.at(0) || null; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    classList: { set: new Set(), add(...cs) { cs.forEach((c) => this.set.add(c)); }, remove(...cs) { cs.forEach((c) => this.set.delete(c)); }, toggle(c, f) { f ? this.set.add(c) : this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelector() { return null; }, querySelectorAll: () => [],
    append(...items) { items.forEach((it) => { it.parentNode = this; it.parentElement = this; this.children.push(it); }); },
    appendChild(it) { it.parentNode = this; it.parentElement = this; this.children.push(it); return it; },
    insertBefore(it) { it.parentNode = this; it.parentElement = this; this.children.push(it); return it; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, click() { clickedLinks.push(this.download); }, remove() {}
  });
  const sandbox = {
    window: { scrollBy(x, y) { scrolled.push({ x, y }); } }, globalThis: {}, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Blob: class FakeBlob { constructor(parts) { this.parts = parts; } }, URL: { createObjectURL: () => "blob:test-svg", revokeObjectURL: () => {} },
    document: { createElement: makeEl, body: makeEl("BODY") }, setTimeout: () => {},
    navigator: { clipboard: { writeText: async (t) => { copiedBatch = t; } } },
    chrome: {
      action: { setBadgeText: ({ text }) => { badgeTxt = text; }, setBadgeBackgroundColor() {} },
      tabs: { query: async () => [] },
      storage: { local: { remove: async (k) => { removedKey = k; }, set: async (o) => { savedJson = JSON.stringify(o); } } }
    },
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
  const pre1 = makeEl("PRE"); pre1.textContent = "=== FILE: a.py ===\nx = 1";
  const pre2 = makeEl("PRE"); pre2.textContent = "=== FILE: b.py ===\ny = 2";
  const item1 = blockMgr.controlsUi.buildTrackedBlockItem(pre1, "a.py", false, blockMgr);
  const item2 = blockMgr.controlsUi.buildTrackedBlockItem(pre2, "b.py", false, blockMgr);
  item1.groupItems = [item1, item2]; item2.isSecondaryInGroup = true; item2.groupLeadRef = item1;
  blockMgr.trackedBlocks.push(item1, item2);
  blockMgr.purgeDomOnly(item1, "Copié et purgé");
  blockMgr.syncItem(item1);
  assert.equal(item1.batchBtn.style.display, "inline-flex");
  assert.ok(item1.batchBtn.textContent.includes("Copier le reste"));
  assert.equal(await blockMgr.copyAndPurgeFrom(item1), 1);
  assert.equal(copiedBatch, "=== FILE: b.py ===\ny = 2");
  assert.equal(scrolled.length, 0);
  const bgSvc = new sandbox.globalThis.GmcBackgroundService();
  await bgSvc.resetColdStartState();
  assert.equal(badgeTxt, "OFF");
  assert.ok(savedJson.includes('"running":false'));
  bgSvc.nativeHelper.fetchSessionToken = async () => "fresh-tok";
  assert.equal((await bgSvc.fetchWithTokenFallback("http://localhost:18765/status", {}, "stale-tok")).ok, true);
  assert.equal(savedJson, JSON.stringify({ watcherApiToken: "fresh-tok" }));
  bgSvc.nativeHelper.fetchSessionToken = async () => null;
  assert.equal((await bgSvc.fetchWithTokenFallback("http://localhost:18765/status", {}, "old-tok")).ok, true);
  assert.equal(removedKey, "watcherApiToken");
});
