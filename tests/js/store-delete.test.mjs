import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

function fixture() {
  const store = new SitestryStore();
  store.project = {
    project_id: "t",
    project_name: "T",
    metadata: { scale_px_per_meter: 30, image_width_px: 1000, image_height_px: 800, roi_px: { x: 0, y: 0, width: 1000, height: 800 } },
    nodes: [
      { id: "n1", x_px: 0, y_px: 0 },
      { id: "n2", x_px: 100, y_px: 0 },
      { id: "n3", x_px: 100, y_px: 100 },
      { id: "n4", x_px: 300, y_px: 0 },
      { id: "n5", x_px: 400, y_px: 0 },
      { id: "n9", x_px: 700, y_px: 700 }, // pre-existing orphan, not ours to touch
    ],
    walls: [
      { id: "w1", start_node: "n1", end_node: "n2" },
      { id: "w2", start_node: "n2", end_node: "n3" },
      { id: "w3", start_node: "n4", end_node: "n5" },
    ],
    columns: [],
    openings: [{ id: "o1", wall_id: "w1", type: "single_door", offset_ratio: 0.5 }],
    rooms: [],
    stairs: [],
    equipments: [],
    cable_trays: [],
  };
  store.undoStack = [];
  store.redoStack = [];
  return store;
}

const ids = (list) => list.map((item) => item.id).sort();

test("deleting a wall removes end nodes that nothing else uses", () => {
  const store = fixture();
  store.selectObject("wall", "w3");
  assert.equal(store.deleteSelected(), true);
  assert.deepEqual(ids(store.project.walls), ["w1", "w2"]);
  assert.deepEqual(ids(store.project.nodes), ["n1", "n2", "n3", "n9"]);
});

test("deleting a wall keeps a node shared with another wall", () => {
  const store = fixture();
  store.selectObject("wall", "w1");
  store.deleteSelected();
  assert.deepEqual(ids(store.project.nodes), ["n2", "n3", "n4", "n5", "n9"]);
});

test("deleting a node removes its walls and the far nodes that became unused", () => {
  const store = fixture();
  store.selectObject("node", "n2");
  store.deleteSelected();
  assert.deepEqual(ids(store.project.walls), ["w3"]);
  assert.deepEqual(ids(store.project.nodes), ["n4", "n5", "n9"]);
});

test("unrelated pre-existing orphan nodes are left alone", () => {
  const store = fixture();
  store.selectObject("wall", "w3");
  store.deleteSelected();
  assert.ok(store.project.nodes.some((n) => n.id === "n9"));
});

test("hosted openings are removed with the wall", () => {
  const store = fixture();
  store.selectObject("wall", "w1");
  store.deleteSelected();
  assert.equal(store.project.openings.length, 0);
});

test("delete is one undo step and undo restores walls, nodes and openings", () => {
  const store = fixture();
  const before = JSON.stringify(store.project);
  store.selectObject("node", "n2");
  store.deleteSelected();
  assert.equal(store.undoStack.length, 1);
  store.undo();
  assert.equal(JSON.stringify(store.project), before);
});
