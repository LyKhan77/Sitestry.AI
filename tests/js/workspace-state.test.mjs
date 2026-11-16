import test from "node:test";
import assert from "node:assert/strict";
import { structureHash, projectHash, workspaceFlags, countsOf } from "../../frontend/js/workspaceState.js";

const base = () => ({
  metadata: { scale_px_per_meter: 30.68, roi_px: { x: 1, y: 2, width: 3, height: 4 } },
  nodes: [{ id: "n1", x_px: 10, y_px: 20 }, { id: "n2", x_px: 30, y_px: 40 }],
  walls: [{ id: "w1", start_node: "n1", end_node: "n2" }],
  columns: [{ id: "c1", x_px: 5, y_px: 6 }],
  openings: [],
  rooms: [],
  stairs: [],
  equipments: [{ id: "e1", x_px: 1, y_px: 1 }],
  cable_trays: [{ id: "t1", points_px: [[0, 0], [1, 1]] }],
});

test("structureHash is stable across key order", () => {
  const a = base();
  const b = { ...base(), nodes: [{ y_px: 20, x_px: 10, id: "n1" }, { y_px: 40, id: "n2", x_px: 30 }] };
  assert.equal(structureHash(a), structureHash(b));
});

test("structureHash ignores equipment and cable trays", () => {
  const a = base();
  const b = base();
  b.equipments.push({ id: "e2", x_px: 9, y_px: 9 });
  b.cable_trays = [];
  assert.equal(structureHash(a), structureHash(b));
});

test("structureHash changes when a wall node moves", () => {
  const b = base();
  b.nodes[0].x_px = 11;
  assert.notEqual(structureHash(base()), structureHash(b));
});

test("structureHash changes when scale changes", () => {
  const b = base();
  b.metadata.scale_px_per_meter = 31;
  assert.notEqual(structureHash(base()), structureHash(b));
});

test("workspaceFlags covers clean, dirty, stale and unbuilt", () => {
  assert.deepEqual(workspaceFlags({ liveHash: "a", savedHash: "a", builtHash: "a" }), { dirty: false, stale: false, built: true });
  assert.deepEqual(workspaceFlags({ liveHash: "b", savedHash: "a", builtHash: "a" }), { dirty: true, stale: false, built: true });
  assert.deepEqual(workspaceFlags({ liveHash: "a", savedHash: "a", builtHash: "z" }), { dirty: false, stale: true, built: true });
  assert.deepEqual(workspaceFlags({ liveHash: "a", savedHash: "a", builtHash: null }), { dirty: false, stale: false, built: false });
});

test("countsOf counts each array", () => {
  const project = base();
  project.openings = [{ id: "o1" }, { id: "o2" }];
  assert.deepEqual(countsOf(project), { walls: 1, openings: 2, columns: 1, stairs: 0, rooms: 0 });
});

test("structureHash ignores tray nodes", () => {
  const a = base();
  const b = base();
  b.tray_nodes = [{ id: "tn_1", x_px: 3, y_px: 4 }];
  assert.equal(structureHash(a), structureHash(b));
});

test("projectHash detects changes in installation (equipments, trays, pipes, cables)", () => {
  const a = base();
  const b = base();
  b.equipments.push({ id: "e2", x_px: 9, y_px: 9 });
  assert.notEqual(projectHash(a), projectHash(b));

  const c = base();
  c.cables = [{ id: "cab_1", source_id: "e1", target_id: "e2" }];
  assert.notEqual(projectHash(a), projectHash(c));

  const d = base();
  d.pipe_runs = [{ id: "p1", node_ids: ["pn1", "pn2"] }];
  assert.notEqual(projectHash(a), projectHash(d));
});
