import test from "node:test";
import assert from "node:assert/strict";
import {
  PIPE_MOUNTINGS,
  defaultPipeElevation,
  insertPipeRun,
  nearestPipeAnchor,
  pipeLengthM,
  pipePoints,
  prunePipeNodes,
} from "../../frontend/js/pipeNetwork.js";
import { SitestryStore } from "../../frontend/js/store.js";

const emptyProject = () => ({ metadata: { scale_px_per_meter: 10, default_wall_height_m: 3.8 }, pipe_nodes: [], pipe_runs: [] });
const PROPS = { id: "p1", name: "Pipe", mounting: "underfloor", diameter_m: 0.1, elevation_m: 0.15, color: "#06b6d4" };

test("PIPE_MOUNTINGS and defaultPipeElevation support underfloor and overhead", () => {
  assert.deepEqual(PIPE_MOUNTINGS, ["underfloor", "overhead"]);
  const proj = emptyProject();
  assert.equal(defaultPipeElevation(proj, "underfloor"), 0.15);
  assert.equal(defaultPipeElevation(proj, "overhead"), 3.1);
});

test("insertPipeRun splits mid-segment, prunes orphans, and measures length", () => {
  const project = emptyProject();
  const a = insertPipeRun(project, [[0, 0], [100, 0]], { ...PROPS, id: "a" }, 2);
  const b = insertPipeRun(project, [[50, 60], [50, 0.5]], { ...PROPS, id: "b" }, 2);
  assert.equal(a.node_ids.length, 3);
  assert.equal(b.node_ids[1], a.node_ids[1]);
  assert.deepEqual(pipePoints(project, a)[1], [50, 0]);
  assert.equal(pipeLengthM(project, a, 10), 10);
  assert.deepEqual(nearestPipeAnchor(project, { x: 50, y: 2 }, 5), { x: 50, y: 0, kind: "node" });

  project.pipe_runs = project.pipe_runs.filter((r) => r.id !== "b");
  prunePipeNodes(project);
  assert.equal(project.pipe_nodes.length, 3);
});

test("store.addPipeRun, deleteSelected, undo/redo, and BoQ pipeMeters work together", () => {
  const store = new SitestryStore();
  store.project.metadata.scale_px_per_meter = 10;
  store.ui.pipeMounting = "underfloor";
  const p = store.addPipeRun([[0, 0], [40, 0], [40, 30]]);
  assert.equal(p.mounting, "underfloor");
  assert.equal(p.elevation_m, 0.15);
  assert.equal(store.computeBoQSummary().pipeLengthMeters, "7.0");

  store.selectObject("pipe", p.id);
  assert.equal(store.canEdit("pipe"), false);
  store.ui.step = 4;
  assert.equal(store.canEdit("pipe"), true);

  store.deleteSelected();
  assert.equal(store.project.pipe_runs.length, 0);
  assert.equal(store.project.pipe_nodes.length, 0);
  store.undo();
  assert.equal(store.project.pipe_runs.length, 1);
  assert.equal(store.project.pipe_nodes.length, 3);
});
