/**
 * Sitestry.AI — Stage 5 Generic Equipment Catalog & Wall-Mount Snapping (pure, no DOM).
 *
 * Groups all Stage 5 facility hardware into 5 generic categories:
 *   rack | power | data | cooling | security
 * while preserving 100% compatibility with legacy presets (rack, ups, battery, rectifier, panel, pac).
 */

import { buildRoomFaces, faceAt, pointInPolygon, polygonArea } from "./roomFaces.js";

export const EQUIPMENT_GROUPS = ["rack", "power", "data", "cooling", "security"];

export const EQUIPMENT_GROUP_LABELS = {
  rack: "Rack",
  power: "Power",
  data: "Data",
  cooling: "Cooling",
  security: "Security",
};

/**
 * Canonical subtype definitions.
 * `mount`: "floor" | "wall" | "ceiling"
 */
export const EQUIPMENT_SUBTYPES = {
  // ---- RACK ----
  rack: {
    group: "rack",
    label: "Server Rack 42U",
    w: 0.6,
    d: 1.1,
    h: 2.1,
    elev: 0.0,
    mount: "floor",
    color: "#1e3932",
  },
  network_rack: {
    group: "rack",
    label: "Network / Telco Rack 42U",
    w: 0.8,
    d: 1.0,
    h: 2.1,
    elev: 0.0,
    mount: "floor",
    color: "#234a3f",
  },

  // ---- POWER ----
  panel: {
    group: "power",
    label: "ACPDB / SDP / PDU Panel",
    w: 1.4,
    d: 0.65,
    h: 2.0,
    elev: 0.0,
    mount: "floor",
    color: "#b45309",
  },
  ups: {
    group: "power",
    label: "UPS Frame 250kVA",
    w: 1.6,
    d: 0.95,
    h: 2.0,
    elev: 0.0,
    mount: "floor",
    color: "#006241",
  },
  battery: {
    group: "power",
    label: "Lithium Battery Bank",
    w: 2.2,
    d: 0.9,
    h: 2.0,
    elev: 0.0,
    mount: "floor",
    color: "#00754a",
  },
  rectifier: {
    group: "power",
    label: "DC Rectifier Cabinet",
    w: 1.2,
    d: 0.8,
    h: 2.0,
    elev: 0.0,
    mount: "floor",
    color: "#3b5249",
  },
  outlet: {
    group: "power",
    label: "Colokan / Wall Outlet",
    w: 0.25,
    d: 0.12,
    h: 0.25,
    elev: 0.6,
    mount: "wall",
    color: "#dc2626",
  },
  grounding_bar: {
    group: "power",
    label: "Grounding Busbar (TMGB / TGB)",
    w: 0.45,
    d: 0.12,
    h: 0.2,
    elev: 0.5,
    mount: "wall",
    color: "#16a34a",
  },
  power_riser: {
    group: "power",
    label: "Power Link / Riser (Antar Lantai)",
    w: 0.45,
    d: 0.2,
    h: 0.8,
    elev: 0.45,
    mount: "wall",
    color: "#ea580c",
  },

  // ---- DATA ----
  data_cabinet: {
    group: "data",
    label: "Data / ODF Cabinet",
    w: 0.8,
    d: 0.8,
    h: 2.1,
    elev: 0.0,
    mount: "floor",
    color: "#0369a1",
  },
  data_outlet: {
    group: "data",
    label: "Data Wall Outlet",
    w: 0.22,
    d: 0.1,
    h: 0.22,
    elev: 0.6,
    mount: "wall",
    color: "#0284c7",
  },
  data_riser: {
    group: "data",
    label: "Data Link / Riser (Antar Lantai)",
    w: 0.45,
    d: 0.2,
    h: 0.8,
    elev: 0.45,
    mount: "wall",
    color: "#eab308",
  },

  // ---- COOLING ----
  pac: {
    group: "cooling",
    label: "PAC Downflow Cooling",
    w: 1.9,
    d: 0.95,
    h: 2.15,
    elev: 0.0,
    mount: "floor",
    color: "#0e7490",
  },
  in_row: {
    group: "cooling",
    label: "In-Row Cooling Unit",
    w: 0.35,
    d: 1.1,
    h: 2.1,
    elev: 0.0,
    mount: "floor",
    color: "#0891b2",
  },
  chiller: {
    group: "cooling",
    label: "AC Central / Chiller Outdoor",
    w: 2.2,
    d: 1.2,
    h: 2.0,
    elev: 0.0,
    mount: "floor",
    color: "#06b6d4",
  },
  fan: {
    group: "cooling",
    label: "Exhaust Fan",
    w: 0.5,
    d: 0.25,
    h: 0.5,
    elev: 2.6,
    mount: "wall",
    color: "#22d3ee",
  },

  // ---- SECURITY ----
  cctv: {
    group: "security",
    label: "CCTV Camera",
    w: 0.25,
    d: 0.25,
    h: 0.22,
    elev: 2.9,
    mount: "wall",
    color: "#7e22ce",
  },
  access_control: {
    group: "security",
    label: "Access Control Reader",
    w: 0.2,
    d: 0.1,
    h: 0.25,
    elev: 1.3,
    mount: "wall",
    color: "#9333ea",
  },
  fire_sensor: {
    group: "security",
    label: "Fire / Smoke Sensor",
    w: 0.25,
    d: 0.25,
    h: 0.12,
    elev: 3.65,
    mount: "ceiling",
    color: "#a855f7",
  },
};

