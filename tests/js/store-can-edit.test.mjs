import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

const STRUCTURAL = ["node", "wall", "opening", "column", "stair", "room"];
const INSTALL = ["equipment", "tray"];

function atStep(step) {
  const store = new SitestryStore();
  store.ui.step = step;
  return store;
}

test("step 3 edits structural kinds only", () => {
  const store = atStep(3);
  for (const k of STRUCTURAL) assert.equal(store.canEdit(k), true, k);
  for (const k of INSTALL) assert.equal(store.canEdit(k), false, k);
});

test("step 5 edits equipment and tray only", () => {
  const store = atStep(5);
  for (const k of INSTALL) assert.equal(store.canEdit(k), true, k);
  for (const k of STRUCTURAL) assert.equal(store.canEdit(k), false, k);
});

test("steps 1, 2 and 4 edit nothing", () => {
  for (const step of [1, 2, 4]) {
    const store = atStep(step);
    for (const k of [...STRUCTURAL, ...INSTALL]) assert.equal(store.canEdit(k), false, `${step}:${k}`);
  }
});

test("unknown or missing kind is not editable", () => {
  const store = atStep(3);
  assert.equal(store.canEdit("bogus"), false);
  assert.equal(store.canEdit(undefined), false);
});
