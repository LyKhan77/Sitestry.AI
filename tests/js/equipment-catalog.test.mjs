import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_SUBTYPES,
  defaultSubtypeForGroup,
  getEquipmentPreset,
  resolveEquipmentElevationM,
  resolveEquipmentGroup,
  resolveFloorElevationAt,
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

test("floor-mounted equipment rests flush on room floor, base floor (0.02m), or ground (0m)", () => {
  const store = new SitestryStore();
  // Closed outer structural room (0..400, 0..200) -> BaseFloor = 0.02 m where no room zone exists
  store.project.nodes = [
    { id: "n1", x_px: 0, y_px: 0 },
    { id: "n2", x_px: 400, y_px: 0 },
    { id: "n3", x_px: 400, y_px: 200 },
    { id: "n4", x_px: 0, y_px: 200 },
  ];
  store.project.walls = [
    { id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.2, height_m: 3.8, type: "solid" },
    { id: "w2", start_node: "n2", end_node: "n3", thickness_m: 0.2, height_m: 3.8, type: "solid" },
    { id: "w3", start_node: "n3", end_node: "n4", thickness_m: 0.2, height_m: 3.8, type: "solid" },
    { id: "w4", start_node: "n4", end_node: "n1", thickness_m: 0.2, height_m: 3.8, type: "solid" },
  ];
  store.project.rooms = [
    {
      id: "r1",
      name: "R. Meeting",
      floor_type: "raised_floor_60cm",
      elevation_m: 0.06,
      polygon_px: [[10, 10], [180, 10], [180, 180], [10, 180]],
    },
    {
      id: "r2",
      name: "Data Hall",
      floor_type: "raised_floor_60cm",
      elevation_m: 0.45,
      polygon_px: [[200, 10], [390, 10], [390, 190], [200, 190]],
    },
  ];

  // Placed inside +0.06m room -> flush on 0.06m
  const rackInLowRoom = store.addEquipment(80, 80, "rack");
  assert.equal(rackInLowRoom.elevation_m, 0.06);

  // Moved into +0.45m room -> tracks 0.45m floor
  store.moveEquipment(rackInLowRoom.id, 280, 80);
  assert.equal(rackInLowRoom.elevation_m, 0.45);

  // Wall outlet in +0.45m room sits 0.6m above the 0.45m floor
  const outlet = store.addEquipment(250, 5, "outlet");
  assert.equal(resolveFloorElevationAt(store.project, 250, 15), 0.45);
  assert.ok(outlet.elevation_m >= 0.6);

  // Saved stale rack (legacy hardcoded 0.45m) inside +0.06m room or +0.02m BaseFloor resolves flush
  assert.equal(
    resolveEquipmentElevationM(store.project, { subtype: "rack", mount: "floor", x_px: 80, y_px: 80, elevation_m: 0.45 }),
    0.06
  );
  assert.equal(
    resolveEquipmentElevationM(store.project, { subtype: "pac", mount: "floor", x_px: 190, y_px: 100, elevation_m: 0.45 }),
    0.02
  );
  assert.equal(
    resolveEquipmentElevationM(store.project, { subtype: "rack", mount: "floor", x_px: 500, y_px: 500, elevation_m: 0.45 }),
    0
  );
});
