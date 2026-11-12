/**
 * Sitestry.AI — Pure 2D annotation geometry for manual wall drag, endpoint
 * assistance, optional source guidance, and atomic wall insertion/splitting.
 *
 * No DOM, Konva, or Three.js imports: preview and planning are testable in Node
 * and never mutate the canonical project.
 *
 * Canonical coordinates are source pixels (2.0x PDF render or native raster).
 * Screen tolerances are converted with the current view scale.
 */

export const WALL_MIN_GESTURE_CSS_PX = 3;
export const WALL_SNAP_CSS_PX = 10;
export const WALL_GUIDE_ANGLE_DEG = 15;
export const GEOMETRY_EPSILON_PX = 1e-6;
export const OPENING_OFFSET_MIN = 0.08;
export const OPENING_OFFSET_MAX = 0.92;

const DEFAULT_ASSISTANCE = { endpointSnap: false, ortho: false };
const GUIDE_MIN_CONFIDENCE = 0.65;

export function toPointPx(point) {
  if (!point) return null;
  const x = Number(point.x_px ?? point.x);
  const y = Number(point.y_px ?? point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x_px: x, y_px: y };
}

export function distancePx(a, b) {
  return Math.hypot(b.x_px - a.x_px, b.y_px - a.y_px);
}

export function projectPointOnSegment(point, a, b) {
  const dx = b.x_px - a.x_px;
  const dy = b.y_px - a.y_px;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < GEOMETRY_EPSILON_PX) {
    return { ratio: 0, point: { ...a }, distance: distancePx(point, a) };
  }
  const rawRatio = ((point.x_px - a.x_px) * dx + (point.y_px - a.y_px) * dy) / lenSq;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const projected = { x_px: a.x_px + ratio * dx, y_px: a.y_px + ratio * dy };
  return { ratio, rawRatio, point: projected, distance: distancePx(point, projected) };
}

function segmentAngleDeg(a, b) {
  return (Math.atan2(b.y_px - a.y_px, b.x_px - a.x_px) * 180) / Math.PI;
}

function angleDifferenceDeg(a, b) {
  let diff = Math.abs(((a - b) % 180 + 180) % 180);
  if (diff > 90) diff = 180 - diff;
  return diff;
}

export function resolveConnection(point, project, tolerancePx) {
  let bestNode = null;
  let bestNodeDistance = Infinity;
  for (const node of project.nodes || []) {
    const d = distancePx(point, node);
    if (d <= tolerancePx && d < bestNodeDistance) {
      bestNode = node;
      bestNodeDistance = d;
    }
  }
  if (bestNode) {
    return {
      type: "node",
      nodeId: bestNode.id,
      point: { x_px: bestNode.x_px, y_px: bestNode.y_px },
      distance: bestNodeDistance,
    };
  }

  let bestWall = null;
  let bestProjection = null;
  for (const wall of project.walls || []) {
    const n1 = (project.nodes || []).find((n) => n.id === wall.start_node);
    const n2 = (project.nodes || []).find((n) => n.id === wall.end_node);
    if (!n1 || !n2) continue;
    const projection = projectPointOnSegment(point, n1, n2);
    const interior = projection.rawRatio > 1e-4 && projection.rawRatio < 1 - 1e-4;
    if (!interior) continue;
    if (projection.distance <= tolerancePx && (!bestProjection || projection.distance < bestProjection.distance)) {
      bestWall = wall;
      bestProjection = projection;
    }
  }
  if (bestWall) {
    return {
      type: "wall",
      wallId: bestWall.id,
      ratio: bestProjection.ratio,
      point: bestProjection.point,
      distance: bestProjection.distance,
    };
  }

  return { type: "free", point: { ...point }, distance: Infinity };
}

