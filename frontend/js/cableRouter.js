/**
 * Sitestry.AI — Stage 5 Automatic Cabling & Cooling Route Solver (pure, no DOM).
 *
 * Computes Source -> Target routes over eligible `cable_trays` (`power` | `data` | `unified`)
 * or `pipe_runs` (`cooling`), using Dijkstra shortest path, orthogonal wall-hugging fallback,
 * deterministic lateral lane offsets on shared trays, and 3D waterfall drop coordinates.
 */

import { getEquipmentPreset } from "./equipmentCatalog.js";
import { normalizeTrayService } from "./trayNetwork.js";

export const CABLE_SYSTEMS = ["power", "grounding", "link", "cooling", "security"];

export const CABLE_SYSTEM_LABELS = {
  power: "Power",
  grounding: "Grounding",
  link: "Link (Antar Lantai)",
  cooling: "Cooling (Pipe)",
  security: "Security",
};

export const WATERFALL_STYLES = ["tray_waterfall", "direct"];

export const WATERFALL_STYLE_LABELS = {
  tray_waterfall: "Tray Waterfall",
  direct: "Direct Drop",
};

const INFRA_SNAP_RADIUS_M = 3.0;
const WALL_SEARCH_RADIUS_M = 4.5;

const SYSTEM_COLORS = {
  powerA: "#dc2626",
  powerB: "#2563eb",
  grounding: "#16a34a",
  linkData: "#eab308",
  linkPower: "#f97316",
  cooling: "#06b6d4",
  security: "#9333ea",
};

const SYSTEM_PRIORITY = {
  powerA: 0,
  powerB: 1,
  grounding: 2,
  link: 3,
  security: 4,
};

const LANE_OFFSETS_M = {
  powerA: -0.1,
  powerB: -0.04,
  grounding: 0.16,
  link: 0.04,
  security: 0.1,
  cooling: 0.0,
};

export function cableColorFor(cable, source = null, target = null) {
  if (cable?.color) return cable.color;
  const sys = cable?.system || "power";
  if (sys === "power") return cable?.path_label === "B" ? SYSTEM_COLORS.powerB : SYSTEM_COLORS.powerA;
  if (sys === "grounding") return SYSTEM_COLORS.grounding;
  if (sys === "cooling") return SYSTEM_COLORS.cooling;
  if (sys === "security") return SYSTEM_COLORS.security;
  if (sys === "link") {
    const isPowerRiser = source?.subtype === "power_riser" || target?.subtype === "power_riser";
    return isPowerRiser ? SYSTEM_COLORS.linkPower : SYSTEM_COLORS.linkData;
  }
  return SYSTEM_COLORS.powerA;
}

function systemLaneKey(cable) {
  const sys = cable?.system || "power";
  return sys === "power" ? (cable?.path_label === "B" ? "powerB" : "powerA") : sys;
}

/**
 * Compute parallel horizontal offset & vertical tier inside a tray so multiple cables
 * of the same or different systems bundle neatly side-by-side and stack cleanly.
 */
function computeTrayBundleSlot(project, cable, trayWidthM = 0.5, scale = 30.68) {
  const allTrayCables = (project?.cables || []).filter((c) => c && c.system !== "cooling");
  const idx = allTrayCables.findIndex((c) => c.id === cable?.id);
  if (allTrayCables.length <= 1 || idx === -1) {
    return { offsetPx: (LANE_OFFSETS_M[systemLaneKey(cable)] ?? 0) * scale, tier: 0 };
  }

  const ordered = allTrayCables
    .map((c, order) => ({ c, key: systemLaneKey(c), order }))
    .sort((a, b) => (SYSTEM_PRIORITY[a.key] ?? 9) - (SYSTEM_PRIORITY[b.key] ?? 9) || a.order - b.order);

  const slot = Math.max(0, ordered.findIndex((item) => item.c.id === cable.id));
  const usableW = Math.max(0.24, (Number(trayWidthM) || 0.5) - 0.08);
  const spacing = 0.045;
  const cols = Math.max(3, Math.floor(usableW / spacing) + 1);
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  const rowCount = Math.min(cols, ordered.length - row * cols);
  const centeredOffsetM = (col - (rowCount - 1) / 2) * spacing;
  return { offsetPx: centeredOffsetM * scale, tier: row };
}

