import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";

test("store.addCable creates, selects, cascade-deletes on equipment removal, and supports undo", () => {
  const store = new SitestryStore();
  store.project.metadata.scale_px_per_meter = 20;
  store.ui.step = 5;

  const panel = store.addEquipment(40, 80, "panel");
  const rack = store.addEquipment(240, 80, "rack");
  store.addCableTray([[40, 60], [240, 60]], { service: "power" });

  assert.equal(store.addCable(panel.id, panel.id), null);
  store.ui.cableSystem = "power";
  store.ui.cablePathLabel = "B";
  const cable = store.addCable(panel.id, rack.id);
  assert.ok(cable);
  assert.equal(cable.system, "power");
  assert.equal(cable.path_label, "B");
  assert.equal(cable.color, "#2563eb");
  assert.equal(store.canEdit("cable"), true);

  const boq = store.computeBoQSummary();
  assert.ok(Number(boq.powerCableMeters) > 9);
  assert.equal(boq.waterfallCount, 2);

  // Cascade delete when rack is removed
  store.selectObject("equipment", rack.id);
  store.deleteSelected();
  assert.equal(store.project.equipments.length, 1);
  assert.equal(store.project.cables.length, 0);

  store.undo();
  assert.equal(store.project.equipments.length, 2);
  assert.equal(store.project.cables.length, 1);
});