function findGuide(startPx, endPx, guides, viewScale) {
  if (!Array.isArray(guides) || guides.length === 0) return null;
  const tolerancePx = WALL_SNAP_CSS_PX / Math.max(0.0001, viewScale);
  const gestureLength = distancePx(startPx, endPx);
  if (gestureLength < 1) return null;
  const gestureAngle = segmentAngleDeg(startPx, endPx);
  const mid = { x_px: (startPx.x_px + endPx.x_px) / 2, y_px: (startPx.y_px + endPx.y_px) / 2 };

  let best = null;
  for (const guide of guides) {
    if (Number(guide.confidence ?? 1) < GUIDE_MIN_CONFIDENCE) continue;
    const ga = toPointPx(guide.start_px);
    const gb = toPointPx(guide.end_px);
    if (!ga || !gb) continue;
    const guideLength = distancePx(ga, gb);
    if (guideLength < 12) continue;
    const angleDiff = angleDifferenceDeg(gestureAngle, segmentAngleDeg(ga, gb));
    if (angleDiff > WALL_GUIDE_ANGLE_DEG) continue;
    const midProjection = projectPointOnSegment(mid, ga, gb);
    if (midProjection.distance > tolerancePx) continue;
    const startProjection = projectPointOnSegment(startPx, ga, gb);
    const endProjection = projectPointOnSegment(endPx, ga, gb);
    if (
      startProjection.rawRatio < -0.02 ||
      startProjection.rawRatio > 1.02 ||
      endProjection.rawRatio < -0.02 ||
      endProjection.rawRatio > 1.02
    ) {
      continue;
    }
    const lengthPenalty = Math.max(0, 20 - guideLength) / 2;
    const score = midProjection.distance + angleDiff * 0.5 + lengthPenalty;
    if (!best || score < best.score) {
      best = {
        guide,
        score,
        startPx: startProjection.point,
        endPx: endProjection.point,
      };
    }
  }
  return best;
}

/**
 * Compute a non-mutating wall preview.
 * Returns {valid, startPx, endPx, connections:{start,end}, guideId, feedback}.
 */
export function computeWallPreview({
  startPx,
  endPx,
  viewScale = 1,
  mode = "manual",
  assistance = DEFAULT_ASSISTANCE,
  guides = [],
  project,
}) {
  const start = toPointPx(startPx);
  const end = toPointPx(endPx);
  const scale = Math.max(0.0001, Number(viewScale) || 1);
  const assist = { ...DEFAULT_ASSISTANCE, ...(assistance || {}) };
  const base = {
    valid: false,
    startPx: start,
    endPx: end,
    connections: { start: { type: "free" }, end: { type: "free" } },
    guideId: null,
    feedback: "",
  };

  if (!start || !end || !project) {
    return { ...base, feedback: "Koordinat wall tidak valid (finite numbers diperlukan)." };
  }

  let workingStart = { ...start };
  let workingEnd = { ...end };
  let guideId = null;
  let guideFeedback = "";

  if (mode === "guided") {
    const hit = findGuide(start, end, guides, scale);
    if (hit) {
      workingStart = { ...hit.startPx };
      workingEnd = { ...hit.endPx };
      guideId = hit.guide.id;
      guideFeedback = ` · Guided centerline ${hit.guide.id}`;
    } else {
      guideFeedback = " · Guided tidak tersedia di area ini; preview manual.";
    }
  }

  if (!guideId && assist.ortho) {
    const dx = Math.abs(workingEnd.x_px - workingStart.x_px);
    const dy = Math.abs(workingEnd.y_px - workingStart.y_px);
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle <= WALL_GUIDE_ANGLE_DEG) workingEnd.y_px = workingStart.y_px;
      else if (90 - angle <= WALL_GUIDE_ANGLE_DEG) workingEnd.x_px = workingStart.x_px;
    }
  }

  const tolerancePx = assist.endpointSnap
    ? WALL_SNAP_CSS_PX / scale
    : 0.75 / scale;
  const startConnection = resolveConnection(workingStart, project, tolerancePx);
  const endConnection = resolveConnection(workingEnd, project, tolerancePx);

  workingStart = { ...startConnection.point };
  workingEnd = { ...endConnection.point };

  const screenLength = distancePx(workingStart, workingEnd) * scale;
  const minScreenLength = WALL_MIN_GESTURE_CSS_PX;
  const valid = Number.isFinite(screenLength) && screenLength >= minScreenLength;

  let feedback = `${(distancePx(workingStart, workingEnd) / (project.metadata?.scale_px_per_meter || 30.68)).toFixed(2)} m`;
  if (startConnection.type === "node") feedback = `Junction node ${startConnection.nodeId} · ${feedback}`;
  if (startConnection.type === "wall") feedback = `Split wall ${startConnection.wallId} · ${feedback}`;
  if (endConnection.type === "node") feedback = `${feedback} · Junction node ${endConnection.nodeId}`;
  if (endConnection.type === "wall") feedback = `${feedback} · Split wall ${endConnection.wallId}`;
  feedback += guideFeedback;
  if (!valid) feedback = "Gesture terlalu pendek atau degenerate.";

  return {
    valid,
    startPx: workingStart,
    endPx: workingEnd,
    connections: { start: startConnection, end: endConnection },
    guideId,
    feedback,
  };
}

