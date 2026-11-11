/**
 * Sitestry.AI — Shared parametric staircase resolver.
 *
 * Pure geometry: no DOM, Konva, or Three.js. Preview, 2D, 3D, bounds, handles,
 * and GLB export all consume this one resolver so flights, risers, and
 * elevations cannot disagree.
 *
 * Canonical geometry stays in source pixels; physical dimensions in meters.
 * Canvas coordinates use y-down, matching the 2D drawing.
 */

export const STAIR_TEMPLATE_VERSION = 1;
export const STAIR_MIN_RISERS = 4;
export const STAIR_MAX_RISERS = 128;
export const STAIR_DEFAULT_WIDTH_M = 1.2;
export const STAIR_DEFAULT_LANDING_M = 1.2;
export const STAIR_DEFAULT_RISER_M = 0.175;
export const STAIR_DEFAULT_U_RUN_M = 0.28;
export const STAIR_EPSILON = 1e-6;

const SIGN = { right: 1, left: -1 };

export function isParametricStair(stair) {
  return Boolean(stair) && stair.template_version === STAIR_TEMPLATE_VERSION;
}

export function toPoint(point) {
  if (!point) return null;
  const x = Number(point.x_px ?? point.x);
  const y = Number(point.y_px ?? point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x_px: x, y_px: y };
}

function fail(code, field, message) {
  return { ok: false, code, field, message };
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function basis(headingRad, turn) {
  const ux = Math.cos(headingRad);
  const uy = Math.sin(headingRad);
  const sign = SIGN[turn];
  return { u: { x: ux, y: uy }, v: { x: sign * -uy, y: sign * ux }, sign };
}

function at(origin, u, v, along, across, scale) {
  return {
    x_px: origin.x_px + (u.x * along + v.x * across) * scale,
    y_px: origin.y_px + (u.y * along + v.y * across) * scale,
  };
}

function quad(origin, u, v, a0, a1, c0, c1, scale) {
  return [
    at(origin, u, v, a0, c0, scale),
    at(origin, u, v, a1, c0, scale),
    at(origin, u, v, a1, c1, scale),
    at(origin, u, v, a0, c1, scale),
  ];
}

function polygonCentroid(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x_px ?? point[0];
    y += point.y_px ?? point[1];
  }
  return { x: x / points.length, y: y / points.length };
}

function boundsOf(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const point of polygon) {
      const x = point.x_px ?? point[0];
      const y = point.y_px ?? point[1];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { x_min: minX, y_min: minY, x_max: maxX, y_max: maxY };
}

function splitRisers(total, run1, run2) {
  const safeTotal = Math.max(STAIR_MIN_RISERS, total);
  let n1 = Math.round((safeTotal * run1) / (run1 + run2));
  n1 = Math.max(2, Math.min(safeTotal - 2, n1));
  return [n1, safeTotal - n1];
}

function buildFlight({
  index,
  origin,
  u,
  v,
  laneAcross,
  alongStart,
  alongEnd,
  widthM,
  risers,
  startElevation,
  riserHeight,
  scale,
}) {
  const runM = Math.abs(alongEnd - alongStart);
  const treadRun = runM / risers;
  const treads = [];
  for (let i = 0; i < risers; i += 1) {
    const a0 = alongStart + Math.sign(alongEnd - alongStart) * treadRun * i;
    const a1 = alongStart + Math.sign(alongEnd - alongStart) * treadRun * (i + 1);
    const poly = quad(
      origin,
      u,
      v,
      Math.min(a0, a1),
      Math.max(a0, a1),
      laneAcross - widthM / 2,
      laneAcross + widthM / 2,
      scale
    );
    treads.push({
      index: i + 1,
      elevation_m: startElevation + riserHeight * (i + 1),
      run_m: treadRun,
      footprint_px: poly,
    });
  }
  const first = at(origin, u, v, alongStart, laneAcross, scale);
  const last = at(origin, u, v, alongEnd, laneAcross, scale);
  const footprint = quad(
    origin,
    u,
    v,
    Math.min(alongStart, alongEnd),
    Math.max(alongStart, alongEnd),
    laneAcross - widthM / 2,
    laneAcross + widthM / 2,
    scale
  );
  const sideOffset = widthM / 2;
  const guardrail_edges = [
    {
      start_px: at(origin, u, v, alongStart, laneAcross - sideOffset, scale),
      end_px: at(origin, u, v, alongEnd, laneAcross - sideOffset, scale),
      start_elevation_m: startElevation,
      end_elevation_m: startElevation + risers * riserHeight,
    },
    {
      start_px: at(origin, u, v, alongStart, laneAcross + sideOffset, scale),
      end_px: at(origin, u, v, alongEnd, laneAcross + sideOffset, scale),
      start_elevation_m: startElevation,
      end_elevation_m: startElevation + risers * riserHeight,
    },
  ];
  return {
    index,
    start_px: first,
    end_px: last,
    direction_rad: Math.atan2(u.y, u.x) + (alongEnd < alongStart ? Math.PI : 0),
    run_m: runM,
    width_m: widthM,
    risers,
    start_elevation_m: startElevation,
    end_elevation_m: startElevation + risers * riserHeight,
    footprint_px: footprint,
    treads,
    guardrail_edges,
  };
}

