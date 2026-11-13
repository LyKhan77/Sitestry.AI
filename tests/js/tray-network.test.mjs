import test from "node:test";
import assert from "node:assert/strict";
import { snapDrawPoint } from "../../frontend/js/trayNetwork.js";

test("an anchor within the radius wins", () => {
  const r = snapDrawPoint({ x: 103, y: 104 }, [[100, 100]], { radiusPx: 8 });
  assert.deepEqual(r, { x: 100, y: 100, snapped: "node" });
});

test("a point outside every anchor radius is returned unchanged", () => {
  const r = snapDrawPoint({ x: 150, y: 150 }, [[100, 100]], { radiusPx: 8 });
  assert.deepEqual(r, { x: 150, y: 150, snapped: null });
});

test("ortho snaps to the closer axis through the start point", () => {
  assert.deepEqual(snapDrawPoint({ x: 100, y: 4 }, [], { radiusPx: 8, from: [0, 0], ortho: true }), { x: 100, y: 0, snapped: "ortho" });
  assert.deepEqual(snapDrawPoint({ x: 5, y: 90 }, [], { radiusPx: 8, from: [0, 0], ortho: true }), { x: 0, y: 90, snapped: "ortho" });
});

test("ortho without a start point does nothing", () => {
  assert.deepEqual(snapDrawPoint({ x: 100, y: 4 }, [], { radiusPx: 8, ortho: true }), { x: 100, y: 4, snapped: null });
});

test("an anchor beats ortho when both apply", () => {
  const r = snapDrawPoint({ x: 99, y: 6 }, [[100, 8]], { radiusPx: 8, from: [0, 0], ortho: true });
  assert.deepEqual(r, { x: 100, y: 8, snapped: "node" });
});

import { TRAY_TYPES, defaultTrayElevation } from "../../frontend/js/trayNetwork.js";

test("tray types list the four supported types", () => {
  assert.deepEqual(TRAY_TYPES, ["perforated", "ladder", "duct", "wiremesh"]);
});

test("default elevation sits 0.45 m below the ceiling", () => {
  assert.equal(defaultTrayElevation({ metadata: { default_wall_height_m: 3.8 } }), 3.35);
  assert.equal(defaultTrayElevation({ metadata: { default_wall_height_m: 3.0 } }), 2.55);
});

import {
  migrateTrayNetwork,
  trayPoints,
  insertTrayRun,
  pruneTrayNodes,
  trayLengthM,
  nearestTrayAnchor,
} from "../../frontend/js/trayNetwork.js";

const emptyProject = () => ({ metadata: { scale_px_per_meter: 10 }, tray_nodes: [], cable_trays: [] });
const PROPS = { id: "t1", name: "T", type: "perforated", width_m: 0.5, height_m: 0.1, elevation_m: 3.35 };

test("migration turns points_px into shared nodes and is idempotent", () => {
  const project = {
    metadata: { scale_px_per_meter: 10 },
    cable_trays: [{ id: "t1", points_px: [[0, 0], [50, 0], [50, 50]] }],
  };
  migrateTrayNetwork(project);
  assert.equal(project.tray_nodes.length, 3);
  assert.equal(project.cable_trays[0].node_ids.length, 3);
  assert.equal("points_px" in project.cable_trays[0], false);
  assert.deepEqual(trayPoints(project, project.cable_trays[0]), [[0, 0], [50, 0], [50, 50]]);
  const snapshot = JSON.stringify(project);
  migrateTrayNetwork(project);
  assert.equal(JSON.stringify(project), snapshot);
});

test("migration merges points within 1 px across trays", () => {
  const project = {
    cable_trays: [
      { id: "a", points_px: [[0, 0], [50, 0]] },
      { id: "b", points_px: [[50.4, 0.3], [50, 40]] },
    ],
  };
  migrateTrayNetwork(project);
  assert.equal(project.tray_nodes.length, 3);
  assert.equal(project.cable_trays[0].node_ids[1], project.cable_trays[1].node_ids[0]);
});

test("a run ending on the middle of another tray splits that tray and shares the node", () => {
  const project = emptyProject();
  const a = insertTrayRun(project, [[0, 0], [100, 0]], { ...PROPS, id: "a" }, 2);
  const lengthBefore = trayLengthM(project, a, 10);
  const b = insertTrayRun(project, [[50, 60], [50, 1]], { ...PROPS, id: "b" }, 2);
  assert.equal(a.node_ids.length, 3);
  assert.equal(b.node_ids[1], a.node_ids[1]);
  assert.equal(trayLengthM(project, a, 10), lengthBefore);
  assert.deepEqual(trayPoints(project, b)[1], [50, 0]);
});

test("a run reuses an existing node within the snap radius", () => {
  const project = emptyProject();
  const a = insertTrayRun(project, [[0, 0], [100, 0]], { ...PROPS, id: "a" }, 2);
  const b = insertTrayRun(project, [[101, 1], [101, 80]], { ...PROPS, id: "b" }, 2);
  assert.equal(b.node_ids[0], a.node_ids[1]);
  assert.equal(project.tray_nodes.length, 3);
});

test("a run that collapses to one node is rejected", () => {
  const project = emptyProject();
  assert.equal(insertTrayRun(project, [[0, 0], [0.5, 0.5]], PROPS, 2), null);
  assert.equal(project.cable_trays.length, 0);
});

test("pruning keeps shared nodes and removes orphans", () => {
  const project = emptyProject();
  insertTrayRun(project, [[0, 0], [100, 0]], { ...PROPS, id: "a" }, 2);
  const b = insertTrayRun(project, [[100, 0], [100, 80]], { ...PROPS, id: "b" }, 2);
  project.cable_trays = project.cable_trays.filter((t) => t.id !== "b");
  pruneTrayNodes(project);
  assert.equal(project.tray_nodes.length, 2);
  assert.equal(project.tray_nodes.some((n) => n.id === b.node_ids[1]), false);
});

test("tray length is the polyline length in meters", () => {
  const project = emptyProject();
  const t = insertTrayRun(project, [[0, 0], [30, 0], [30, 40]], PROPS, 1);
  assert.equal(trayLengthM(project, t, 10), 7);
});

test("nearest anchor prefers a node and falls back to a segment point", () => {
  const project = emptyProject();
  insertTrayRun(project, [[0, 0], [100, 0]], PROPS, 1);
  assert.deepEqual(nearestTrayAnchor(project, { x: 3, y: 2 }, 8), { x: 0, y: 0, kind: "node" });
  assert.deepEqual(nearestTrayAnchor(project, { x: 50, y: 4 }, 8), { x: 50, y: 0, kind: "segment" });
  assert.equal(nearestTrayAnchor(project, { x: 50, y: 40 }, 8), null);
});
