import test from "node:test";
import assert from "node:assert/strict";
import {
  CABLE_SYSTEMS,
  cableColorFor,
  resolveCableRoute,
  resolveWaterfallGroups,
} from "../../frontend/js/cableRouter.js";
import { insertTrayRun } from "../../frontend/js/trayNetwork.js";
import { insertPipeRun } from "../../frontend/js/pipeNetwork.js";

function baseProject() {
  return {
    metadata: { scale_px_per_meter: 20, default_wall_height_m: 3.8 },
    nodes: [
      { id: "n1", x_px: 0, y_px: 0 },
      { id: "n2", x_px: 400, y_px: 0 },
    ],
    walls: [{ id: "w1", start_node: "n1", end_node: "n2", thickness_m: 0.15, height_m: 3.8, type: "solid" }],
    equipments: [
      { id: "panel1", name: "Panel", category: "panel", domain_group: "power", subtype: "panel", mount: "floor", x_px: 40, y_px: 80, width_m: 1.0, depth_m: 0.6, height_m: 2.0, elevation_m: 0 },
      { id: "rack1", name: "Rack", category: "rack", domain_group: "rack", subtype: "rack", mount: "floor", x_px: 300, y_px: 80, width_m: 0.6, depth_m: 1.1, height_m: 2.1, elevation_m: 0.45 },
      { id: "chiller1", name: "Chiller", category: "chiller", domain_group: "cooling", subtype: "chiller", mount: "floor", x_px: 40, y_px: 200, width_m: 2.0, depth_m: 1.0, height_m: 2.0, elevation_m: 0 },
      { id: "pac1", name: "PAC", category: "pac", domain_group: "cooling", subtype: "pac", mount: "floor", x_px: 300, y_px: 200, width_m: 1.8, depth_m: 0.9, height_m: 2.15, elevation_m: 0.45 },
      { id: "cctv1", name: "CCTV", category: "cctv", domain_group: "security", subtype: "cctv", mount: "wall", x_px: 280, y_px: 0, width_m: 0.25, depth_m: 0.25, height_m: 0.22, elevation_m: 2.9 },
    ],
    cable_trays: [],
    tray_nodes: [],
    pipe_runs: [],
    pipe_nodes: [],
  };
}

test("CABLE_SYSTEMS and cableColorFor cover all 5 systems and power path A/B", () => {
  assert.deepEqual(CABLE_SYSTEMS, ["power", "grounding", "link", "cooling", "security"]);
  assert.equal(cableColorFor({ system: "power", path_label: "A" }), "#dc2626");
  assert.equal(cableColorFor({ system: "power", path_label: "B" }), "#2563eb");
  assert.equal(cableColorFor({ system: "grounding" }), "#16a34a");
  assert.equal(cableColorFor({ system: "cooling" }), "#06b6d4");
  assert.equal(cableColorFor({ system: "security" }), "#9333ea");
});

test("power cable routes over power/unified tray, skips data-only tray, and creates waterfalls", () => {
  const proj = baseProject();
  insertTrayRun(proj, [[40, 60], [300, 60]], { id: "t_pwr", service: "power", elevation_m: 3.25 }, 1);
  insertTrayRun(proj, [[40, 40], [300, 40]], { id: "t_dat", service: "data", elevation_m: 3.45 }, 1);

  const route = resolveCableRoute(proj, { id: "c1", system: "power", path_label: "A", source_id: "panel1", target_id: "rack1" });
  assert.equal(route.eligible_infra, "tray");
  assert.equal(route.fallback_used, false);
  assert.equal(route.waterfalls.length, 2);
  assert.ok(route.length_m > 12);
  // 2D path traverses the power tray at y=60 (shifted slightly by lateral lane offset)
  assert.ok(route.points2d_px.some(([, y]) => Math.abs(y - 60) < 5));
});

test("security cable routes over data/unified tray and ignores power-only tray", () => {
  const proj = baseProject();
  insertTrayRun(proj, [[40, 60], [300, 60]], { id: "t_pwr", service: "power", elevation_m: 3.25 }, 1);
  insertTrayRun(proj, [[280, 20], [300, 20], [300, 70]], { id: "t_dat", service: "data", elevation_m: 3.45 }, 1);

  const route = resolveCableRoute(proj, { id: "c2", system: "security", source_id: "rack1", target_id: "cctv1" });
  assert.equal(route.eligible_infra, "tray");
  assert.equal(route.fallback_used, false);
  assert.ok(route.points2d_px.some(([, y]) => Math.abs(y - 20) < 5));
});

