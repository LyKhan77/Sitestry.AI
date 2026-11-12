/**
 * Sitestry.AI — closed room detection from the wall graph (pure, no DOM).
 *
 * Walls are planarized first: points closer than `gapPx` merge, a wall is split where another
 * wall ends within `gapPx` of it, and walls that cross without a shared node are split at the
 * crossing. Dangling walls are pruned, then faces are walked half-edge by half-edge. Inner faces
 * have a positive shoelace area; the outer face of every connected component is negative and dropped.
 */

const EPS = 1e-9;

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function onSegment(a, b, p) {
  return (
    Math.abs(orient(a, b, p)) <= 1e-7 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-7
  );
}

/** True when the closed segments share any point (crossing, touching or overlapping). */
function segmentsTouch(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function isSimplePolygon(points) {
  const pts = points.filter((p, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6;
  });
  if (pts.length < 3 || Math.abs(polygonArea(pts)) < 1e-6) return false;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsTouch(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

function crossingParam(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? t : null;
}

function simplify(poly) {
  let pts = poly.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const span = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      const offLine = span < EPS ? 0 : Math.abs(orient(prev, next, cur)) / span;
      if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) < 1e-6 || offLine < 0.05) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Merge near points, split walls at near endpoints and crossings; returns points and adjacency sets. */
function planarize(project, gap) {
  const nodes = new Map((project?.nodes || []).map((n) => [n.id, [n.x_px, n.y_px]]));
  const segments = [];
  for (const wall of project?.walls || []) {
    const a = nodes.get(wall.start_node);
    const b = nodes.get(wall.end_node);
    if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > EPS) segments.push([a, b]);
  }
  if (segments.length === 0) return { points: [], adjacency: [] };

  const points = [];
  const register = (p) => {
    for (const q of points) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= gap) return points.indexOf(q);
    points.push([p[0], p[1]]);
    return points.length - 1;
  };

  const endpoints = segments.flatMap((s) => s);
  const edgeKeys = new Set();
  const edges = [];
  segments.forEach(([a, b], index) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const ts = [0, 1];
    for (const p of endpoints) {
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      const qx = a[0] + dx * t;
      const qy = a[1] + dy * t;
      if (Math.hypot(p[0] - qx, p[1] - qy) <= gap) ts.push(t);
    }
    segments.forEach(([c, d], other) => {
      if (other === index) return;
      const t = crossingParam(a, b, c, d);
      if (t !== null) ts.push(t);
    });
    ts.sort((x, y) => x - y);
    for (let i = 0; i < ts.length - 1; i++) {
      const p = register([a[0] + dx * ts[i], a[1] + dy * ts[i]]);
      const q = register([a[0] + dx * ts[i + 1], a[1] + dy * ts[i + 1]]);
      if (p === q) continue;
      const key = p < q ? `${p}-${q}` : `${q}-${p}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push([p, q]);
    }
  });

  const adjacency = points.map(() => new Set());
  for (const [p, q] of edges) {
    adjacency[p].add(q);
    adjacency[q].add(p);
  }
  return { points, adjacency };
}

/** Wall ends that stay alone after near ends are bridged: the gaps worth pointing out to the user. */
export function findFreeEnds(project, options = {}) {
  const scale = project?.metadata?.scale_px_per_meter || 30.68;
  const { points, adjacency } = planarize(project, options.gapPx ?? 0.3 * scale);
  return points.filter((_, i) => adjacency[i].size === 1).map(([x, y]) => [x, y]);
}

export function buildRoomFaces(project, options = {}) {
  const scale = project?.metadata?.scale_px_per_meter || 30.68;
  const gap = options.gapPx ?? 0.6 * scale;
  const minArea = options.minAreaPx ?? scale * scale;

  const { points, adjacency } = planarize(project, gap);
  if (points.length === 0) return [];

  let pruned = true;
  while (pruned) {
    pruned = false;
    adjacency.forEach((neighbours, i) => {
      if (neighbours.size === 1) {
        const [j] = neighbours;
        neighbours.delete(j);
        adjacency[j].delete(i);
        pruned = true;
      }
    });
  }

  const angle = (i, j) => Math.atan2(points[j][1] - points[i][1], points[j][0] - points[i][0]);
  const order = adjacency.map((set, i) => [...set].sort((a, b) => angle(i, a) - angle(i, b)));

  const used = new Set();
  const faces = [];
  for (let i = 0; i < points.length; i++) {
    for (const j of order[i]) {
      if (used.has(`${i}>${j}`)) continue;
      const ring = [];
      let from = i;
      let to = j;
      while (!used.has(`${from}>${to}`)) {
        used.add(`${from}>${to}`);
        ring.push(from);
        const around = order[to];
        const at = around.indexOf(from);
        const next = around[(at - 1 + around.length) % around.length];
        from = to;
        to = next;
      }
      const coords = ring.map((k) => points[k]);
      if (polygonArea(coords) <= minArea) continue;
      const polygon = simplify(coords);
      if (polygon.length < 3 || !isSimplePolygon(polygon)) continue;
      const area = polygonArea(polygon);
      if (area > minArea) faces.push({ polygon: polygon.map(([x, y]) => [x, y]), area });
    }
  }
  return faces.sort((a, b) => a.area - b.area);
}

export function faceAt(faces, x, y) {
  for (const face of faces) if (pointInPolygon([x, y], face.polygon)) return face;
  return null;
}
