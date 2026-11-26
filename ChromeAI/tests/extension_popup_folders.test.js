// Lancer avec : node --test tools/ChromeAI/tests/extension_popup_folders.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("WatcherPopupController pilote le dossier cible uniquement via targetDirSelect", () => {
  const domById = {};
  const makeEl = (tag, id = "") => {
    const el = {
      tagName: tag, id, value: "", textContent: "", title: "", disabled: false, selected: false,
      style: {}, options: [], listeners: {},
      appendChild(opt) { this.options.push(opt); if (opt.selected) this.value = opt.value; },
      addEventListener(ev, fn) { this.listeners[ev] = fn; }
    };
    Object.defineProperty(el, "innerHTML", { get: () => "", set() { el.options = []; } });
    if (id) domById[id] = el;
    return el;
  };

  for (const [id, tag] of [
    ["rootDirInput", "INPUT"], ["targetDirSelect", "SELECT"], ["reloadFoldersBtn", "BUTTON"],
    ["testRunnerInput", "INPUT"], ["extraArgsInput", "INPUT"],
    ["previewCommand", "CODE"], ["footerRootDir", "SPAN"], ["installCommandText", "CODE"],
    ["installHelpBox", "DIV"], ["errorBox", "DIV"],
    ["configLockNotice", "DIV"], ["startBtn", "BUTTON"], ["stopBtn", "BUTTON"], ["refreshBtn", "BUTTON"]
  ]) makeEl(tag, id);

  let listReply = { ok: true, folders: ["AppA", "tools"] };
  const savedStorage = {};
  const sandbox = {
    window: { addEventListener() {} },
    document: { getElementById: (id) => domById[id] || null, createElement: (tag) => makeEl(tag), addEventListener() {} },
    chrome: {
      runtime: {
        id: "ext-123",
        sendMessage(msg, cb) {
          if (msg.type === "LIST_WORKSPACE_FOLDERS") cb(listReply);
          else if (msg.type === "REFRESH_STATUS") cb({ running: false, checkedAt: "12:00:00" });
        }
      },
      storage: {
        local: {
          get: (_keys, cb) => cb({ savedRootDir: "C:\\git", savedTargetDir: "Tools", watchClipboardState: { running: false } }),
          set: (obj) => Object.assign(savedStorage, obj)
        }
      }
    },
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "popup_view.js"), "utf-8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, "popup.js"), "utf-8"), sandbox);

  const popup = new sandbox.window.GmcPopupController();
  popup.init();

  assert.deepEqual(domById.targetDirSelect.options.map((o) => o.value), ["", ".", "AppA", "tools"]);
  assert.equal(domById.targetDirSelect.value, "tools");
  assert.ok(domById.previewCommand.textContent.endsWith("tools"));

  domById.targetDirSelect.value = "AppA";
  domById.targetDirSelect.listeners.change();
  assert.equal(savedStorage.savedTargetDir, "AppA");
  assert.ok(domById.previewCommand.textContent.endsWith("AppA"));

  listReply = { ok: false, folders: [], error: "Action inconnue : list_folders", missingHost: true };
  popup.loadWorkspaceFolders();
  assert.equal(domById.errorBox.style.display, "block");
  assert.equal(domById.installHelpBox.style.display, "block");
});
