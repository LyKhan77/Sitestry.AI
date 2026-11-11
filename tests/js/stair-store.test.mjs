import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";
import { resolveStairGeometry, isParametricStair } from "../../frontend/js/stairGeometry.js";

function fixture() {
  const store = new SitestryStore();
  store.project = {
    project_id: "stair-test",
    project_name: "Stair Test",
    metadata: {
      scale_px_per_meter: 10,
      default_wall_height_m: 3.8,
      image_width_px: 1000,
      image_height_px: 800,
      roi_px: { x: 0, y: 0, width: 1000, height: 800 },
    },
    nodes: [], walls: [], columns: [], openings: [], rooms: [], stairs: [], equipments: [], cable_trays: [],
  };
  store.undoStack = [];
  store.redoStack = [];
  return store;
}

test("add_straight_stair_uses_defaults_and_one_undo", () => {
  const store = fixture();
  const result = store.addParametricStair({
    shape: "straight",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 40, y_px: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(store.undoStack.length, 1);
  const stair = result.stair;
  assert.equal(stair.template_version, 1);
  assert.equal(stair.width_m, 1.2);
  assert.equal(stair.steps, 22);
  assert.equal(stair.bbox_px, undefined);
  const geometry = resolveStairGeometry(stair, 10);
  assert.equal(geometry.ok, true);
  assert.equal(geometry.flights.length, 1);
  assert.equal(geometry.flights[0].run_m, 4);
});

test("add_L_and_U_create_single_objects_with_flights_and_landing", () => {
  const store = fixture();
  const l = store.addParametricStair({
    shape: "L",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 24, y_px: 24 },
    height_m: 3.0,
    steps: 9,
  });
  assert.equal(l.ok, true);
  const lg = resolveStairGeometry(l.stair, 10);
  assert.equal(lg.flights.length, 2);
  assert.equal(lg.landings.length, 1);
  assert.ok(l.stair.depth_m > 0);

  const u = store.addParametricStair({
    shape: "U",
    start_px: { x_px: 100, y_px: 0 },
    end_px: { x_px: 100, y_px: 24 },
    heading_rad: 0,
    turn: "right",
    flight_run_m: 3,
    steps: 12,
  });
  assert.equal(u.ok, true);
  const ug = resolveStairGeometry(u.stair, 10);
  assert.equal(ug.flights.length, 2);
  assert.equal(store.undoStack.length, 2);
});

test("invalid_U_does_not_change_project_or_history", () => {
  const store = fixture();
  const before = JSON.stringify(store.project);
  const result = store.addParametricStair({
    shape: "U",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 0, y_px: 6 },
    heading_rad: 0,
    flight_run_m: 3,
    steps: 12,
  });
  assert.equal(result.ok, false);
  assert.equal(store.project.stairs.length, 0);
  assert.equal(JSON.stringify(store.project), before);
  assert.equal(store.undoStack.length, 0);
});

test("endpoint_update_regenerates_and_undo_restores", () => {
  const store = fixture();
  const added = store.addParametricStair({
    shape: "L",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 24, y_px: 24 },
    steps: 9,
  });
  const id = added.stair.id;
  const beforeEnd = { ...added.stair.end_px };
  const beforeUndo = store.undoStack.length;
  const updated = store.updateParametricStair(id, { end_px: { x_px: 30, y_px: 30 } });
  assert.equal(updated.ok, true);
  assert.equal(store.undoStack.length, beforeUndo + 1);
  assert.deepEqual(store.project.stairs[0].end_px, { x_px: 30, y_px: 30 });
  assert.equal(store.undo(), true);
  assert.deepEqual(store.project.stairs[0].end_px, beforeEnd);
});

test("invalid_parameter_update_keeps_canonical_object_untouched", () => {
  const store = fixture();
  const added = store.addParametricStair({
    shape: "straight",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 40, y_px: 0 },
  });
  const id = added.stair.id;
  const snapshot = JSON.stringify(store.project.stairs[0]);
  const undoBefore = store.undoStack.length;
  for (const patch of [{ width_m: -1 }, { width_m: Number.NaN }, { landing_depth_m: 0.2 }, { steps: 2 }, { steps: 9.5 }]) {
    const result = store.updateParametricStair(id, patch);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(JSON.stringify(store.project.stairs[0]), snapshot);
    assert.equal(store.undoStack.length, undoBefore);
  }
});

test("translate_moves_both_endpoints_and_is_one_undo", () => {
  const store = fixture();
  const added = store.addParametricStair({
    shape: "L",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 24, y_px: 24 },
    steps: 9,
  });
  const start = { ...added.stair.start_px };
  const end = { ...added.stair.end_px };
  const result = store.translateParametricStair(added.stair.id, { dx: 15, dy: -5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.stair.start_px, { x_px: start.x_px + 15, y_px: start.y_px - 5 });
  assert.deepEqual(result.stair.end_px, { x_px: end.x_px + 15, y_px: end.y_px - 5 });
  assert.equal(store.undoStack.length, 2);
  store.undo();
  assert.deepEqual(store.project.stairs[0].start_px, start);
});

test("undo_and_redo_restore_template_and_turn", () => {
  const store = fixture();
  const added = store.addParametricStair({
    shape: "U",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 0, y_px: 24 },
    heading_rad: 0,
    turn: "right",
    flight_run_m: 3,
    steps: 12,
  });
  store.updateParametricStair(added.stair.id, { turn: "left", heading_rad: 0, end_px: { x_px: 0, y_px: -24 } });
  assert.equal(store.project.stairs[0].turn, "left");
  store.undo();
  assert.equal(store.project.stairs[0].turn, "right");
  store.redo();
  assert.equal(store.project.stairs[0].turn, "left");
});

test("explicit_legacy_conversion_uses_declared_direction_and_is_undoable", () => {
  const store = fixture();
  const legacy = {
    id: "stair_legacy",
    name: "Legacy Stair",
    x_px: 50,
    y_px: 60,
    width_m: 1.4,
    depth_m: 3.0,
    height_m: 3.6,
    steps: 12,
    direction: "north",
    bbox_px: [40, 40, 20, 40],
  };
  store.project.stairs.push(legacy);
  const suggestion = store.suggestLegacyStairConversion("stair_legacy");
  assert.equal(suggestion.shape, "straight");
  assert.equal(suggestion.start_px.y_px, 60 + 15);
  assert.equal(suggestion.end_px.y_px, 60 - 15);
  const result = store.convertLegacyStair("stair_legacy", suggestion);
  assert.equal(result.ok, true);
  assert.equal(result.stair.id, "stair_legacy");
  assert.equal(isParametricStair(result.stair), true);
  assert.equal(store.project.stairs.length, 1);
  assert.equal(store.undoStack.length, 1);
  store.undo();
  assert.deepEqual(store.project.stairs[0], legacy);
});

test("legacy_addStaircase_stays_legacy_without_auto_conversion", () => {
  const store = fixture();
  const legacy = store.addStaircase(100, 100);
  assert.equal(legacy.template_version, undefined);
  assert.ok(legacy.bbox_px);
});

test("preview_does_not_mutate_project_or_history", () => {
  const store = fixture();
  const before = JSON.stringify(store.project);
  const preview = store.previewParametricStair({
    shape: "straight",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 50, y_px: 20 },
  });
  assert.equal(preview.ok, true);
  assert.equal(JSON.stringify(store.project), before);
  assert.equal(store.undoStack.length, 0);
});
