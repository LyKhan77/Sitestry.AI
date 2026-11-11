import test from "node:test";
import assert from "node:assert/strict";
import {
  computeWallPreview,
  planWallInsertion,
  planWallSplit,
} from "../../frontend/js/annotationGeometry.js";
import { SitestryStore } from "../../frontend/js/store.js";

function projectFixture() {
  return {
    project_id: "wall-test",
    project_name: "Wall Test",
    metadata: {
      scale_px_per_meter: 10,
      default_wall_height_m: 3.8,
      image_width_px: 1000,
      image_height_px: 800,
      roi_px: { x: 0, y: 0, width: 1000, height: 800 },
    },
    nodes: [
      { id: "n1", x_px: 0, y_px: 0 },
      { id: "n2", x_px: 100, y_px: 0 },
      { id: "n3", x_px: 100, y_px: 100 },
    ],
    walls: [
      { id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.2, height_m: 3.8, type: "solid" },
      { id: "w2", start_node: "n2", end_node: "n3", thickness_m: 0.2, height_m: 3.8, type: "solid" },
    ],
    columns: [],
    openings: [
      {
        id: "op1",
        wall_id: "w1",
        type: "single_door",
        offset_ratio: 0.75,
        width_m: 0.8,
        height_m: 2.15,
        elevation_m: 0,
        x_px: 75,
        y_px: 0,
      },
    ],
    rooms: [],
    stairs: [],
    equipments: [],
    cable_trays: [],
  };
}

let idCounter = 0;
const allocateId = (prefix) => `${prefix}_test_${++idCounter}`;

function previewFor(project, startPx, endPx, options = {}) {
  return computeWallPreview({
    startPx,
    endPx,
    viewScale: options.viewScale ?? 1,
    mode: options.mode ?? "manual",
    assistance: options.assistance ?? { endpointSnap: false, ortho: false },
    guides: options.guides ?? [],
    project,
  });
}

test("manual_off_snap_preserves_diagonal", () => {
  const project = projectFixture();
  const preview = previewFor(project, { x_px: 10, y_px: 120 }, { x_px: 90, y_px: 157 });
  assert.equal(preview.valid, true);
  assert.equal(preview.endPx.x_px, 90);
  assert.equal(preview.endPx.y_px, 157);
  assert.equal(preview.connections.end.type, "free");
});

test("endpoint_five_source_px_away_stays_distinct_when_assistance_off", () => {
  const project = projectFixture();
  const preview = previewFor(project, { x_px: 5, y_px: 0 }, { x_px: 50, y_px: 40 });
  assert.notEqual(preview.connections.start.type, "node");
  assert.equal(preview.startPx.x_px, 5);
  assert.equal(preview.startPx.y_px, 0);
});

test("snapping_uses_ten_css_px_at_three_zoom_levels", () => {
  const project = projectFixture();
  project.walls = [];
  project.openings = [];
  const assistance = { endpointSnap: true, ortho: false };
  const atZoom = (zoom) =>
    previewFor(project, { x_px: 12, y_px: 0 }, { x_px: 60, y_px: 50 }, { viewScale: zoom, assistance });

  assert.equal(atZoom(0.5).connections.start.type, "node");
  assert.equal(atZoom(1).connections.start.type, "free");
  assert.equal(atZoom(2).connections.start.type, "free");

  const near = (zoom) =>
    previewFor(project, { x_px: 4, y_px: 0 }, { x_px: 60, y_px: 50 }, { viewScale: zoom, assistance });
  assert.equal(near(2).connections.start.type, "node");
});

test("ortho_assistance_is_separate_from_endpoint_snap", () => {
  const project = projectFixture();
  const off = previewFor(project, { x_px: 20, y_px: 200 }, { x_px: 120, y_px: 207 });
  assert.equal(off.endPx.y_px, 207);
  const on = previewFor(project, { x_px: 20, y_px: 200 }, { x_px: 120, y_px: 207 }, {
    assistance: { endpointSnap: false, ortho: true },
  });
  assert.equal(on.endPx.y_px, 200);
});

test("guided_preview_uses_source_candidate_centerline", () => {
  const project = projectFixture();
  const guides = [
    { id: "g1", start_px: { x_px: 10, y_px: 300 }, end_px: { x_px: 110, y_px: 300 }, width_px: 6, confidence: 0.9, evidence: "parallel_edges" },
  ];
  const preview = previewFor(project, { x_px: 20, y_px: 302 }, { x_px: 90, y_px: 303 }, {
    mode: "guided",
    guides,
    assistance: { endpointSnap: false, ortho: true },
  });
  assert.equal(preview.guideId, "g1");
  assert.equal(preview.endPx.y_px, 300);
  assert.equal(preview.startPx.y_px, 300);
});

