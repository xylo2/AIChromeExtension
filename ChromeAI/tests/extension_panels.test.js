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
  const contentJs = fs.readFileSync(path.join(EXTENSION_DIR, "content.js"), "utf-8");
  assert.ok(contentJs.includes("const resetTestsButton = () => setBtnState(testsBtn, null"));
  assert.ok(contentJs.includes("if (ok) resetTestsButton();"));
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
  const wrapperNode = makeNode("DIV");
  const copyBtn = makeNode("BUTTON");
  copyBtn.textContent = "Copier";
  const preNode = makeNode("PRE");
  preNode.textContent = '<svg viewBox="0 0 10 10" xmlns="http://w3.org"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(2)"><circle onclick="x()" cx="5" cy="5" r="4"/></a></svg>';
  wrapperNode.append(copyBtn, preNode);
  const sandbox = {
    window: { innerWidth: 1200, innerHeight: 800 }, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Blob: class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } },
    URL: { createObjectURL: () => "blob:mock-svg", revokeObjectURL: () => {} }, setTimeout: () => {},
    document: { createElement: makeNode, body: { appendChild(n) { appended.push(n); } }, querySelectorAll: () => [preNode] }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "spill_detector.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "svg_preview.js"), "utf-8"), sandbox);
  const preview = new sandbox.window.GmcSvgPreviewManager(new sandbox.window.GmcSpillDetector());
  const cleaned = preview.extractSvgMarkup(preNode.textContent);
  const expectedNs = ["http://www", "w3", "org/2000/svg"].join(".");
  assert.ok(cleaned.includes(`xmlns="${expectedNs}"`));
  assert.equal(cleaned.includes("<script"), false);
  preview.scanStandaloneBlocks();
  const standaloneBtn = wrapperNode.querySelector(".gmc-svg-standalone-dl");
  assert.ok(standaloneBtn);
  standaloneBtn.click();
  assert.equal(downloaded.at(0).download, "image.svg");
  preNode.listeners.mouseenter({ clientX: 100, clientY: 120 });
  assert.equal(preview.tooltipEl.style.display, "flex");
  assert.equal(appended.at(-1), preview.tooltipEl);
});
test("ChatInjector, CodeBlockManager (SVG, purge + scroll/Suite auto) et WatcherBackgroundService", async () => {
  const scrolled = [];
  let removedKey = null; let calls = 0; const clickedLinks = [];
  const makeEl = (tag) => ({
    tagName: tag, type: "", className: "", title: "", innerHTML: "", href: "", download: "", style: {}, listeners: {},
    classList: { add() {}, remove() {} },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { clickedLinks.push(this.download); },
    remove() {}
  });
  const sandbox = {
    window: { scrollBy(x, y) { scrolled.push({ x, y }); } },
    globalThis: {},
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Blob: class FakeBlob { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:test-svg", revokeObjectURL: () => {} },
    document: { createElement: makeEl, body: { appendChild() {} } },
    setTimeout: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: { storage: { local: { remove: async (k) => { removedKey = k; } } } },
    fetch: async (_u, opts) => (++calls === 1 && opts.headers["X-Watcher-Token"] ? { status: 401, ok: false } : { status: 200, ok: true })
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_detector.js", "chat_injector.js", "git_panel.js", "svg_preview.js", "block_manager.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }
  const spill = new sandbox.window.GmcSpillDetector();
  const sentPrompts = [];
  const fakeChat = { insertPrompt(txt, auto) { sentPrompts.push({ txt, auto }); } };
  const blockMgr = new sandbox.window.GmcCodeBlockManager(spill, fakeChat, null, new sandbox.window.GmcSvgPreviewManager(spill));
  assert.equal(blockMgr.MAX_SAFE_LINES, 95);

  const svgItem = {
    el: { tagName: "PRE", textContent: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', getAttribute: () => null, querySelector: () => null },
    headerName: "dragon.svg"
  };
  const dlBtn = blockMgr.createDownloadBtn(svgItem);
  dlBtn.listeners.click({ stopPropagation() {} });
  assert.deepEqual(clickedLinks, ["dragon.svg"]);

  let scrollTargetOpts = null;
  const firstItem = {
    el: { tagName: "PRE", textContent: "a = 1", isConnected: true, getAttribute: () => null, setAttribute() {}, querySelector: () => null, classList: { add() {} } },
    headerName: "first.py", spilledNodes: [], purgeButtons: []
  };
  const afterCommentNode = { nodeType: 1, tagName: "P", className: "", textContent: "Partie suivante attendue : fichier. Réponds « Suite ».", nextSibling: null };
  const nextPlaceholder = { scrollIntoView(opts) { scrollTargetOpts = opts; } };
  const nextItem = {
    el: { tagName: "PRE", textContent: "b = 2", isConnected: true, attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, classList: { add() {} }, nextSibling: afterCommentNode },
    placeholderEl: nextPlaceholder, spilledNodes: [], purgeButtons: []
  };
  blockMgr.trackedBlocks.push(firstItem, nextItem);
  await blockMgr.copyAndPurge(firstItem);
  assert.deepEqual({ ...scrollTargetOpts }, { behavior: "smooth", block: "center" });
  assert.equal(sentPrompts.length, 0);

  await blockMgr.copyAndPurge(nextItem);
  assert.deepEqual(sentPrompts.map((p) => ({ ...p })), [{ txt: "Suite", auto: true }]);

  let h = 420;
  const fakeWrapper = { getBoundingClientRect() { return { top: -150, height: h }; } };
  blockMgr.preserveScrollAround(fakeWrapper, () => { h = 36; });
  assert.equal(scrolled.at(0).x, 0);
  assert.equal(scrolled.at(0).y, -384);
  const injector = new sandbox.window.GmcChatInjector();
  let focusArg = null;
  const parentBox = { scrollTop: 140, parentElement: null };
  const fakeBox = { scrollTop: 95, parentElement: parentBox, focus(opts) { focusArg = opts; } };
  injector.focusWithoutScroll(fakeBox);
  injector.scrollComposerToTop(fakeBox);
  assert.equal(focusArg.preventScroll, true);
  assert.equal(fakeBox.scrollTop, 0);
  assert.equal(parentBox.scrollTop, 0);

  const gitMgr = new sandbox.window.GmcGitPanelManager(spill, injector);
  const shortVerify = gitMgr.buildVerifyPrompt(["a.py", "b.py"], "git_changes.diff.txt");
  assert.equal(shortVerify.split("\n").length, 2);
  assert.ok(shortVerify.includes("2 fichier(s)"));

  const bgSvc = new sandbox.globalThis.GmcBackgroundService();
  assert.equal((await bgSvc.fetchWithTokenFallback("http://localhost:18765/status", {}, "tok")).ok, true);
  assert.equal(removedKey, "watcherApiToken");
});
