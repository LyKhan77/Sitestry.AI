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

test("loading a legacy project migrates trays to shared nodes", () => {
  const store = new SitestryStore();
  store.loadProjectData({
    cable_trays: [{ id: "t1", type: "ladder", width_m: 0.5, elevation_m: 2.75, points_px: [[0, 0], [50, 0], [50, 50]] }],
  });
  const tray = store.project.cable_trays[0];
  assert.equal(tray.node_ids.length, 3);
  assert.equal(store.project.tray_nodes.length, 3);
  assert.equal("points_px" in tray, false);
});

test("BoQ tray length is unchanged by migration", () => {
  const store = new SitestryStore();
  store.project.metadata.scale_px_per_meter = 10;
  store.loadProjectData({ cable_trays: [{ id: "t1", points_px: [[0, 0], [30, 0], [30, 40]] }] });
  assert.equal(Number(store.computeBoQSummary().trayLengthMeters), 7);
});

test("addCableTray shares nodes: ending mid-segment splits the first tray", () => {
  const store = new SitestryStore();
  const a = store.addCableTray([[0, 0], [200, 0]]);
  const b = store.addCableTray([[100, 80], [100, 0]]);
  assert.equal(store.project.cable_trays.find((t) => t.id === a.id).node_ids.length, 3);
  assert.equal(b.node_ids[1], store.project.cable_trays.find((t) => t.id === a.id).node_ids[1]);
});

test("deleting a tray keeps nodes another tray uses and undo restores everything", () => {
  const store = new SitestryStore();
  const a = store.addCableTray([[0, 0], [200, 0]]);
  const b = store.addCableTray([[200, 0], [200, 90]]);
  assert.equal(store.project.tray_nodes.length, 3);
  store.selectObject("tray", b.id);
  store.deleteSelected();
  assert.equal(store.project.cable_trays.length, 1);
  assert.equal(store.project.tray_nodes.length, 2);
  assert.deepEqual(store.project.cable_trays[0].node_ids, a.node_ids);
  store.undo();
  assert.equal(store.project.cable_trays.length, 2);
  assert.equal(store.project.tray_nodes.length, 3);
});

test("tray service splits BoQ lengths across power, data, and unified", () => {
  const store = new SitestryStore();
  store.project.metadata.scale_px_per_meter = 10;
  store.ui.trayService = "power";
  const p = store.addCableTray([[0, 0], [30, 0]]);
  assert.equal(p.service, "power");
  assert.equal(p.elevation_m, 3.25);

  store.ui.trayService = "data";
  const d = store.addCableTray([[0, 20], [50, 20]]);
  assert.equal(d.service, "data");
  assert.equal(d.elevation_m, 3.45);

  const boq = store.computeBoQSummary();
  assert.equal(boq.powerTrayMeters, "3.0");
  assert.equal(boq.dataTrayMeters, "5.0");
  assert.equal(boq.unifiedTrayMeters, "0.0");
  assert.equal(boq.trayLengthMeters, "8.0");
});
