/**
 * Sitestry.AI — shared-vertex polyline graph primitives (pure, no DOM).
 *
 * Reused by `trayNetwork.js` (`tray_nodes` / `cable_trays`) and
 * `pipeNetwork.js` (`pipe_nodes` / `pipe_runs`) to avoid duplicating graph math.
 */

export function nextGraphNodeId(nodes, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const n of nodes) {
    const m = re.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function addGraphNode(nodes, prefix, x, y) {
  const node = {
    id: nextGraphNodeId(nodes, prefix),
    x_px: Math.round(x * 10) / 10,
    y_px: Math.round(y * 10) / 10,
  };
  nodes.push(node);
  return node;
}

export function nearestGraphNode(nodes, x, y, radius, allowedIds = null) {
  let best = null;
  let bestDist = radius;
  for (const n of nodes) {
    if (allowedIds && !allowedIds.has(n.id)) continue;
    const d = Math.hypot(n.x_px - x, n.y_px - y);
    if (d <= bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

export function nearestGraphSegment(nodes, runs, x, y, radius, runFilter = null) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best = null;
  for (const run of runs) {
    if (runFilter && !runFilter(run)) continue;
    const ids = run.node_ids || [];
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
      if (dist <= radius && (!best || dist < best.dist)) {
        best = { run, index: i, x: px, y: py, dist };
      }
    }
  }
  return best;
}

export function graphRunPoints(nodes, run) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  return (run.node_ids || []).map((id) => byId.get(id)).filter(Boolean).map((n) => [n.x_px, n.y_px]);
}

export function graphRunLengthM(nodes, run, scalePxPerMeter) {
  const pts = graphRunPoints(nodes, run);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return total / scalePxPerMeter;
}

export function pruneGraphNodes(nodes, runs) {
  const used = new Set();
  for (const run of runs) for (const id of run.node_ids || []) used.add(id);
  return nodes.filter((n) => used.has(n.id));
}

export function insertGraphRun({
  nodes,
  runs,
  prefix,
  pointsPx,
  props,
  snapPx,
  allowedIdsFn = null,
  runFilter = null,
}) {
  const ids = [];
  for (const [x, y] of pointsPx) {
    const allowedIds = allowedIdsFn ? allowedIdsFn(ids) : null;
    let node = nearestGraphNode(nodes, x, y, snapPx, allowedIds);
    if (!node) {
      const seg = nearestGraphSegment(nodes, runs, x, y, snapPx, runFilter);
      if (seg) {
        node = addGraphNode(nodes, prefix, seg.x, seg.y);
        seg.run.node_ids.splice(seg.index + 1, 0, node.id);
      } else {
        node = addGraphNode(nodes, prefix, x, y);
      }
    }
    if (ids[ids.length - 1] !== node.id) ids.push(node.id);
  }
  if (ids.length < 2) {
    return { run: null, prunedNodes: pruneGraphNodes(nodes, runs) };
  }
  const run = { ...props, node_ids: ids };
  runs.push(run);
  return { run, prunedNodes: nodes };
}

export function nearestGraphAnchor(nodes, runs, pt, radiusPx, allowedIds = null, runFilter = null) {
  const node = nearestGraphNode(nodes, pt.x, pt.y, radiusPx, allowedIds);
  if (node) return { x: node.x_px, y: node.y_px, kind: "node" };
  const seg = nearestGraphSegment(nodes, runs, pt.x, pt.y, radiusPx, runFilter);
  return seg ? { x: seg.x, y: seg.y, kind: "segment" } : null;
}
