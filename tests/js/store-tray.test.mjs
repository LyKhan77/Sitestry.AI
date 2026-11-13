import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

const RUN = [[0, 0], [100, 0]];

test("a new tray defaults to perforated, 0.5 m wide, 0.1 m high, 0.45 m under the ceiling", () => {
  const store = new SitestryStore();
  const tray = store.addCableTray(RUN);
  assert.equal(tray.type, "perforated");
  assert.equal(tray.width_m, 0.5);
  assert.equal(tray.height_m, 0.1);
  assert.equal(tray.elevation_m, 3.35);
});

test("the tray type comes from ui.trayType and options override defaults", () => {
  const store = new SitestryStore();
  store.ui.trayType = "duct";
  assert.equal(store.addCableTray(RUN).type, "duct");
  const wide = store.addCableTray(RUN, { type: "wiremesh", width_m: 0.8 });
  assert.equal(wide.type, "wiremesh");
  assert.equal(wide.width_m, 0.8);
});

test("elevation follows the project wall height", () => {
  const store = new SitestryStore();
  store.project.metadata.default_wall_height_m = 3.0;
  assert.equal(store.addCableTray(RUN).elevation_m, 2.55);
});

test("a legacy ladder tray keeps its type and elevation after loading", () => {
  const store = new SitestryStore();
  store.loadProjectData({
    cable_trays: [
      { id: "t1", name: "old", type: "ladder", width_m: 0.5, elevation_m: 2.75, points_px: [[0, 0], [50, 0]] },
    ],
  });
  const tray = store.project.cable_trays[0];
  assert.equal(tray.type, "ladder");
  assert.equal(tray.elevation_m, 2.75);
});

test("the preset tray uses the new defaults", () => {
  const store = new SitestryStore();
  store.loadPresetTelcoEquipment();
  const tray = store.project.cable_trays[0];
  assert.equal(tray.type, "perforated");
  assert.equal(tray.height_m, 0.1);
  assert.equal(tray.elevation_m, 3.35);
});
