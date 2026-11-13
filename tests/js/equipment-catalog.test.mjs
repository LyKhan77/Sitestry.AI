import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_SUBTYPES,
  defaultSubtypeForGroup,
  getEquipmentPreset,
  resolveEquipmentGroup,
  snapWallMountPosition,
  subtypesForGroup,
} from "../../frontend/js/equipmentCatalog.js";
import { SitestryStore } from "../../frontend/js/store.js";

test("EQUIPMENT_GROUPS exposes the 5 generic Stage 5 categories", () => {
  assert.deepEqual(EQUIPMENT_GROUPS, ["rack", "power", "data", "cooling", "security"]);
});

test("legacy categories map to their canonical domain_group", () => {
  assert.equal(resolveEquipmentGroup({ category: "rack" }), "rack");
  assert.equal(resolveEquipmentGroup({ category: "ups" }), "power");
  assert.equal(resolveEquipmentGroup({ category: "battery" }), "power");
  assert.equal(resolveEquipmentGroup({ category: "rectifier" }), "power");
  assert.equal(resolveEquipmentGroup({ category: "panel" }), "power");
  assert.equal(resolveEquipmentGroup({ category: "pac" }), "cooling");
});

test("each generic group has at least one subtype and valid defaults", () => {
  for (const group of EQUIPMENT_GROUPS) {
    const subs = subtypesForGroup(group);
    assert.ok(subs.length >= 1, `expected subtypes for ${group}`);
    const def = defaultSubtypeForGroup(group);
    assert.ok(EQUIPMENT_SUBTYPES[def], `expected default subtype ${def}`);
    assert.equal(getEquipmentPreset(def).group, group);
  }
});

test("snapWallMountPosition projects onto nearest wall within maxDistPx and sets rotation", () => {
  const nodes = [
    { id: "n1", x_px: 0, y_px: 100 },
    { id: "n2", x_px: 200, y_px: 100 },
    { id: "n3", x_px: 200, y_px: 300 },
  ];
  const walls = [
    { id: "w_horiz", start_node: "n1", end_node: "n2" },
    { id: "w_vert", start_node: "n2", end_node: "n3" },
  ];
  const hSnap = snapWallMountPosition(80, 112, walls, nodes, 20);
  assert.ok(hSnap);
  assert.equal(hSnap.wall_id, "w_horiz");
  assert.equal(hSnap.x_px, 80);
  assert.equal(hSnap.y_px, 100);
  assert.equal(hSnap.rotation_deg, 0);

  const vSnap = snapWallMountPosition(190, 220, walls, nodes, 20);
  assert.ok(vSnap);
  assert.equal(vSnap.wall_id, "w_vert");
  assert.equal(vSnap.x_px, 200);
  assert.equal(vSnap.y_px, 220);
  assert.equal(vSnap.rotation_deg, 90);

  assert.equal(snapWallMountPosition(50, 200, walls, nodes, 20), null);
});

test("store.addEquipment supports generic subtypes, wall snapping, and BoQ group counts", () => {
  const store = new SitestryStore();
  store.project.nodes = [
    { id: "n1", x_px: 100, y_px: 100 },
    { id: "n2", x_px: 400, y_px: 100 },
  ];
  store.project.walls = [{ id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.15, height_m: 3.8, type: "solid" }];

  const outlet = store.addEquipment(250, 108, "outlet");
  assert.equal(outlet.domain_group, "power");
  assert.equal(outlet.subtype, "outlet");
  assert.equal(outlet.mount, "wall");
  assert.equal(outlet.wall_id, "w1");
  assert.equal(outlet.y_px, 100);

  const cctv = store.addEquipment(150, 106, "cctv");
  assert.equal(cctv.domain_group, "security");
  assert.equal(cctv.mount, "wall");
  assert.equal(cctv.wall_id, "w1");

  const chiller = store.addEquipment(50, 50, "chiller");
  assert.equal(chiller.domain_group, "cooling");
  assert.equal(chiller.mount, "floor");

  const boq = store.computeBoQSummary();
  assert.equal(boq.equipmentsCount, 3);
  assert.equal(boq.equipmentsByGroup.power, 1);
  assert.equal(boq.equipmentsByGroup.security, 1);
  assert.equal(boq.equipmentsByGroup.cooling, 1);
  assert.equal(boq.equipmentsByGroup.rack, 0);
  assert.equal(boq.equipmentsByGroup.data, 0);
});