export function normalizeWaterfallStyle(style) {
  return WATERFALL_STYLES.includes(style) ? style : "tray_waterfall";
}

function equipmentConnectionZ(eq) {
  const preset = getEquipmentPreset(eq?.subtype || eq?.category);
  const elev = Number(eq?.elevation_m) || 0;
  const h = Number(eq?.height_m) || preset.h || 2.0;
  const mount = eq?.mount || preset.mount || "floor";
  if (mount === "floor") return elev + h;
  return elev + h * 0.5;
}

function eligibleServicesForCable(cable, source, target) {
  const sys = cable?.system || "power";
  if (sys === "cooling") return null; // Uses pipe_runs, never cable_trays
  if (sys === "power" || sys === "grounding") return new Set(["power", "unified"]);
  if (sys === "security") return new Set(["data", "unified"]);
  if (sys === "link") {
    const isPowerRiser = source?.subtype === "power_riser" || target?.subtype === "power_riser";
    return new Set([isPowerRiser ? "power" : "data", "unified"]);
  }
  return new Set(["unified"]);
}

function closestPointOnRuns(x, y, runs, nodeById) {
  let best = null;
  for (const run of runs) {
    const ids = run.node_ids || [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = nodeById.get(ids[i]);
      const b = nodeById.get(ids[i + 1]);
      if (!a || !b) continue;
      const dx = b.x_px - a.x_px;
      const dy = b.y_px - a.y_px;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x_px) * dx + (y - a.y_px) * dy) / len2));
      const px = a.x_px + dx * t;
      const py = a.y_px + dy * t;
      const dist = Math.hypot(x - px, y - py);
      if (!best || dist < best.dist) {
        best = { run, segIndex: i, t, x: px, y: py, dist, aId: ids[i], bId: ids[i + 1] };
      }
    }
  }
  return best;
}

function buildGraphWithPortals(runs, baseNodeById, srcHit, tgtHit) {
  const nodes = new Map();
  for (const [id, n] of baseNodeById) nodes.set(id, { id, x: n.x_px, y: n.y_px, z: null });
  const adj = new Map();
  const addEdge = (u, v, elev) => {
    const nu = nodes.get(u);
    const nv = nodes.get(v);
    if (!nu || !nv || u === v) return;
    const w = Math.hypot(nv.x - nu.x, nv.y - nu.y);
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u).push({ to: v, w, elev });
    adj.get(v).push({ to: u, w, elev });
  };

  // Split segments that host srcHit or tgtHit so Dijkstra reaches exact projection points.
  const splitsBySeg = new Map();
  const registerSplit = (portalId, hit) => {
    nodes.set(portalId, { id: portalId, x: hit.x, y: hit.y, z: Number(hit.run.elevation_m) });
    const key = `${hit.run.id}:${hit.segIndex}`;
    if (!splitsBySeg.has(key)) splitsBySeg.set(key, []);
    splitsBySeg.get(key).push({ id: portalId, t: hit.t });
  };
  if (srcHit) registerSplit("__src__", srcHit);
  if (tgtHit) registerSplit("__tgt__", tgtHit);

  for (const run of runs) {
    const ids = run.node_ids || [];
    const elev = Number(run.elevation_m ?? 3.35);
    for (let i = 0; i < ids.length - 1; i++) {
      const key = `${run.id}:${i}`;
      const splits = (splitsBySeg.get(key) || []).slice().sort((p, q) => p.t - q.t);
      const chain = [ids[i], ...splits.map((s) => s.id), ids[i + 1]];
      for (let k = 0; k < chain.length - 1; k++) {
        addEdge(chain[k], chain[k + 1], elev);
      }
    }
  }

  return { nodes, adj };
}