export function computeDefaultHeading(startPx, endPx, shape, turn) {
  const start = toPoint(startPx);
  const end = toPoint(endPx);
  if (!start || !end) return 0;
  const sign = SIGN[turn] ?? 1;
  const angle = Math.atan2(end.y_px - start.y_px, end.x_px - start.x_px);
  if (shape === "straight") return angle;
  if (shape === "L") return angle - sign * (Math.PI / 4);
  if (shape === "U") return angle - sign * (Math.PI / 2);
  return angle;
}

function validateCommon(stair, scale) {
  if (!finitePositive(scale)) return fail("invalid_scale", "scalePxPerMeter", "Scale must be a positive finite number.");
  if (!stair || typeof stair !== "object") return fail("invalid_schema", "stair", "Stair object is required.");
  if (stair.template_version === undefined || stair.template_version === null) {
    return fail("legacy_stair", "template_version", "Legacy stair without a template discriminator uses the legacy renderer.");
  }
  if (stair.template_version !== STAIR_TEMPLATE_VERSION) {
    return fail("unsupported_template_version", "template_version", "Only template_version 1 is supported.");
  }
  const shape = stair.shape;
  if (!["straight", "L", "U"].includes(shape)) return fail("invalid_schema", "shape", "shape must be straight, L, or U.");
  const start = toPoint(stair.start_px);
  const end = toPoint(stair.end_px);
  if (!start || !end) return fail("invalid_schema", "start_px", "start_px and end_px must be finite PointPx values.");
  if (Math.hypot(end.x_px - start.x_px, end.y_px - start.y_px) < STAIR_EPSILON) {
    return fail("degenerate_endpoints", "end_px", "Lower and upper endpoints must differ.");
  }
  if (!finitePositive(stair.width_m)) return fail("invalid_width", "width_m", "width_m must be positive.");
  if (!finitePositive(stair.height_m)) return fail("invalid_height", "height_m", "height_m must be positive.");
  const steps = Number(stair.steps);
  if (!Number.isInteger(steps) || steps < STAIR_MIN_RISERS || steps > STAIR_MAX_RISERS) {
    return fail("invalid_steps", "steps", `steps must be an integer ${STAIR_MIN_RISERS}..${STAIR_MAX_RISERS}.`);
  }
  if (!["left", "right"].includes(stair.turn)) return fail("invalid_turn", "turn", "turn must be left or right.");
  const landing = Number(stair.landing_depth_m);
  if (!finitePositive(landing)) return fail("invalid_landing", "landing_depth_m", "landing_depth_m must be positive.");
  if (landing + STAIR_EPSILON < Number(stair.width_m)) {
    return fail("landing_too_shallow", "landing_depth_m", "Landing depth must be at least the flight width.");
  }
  return { ok: true, start, end, shape, steps, landing, width: Number(stair.width_m) };
}

function warningsFor(stair, riserHeight, flights) {
  const warnings = [];
  for (const flight of flights) {
    const treadRun = flight.run_m / flight.risers;
    if (riserHeight > 0.19 + STAIR_EPSILON) {
      warnings.push(`Flight ${flight.index}: riser ${riserHeight.toFixed(3)} m exceeds 0.19 m drafting advisory.`);
    }
    if (treadRun < 0.25 - STAIR_EPSILON) {
      warnings.push(`Flight ${flight.index}: tread run ${treadRun.toFixed(3)} m is below 0.25 m drafting advisory.`);
    }
  }
  return warnings;
}

