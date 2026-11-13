/**
 * Sitestry.AI — cable tray network helpers (pure, no DOM).
 *
 * Tray constants and defaults, vertex snapping for drawing, and the shared-vertex tray graph.
 */

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
 * Snap a cursor point while drawing a tray run.
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
// project.tray_nodes = [{id, x_px, y_px}]; each tray lists its vertices in `node_ids`.

const MERGE_PX = 1;

function nextNodeId(project) {
  let max = 0;
  for (const n of project.tray_nodes) {
    const m = /^tn_(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `tn_${max + 1}`;
}

function addNode(project, x, y) {
  const node = { id: nextNodeId(project), x_px: Math.round(x * 10) / 10, y_px: Math.round(y * 10) / 10 };
  project.tray_nodes.push(node);
  return node;
}

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

function nearestNode(project, x, y, radius, service = null, extraIds = null) {
  const allowed = eligibleNodeIds(project, service, extraIds);
  let best = null;
  let bestDist = radius;
  for (const n of project.tray_nodes) {
    if (allowed && !allowed.has(n.id)) continue;
    const d = Math.hypot(n.x_px - x, n.y_px - y);
    if (d <= bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

/** Closest interior point of any matching-service tray segment: {tray, index, x, y, dist} or null. */
function nearestSegment(project, x, y, radius, service = null) {
  const target = service ? normalizeTrayService(service) : null;
  const byId = new Map(project.tray_nodes.map((n) => [n.id, n]));
  let best = null;
  for (const tray of project.cable_trays) {
    if (target && normalizeTrayService(tray.service) !== target) continue;
    const ids = tray.node_ids || [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = byId.get(ids[i]);
      const b = byId.get(ids[i + 1]);
      if (!a || !b) continue;
      const dx = b.x_px - a.x_px;
      const dy = b.y_px - a.y_px;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = ((x - a.x_px) * dx + (y - a.y_px) * dy) / len2;
      if (t <= 0 || t >= 1) continue;
      const px = a.x_px + dx * t;
      const py = a.y_px + dy * t;
      const dist = Math.hypot(x - px, y - py);
      if (dist <= radius && (!best || dist < best.dist)) best = { tray, index: i, x: px, y: py, dist };
    }
  }
  return best;
}

/** Convert legacy `points_px` trays to shared nodes (merged within 1 px). Idempotent. */
export function migrateTrayNetwork(project) {
  if (!Array.isArray(project.tray_nodes)) project.tray_nodes = [];
  for (const tray of project.cable_trays || []) {
    if (!tray.service) tray.service = "unified";
    if (!Array.isArray(tray.points_px) || tray.node_ids) continue;
    tray.node_ids = tray.points_px.map(([x, y]) => (nearestNode(project, x, y, MERGE_PX) || addNode(project, x, y)).id);
    delete tray.points_px;
  }
}

/** Vertex positions of a tray, in node order. */
export function trayPoints(project, tray) {
  const byId = new Map((project.tray_nodes || []).map((n) => [n.id, n]));
  return (tray.node_ids || []).map((id) => byId.get(id)).filter(Boolean).map((n) => [n.x_px, n.y_px]);
}

/**
 * Add a run of vertices as a new tray. Each point reuses a node within `snapPx`, else splits the
 * tray segment it lands on (the new node is inserted into that tray), else creates a node.
 * Returns the tray, or null when fewer than two distinct nodes remain.
 */
export function insertTrayRun(project, pointsPx, props, snapPx) {
  if (!Array.isArray(project.tray_nodes)) project.tray_nodes = [];
  const service = normalizeTrayService(props?.service);
  const ids = [];
  for (const [x, y] of pointsPx) {
    let node = nearestNode(project, x, y, snapPx, service, ids);
    if (!node) {
      const seg = nearestSegment(project, x, y, snapPx, service);
      if (seg) {
        node = addNode(project, seg.x, seg.y);
        seg.tray.node_ids.splice(seg.index + 1, 0, node.id);
      } else {
        node = addNode(project, x, y);
      }
    }
    if (ids[ids.length - 1] !== node.id) ids.push(node.id);
  }
  if (ids.length < 2) {
    pruneTrayNodes(project);
    return null;
  }
  const tray = { ...props, service, node_ids: ids };
  project.cable_trays.push(tray);
  return tray;
}

/** Remove nodes no tray uses. */
export function pruneTrayNodes(project) {
  const used = new Set();
  for (const tray of project.cable_trays) for (const id of tray.node_ids || []) used.add(id);
  project.tray_nodes = project.tray_nodes.filter((n) => used.has(n.id));
}

export function trayLengthM(project, tray, scalePxPerMeter) {
  const pts = trayPoints(project, tray);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return total / scalePxPerMeter;
}

/** Closest snap target for drawing: an existing node first, else a point on a segment. */
export function nearestTrayAnchor(project, pt, radiusPx, service = null) {
  const node = nearestNode(project, pt.x, pt.y, radiusPx, service);
  if (node) return { x: node.x_px, y: node.y_px, kind: "node" };
  const seg = nearestSegment(project, pt.x, pt.y, radiusPx, service);
  return seg ? { x: seg.x, y: seg.y, kind: "segment" } : null;
}
