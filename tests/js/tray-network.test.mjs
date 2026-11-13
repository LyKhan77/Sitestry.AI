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
