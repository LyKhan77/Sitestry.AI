/**
 * Sitestry.AI — cable tray network helpers (pure, no DOM).
 *
 * Tray constants and defaults, vertex snapping for drawing, and the shared-vertex tray graph.
 */

import {
  addGraphNode,
  graphRunLengthM,
  graphRunPoints,
  insertGraphRun,
  nearestGraphAnchor,
  nearestGraphNode,
  pruneGraphNodes,
} from "./sharedGraph.js";

export const TRAY_TYPES = ["perforated", "ladder", "duct", "wiremesh"];

export const TRAY_SERVICES = ["power", "data", "unified"];

/** Ceiling gaps per service: Data sits highest (0.35 m), Unified middle (0.45 m), Power lowest (0.55 m). */
export const TRAY_CEILING_GAP_M = 0.45;
const SERVICE_CEILING_GAPS = {
  power: 0.55,
  data: 0.35,
  unified: TRAY_CEILING_GAP_M,
};
const SERVICE_COLORS = {
  power: "#cba258",
  data: "#0284c7",
  unified: "#65a30d",
};

export function normalizeTrayService(service) {
  return TRAY_SERVICES.includes(service) ? service : "unified";
}

export function trayColorForService(service) {
  return SERVICE_COLORS[normalizeTrayService(service)];
}

export function defaultTrayElevation(project, service = "unified") {
  const wallHeight = Number(project?.metadata?.default_wall_height_m) || 3.8;
  const gap = SERVICE_CEILING_GAPS[normalizeTrayService(service)] ?? TRAY_CEILING_GAP_M;
  return Math.round((wallHeight - gap) * 100) / 100;
}

/**
 * Snap a cursor point while drawing a tray or pipe run.
 * Priority: nearest anchor within `radiusPx`, then ortho against `from`, else the point itself.
 */
export function snapDrawPoint(pt, anchors, { radiusPx, from = null, ortho = false }) {
  let best = null;
  let bestDist = radiusPx;
  for (const [ax, ay] of anchors) {
    const d = Math.hypot(pt.x - ax, pt.y - ay);
    if (d <= bestDist) {
      best = [ax, ay];
      bestDist = d;
    }
  }
  if (best) return { x: best[0], y: best[1], snapped: "node" };
  if (ortho && from) {
    const dx = Math.abs(pt.x - from[0]);
    const dy = Math.abs(pt.y - from[1]);
    return dx >= dy
      ? { x: pt.x, y: from[1], snapped: "ortho" }
      : { x: from[0], y: pt.y, snapped: "ortho" };
  }
  return { x: pt.x, y: pt.y, snapped: null };
}

// ==================== SHARED-VERTEX TRAY GRAPH ====================

const MERGE_PX = 1;

function eligibleNodeIds(project, service, extraIds = null) {
  if (!service) return null;
  const target = normalizeTrayService(service);
  const allowed = new Set(extraIds || []);
  for (const tray of project.cable_trays || []) {
    if (normalizeTrayService(tray.service) !== target) continue;
    for (const id of tray.node_ids || []) allowed.add(id);
  }
  return allowed;
}

/** Convert legacy `points_px` trays to shared nodes (merged within 1 px). Idempotent. */
export function migrateTrayNetwork(project) {
  if (!Array.isArray(project.tray_nodes)) project.tray_nodes = [];
  for (const tray of project.cable_trays || []) {
    if (!tray.service) tray.service = "unified";
    if (!Array.isArray(tray.points_px) || tray.node_ids) continue;
    tray.node_ids = tray.points_px.map(
      ([x, y]) => (nearestGraphNode(project.tray_nodes, x, y, MERGE_PX) || addGraphNode(project.tray_nodes, "tn_", x, y)).id
    );
    delete tray.points_px;
  }
}

/** Vertex positions of a tray, in node order. */
export function trayPoints(project, tray) {
  return graphRunPoints(project.tray_nodes, tray);
}

/**
 * Add a run of vertices as a new tray. Each point reuses a matching-service node within `snapPx`,
 * else splits a matching-service tray segment, else creates a node.
 */
export function insertTrayRun(project, pointsPx, props, snapPx) {
  if (!Array.isArray(project.tray_nodes)) project.tray_nodes = [];
  const service = normalizeTrayService(props?.service);
  const { run, prunedNodes } = insertGraphRun({
    nodes: project.tray_nodes,
    runs: project.cable_trays,
    prefix: "tn_",
    pointsPx,
    props: { ...props, service },
    snapPx,
    allowedIdsFn: (ids) => eligibleNodeIds(project, service, ids),
    runFilter: (tray) => normalizeTrayService(tray.service) === service,
  });
  project.tray_nodes = prunedNodes;
  return run;
}

/** Remove nodes no tray uses. */
export function pruneTrayNodes(project) {
  project.tray_nodes = pruneGraphNodes(project.tray_nodes || [], project.cable_trays || []);
}

export function trayLengthM(project, tray, scalePxPerMeter) {
  return graphRunLengthM(project.tray_nodes, tray, scalePxPerMeter);
}

/** Closest snap target for drawing: an existing node first, else a point on a segment. */
export function nearestTrayAnchor(project, pt, radiusPx, service = null) {
  const allowed = service ? eligibleNodeIds(project, service) : null;
  const runFilter = service ? (tray) => normalizeTrayService(tray.service) === normalizeTrayService(service) : null;
  return nearestGraphAnchor(project.tray_nodes || [], project.cable_trays || [], pt, radiusPx, allowed, runFilter);
}