function finish(stair, scale, flights, landings, route, guardrails) {
  const riserHeight = Number(stair.height_m) / Number(stair.steps);
  const polygons = [...flights.map((f) => f.footprint_px), ...landings.map((l) => l.footprint_px)];
  const treads = flights.flatMap((f) => f.treads);
  return {
    ok: true,
    shape: stair.shape,
    flights,
    landings,
    treads,
    route_px: route,
    footprint_px: polygons,
    bounds_px: boundsOf(polygons),
    guardrail_edges: guardrails,
    warnings: warningsFor(stair, riserHeight, flights),
  };
}

export function resolveStairGeometry(stair, scalePxPerMeter) {
  const common = validateCommon(stair, scalePxPerMeter);
  if (!common.ok) return common;
  const { start, end, shape, steps, landing, width } = common;
  const scale = Number(scalePxPerMeter);
  const height = Number(stair.height_m);
  const riserHeight = height / steps;
  const turn = stair.turn;
  const dx = (end.x_px - start.x_px) / scale;
  const dy = (end.y_px - start.y_px) / scale;

  if (shape === "straight") {
    const heading = Math.atan2(dy, dx);
    const { u, v } = basis(heading, turn);
    const run = Math.hypot(dx, dy);
    const flight = buildFlight({
      index: 1,
      origin: start,
      u,
      v,
      laneAcross: 0,
      alongStart: 0,
      alongEnd: run,
      widthM: width,
      risers: steps,
      startElevation: 0,
      riserHeight,
      scale,
    });
    return finish(stair, scale, [flight], [], [start, end], flight.guardrail_edges);
  }

  let heading = Number(stair.heading_rad);
  if (!Number.isFinite(heading)) {
    heading = computeDefaultHeading(start, end, shape, turn);
  }
  const { u, v } = basis(heading, turn);
  const along = dx * u.x + dy * u.y;
  const across = dx * v.x + dy * v.y;

  if (shape === "L") {
    if (along <= landing / 2 + STAIR_EPSILON) {
      return fail("infeasible_flight", "end_px", "First L flight is too short for the landing depth.");
    }
    if (across <= landing / 2 + STAIR_EPSILON) {
      return fail("infeasible_flight", "end_px", "Second L flight is too short for the landing depth.");
    }
    const run1 = along - landing / 2;
    const run2 = across - landing / 2;
    const [n1, n2] = splitRisers(steps, run1, run2);
    const flight1 = buildFlight({
      index: 1,
      origin: start,
      u,
      v,
      laneAcross: 0,
      alongStart: 0,
      alongEnd: run1,
      widthM: width,
      risers: n1,
      startElevation: 0,
      riserHeight,
      scale,
    });
    // The second leg runs along v from the landing centre to the endpoint.
    const elbow = at(start, u, v, along, 0, scale);
    const flight2Aligned = buildFlight({
      index: 2,
      origin: elbow,
      u: v,
      v: { x: -u.x, y: -u.y },
      laneAcross: 0,
      alongStart: landing / 2,
      alongEnd: across,
      widthM: width,
      risers: n2,
      startElevation: n1 * riserHeight,
      riserHeight,
      scale,
    });
    const landingFootprint = quad(
      start,
      u,
      v,
      along - landing / 2,
      along + landing / 2,
      -landing / 2,
      landing / 2,
      scale
    );
    const landingElevation = n1 * riserHeight;
    const landings = [
      {
        index: 1,
        elevation_m: landingElevation,
        depth_m: landing,
        width_m: landing,
        footprint_px: landingFootprint,
      },
    ];
    const guardrails = [
      ...flight1.guardrail_edges,
      ...flight2Aligned.guardrail_edges,
      {
        start_px: at(start, u, v, along - landing / 2, -landing / 2, scale),
        end_px: at(start, u, v, along + landing / 2, -landing / 2, scale),
        start_elevation_m: landingElevation,
        end_elevation_m: landingElevation,
      },
      {
        start_px: at(start, u, v, along + landing / 2, -landing / 2, scale),
        end_px: at(start, u, v, along + landing / 2, landing / 2, scale),
        start_elevation_m: landingElevation,
        end_elevation_m: landingElevation,
      },
    ];
    const route = [
      start,
      at(start, u, v, along - landing / 2, 0, scale),
      at(start, u, v, along, 0, scale),
      at(start, u, v, along, landing / 2, scale),
      end,
    ];
    return finish(stair, scale, [flight1, flight2Aligned], landings, route, guardrails);
  }

  // U-shape: explicit flight run, return flight derived from longitudinal displacement.
  const run1 = Number(stair.flight_run_m);
  if (!finitePositive(run1)) return fail("invalid_flight_run", "flight_run_m", "U stairs require a positive flight_run_m.");
  if (across + STAIR_EPSILON < width) {
    return fail("infeasible_width", "end_px", "U endpoint transversal separation is smaller than the flight width.");
  }
  const run2 = run1 - along;
  if (run2 <= STAIR_EPSILON) {
    return fail("infeasible_flight", "flight_run_m", "Return flight run must be positive; increase flight_run_m or move the endpoint.");
  }
  const [n1, n2] = splitRisers(steps, run1, run2);
  const flight1 = buildFlight({
    index: 1,
    origin: start,
    u,
    v,
    laneAcross: 0,
    alongStart: 0,
    alongEnd: run1,
    widthM: width,
    risers: n1,
    startElevation: 0,
    riserHeight,
    scale,
  });
  const flight2 = buildFlight({
    index: 2,
    origin: start,
    u,
    v,
    laneAcross: across,
    alongStart: run1,
    alongEnd: along,
    widthM: width,
    risers: n2,
    startElevation: n1 * riserHeight,
    riserHeight,
    scale,
  });
  const landingFootprint = quad(
    start,
    u,
    v,
    run1 - landing / 2,
    run1 + landing / 2,
    -width / 2,
    across + width / 2,
    scale
  );
  const landings = [
    {
      index: 1,
      elevation_m: n1 * riserHeight,
      depth_m: landing,
      width_m: across + width,
      footprint_px: landingFootprint,
    },
  ];
  const guardrails = [
    ...flight1.guardrail_edges,
    ...flight2.guardrail_edges,
    {
      start_px: at(start, u, v, run1 - landing / 2, -width / 2, scale),
      end_px: at(start, u, v, run1 + landing / 2, -width / 2, scale),
      start_elevation_m: n1 * riserHeight,
      end_elevation_m: n1 * riserHeight,
    },
    {
      start_px: at(start, u, v, run1 - landing / 2, across + width / 2, scale),
      end_px: at(start, u, v, run1 + landing / 2, across + width / 2, scale),
      start_elevation_m: n1 * riserHeight,
      end_elevation_m: n1 * riserHeight,
    },
  ];
  const route = [
    start,
    at(start, u, v, run1, 0, scale),
    at(start, u, v, run1, across, scale),
    end,
  ];
  return finish(stair, scale, [flight1, flight2], landings, route, guardrails);
}