test("cooling connection routes over pipe_runs and never uses cable_trays", () => {
  const proj = baseProject();
  insertTrayRun(proj, [[40, 60], [300, 60]], { id: "t_uni", service: "unified", elevation_m: 3.35 }, 1);
  insertPipeRun(proj, [[40, 190], [300, 190]], { id: "p1", mounting: "underfloor", elevation_m: 0.15 }, 1);

  const route = resolveCableRoute(proj, { id: "c3", system: "cooling", source_id: "chiller1", target_id: "pac1" });
  assert.equal(route.eligible_infra, "pipe");
  assert.equal(route.fallback_used, false);
  assert.ok(route.points2d_px.some(([, y]) => Math.abs(y - 190) < 3));
});

test("orthogonal wall-hugging fallback engages when no eligible tray exists", () => {
  const proj = baseProject();
  const route = resolveCableRoute(proj, { id: "c4", system: "power", source_id: "panel1", target_id: "rack1" });
  assert.equal(route.eligible_infra, "wall_direct");
  assert.equal(route.fallback_used, true);
  // Orthogonal path has only horizontal/vertical segments (no diagonal straight cut)
  assert.ok(route.points2d_px.length >= 3);
  for (let i = 0; i < route.points2d_px.length - 1; i++) {
    const [x1, y1] = route.points2d_px[i];
    const [x2, y2] = route.points2d_px[i + 1];
    assert.ok(Math.abs(x1 - x2) < 0.2 || Math.abs(y1 - y2) < 0.2, "fallback segments must be orthogonal");
  }
});

test("power and grounding sharing the same tray receive distinct lateral lane offsets", () => {
  const proj = baseProject();
  insertTrayRun(proj, [[40, 80], [300, 80]], { id: "t1", service: "unified", elevation_m: 3.35 }, 1);
  const pwr = resolveCableRoute(proj, { id: "c_p", system: "power", path_label: "A", source_id: "panel1", target_id: "rack1" });
  const gnd = resolveCableRoute(proj, { id: "c_g", system: "grounding", source_id: "panel1", target_id: "rack1" });
  assert.notEqual(pwr.points2d_px[1][1], gnd.points2d_px[1][1]);
});

test("multiple cables of the same system bundle side-by-side neatly and share edge-mounted Tray Waterfall groups", () => {
  const proj = baseProject();
  insertTrayRun(proj, [[40, 60], [300, 60]], { id: "t1", type: "ladder", service: "power", width_m: 0.5, elevation_m: 3.25 }, 1);
  const c1 = { id: "cp1", system: "power", path_label: "A", source_id: "panel1", target_id: "rack1" };
  const c2 = { id: "cp2", system: "power", path_label: "A", source_id: "panel1", target_id: "rack1" };
  const c3 = { id: "cp3", system: "power", path_label: "A", source_id: "panel1", target_id: "rack1", waterfall_style: "direct" };
  proj.cables = [c1, c2, c3];

  const groups = resolveWaterfallGroups(proj);
  // c1 and c2 share 1 entry group at x≈40 and 1 exit group at x≈300 (c3 is direct)
  assert.equal(groups.length, 2);
  assert.equal(groups[0].cableCount, 2);
  assert.equal(groups[0].trayType, "ladder");
  assert.equal(groups[0].trayService, "power");
  // Edge-mounted at tray center (y=60) + halfWidth (0.25m * 20px/m = 5px) -> y=65
  assert.ok(Math.abs(groups[0].y_px - 65) < 0.5);

  const r1 = resolveCableRoute(proj, c1, groups);
  const r2 = resolveCableRoute(proj, c2, groups);
  const r3 = resolveCableRoute(proj, c3, groups);
  const ys = new Set([
    r1.points2d_px.find(([x]) => Math.abs(x - 170) < 10 || x > 50)?.[1] ?? r1.points2d_px[2][1],
    r2.points2d_px.find(([x]) => Math.abs(x - 170) < 10 || x > 50)?.[1] ?? r2.points2d_px[2][1],
    r3.points2d_px[1][1],
  ]);
  assert.equal(ys.size, 3);
  assert.equal(r1.waterfalls[0].style, "tray_waterfall");
  assert.equal(r1.waterfalls[0].groupId, groups[0].id);
  assert.equal(r3.waterfalls[0].style, "direct");
});