function splitDraftWall(draft, wallId, splitPoint, allocateId, scalePxPerMeter) {
  const index = draft.walls.findIndex((w) => w.id === wallId);
  if (index === -1) return { ok: false, error: `Wall ${wallId} tidak ditemukan.` };
  const wall = draft.walls[index];
  const n1 = draft.nodes.find((n) => n.id === wall.start_node);
  const n2 = draft.nodes.find((n) => n.id === wall.end_node);
  if (!n1 || !n2) return { ok: false, error: `Wall ${wallId} memiliki node yang hilang.` };

  const lengthPx = distancePx(n1, n2);
  if (lengthPx < 1) return { ok: false, error: "Wall terlalu pendek untuk di-split." };
  const projection = projectPointOnSegment(toPointPx(splitPoint), n1, n2);
  const t = projection.rawRatio;
  if (!Number.isFinite(t) || t <= 1e-4 || t >= 1 - 1e-4) {
    return { ok: false, error: "Titik split harus berada di interior wall, bukan pada endpoint." };
  }

  const midId = allocateId("node");
  const midNode = {
    id: midId,
    x_px: Math.round(projection.point.x_px * 10) / 10,
    y_px: Math.round(projection.point.y_px * 10) / 10,
  };

  const secondId = allocateId("wall");
  const first = { ...wall, start_node: n1.id, end_node: midId };
  const second = { ...wall, id: secondId, start_node: midId, end_node: n2.id };
  draft.nodes.push(midNode);
  draft.walls.splice(index, 1, first, second);

  for (const opening of draft.openings.filter((o) => o.wall_id === wallId)) {
    const halfRatio = ((Number(opening.width_m) || 1.2) * (scalePxPerMeter || 1)) / (2 * lengthPx);
    if (Math.abs(opening.offset_ratio - t) < halfRatio + 1e-6) {
      return {
        ok: false,
        error: `Opening ${opening.id} melintasi junction; geser junction atau opening terlebih dahulu.`,
      };
    }
    const remapped = opening.offset_ratio < t
      ? opening.offset_ratio / t
      : (opening.offset_ratio - t) / (1 - t);
    if (remapped < OPENING_OFFSET_MIN - 1e-9 || remapped > OPENING_OFFSET_MAX + 1e-9) {
      return {
        ok: false,
        error: `Opening ${opening.id} membutuhkan offset ${remapped.toFixed(3)} di luar ${OPENING_OFFSET_MIN}..${OPENING_OFFSET_MAX}; split ditolak.`,
      };
    }
    opening.wall_id = opening.offset_ratio < t ? first.id : second.id;
    opening.offset_ratio = remapped;
    const host = draft.walls.find((w) => w.id === opening.wall_id);
    const ha = draft.nodes.find((n) => n.id === host.start_node);
    const hb = draft.nodes.find((n) => n.id === host.end_node);
    opening.x_px = Math.round((ha.x_px + (hb.x_px - ha.x_px) * opening.offset_ratio) * 10) / 10;
    opening.y_px = Math.round((ha.y_px + (hb.y_px - ha.y_px) * opening.offset_ratio) * 10) / 10;
  }

  return { ok: true, midNodeId: midId, wallIds: [first.id, second.id] };
}

