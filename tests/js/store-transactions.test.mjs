import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

function fixture() {
  const store = new SitestryStore();
  store.project = {
    project_id: "test",
    project_name: "Test Project",
    metadata: {
      scale_px_per_meter: 30.68,
      default_wall_height_m: 3.8,
      image_width_px: 1584,
      image_height_px: 1224,
      roi_px: { x: 0, y: 0, width: 1584, height: 1224 },
    },
    nodes: [
      { id: "n1", x_px: 175.6, y_px: 323.9 },
      { id: "n2", x_px: 400.0, y_px: 323.9 },
      { id: "n3", x_px: 400.0, y_px: 500.0 },
    ],
    walls: [
      { id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.2, height_m: 3.8, type: "solid" },
      { id: "w2", start_node: "n2", end_node: "n3", thickness_m: 0.2, height_m: 3.8, type: "solid" },
    ],
    columns: [],
    openings: [],
    rooms: [],
    stairs: [],
    equipments: [],
    cable_trays: [],
  };
  store.undoStack = [];
  store.redoStack = [];
  return store;
}

test("transaction_commit_has_one_undo", () => {
  const store = fixture();
  const token = store.beginTransaction("vertex-drag");
  store.moveNode("n1", 230.6, 358.9, false);
  const changed = store.commitTransaction(token);
  assert.equal(changed, true);
  assert.equal(store.undoStack.length, 1);
  assert.equal(store.getNodeById("n1").x_px, 230.6);
  assert.equal(store.undo(), true);
  const node = store.getNodeById("n1");
  assert.equal(node.x_px, 175.6);
  assert.equal(node.y_px, 323.9);
});

test("cancel_and_noop_preserve_redo", () => {
  const store = fixture();
  const first = store.beginTransaction("first");
  store.moveNode("n1", 200, 350, false);
  store.commitTransaction(first);
  store.undo();
  assert.equal(store.redoStack.length, 1);

  const cancelled = store.beginTransaction("second");
  store.moveNode("n1", 300, 400, false);
  assert.equal(store.cancelTransaction(cancelled), true);
  assert.equal(store.getNodeById("n1").x_px, 175.6);
  assert.equal(store.redoStack.length, 1);
  assert.equal(store.undoStack.length, 0);

  const noop = store.beginTransaction("noop");
  assert.equal(store.commitTransaction(noop), false);
  assert.equal(store.undoStack.length, 0);
  assert.equal(store.redoStack.length, 1);
});

test("stale_token_cannot_cancel_new_edit", () => {
  const store = fixture();
  const first = store.beginTransaction("first");
  store.cancelTransaction(first);
  const second = store.beginTransaction("second");
  store.moveNode("n1", 260, 360, false);
  assert.equal(store.cancelTransaction(first), false);
  assert.equal(store.getNodeById("n1").x_px, 260);
  assert.equal(store.commitTransaction(second), true);
});

test("nested_transaction_is_rejected", () => {
  const store = fixture();
  const first = store.beginTransaction("first");
  assert.equal(store.beginTransaction("nested"), null);
  store.cancelTransaction(first);
});

test("transaction_preview_does_not_commit_history", () => {
  const store = fixture();
  let previews = 0;
  let commits = 0;
  store.addEventListener("geometryPreviewChanged", () => { previews += 1; });
  store.addEventListener("geometryChanged", (event) => {
    if (event.detail?.source !== "undo" && event.detail?.source !== "redo") commits += 1;
  });

  const token = store.beginTransaction("drag");
  store.moveNode("n1", 210, 340, false);
  store.moveNode("n1", 220, 345, false);
  assert.equal(store.undoStack.length, 0);
  assert.equal(previews, 2);
  store.commitTransaction(token);
  assert.equal(commits, 1);
  assert.equal(store.undoStack.length, 1);
});

test("shared_node_updates_all_connected_walls", () => {
  const store = fixture();
  const token = store.beginTransaction("move-shared");
  store.moveNode("n2", 450, 300, false);
  const preview = store.project.walls.filter((w) => w.start_node === "n2" || w.end_node === "n2");
  assert.equal(preview.length, 2);
  for (const wall of preview) {
    const a = store.getNodeById(wall.start_node);
    const b = store.getNodeById(wall.end_node);
    assert.ok(a.x_px === 450 || b.x_px === 450);
  }
  store.commitTransaction(token);
  const n2 = store.getNodeById("n2");
  assert.deepEqual([n2.x_px, n2.y_px], [450, 300]);
});

test("first_and_repeated_vertex_drag_moves_real_node", () => {
  const store = fixture();
  const moves = [
    [230.6, 358.9],
    [242.1, 366.2],
  ];
  for (const [x, y] of moves) {
    const token = store.beginTransaction("vertex-drag");
    store.moveNode("n1", x, y, false);
    store.commitTransaction(token);
    const node = store.getNodeById("n1");
    assert.equal(node.x_px, x);
    assert.equal(node.y_px, y);
  }
  assert.equal(store.undoStack.length, 2);
  store.undo();
  const node = store.getNodeById("n1");
  assert.deepEqual([node.x_px, node.y_px], moves[0]);
});

test("node_numeric_edit_is_one_undo_and_rejects_nonfinite", () => {
  const store = fixture();
  assert.equal(store.setNodePosition("n1", 200, 330), true);
  assert.equal(store.undoStack.length, 1);
  const node = store.getNodeById("n1");
  assert.deepEqual([node.x_px, node.y_px], [200, 330]);
  assert.equal(store.setNodePosition("n1", Number.NaN, 0), false);
  assert.equal(store.undoStack.length, 1);
});

test("every_committed_geometry_event_carries_a_new_revision", () => {
  const store = fixture();
  const start = store.revision;
  let seen = [];
  store.addEventListener("geometryChanged", (event) => seen.push(event.detail.revision));
  store.emit("geometryChanged", { source: "inspector" });
  store.emit("geometryChanged", { source: "delete" });
  assert.deepEqual(seen, [start + 1, start + 2]);
  const token = store.beginTransaction("edit");
  store.moveNode("n1", 190, 330, false);
  store.commitTransaction(token);
  assert.equal(seen[2], start + 3);
});

test("history_is_capped_at_45_during_transactions", () => {
  const store = fixture();
  for (let i = 0; i < 60; i++) {
    const token = store.beginTransaction("edit");
    store.moveNode("n1", 175.6 + i, 323.9, false);
    store.commitTransaction(token);
  }
  assert.equal(store.undoStack.length, 45);
});
