/**
 * Sitestry.AI — cable tray fittings (pure, no DOM).
 *
 * Fittings are never stored: they are derived from the shared-vertex tray graph.
 * Every tray segment touching a node is one arm of that node's fitting.
 */

const STRAIGHT_TOLERANCE_RAD = (5 * Math.PI) / 180;
const WIDTH_EPS_M = 0.001;

function classify(arms) {
  if (arms.length === 1) return "end";
  if (arms.length === 2) {
    const diff = Math.abs(arms[0].angleRad - arms[1].angleRad) % (2 * Math.PI);
    const apart = diff > Math.PI ? 2 * Math.PI - diff : diff;
    if (Math.abs(Math.PI - apart) <= STRAIGHT_TOLERANCE_RAD) {
      return Math.abs(arms[0].widthM - arms[1].widthM) > WIDTH_EPS_M ? "reducer" : "straight";
    }
    return "elbow";
  }
  return arms.length === 3 ? "tee" : "cross";
}

/**
 * @returns {Map<string, {nodeId:string, x_px:number, y_px:number,
 *   kind:"end"|"straight"|"reducer"|"elbow"|"tee"|"cross",
 *   arms:{trayId:string, angleRad:number, widthM:number}[]}>}
 */
export function deriveFittings(project, scalePxPerMeter) {
  void scalePxPerMeter; // arm angles and widths do not depend on scale; kept for a stable signature
  const nodes = new Map((project.tray_nodes || []).map((n) => [n.id, n]));
  const armsByNode = new Map();
  const addArm = (nodeId, toId, tray) => {
    const from = nodes.get(nodeId);
    const to = nodes.get(toId);
    if (!from || !to) return;
    const list = armsByNode.get(nodeId) || [];
    list.push({
      trayId: tray.id,
      angleRad: Math.atan2(to.y_px - from.y_px, to.x_px - from.x_px),
      widthM: Number(tray.width_m) || 0.45,
    });
    armsByNode.set(nodeId, list);
  };
  for (const tray of project.cable_trays || []) {
    const ids = tray.node_ids || [];
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) addArm(ids[i], ids[i - 1], tray);
      if (i < ids.length - 1) addArm(ids[i], ids[i + 1], tray);
    }
  }
  const result = new Map();
  for (const [nodeId, arms] of armsByNode) {
    const node = nodes.get(nodeId);
    result.set(nodeId, { nodeId, x_px: node.x_px, y_px: node.y_px, kind: classify(arms), arms });
  }
  return result;
}
