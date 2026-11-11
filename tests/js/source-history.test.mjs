import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

function layout(nodeX = 175.6, nodeY = 323.9) {
  return {
    project_id: "source-history",
    project_name: "Source History",
    metadata: {
      page_number: 4,
      scale_px_per_meter: 30.68,
      image_width_px: 1584,
      image_height_px: 1224,
      roi_px: { x: 63.4, y: 49.0, width: 1172.2, height: 1101.6 },
    },
    nodes: [
      { id: "n1", x_px: nodeX, y_px: nodeY },
      { id: "n2", x_px: 400.0, y_px: nodeY },
    ],
    walls: [{ id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.2, height_m: 3.8 }],
    columns: [],
    openings: [],
    rooms: [],
    stairs: [],
    equipments: [],
    cable_trays: [],
  };
}

function loadedStore() {
  const store = new SitestryStore();
  store.setSource({
    kind: "sample",
    sampleId: "gatsu_p4",
    metaOverrides: { page_number: 4, image_width_px: 1584, image_height_px: 1224 },
  });
  store.loadProjectData(layout());
  const token = store.beginTransaction("vertex-drag");
  store.moveNode("n1", 230.6, 358.9, false);
  store.commitTransaction(token);
  assert.equal(store.undoStack.length, 1);
  return store;
}

function assertSameSourceHistorySurvives(store, invalidate) {
  invalidate(store);
  store.loadProjectData(layout(500.0, 500.0));

  // Re-extracting the same source pushes the current project, not a history reset.
  assert.equal(store.undoStack.length, 2);
  assert.equal(store.getNodeById("n1").x_px, 500.0);

  assert.equal(store.undo(), true);
  assert.equal(store.getNodeById("n1").x_px, 230.6);
  assert.equal(store.getNodeById("n1").y_px, 358.9);

  assert.equal(store.undo(), true);
  assert.equal(store.getNodeById("n1").x_px, 175.6);
  assert.equal(store.getNodeById("n1").y_px, 323.9);

  assert.equal(store.redo(), true);
  assert.equal(store.getNodeById("n1").x_px, 230.6);
  assert.equal(store.getNodeById("n1").y_px, 358.9);
}

test("roi_change_and_guide_invalidation_preserve_same_source_history", () => {
  const store = loadedStore();
  assertSameSourceHistorySurvives(store, (s) => {
    s.setRoi({ x: 80, y: 60, width: 900, height: 800 });
    s.clearGuideCandidates();
  });
});

test("guided_to_manual_switches_preserve_same_source_history", () => {
  const store = loadedStore();
  assertSameSourceHistorySurvives(store, (s) => {
    s.setGuideCandidates([{ id: "g_1" }], "ready");
    s.clearGuideCandidates();
  });
});

test("guide_clear_does_not_discard_loaded_source_identity", () => {
  const store = loadedStore();
  const revision = store.currentSource.revision;
  store.clearGuideCandidates();
  store.loadProjectData(layout(300.0, 300.0));
  assert.equal(store.currentSource.revision, revision);
  assert.equal(store.undoStack.length, 2);
});