test("plan_insertion_reuses_node_and_creates_one_wall", () => {
  const project = projectFixture();
  const preview = previewFor(project, { x_px: 0, y_px: 0 }, { x_px: 40, y_px: 60 });
  assert.equal(preview.connections.start.type, "node");
  const plan = planWallInsertion({
    project,
    preview,
    properties: { type: "solid", thickness_m: 0.2, height_m: 3.8 },
    allocateId,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.patch.nodes.length, project.nodes.length + 1);
  assert.equal(plan.patch.walls.length, project.walls.length + 1);
  assert.equal(plan.patch.openings.length, project.openings.length);
});

test("split_and_insert_remaps_opening_physical_position", () => {
  const project = projectFixture();
  const preview = previewFor(project, { x_px: 50, y_px: 0 }, { x_px: 50, y_px: 60 });
  const plan = planWallInsertion({
    project,
    preview,
    properties: { type: "solid", thickness_m: 0.2, height_m: 3.8 },
    allocateId,
  });
  assert.equal(plan.ok, true);
  const left = plan.patch.walls.find((w) => w.id === "w1");
  const right = plan.patch.walls.find((w) => w.id !== "w1" && w.start_node === left.end_node);
  assert.ok(right);
  assert.equal(left.end_node, right.start_node);
  const op = plan.patch.openings.find((o) => o.id === "op1");
  assert.equal(op.wall_id, right.id);
  assert.equal(op.offset_ratio, 0.5);
  assert.equal(op.x_px, 75);
  assert.equal(op.y_px, 0);
});

test("opening_straddling_junction_rejects_without_mutation", () => {
  const project = projectFixture();
  project.openings[0].offset_ratio = 0.5;
  const before = JSON.stringify(project);
  const plan = planWallSplit(project, "w1", { x_px: 50, y_px: 0 }, allocateId);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /opening/i);
  assert.equal(JSON.stringify(project), before);
});

test("remap_outside_canonical_offset_rejects", () => {
  const project = projectFixture();
  project.openings[0].offset_ratio = 0.1;
  const plan = planWallSplit(project, "w1", { x_px: 5, y_px: 0 }, allocateId);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /offset/i);
});

test("split_double_click_keeps_openings_and_ids", () => {
  const project = projectFixture();
  const plan = planWallSplit(project, "w1", { x_px: 40, y_px: 0 }, allocateId);
  assert.equal(plan.ok, true);
  const first = plan.patch.walls.find((w) => w.id === "w1");
  const second = plan.patch.walls.find((w) => w.id !== "w1" && w.start_node === first.end_node);
  assert.ok(first);
  assert.ok(second);
  const op = plan.patch.openings[0];
  assert.equal(op.wall_id, second.id);
  assert.equal(op.offset_ratio, (0.75 - 0.4) / 0.6);
});

test("store_insert_wall_is_one_undo_and_remaps_openings", () => {
  const store = new SitestryStore();
  store.project = projectFixture();
  store.undoStack = [];
  store.redoStack = [];
  const preview = previewFor(store.project, { x_px: 50, y_px: 0 }, { x_px: 30, y_px: 70 });
  const result = store.insertWall(preview, { type: "solid" });
  assert.equal(result.ok, true);
  assert.equal(store.undoStack.length, 1);
  assert.equal(store.project.walls.length, 4);
  const op = store.project.openings[0];
  const host = store.project.walls.find((w) => w.id === op.wall_id);
  const a = store.getNodeById(host.start_node);
  const b = store.getNodeById(host.end_node);
  assert.equal(a.x_px + (b.x_px - a.x_px) * op.offset_ratio, 75);
  assert.equal(store.undo(), true);
  assert.equal(store.project.openings[0].wall_id, "w1");
  assert.equal(store.project.openings[0].offset_ratio, 0.75);
});

test("degenerate_and_duplicate_walls_are_rejected", () => {
  const project = projectFixture();
  const tiny = previewFor(project, { x_px: 10, y_px: 10 }, { x_px: 11, y_px: 11 });
  assert.equal(tiny.valid, false);
  const duplicate = previewFor(project, { x_px: 0, y_px: 0 }, { x_px: 100, y_px: 0 }, {
    assistance: { endpointSnap: true, ortho: false },
  });
  const plan = planWallInsertion({ project, preview: duplicate, properties: {}, allocateId });
  assert.equal(plan.ok, false);
});
