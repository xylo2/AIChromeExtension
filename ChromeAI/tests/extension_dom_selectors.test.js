// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Utilisateur_A

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

test("SpillDetector, BlockVerificationHelper et TokenBudgetManager reconnaissent [data-scope-id='turn'] et .aiModeUiCodeBlock__Container", () => {
  const makeNode = (tag, attrs = {}) => ({
    tagName: tag, attrs, textContent: "", parentElement: null, children: [],
    matches(sel) {
      return sel.includes('[data-scope-id="turn"]') && this.attrs["data-scope-id"] === "turn";
    },
    closest(sel) {
      if (sel.includes(".aiModeUiCodeBlock__Container") && this.attrs.cls?.includes("aiModeUiCodeBlock__Container")) {
        return this;
      }
      return this.parentElement ? this.parentElement.closest(sel) : null;
    },
    querySelectorAll(sel) {
      if (sel === "pre") return this.children.filter((c) => c.tagName === "PRE");
      return [];
    }
  });

  const turnEl = makeNode("DIV", { "data-scope-id": "turn" });
  turnEl.textContent = "a".repeat(800);
  const blockWrap = makeNode("DIV", { cls: "BpxUDf aiModeUiCodeBlock__Container" });
  const innerBox = makeNode("DIV");
  const preEl = makeNode("PRE");
  blockWrap.parentElement = turnEl;
  innerBox.parentElement = blockWrap;
  preEl.parentElement = innerBox;
  blockWrap.children = [preEl];

  const sandbox = {
    window: {},
    document: { querySelectorAll: (sel) => (sel.includes('[data-scope-id="turn"]') ? [turnEl] : []) }
  };
  vm.createContext(sandbox);
  for (const mod of ["spill_heuristics.js", "spill_detector.js", "block_verifier.js", "token_budget.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, mod), "utf-8"), sandbox);
  }

  const spill = new sandbox.window.GmcSpillDetector();
  assert.equal(spill.findCodeBlockWrapper(preEl), blockWrap);
  const verifier = new sandbox.window.GmcBlockVerificationHelper(null, spill);
  assert.equal(verifier.findTurnContainer(preEl), turnEl);
  const budget = new sandbox.window.GmcTokenBudgetManager();
  assert.equal(budget.getConversationTurnCount(), 1);
  assert.equal(budget.estimateConversationDomTokens(), 200);
});
