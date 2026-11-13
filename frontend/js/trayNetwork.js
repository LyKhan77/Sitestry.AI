/**
 * Sitestry.AI — cable tray network helpers (pure, no DOM).
 *
 * Tray constants and defaults, vertex snapping for drawing, and the shared-vertex tray graph.
 */

export const TRAY_TYPES = ["perforated", "ladder", "duct", "wiremesh"];

/** Trays hang 0.45 m below the ceiling; `elevation_m` is the tray top. */
export const TRAY_CEILING_GAP_M = 0.45;

export function defaultTrayElevation(project) {
  const wallHeight = Number(project?.metadata?.default_wall_height_m) || 3.8;
  return Math.round((wallHeight - TRAY_CEILING_GAP_M) * 100) / 100;
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