function cloneProjectGeometry(project) {
  return {
    nodes: (project.nodes || []).map((n) => ({ ...n })),
    walls: (project.walls || []).map((w) => ({ ...w })),
    openings: (project.openings || []).map((o) => ({ ...o })),
  };
}

function ensureNode(draft, connection, fallbackPoint, scalePxPerMeter, allocateId) {
  if (connection && connection.type === "node") {
    const existing = draft.nodes.find((n) => n.id === connection.nodeId);
    if (!existing) return { ok: false, error: `Node ${connection.nodeId} tidak ditemukan.` };
    return { ok: true, nodeId: existing.id };
  }
  if (connection && connection.type === "wall") {
    const split = splitDraftWall(
      draft,
      connection.wallId,
      connection.point || fallbackPoint,
      allocateId,
      scalePxPerMeter
    );
    if (!split.ok) return split;
    return { ok: true, nodeId: split.midNodeId };
  }
  const point = toPointPx(fallbackPoint);
  if (!point) return { ok: false, error: "Endpoint wall tidak valid." };
  const nodeId = allocateId("node");
  draft.nodes.push({
    id: nodeId,
    x_px: Math.round(point.x_px * 10) / 10,
    y_px: Math.round(point.y_px * 10) / 10,
  });
  return { ok: true, nodeId };
}

/**
 * Plan a fully validated wall insertion. The returned patch is applied by the
 * store inside one transaction; the input project is never mutated.
 */
export function planWallInsertion({ project, preview, properties = {}, allocateId }) {
  if (!preview || !preview.valid) {
    return { ok: false, error: preview?.feedback || "Preview wall tidak valid." };
  }
  const draft = cloneProjectGeometry(project);
  const scale = project.metadata?.scale_px_per_meter || 30.68;

  const start = ensureNode(draft, preview.connections?.start, preview.startPx, scale, allocateId);
  if (!start.ok) return start;
  const end = ensureNode(draft, preview.connections?.end, preview.endPx, scale, allocateId);
  if (!end.ok) return end;

  if (start.nodeId === end.nodeId) {
    return { ok: false, error: "Endpoint start dan end menjadi node yang sama; wall degenerate." };
  }
  const duplicate = draft.walls.some(
    (w) =>
      (w.start_node === start.nodeId && w.end_node === end.nodeId) ||
      (w.start_node === end.nodeId && w.end_node === start.nodeId)
  );
  if (duplicate) {
    return { ok: false, error: "Wall dengan pasangan node yang sama sudah ada." };
  }

  const wallId = allocateId("wall");
  const wall = {
    id: wallId,
    start_node: start.nodeId,
    end_node: end.nodeId,
    thickness_m: Number(properties.thickness_m) || (properties.type === "cage_mesh" ? 0.08 : 0.2),
    height_m: Number(properties.height_m) || project.metadata?.default_wall_height_m || 3.8,
    type: properties.type || "solid",
    label:
      properties.label ||
      (properties.type === "cage_mesh"
        ? "Wiremesh Server Cage"
        : properties.type === "glass"
        ? "Glass Partition"
        : "Concrete Wall"),
  };
  draft.walls.push(wall);

  return { ok: true, patch: draft, wallId };
}

/**
 * Plan an interior wall split, preserving physical opening positions and tags.
 */
export function planWallSplit(project, wallId, splitPoint, allocateId) {
  const draft = cloneProjectGeometry(project);
  const scale = project.metadata?.scale_px_per_meter || 30.68;
  const split = splitDraftWall(draft, wallId, splitPoint, allocateId, scale);
  if (!split.ok) return split;
  return { ok: true, patch: draft, midNodeId: split.midNodeId, wallIds: split.wallIds };
}
