import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

function fixture() {
  const store = new SitestryStore();
  store.project = {
    project_id: "t",
    project_name: "T",
    metadata: { scale_px_per_meter: 30, image_width_px: 1000, image_height_px: 800, roi_px: { x: 0, y: 0, width: 1000, height: 800 } },
    nodes: [],
    walls: [],
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

const RECT = [[0, 0], [200, 0], [200, 100], [0, 100]];

test("addRoomPolygon creates a named room, selects it and is one undo step", () => {
  const store = fixture();
  const events = [];
  store.addEventListener("geometryChanged", (e) => events.push(e.detail.source));
  const room = store.addRoomPolygon(RECT);
  assert.ok(room);
  assert.equal(store.project.rooms.length, 1);
  assert.equal(room.name, "Ruangan 1");
  assert.deepEqual(room.polygon_px, RECT);
  assert.deepEqual(store.ui.selected, { kind: "room", id: room.id });
  assert.equal(store.undoStack.length, 1);
  assert.deepEqual(events, ["addRoom"]);
  store.undo();
  assert.equal(store.project.rooms.length, 0);
});

test("addRoomPolygon rejects fewer than 3 points, a bow tie and a tiny polygon without history", () => {
  const store = fixture();
  assert.equal(store.addRoomPolygon([[0, 0], [100, 0]]), null);
  assert.equal(store.addRoomPolygon([[0, 0], [100, 100], [100, 0], [0, 100]]), null);
  assert.equal(store.addRoomPolygon([[0, 0], [10, 0], [10, 10], [0, 10]]), null);
  assert.equal(store.project.rooms.length, 0);
  assert.equal(store.undoStack.length, 0);
});

test("addRoomPolygon rounds points to 0.1 and accepts an explicit name", () => {
  const store = fixture();
  const room = store.addRoomPolygon([[0.04, 0], [200.26, 0], [200, 100.01], [0, 100]], { name: "Server" });
  assert.equal(room.name, "Server");
  assert.deepEqual(room.polygon_px[0], [0, 0]);
  assert.deepEqual(room.polygon_px[1], [200.3, 0]);
});

test("default names increment", () => {
  const store = fixture();
  assert.equal(store.addRoomPolygon(RECT).name, "Ruangan 1");
  assert.equal(store.addRoomPolygon(RECT.map(([x, y]) => [x + 300, y])).name, "Ruangan 2");
});

test("setRoomVertex rounds to 0.1 and moves one vertex only", () => {
  const store = fixture();
  const room = store.addRoomPolygon(RECT);
  assert.equal(store.setRoomVertex(room.id, 2, 210.26, 90.04), true);
  assert.deepEqual(room.polygon_px, [[0, 0], [200, 0], [210.3, 90], [0, 100]]);
  assert.equal(store.setRoomVertex(room.id, 9, 1, 1), false);
  assert.equal(store.setRoomVertex("missing", 0, 1, 1), false);
  assert.equal(store.setRoomVertex(room.id, 0, Number.NaN, 1), false);
});

test("setRoomVertex inside a transaction produces one undo step", () => {
  const store = fixture();
  const room = store.addRoomPolygon(RECT);
  store.undoStack = [];
  const token = store.beginTransaction("room-vertex-drag");
  store.setRoomVertex(room.id, 1, 205, 0);
  store.setRoomVertex(room.id, 1, 220, 5);
  assert.equal(store.commitTransaction(token), true);
  assert.equal(store.undoStack.length, 1);
  store.undo();
  assert.deepEqual(store.project.rooms[0].polygon_px[1], [200, 0]);
});