/**
 * Explicit legacy conversion suggestion. Uses declared width/depth/direction
 * and center position only; never interprets the ambiguous legacy bbox arrays.
 */
export function suggestLegacyConversion(legacy, scalePxPerMeter) {
  if (!legacy || legacy.template_version !== undefined) return null;
  const scale = Number(scalePxPerMeter);
  if (!finitePositive(scale)) return null;
  const width = finitePositive(legacy.width_m) ? Number(legacy.width_m) : STAIR_DEFAULT_WIDTH_M;
  const height = finitePositive(legacy.height_m) ? Number(legacy.height_m) : 3.8;
  const depth = finitePositive(legacy.depth_m) ? Number(legacy.depth_m) : 3.2;
  const steps = Number.isInteger(Number(legacy.steps))
    ? Math.max(STAIR_MIN_RISERS, Math.min(STAIR_MAX_RISERS, Number(legacy.steps)))
    : Math.max(STAIR_MIN_RISERS, Math.round(height / STAIR_DEFAULT_RISER_M));
  const directions = {
    north: -Math.PI / 2,
    east: 0,
    south: Math.PI / 2,
    west: Math.PI,
  };
  const direction = legacy.direction || "north";
  const heading = directions[direction] ?? -Math.PI / 2;
  const cx = Number(legacy.x_px);
  const cy = Number(legacy.y_px);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const half = (depth * scale) / 2;
  return {
    shape: "straight",
    start_px: { x_px: cx - ux * half, y_px: cy - uy * half },
    end_px: { x_px: cx + ux * half, y_px: cy + uy * half },
    width_m: width,
    depth_m: depth,
    height_m: height,
    steps,
    turn: "right",
    heading_rad: heading,
    landing_depth_m: Math.max(width, STAIR_DEFAULT_LANDING_M),
    flight_run_m: null,
    assumed_direction: legacy.direction || "north",
  };
}