function dijkstra(adj, startId, goalId) {
  if (!adj.has(startId) || !adj.has(goalId)) return null;
  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const queue = [{ id: startId, d: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const cur = queue.shift();
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    if (cur.id === goalId) break;
    for (const edge of adj.get(cur.id) || []) {
      const nd = cur.d + edge.w;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, { from: cur.id, elev: edge.elev });
        queue.push({ id: edge.to, d: nd });
      }
    }
  }

  if (!prev.has(goalId) && startId !== goalId) return null;
  const path = [];
  let cur = goalId;
  while (cur) {
    const step = prev.get(cur);
    path.unshift({ id: cur, elev: step?.elev ?? null });
    cur = step?.from;
  }
  return path;
}

function nearestWallDist(x, y, walls, wallNodeById) {
  let best = Infinity;
  let proj = null;
  for (const w of walls || []) {
    const a = wallNodeById.get(w.start_node);
    const b = wallNodeById.get(w.end_node);
    if (!a || !b) continue;
    const dx = b.x_px - a.x_px;
    const dy = b.y_px - a.y_px;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x_px) * dx + (y - a.y_px) * dy) / len2));
    const px = a.x_px + dx * t;
    const py = a.y_px + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      proj = { x: px, y: py, d };
    }
  }
  return proj;
}

/** Orthogonal L/wall-hugging path between two 2D points (never diagonal across open floor). */
function orthogonalPath(ax, ay, bx, by, walls, wallNodeById, maxWallPx) {
  const pts = [[ax, ay]];
  if (Math.hypot(bx - ax, by - ay) < 0.5) return pts;

  const wA = nearestWallDist(ax, ay, walls, wallNodeById);
  if (wA && wA.d > 2 && wA.d <= maxWallPx) {
    // Orthogonal hop to the nearest wall projection first, then orthogonal toward target
    if (Math.abs(wA.x - ax) > 0.5 && Math.abs(wA.y - ay) > 0.5) {
      pts.push([wA.x, ay]);
    }
    pts.push([wA.x, wA.y]);
    const last = pts[pts.length - 1];
    if (Math.abs(bx - last[0]) > 0.5 && Math.abs(by - last[1]) > 0.5) {
      const opt1 = nearestWallDist(bx, last[1], walls, wallNodeById)?.d ?? Infinity;
      const opt2 = nearestWallDist(last[0], by, walls, wallNodeById)?.d ?? Infinity;
      pts.push(opt1 <= opt2 ? [bx, last[1]] : [last[0], by]);
    }
    pts.push([bx, by]);
    return dedupe2D(pts);
  }

  if (Math.abs(bx - ax) > 0.5 && Math.abs(by - ay) > 0.5) {
    const opt1 = nearestWallDist(bx, ay, walls, wallNodeById)?.d ?? Infinity;
    const opt2 = nearestWallDist(ax, by, walls, wallNodeById)?.d ?? Infinity;
    pts.push(opt1 <= opt2 ? [bx, ay] : [ax, by]);
  }
  pts.push([bx, by]);
  return dedupe2D(pts);
}

function dedupe2D(pts) {
  const out = [];
  for (const [x, y] of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(x - prev[0], y - prev[1]) > 0.25) out.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  return out;
}

function applyLaneOffset(pts, offsetPx) {
  if (!offsetPx || pts.length < 2) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = i < pts.length - 1 ? pts[i + 1] : pts[i - 1];
    const dx = i < pts.length - 1 ? nx - x : x - nx;
    const dy = i < pts.length - 1 ? ny - y : y - ny;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
      out.push([x, y]);
    } else {
      const px = (-dy / len) * offsetPx;
      const py = (dx / len) * offsetPx;
      out.push([Math.round((x + px) * 10) / 10, Math.round((y + py) * 10) / 10]);
    }
  }
  return out;
}

/**
 * Compute the 2D & 3D route, length in meters, and waterfall drops for a single cable connection.
 */