export function subtypesForGroup(group) {
  return Object.entries(EQUIPMENT_SUBTYPES)
    .filter(([, meta]) => meta.group === group)
    .map(([key, meta]) => ({ key, ...meta }));
}

export function defaultSubtypeForGroup(group) {
  const subs = subtypesForGroup(group);
  return subs.length ? subs[0].key : "rack";
}

export function getEquipmentPreset(subtypeOrCategory) {
  return EQUIPMENT_SUBTYPES[subtypeOrCategory] || EQUIPMENT_SUBTYPES.rack;
}

export function resolveEquipmentGroup(eq) {
  if (eq?.domain_group && EQUIPMENT_GROUPS.includes(eq.domain_group)) return eq.domain_group;
  const key = eq?.subtype || eq?.category || "rack";
  return EQUIPMENT_SUBTYPES[key]?.group || "rack";
}

/**
 * Project `(x_px, y_px)` onto the nearest wall segment within `maxDistPx`.
 * Returns `{ x_px, y_px, wall_id, rotation_deg }` or `null` if no wall is close enough.
 */
export function snapWallMountPosition(x_px, y_px, walls = [], nodes = [], maxDistPx = 28) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best = null;
  let bestDist = maxDistPx;
  for (const w of walls) {
    const a = byId.get(w.start_node);
    const b = byId.get(w.end_node);
    if (!a || !b) continue;
    const dx = b.x_px - a.x_px;
    const dy = b.y_px - a.y_px;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((x_px - a.x_px) * dx + (y_px - a.y_px) * dy) / len2));
    const px = a.x_px + dx * t;
    const py = a.y_px + dy * t;
    const dist = Math.hypot(x_px - px, y_px - py);
    if (dist <= bestDist) {
      bestDist = dist;
      const angleDeg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
      const normalized = ((angleDeg % 180) + 180) % 180;
      best = {
        x_px: Math.round(px * 10) / 10,
        y_px: Math.round(py * 10) / 10,
        wall_id: w.id,
        rotation_deg: normalized === 180 ? 0 : normalized,
      };
    }
  }
  return best;
}

/**
 * Resolve the physical floor slab height (meters) beneath 2D coordinate `(x_px, y_px)`:
 * 1. Matching `project.rooms` zone slab top (`max(0.06, elevation_m || 0.25)`, picking smallest containing polygon),
 * 2. Else automatic closed-room concrete `BaseFloor` (`0.02 m` when enabled),
 * 3. Else `0.0 m`.
 */
export function resolveFloorElevationAt(project, x_px, y_px, { hasBaseFloor = true, baseFaces = null } = {}) {
  if (!project || !Number.isFinite(Number(x_px)) || !Number.isFinite(Number(y_px))) return 0;
  const px = Number(x_px);
  const py = Number(y_px);

  let matchedRoom = null;
  let bestArea = Infinity;
  for (const room of project.rooms || []) {
    if (!room?.polygon_px || room.polygon_px.length < 3) continue;
    if (!pointInPolygon([px, py], room.polygon_px)) continue;
    const area = Math.abs(polygonArea(room.polygon_px));
    if (area < bestArea) {
      bestArea = area;
      matchedRoom = room;
    }
  }
  if (matchedRoom) {
    return Math.max(0.06, Number(matchedRoom.elevation_m) || 0.25);
  }

  if (hasBaseFloor && (baseFaces?.length || project.walls?.length)) {
    const faces = baseFaces ?? buildRoomFaces(project);
    if (faces.length && faceAt(faces, px, py)) return 0.02;
  }

  return 0;
}

/**
 * Compute default `elevation_m` for newly placed/retyped equipment at `(x_px, y_px)`.
 * Floor-standing equipment sits on the resolved floor slab; wall-mounted sits above it;
 * ceiling-mounted hangs below `default_wall_height_m`.
 */
export function defaultEquipmentElevation(project, subtypeOrCategory, x_px, y_px, opts = {}) {
  const preset = getEquipmentPreset(subtypeOrCategory);
  const wallHeight = Number(project?.metadata?.default_wall_height_m) || 3.8;
  if (preset.mount === "ceiling") {
    return Math.max(0.2, Math.round((wallHeight - preset.h - 0.05) * 100) / 100);
  }
  const floorZ = resolveFloorElevationAt(project, x_px, y_px, opts);
  if (preset.mount === "wall") {
    return Math.min(
      Math.max(0.05, wallHeight - preset.h),
      Math.round((floorZ + preset.elev) * 100) / 100
    );
  }
  return floorZ;
}

/**
 * Resolve effective 3D base elevation (meters) for an equipment instance.
 * Floor-mounted units (`mount === "floor"`) always sit flush on the room/base floor beneath them.
 */
export function resolveEquipmentElevationM(project, eq, opts = {}) {
  const preset = getEquipmentPreset(eq?.subtype || eq?.category);
  const mount = eq?.mount || preset.mount || "floor";
  if (mount === "floor") {
    return resolveFloorElevationAt(project, eq?.x_px, eq?.y_px, opts);
  }
  return Number(eq?.elevation_m ?? preset.elev) || 0;
}
