import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveStairGeometry,
  isParametricStair,
  computeDefaultHeading,
} from "../../frontend/js/stairGeometry.js";
import { computeWallPreview } from "../../frontend/js/annotationGeometry.js";

function stair(overrides = {}) {
  return {
    id: "s1",
    name: "Stair",
    template_version: 1,
    shape: "straight",
    start_px: { x_px: 0, y_px: 0 },
    end_px: { x_px: 30, y_px: 40 },
    width_m: 1.2,
    height_m: 3.0,
    steps: 10,
    turn: "right",
    heading_rad: 0,
    landing_depth_m: 1.2,
    flight_run_m: null,
    ...overrides,
  };
}

const SCALE = 10;

function segmentConnected(a, b) {
  return Math.hypot(a.x_px - b.x_px, a.y_px - b.y_px) < 1e-6;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = [points[i].x_px, points[i].y_px];
    const [x2, y2] = [points[(i + 1) % points.length].x_px, points[(i + 1) % points.length].y_px];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function polygonsOverlapArea(a, b) {
  // Axis-aligned bounding box intersection is enough to catch accidental flight overlap here.
  const box = (poly) => ({
    x0: Math.min(...poly.map((p) => p.x_px)),
    x1: Math.max(...poly.map((p) => p.x_px)),
    y0: Math.min(...poly.map((p) => p.y_px)),
    y1: Math.max(...poly.map((p) => p.y_px)),
  });
  const ba = box(a);
  const bb = box(b);
  return Math.max(0, Math.min(ba.x1, bb.x1) - Math.max(ba.x0, bb.x0)) *
    Math.max(0, Math.min(ba.y1, bb.y1) - Math.max(ba.y0, bb.y0));
}

test("straight stair is rotated by its endpoints and reaches total rise", () => {
  const result = resolveStairGeometry(stair(), SCALE);
  assert.equal(result.ok, true);
  assert.equal(result.flights.length, 1);
  assert.equal(result.landings.length, 0);
  assert.equal(result.treads.length, 10);
  assert.equal(result.treads[9].elevation_m, 3);
  assert.equal(result.flights[0].run_m, 5);
  assert.ok(segmentConnected(result.route_px[0], { x_px: 0, y_px: 0 }));
  assert.ok(segmentConnected(result.route_px[result.route_px.length - 1], { x_px: 30, y_px: 40 }));
  assert.equal(result.flights[0].risers, 10);
  assert.equal(result.flights[0].treads.length, 10);
});

test("L stairs left and right share one riser schedule", () => {
  for (const turn of ["right", "left"]) {
    const end = turn === "right" ? { x_px: 24, y_px: 24 } : { x_px: 24, y_px: -24 };
    const heading = computeDefaultHeading({ x_px: 0, y_px: 0 }, end, "L", turn);
    const result = resolveStairGeometry(
      stair({ shape: "L", end_px: end, heading_rad: heading, steps: 9, turn }),
      SCALE
    );
    assert.equal(result.ok, true, turn);
    assert.equal(result.flights.length, 2);
    assert.equal(result.landings.length, 1);
    assert.equal(result.treads.length, 9);
    const total = result.flights.reduce((sum, f) => sum + f.risers, 0);
    assert.equal(total, 9);
    assert.ok(Math.abs(result.flights[0].end_elevation_m - result.landings[0].elevation_m) < 1e-9);
    assert.ok(Math.abs(result.flights[1].end_elevation_m - 3.0) < 1e-9);
    assert.ok(segmentConnected(result.route_px[0], { x_px: 0, y_px: 0 }));
    assert.ok(segmentConnected(result.route_px.at(-1), end));
    assert.ok(Math.abs(result.flights[0].run_m - 1.8) < 1e-9);
    assert.ok(Math.abs(result.flights[1].run_m - 1.8) < 1e-9);
    assert.equal(polygonsOverlapArea(result.flights[0].footprint_px, result.flights[1].footprint_px), 0);
  }
});

test("U stair uses explicit flight run, not endpoint distance", () => {
  const result = resolveStairGeometry(
    stair({
      shape: "U",
      start_px: { x_px: 0, y_px: 0 },
      end_px: { x_px: 0, y_px: 24 },
      height_m: 3.6,
      steps: 12,
      heading_rad: 0,
      turn: "right",
      flight_run_m: 3,
    }),
    SCALE
  );
  assert.equal(result.ok, true);
  assert.equal(result.flights.length, 2);
  assert.equal(result.flights[0].run_m, 3);
  assert.equal(result.flights[1].run_m, 3);
  const separation = Math.hypot(
    result.flights[0].treads[0].footprint_px[0].x_px - result.flights[1].treads[0].footprint_px[0].x_px,
    result.flights[0].treads[0].footprint_px[0].y_px - result.flights[1].treads[0].footprint_px[0].y_px
  );
  assert.ok(separation >= 12);
  assert.equal(result.flights[0].risers + result.flights[1].risers, 12);
  assert.ok(Math.abs(result.flights[1].end_elevation_m - 3.6) < 1e-9);
  assert.ok(segmentConnected(result.route_px.at(-1), { x_px: 0, y_px: 24 }));
  assert.equal(polygonsOverlapArea(result.flights[0].footprint_px, result.flights[1].footprint_px), 0);
  assert.ok(result.landings[0].width_m >= 1.2);
});

test("U with too-small transversal separation is rejected without moving endpoints", () => {
  const input = stair({
    shape: "U",
    end_px: { x_px: 0, y_px: 6 },
    heading_rad: 0,
    turn: "right",
    flight_run_m: 3,
    steps: 12,
  });
  const before = JSON.stringify(input);
  const result = resolveStairGeometry(input, SCALE);
  assert.equal(result.ok, false);
  assert.match(result.code, /infeasible_width/);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(input.end_px, { x_px: 0, y_px: 6 });
});

test("U mirror case works for left turn", () => {
  const result = resolveStairGeometry(
    stair({
      shape: "U",
      end_px: { x_px: 0, y_px: -24 },
      heading_rad: 0,
      turn: "left",
      flight_run_m: 3,
      steps: 12,
      height_m: 3.6,
    }),
    SCALE
  );
  assert.equal(result.ok, true);
  assert.equal(result.flights[0].run_m, 3);
  assert.equal(result.flights[1].run_m, 3);
});

test("endpoint edit regenerates U geometry", () => {
  const base = stair({
    shape: "U",
    end_px: { x_px: 0, y_px: 24 },
    heading_rad: 0,
    turn: "right",
    flight_run_m: 3,
    steps: 12,
  });
  const moved = { ...base, end_px: { x_px: 0, y_px: 30 } };
  const a = resolveStairGeometry(base, SCALE);
  const b = resolveStairGeometry(moved, SCALE);
  assert.equal(a.flights[1].run_m, 3);
  assert.equal(b.flights[1].run_m, 3);
  assert.notDeepEqual(a.flights[1].footprint_px, b.flights[1].footprint_px);
});

test("invalid scales steps landing and unsupported versions are rejected", () => {
  assert.equal(resolveStairGeometry(stair(), 0).ok, false);
  assert.equal(resolveStairGeometry(stair(), Number.NaN).ok, false);
  assert.equal(
    resolveStairGeometry(stair({ start_px: { x_px: 5, y_px: 5 }, end_px: { x_px: 5, y_px: 5 } }), SCALE).ok,
    false
  );
  assert.equal(resolveStairGeometry(stair({ landing_depth_m: 1.0 }), SCALE).ok, false);
  assert.equal(resolveStairGeometry(stair({ steps: 3 }), SCALE).ok, false);
  assert.equal(resolveStairGeometry(stair({ steps: 129 }), SCALE).ok, false);
  assert.equal(resolveStairGeometry(stair({ steps: 9.5 }), SCALE).ok, false);
  assert.equal(resolveStairGeometry(stair({ template_version: 2 }), SCALE).ok, false);
  assert.equal(resolveStairGeometry(stair({ template_version: 2 }), SCALE).code, "unsupported_template_version");
  const returnFlight = resolveStairGeometry(
    stair({
      shape: "U",
      heading_rad: 0,
      end_px: { x_px: 40, y_px: 24 },
      flight_run_m: 3,
      steps: 12,
    }),
    SCALE
  );
  assert.equal(returnFlight.ok, false);
  assert.match(returnFlight.code, /infeasible_flight/);
});

test("rotation and translation preserve run and elevation schedule", () => {
  const base = resolveStairGeometry(stair(), SCALE);
  const translated = resolveStairGeometry(
    stair({ start_px: { x_px: 100, y_px: 200 }, end_px: { x_px: 130, y_px: 240 } }),
    SCALE
  );
  assert.equal(translated.ok, true);
  assert.equal(translated.flights[0].run_m, base.flights[0].run_m);
  assert.deepEqual(
    translated.treads.map((t) => t.elevation_m),
    base.treads.map((t) => t.elevation_m)
  );
  assert.ok(Math.abs(translated.flights[0].footprint_px[0].x_px - (base.flights[0].footprint_px[0].x_px + 100)) < 1e-9);
});

test("resolver does not mutate input and bounds enclose all footprints", () => {
  const input = stair({ shape: "L", end_px: { x_px: 24, y_px: 24 }, heading_rad: 0, steps: 9 });
  const before = JSON.stringify(input);
  const result = resolveStairGeometry(input, SCALE);
  assert.equal(JSON.stringify(input), before);
  for (const poly of result.footprint_px) {
    for (const point of poly) {
      assert.ok(point.x_px >= result.bounds_px.x_min - 1e-9);
      assert.ok(point.x_px <= result.bounds_px.x_max + 1e-9);
      assert.ok(point.y_px >= result.bounds_px.y_min - 1e-9);
      assert.ok(point.y_px <= result.bounds_px.y_max + 1e-9);
    }
  }
  assert.ok(result.bounds_px.x_max > result.bounds_px.x_min);
});

test("guardrails never span the entrance or exit width", () => {
  for (const shape of ["straight", "L", "U"]) {
    const input = stair({
      shape,
      end_px: shape === "straight" ? { x_px: 30, y_px: 40 } : { x_px: 24, y_px: 24 },
      heading_rad: 0,
      steps: 10,
      flight_run_m: shape === "U" ? 3 : null,
    });
    const result = resolveStairGeometry(input, SCALE);
    assert.equal(result.ok, true);
    for (const edge of result.guardrail_edges) {
      assert.ok(!segmentConnected(edge.start_px, result.route_px[0]));
      assert.ok(!segmentConnected(edge.end_px, result.route_px.at(-1)));
    }
  }
});

test("isParametricStair discriminates only template_version 1", () => {
  assert.equal(isParametricStair(stair()), true);
  assert.equal(isParametricStair({ width_m: 2 }), false);
  assert.equal(isParametricStair({ template_version: 2 }), false);
  assert.equal(isParametricStair(null), false);
});

test("footprint areas are finite positive for L and U", () => {
  for (const shape of ["L", "U"]) {
    const input = stair({
      shape,
      end_px: { x_px: 24, y_px: 24 },
      heading_rad: 0,
      steps: 10,
      flight_run_m: shape === "U" ? 3 : null,
    });
    const result = resolveStairGeometry(input, SCALE);
    assert.equal(result.ok, true);
    for (const poly of result.footprint_px) {
      assert.ok(polygonArea(poly) > 0);
    }
  }
});

test("U landing does not overlap either flight at default depth", () => {
  const result = resolveStairGeometry(
    stair({
      shape: "U",
      start_px: { x_px: 0, y_px: 0 },
      end_px: { x_px: 0, y_px: 24 },
      heading_rad: 0,
      turn: "right",
      flight_run_m: 3,
      steps: 12,
      height_m: 3.6,
    }),
    SCALE
  );
  assert.equal(result.ok, true);
  for (const flight of result.flights) {
    assert.equal(polygonsOverlapArea(result.landings[0].footprint_px, flight.footprint_px), 0);
  }
});

test("default_heading_is_derived_when_heading_is_omitted", () => {
  for (const [shape, end, turn] of [
    ["L", { x_px: 50, y_px: 50 }, "right"],
    ["L", { x_px: 124, y_px: 100 }, "right"],
    ["U", { x_px: 0, y_px: 24 }, "right"],
    ["U", { x_px: 0, y_px: -24 }, "left"],
  ]) {
    const input = stair({
      shape,
      start_px: { x_px: 100, y_px: 100 },
      end_px: { x_px: 100 + end.x_px, y_px: 100 + end.y_px },
      turn,
      steps: 12,
      flight_run_m: shape === "U" ? 3 : null,
    });
    delete input.heading_rad;
    const result = resolveStairGeometry(input, SCALE);
    assert.equal(result.ok, true, `${shape}-${turn}-${JSON.stringify(end)}`);
  }
});

test("assistance_off_does_not_auto_merge_sub_pixel_endpoints", () => {
  const project = {
    metadata: { scale_px_per_meter: 10 },
    nodes: [{ id: "n1", x_px: 0, y_px: 0 }],
    walls: [],
  };
  const preview = computeWallPreview({
    startPx: { x_px: 0.5, y_px: 0 },
    endPx: { x_px: 40, y_px: 30 },
    viewScale: 6,
    mode: "manual",
    assistance: { endpointSnap: false, ortho: false },
    guides: [],
    project,
  });
  assert.equal(preview.connections.start.type, "free");
  assert.equal(preview.startPx.x_px, 0.5);
});
