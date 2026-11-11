import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveStairGeometry, isParametricStair } from "../../frontend/js/stairGeometry.js";

const fixtureUrl = new URL("../fixtures/legacy-stairs.json", import.meta.url);

test("legacy fixture retains both bbox shapes without migration", async () => {
  const raw = await readFile(fixtureUrl, "utf8");
  const fixture = JSON.parse(raw);
  const before = JSON.stringify(fixture);
  assert.equal(fixture.stairs.length, 3);
  assert.deepEqual(fixture.stairs[0].bbox_px, [1074.0, 486.5, 45.0, 55.2]);
  assert.deepEqual(fixture.stairs[1].bbox_px, [440, 336, 560, 464]);
  assert.equal(fixture.stairs.every((s) => s.template_version === undefined), true);
  assert.equal(JSON.stringify(fixture), before);
});

test("legacy objects are routed to the legacy renderer, not the parametric resolver", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  for (const legacy of fixture.stairs) {
    assert.equal(isParametricStair(legacy), false);
    const result = resolveStairGeometry(legacy, 30.68);
    assert.equal(result.ok, false);
    assert.equal(result.code, "legacy_stair");
  }
});

test("version1 objects with missing fields fail explicitly instead of falling back", () => {
  const broken = {
    id: "broken",
    template_version: 1,
    shape: "straight",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 100, y_px: 0 },
    height_m: 3.6,
    steps: 12,
    turn: "right",
    landing_depth_m: 1.2,
  };
  const result = resolveStairGeometry(broken, 30.68);
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_width");
});

test("unknown template versions do not fall back to bbox rendering", () => {
  const future = {
    id: "future",
    template_version: 7,
    shape: "U",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 0, y_px: 240 },
    width_m: 1.2,
    height_m: 3.6,
    steps: 12,
    turn: "right",
    landing_depth_m: 1.2,
    flight_run_m: 3,
  };
  const result = resolveStairGeometry(future, 10);
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_template_version");
});

test("legacy object identity and bbox values are untouched by resolution attempts", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const snapshot = JSON.stringify(fixture.stairs);
  fixture.stairs.forEach((stair) => resolveStairGeometry(stair, 30.68));
  assert.equal(JSON.stringify(fixture.stairs), snapshot);
});