export function resolveCableRoute(project, cable) {
  const empty = {
    points2d_px: [],
    points3d: [],
    length_m: 0,
    waterfalls: [],
    fallback_used: false,
    eligible_infra: "none",
  };
  const byEqId = new Map((project.equipments || []).map((e) => [e.id, e]));
  const source = byEqId.get(cable?.source_id);
  const target = byEqId.get(cable?.target_id);
  if (!source || !target) return empty;

  const scale = Number(project?.metadata?.scale_px_per_meter) || 30.68;
  const snapPx = INFRA_SNAP_RADIUS_M * scale;
  const maxWallPx = WALL_SEARCH_RADIUS_M * scale;
  const wallNodeById = new Map((project.nodes || []).map((n) => [n.id, n]));
  const walls = project.walls || [];

  const isCooling = cable?.system === "cooling";
  const services = eligibleServicesForCable(cable, source, target);
  const runs = isCooling
    ? project.pipe_runs || []
    : (project.cable_trays || []).filter((t) => services.has(normalizeTrayService(t.service)));
  const rawNodes = isCooling ? project.pipe_nodes || [] : project.tray_nodes || [];
  const nodeById = new Map(rawNodes.map((n) => [n.id, n]));

  const srcZ = equipmentConnectionZ(source);
  const tgtZ = equipmentConnectionZ(target);

  const srcHit = runs.length ? closestPointOnRuns(source.x_px, source.y_px, runs, nodeById) : null;
  const tgtHit = runs.length ? closestPointOnRuns(target.x_px, target.y_px, runs, nodeById) : null;

  let infraPoints = null;
  let infraElev = null;
  if (srcHit && tgtHit) {
    const { nodes, adj } = buildGraphWithPortals(runs, nodeById, srcHit, tgtHit);
    const path = dijkstra(adj, "__src__", "__tgt__");
    if (path && path.length >= 1) {
      infraPoints = path.map((p) => {
        const n = nodes.get(p.id);
        return [n.x, n.y];
      });
      infraElev = Number(srcHit.run.elevation_m ?? (isCooling ? 0.15 : 3.35));
    }
  }

  // Fallback when no connected infrastructure exists
  if (!infraPoints) {
    const pts2d = orthogonalPath(source.x_px, source.y_px, target.x_px, target.y_px, walls, wallNodeById, maxWallPx);
    const runElev = isCooling ? 0.15 : Math.max(srcZ, tgtZ, 0.3);
    const points3d = [
      { x_px: source.x_px, y_px: source.y_px, y_m: srcZ },
      ...pts2d.map(([x_px, y_px]) => ({ x_px, y_px, y_m: runElev })),
      { x_px: target.x_px, y_px: target.y_px, y_m: tgtZ },
    ];
    return {
      points2d_px: pts2d,
      points3d,
      length_m: Math.round(polyline3DLengthM(points3d, scale) * 100) / 100,
      waterfalls: [],
      fallback_used: true,
      eligible_infra: "wall_direct",
    };
  }

  const slot = isCooling ? { offsetPx: 0, tier: 0 } : computeTrayBundleSlot(project, cable, srcHit.run.width_m, scale);
  const offsetInfra = applyLaneOffset(dedupe2D(infraPoints), slot.offsetPx);
  const entryPt = offsetInfra[0];
  const exitPt = offsetInfra[offsetInfra.length - 1];

  // Seat non-cooling cables neatly inside the tray trough rather than floating on top of the side wall
  if (!isCooling) {
    const sideH = Number(srcHit.run.height_m ?? 0.1);
    const floorElev = infraElev - sideH + 0.024 + slot.tier * 0.032;
    infraElev = Math.min(infraElev - 0.012, Math.max(0.2, floorElev));
  }

  const wfStyle = normalizeWaterfallStyle(cable?.waterfall_style);

  const srcOutside = srcHit.dist > snapPx;
  const tgtOutside = tgtHit.dist > snapPx;
  const fallback_used = srcOutside || tgtOutside;

  const approachSrc = srcOutside
    ? orthogonalPath(source.x_px, source.y_px, entryPt[0], entryPt[1], walls, wallNodeById, maxWallPx)
    : [[source.x_px, source.y_px], entryPt];
  const approachTgt = tgtOutside
    ? orthogonalPath(exitPt[0], exitPt[1], target.x_px, target.y_px, walls, wallNodeById, maxWallPx)
    : [exitPt, [target.x_px, target.y_px]];

  const points2d_px = dedupe2D([...approachSrc, ...offsetInfra, ...approachTgt]);

  const unitDir = (fromPt, toPt) => {
    const dx = toPt[0] - fromPt[0];
    const dy = toPt[1] - fromPt[1];
    const len = Math.hypot(dx, dy);
    return len > 1e-4 ? { x: dx / len, y: dy / len } : { x: 0, y: 1 };
  };

  const waterfalls = [];
  const points3d = [];
  const lipPx = wfStyle === "tray_waterfall" && !isCooling ? 0.12 * scale : 0;
  for (const [x_px, y_px] of approachSrc.slice(0, -1)) {
    points3d.push({ x_px, y_px, y_m: srcZ });
  }
  if (Math.abs(infraElev - srcZ) > 0.05) {
    const prevApproach = approachSrc[approachSrc.length - 2] || [source.x_px, source.y_px];
    const outDir = unitDir(entryPt, prevApproach);
    if (!isCooling) {
      waterfalls.push({
        x_px: entryPt[0],
        y_px: entryPt[1],
        z_top_m: Math.max(infraElev, srcZ),
        z_bottom_m: Math.min(infraElev, srcZ),
        style: wfStyle,
        out_x: outDir.x,
        out_y: outDir.y,
      });
    }
    const lx = entryPt[0] + outDir.x * lipPx;
    const ly = entryPt[1] + outDir.y * lipPx;
    points3d.push({ x_px: lx, y_px: ly, y_m: srcZ });
    if (lipPx > 0) {
      points3d.push({ x_px: lx, y_px: ly, y_m: infraElev - 0.04 });
    }
    points3d.push({ x_px: entryPt[0], y_px: entryPt[1], y_m: infraElev });
  } else {
    points3d.push({ x_px: entryPt[0], y_px: entryPt[1], y_m: infraElev });
  }
  for (const [x_px, y_px] of offsetInfra.slice(1, -1)) {
    points3d.push({ x_px, y_px, y_m: infraElev });
  }
  points3d.push({ x_px: exitPt[0], y_px: exitPt[1], y_m: infraElev });
  if (Math.abs(infraElev - tgtZ) > 0.05) {
    const nextApproach = approachTgt[1] || [target.x_px, target.y_px];
    const outDir = unitDir(exitPt, nextApproach);
    if (!isCooling) {
      waterfalls.push({
        x_px: exitPt[0],
        y_px: exitPt[1],
        z_top_m: Math.max(infraElev, tgtZ),
        z_bottom_m: Math.min(infraElev, tgtZ),
        style: wfStyle,
        out_x: outDir.x,
        out_y: outDir.y,
      });
    }
    const lx = exitPt[0] + outDir.x * lipPx;
    const ly = exitPt[1] + outDir.y * lipPx;
    if (lipPx > 0) {
      points3d.push({ x_px: lx, y_px: ly, y_m: infraElev - 0.04 });
    }
    points3d.push({ x_px: lx, y_px: ly, y_m: tgtZ });
  } else {
    points3d.push({ x_px: exitPt[0], y_px: exitPt[1], y_m: tgtZ });
  }
  for (const [x_px, y_px] of approachTgt.slice(1)) {
    points3d.push({ x_px, y_px, y_m: tgtZ });
  }

  return {
    points2d_px,
    points3d,
    length_m: Math.round(polyline3DLengthM(points3d, scale) * 100) / 100,
    waterfalls,
    fallback_used,
    eligible_infra: isCooling ? "pipe" : "tray",
  };
}

function polyline3DLengthM(pts, scale) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = (pts[i + 1].x_px - pts[i].x_px) / scale;
    const dz = (pts[i + 1].y_px - pts[i].y_px) / scale;
    const dy = pts[i + 1].y_m - pts[i].y_m;
    total += Math.hypot(dx, dy, dz);
  }
  return total;
}
