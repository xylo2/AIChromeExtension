// Lancer avec : node --test tools/ChromeAI/tests/extension_orphans.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXTENSION_DIR = path.resolve(__dirname, "..");
const TESTS_DIR = __dirname;

test("aucun fichier .js ou .css orphelin dans ChromeAI", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf-8"));
  const popupHtml = fs.readFileSync(path.join(EXTENSION_DIR, "popup.html"), "utf-8");

  const referenced = new Set([
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    manifest.background?.service_worker,
    "popup.js",
  ].filter(Boolean));

  const corpusParts = [popupHtml];
  for (const dir of [EXTENSION_DIR, TESTS_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isFile() && /\.(js|html|json)$/.test(f)) {
        corpusParts.push(fs.readFileSync(full, "utf-8"));
      }
    }
  }
  const fullCorpus = corpusParts.join("\n");

  const orphans = [];
  for (const file of fs.readdirSync(EXTENSION_DIR)) {
    if (!/\.(js|css)$/.test(file)) continue;
    if (referenced.has(file)) continue;
    if (fullCorpus.split(file).length - 1 === 0) orphans.push(file);
  }

  assert.deepEqual(orphans, [], `Fichiers orphelins détectés dans ChromeAI : ${orphans.join(", ")}`);
});
