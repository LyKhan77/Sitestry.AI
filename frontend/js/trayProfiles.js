/**
 * Sitestry.AI — 3D cable tray profiles.
 *
 * One cross-section per tray type, swept along a straight segment. The group is centered on the
 * segment midpoint, the long axis is local X and the tray top sits at y = 0 (the caller places the
 * group at `elevation_m`, which is the tray top).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TRAY_TYPES } from "./trayNetwork.js";

const WALL_T = 0.02; // side wall and plate thickness
const WIRE_T = 0.006; // wire mesh wire thickness
const HOLE_PITCH_M = 0.05; // perforation spacing
const WF_SLOT_PITCH_U = 0.028; // lateral pitch between oval slots on waterfall
const WF_SLOT_PITCH_V = 0.044; // arc-wise pitch between oval slot rows

let perforationTexture = null;
let waterfallSlotTexture = null;

/** Repeating dot pattern used as an alpha map so the base plate looks perforated. */
function getPerforationTexture() {
  if (perforationTexture) return perforationTexture;
  if (typeof document === "undefined") return null;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.24, 0, Math.PI * 2);
  ctx.fill();
  perforationTexture = new THREE.CanvasTexture(canvas);
  perforationTexture.wrapS = THREE.RepeatWrapping;
  perforationTexture.wrapT = THREE.RepeatWrapping;
  return perforationTexture;
}

/** Repeating oval/pill slot pattern used as an alpha map for perforated waterfalls. */
function getWaterfallSlotTexture() {
  if (waterfallSlotTexture) return waterfallSlotTexture;
  if (typeof document === "undefined") return null;
  const w = 64;
  const h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000000";
  const slotW = 20;
  const slotH = 56;
  const x = (w - slotW) / 2;
  const y = (h - slotH) / 2;
  const r = slotW / 2;
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, Math.PI, 0, false);
  ctx.lineTo(x + slotW, y + slotH - r);
  ctx.arc(x + r, y + slotH - r, r, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();
  waterfallSlotTexture = new THREE.CanvasTexture(canvas);
  waterfallSlotTexture.wrapS = THREE.RepeatWrapping;
  waterfallSlotTexture.wrapT = THREE.RepeatWrapping;
  return waterfallSlotTexture;
}

function box(lengthX, heightY, depthZ, x, y, z) {
  const geo = new THREE.BoxGeometry(lengthX, heightY, depthZ);
  geo.translate(x, y, z);
  return geo;
}

function mesh(geometry, material) {
  return new THREE.Mesh(geometry, material);
}

/** Flat perforated base plate (alpha-mapped holes), tray bottom at y = -heightM. */
function perforatedPlate(lengthM, widthM, heightM, material) {
  const plateMat = material.clone();
  const baseAlpha = getPerforationTexture();
  if (baseAlpha) {
    const alpha = baseAlpha.clone();
    alpha.needsUpdate = true;
    alpha.repeat.set(Math.max(1, lengthM / HOLE_PITCH_M), Math.max(1, widthM / HOLE_PITCH_M));
    plateMat.alphaMap = alpha;
    plateMat.alphaTest = 0.5;
  }
  plateMat.side = THREE.DoubleSide;
  return mesh(box(lengthM, WALL_T, widthM, 0, -heightM + WALL_T / 2, 0), plateMat);
}

function perforatedProfile(lengthM, widthM, heightM, material) {
  const group = new THREE.Group();
  group.add(perforatedPlate(lengthM, widthM, heightM, material));
  const wallGeo = box(lengthM, heightM, WALL_T, 0, -heightM / 2, 0);
  const left = mesh(wallGeo, material);
  left.position.z = -widthM / 2 + WALL_T / 2;
  const right = mesh(wallGeo, material);
  right.position.z = widthM / 2 - WALL_T / 2;
  group.add(left, right);
  return group;
}

function ladderProfile(lengthM, widthM, heightM, material) {
  const group = new THREE.Group();
  const railGeo = box(lengthM, heightM, WALL_T, 0, -heightM / 2, 0);
  const left = mesh(railGeo, material);
  left.position.z = -widthM / 2 + WALL_T / 2;
  const right = mesh(railGeo, material);
  right.position.z = widthM / 2 - WALL_T / 2;
  group.add(left, right);
  const rungs = [];
  const rungCount = Math.max(2, Math.floor(lengthM / 0.35));
  for (let r = 0; r <= rungCount; r++) {
    const x = -lengthM / 2 + (r / rungCount) * lengthM;
    rungs.push(box(0.04, 0.03, widthM, x, -heightM + 0.015, 0));
  }
  group.add(mesh(mergeGeometries(rungs), material));
  return group;
}

function ductProfile(lengthM, widthM, heightM, material) {
  const group = new THREE.Group();
  group.add(mesh(box(lengthM, heightM, widthM, 0, -heightM / 2, 0), material));
  return group;
}

function wiremeshProfile(lengthM, widthM, heightM, material) {
  const group = new THREE.Group();
  const wires = [];
  const pitch = 0.1;
  const baseY = -heightM + WIRE_T / 2;
  // Base: longitudinal wires across the width, transverse wires along the length.
  const lanes = Math.max(2, Math.round(widthM / pitch));
  for (let i = 0; i <= lanes; i++) {
    const z = -widthM / 2 + (i / lanes) * widthM;
    wires.push(box(lengthM, WIRE_T, WIRE_T, 0, baseY, z));
  }
  const ribs = Math.max(2, Math.round(lengthM / pitch));
  for (let i = 0; i <= ribs; i++) {
    const x = -lengthM / 2 + (i / ribs) * lengthM;
    wires.push(box(WIRE_T, WIRE_T, widthM, x, baseY, 0));
    // Side wires rise from the base ends of each rib.
    for (const sign of [-1, 1]) {
      wires.push(box(WIRE_T, heightM, WIRE_T, x, -heightM / 2, sign * (widthM / 2 - WIRE_T / 2)));
    }
  }
  // Top edge wires keep the sides stiff.
  for (const sign of [-1, 1]) {
    wires.push(box(lengthM, WIRE_T, WIRE_T, 0, -WIRE_T / 2, sign * (widthM / 2 - WIRE_T / 2)));
  }
  group.add(mesh(mergeGeometries(wires), material));
  return group;
}

const PROFILES = {
  perforated: perforatedProfile,
  ladder: ladderProfile,
  duct: ductProfile,
  wiremesh: wiremeshProfile,
};

/** Build the straight-segment profile for `type` (unknown types fall back to ladder). */
export function buildTrayProfile(type, lengthM, widthM, heightM, material) {
  const build = PROFILES[type] || ladderProfile;
  return build(lengthM, widthM, heightM, material);
}

// ==================== FITTINGS ====================

export const FITTING_KINDS = new Set(["elbow", "tee", "cross", "reducer"]);
const REDUCER_LENGTH_M = 0.3;

/** Half the footprint of a fitting along each arm: where straight segments must stop. */
export function fittingCutM(fitting) {
  if (fitting.kind === "reducer") return REDUCER_LENGTH_M / 2;
  if (FITTING_KINDS.has(fitting.kind)) return Math.max(...fitting.arms.map((a) => a.widthM)) / 2;
  return 0;
}

/** Plate of a square fitting, styled per type. */
function fittingPlate(type, size, heightM, material) {
  if (type === "duct") return mesh(box(size, heightM, size, 0, -heightM / 2, 0), material);
  if (type === "ladder") {
    const rungs = [];
    const count = Math.max(2, Math.round(size / 0.12));
    for (let r = 0; r <= count; r++) {
      rungs.push(box(0.03, 0.03, size, -size / 2 + (r / count) * size, -heightM + 0.015, 0));
    }
    return mesh(mergeGeometries(rungs), material);
  }
  if (type === "wiremesh") {
    const wires = [];
    const count = Math.max(2, Math.round(size / 0.1));
    for (let i = 0; i <= count; i++) {
      const t = -size / 2 + (i / count) * size;
      wires.push(box(size, WIRE_T, WIRE_T, 0, -heightM + WIRE_T / 2, t));
      wires.push(box(WIRE_T, WIRE_T, size, t, -heightM + WIRE_T / 2, 0));
    }
    return mesh(mergeGeometries(wires), material);
  }
  return perforatedPlate(size, size, heightM, material);
}

/** Side wall on local side k (0 +x, 1 +z, 2 -x, 3 -z) of a square fitting. */
function fittingWall(side, size, heightM, material) {
  const along = side % 2 === 0; // wall runs along z on the +-x sides
  const offset = (side < 2 ? 1 : -1) * (size / 2 - WALL_T / 2);
  const geo = along
    ? box(WALL_T, heightM, size, offset, -heightM / 2, 0)
    : box(size, heightM, WALL_T, 0, -heightM / 2, offset);
  return mesh(geo, material);
}

function reducerFitting(fitting, type, heightM, material) {
  const group = new THREE.Group();
  const [a0, a1] = fitting.arms;
  const half0 = a0.widthM / 2;
  const half1 = a1.widthM / 2;
  const L = REDUCER_LENGTH_M;
  // Local +x points toward arm 1, -x toward arm 0.
  const shape = new THREE.Shape([
    new THREE.Vector2(-L / 2, -half0),
    new THREE.Vector2(L / 2, -half1),
    new THREE.Vector2(L / 2, half1),
    new THREE.Vector2(-L / 2, half0),
  ]);
  const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: type === "duct" ? heightM : WALL_T, bevelEnabled: false });
  plateGeo.rotateX(Math.PI / 2); // shape XY -> XZ, extrusion goes down
  const plateTop = type === "duct" ? 0 : -heightM + WALL_T;
  plateGeo.translate(0, plateTop, 0);
  group.add(mesh(plateGeo, material));
  if (type !== "duct") {
    for (const sign of [-1, 1]) {
      const dx = L;
      const dz = sign * (half1 - half0);
      const len = Math.hypot(dx, dz);
      const wall = mesh(box(len, heightM, WALL_T, 0, -heightM / 2, 0), material);
      wall.position.set(0, 0, sign * ((half0 + half1) / 2 - WALL_T / 2));
      wall.rotation.y = -Math.atan2(dz, dx);
      group.add(wall);
    }
  }
  group.rotation.y = -a1.angleRad;
  group.userData.wallCount = type === "duct" ? 0 : 2;
  return group;
}

/**
 * Fitting at a node: a base plate sized to the widest arm, with side walls only on the sides where
 * no arm leaves (reducer: tapered plate). The group is centered on the node, tray top at y = 0.
 */
export function buildFitting(fitting, type, heightM, material) {
  if (fitting.kind === "reducer") return reducerFitting(fitting, type, heightM, material);
  const size = Math.max(...fitting.arms.map((a) => a.widthM));
  const group = new THREE.Group();
  group.add(fittingPlate(type, size, heightM, material));
  const base = fitting.arms[0].angleRad;
  const open = new Set(
    fitting.arms.map((a) => (((Math.round((a.angleRad - base) / (Math.PI / 2)) % 4) + 4) % 4))
  );
  let walls = 0;
  if (type !== "duct") {
    for (let side = 0; side < 4; side++) {
      if (open.has(side)) continue;
      group.add(fittingWall(side, size, heightM, material));
      walls += 1;
    }
  }
  group.rotation.y = -base;
  group.userData.wallCount = walls;
  return group;
}

// ==================== WATERFALL DROPS ====================

const CHEEK_T = 0.005;
const WF_RADIUS_M = 0.11;
const WF_CENTER_Z = 0.008;
const WF_CENTER_Y = -0.104;
const WF_EXIT_Z = WF_CENTER_Z + WF_RADIUS_M; // 0.118m outer tangent face (just inside 0.13m cable drop)
const WF_BOTTOM_Y = -0.148;

function sampleWaterfallDropCurve(arcSteps = 14) {
  const pts = [];
  for (let i = 0; i <= arcSteps; i++) {
    const theta = (Math.PI / 2) * (1 - i / arcSteps);
    pts.push([WF_CENTER_Z + WF_RADIUS_M * Math.cos(theta), WF_CENTER_Y + WF_RADIUS_M * Math.sin(theta)]);
  }
  pts.push([WF_EXIT_Z, WF_BOTTOM_Y]);
  return pts;
}

/** Smooth ribbon BufferGeometry with distortion-free metric UVs for perforated sheets. */
function buildCurvedSheetGeometry(profilePts, widthM, repeatU, repeatV) {
  const arcLens = [0];
  for (let i = 1; i < profilePts.length; i++) {
    const dz = profilePts[i][0] - profilePts[i - 1][0];
    const dy = profilePts[i][1] - profilePts[i - 1][1];
    arcLens.push(arcLens[i - 1] + Math.hypot(dz, dy));
  }
  const totalLen = Math.max(1e-4, arcLens[arcLens.length - 1]);
  const halfW = widthM / 2;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < profilePts.length; i++) {
    const [z, y] = profilePts[i];
    const v = (arcLens[i] / totalLen) * repeatV;
    positions.push(-halfW, y, z, halfW, y, z);
    uvs.push(0, v, repeatU, v);
  }
  for (let i = 0; i < profilePts.length - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Quarter-round steel side guide cheek with top rail-saddle hook & rolled bottom foot. */
function buildQuarterRoundCheekGeometry(hookDepthM = 0.042) {
  const s = new THREE.Shape();
  s.moveTo(0.002, -0.048);
  s.lineTo(0.102, -0.104);
  s.lineTo(0.102, -0.153);
  s.lineTo(0.138, -0.153);
  s.lineTo(0.138, -0.147);
  s.lineTo(0.125, -0.147);
  s.quadraticCurveTo(0.125, 0.048, 0.006, 0.048);
  s.lineTo(-0.036, 0.048);
  s.lineTo(-0.036, -hookDepthM);
  s.lineTo(-0.023, -hookDepthM);
  s.lineTo(-0.023, 0.005);
  s.lineTo(0.002, 0.005);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, { depth: CHEEK_T, bevelEnabled: false, curveSegments: 14 });
  geo.translate(0, 0, -CHEEK_T / 2);
  geo.rotateY(-Math.PI / 2); // Shape X -> +Z outward, Shape Y -> +Y up
  return geo;
}

function buildWireRodSegment(p1, p2, radius) {
  const dz = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dz, dy);
  if (len < 1e-4) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6, 1);
  geo.rotateX(Math.PI / 2 - Math.atan2(dy, dz));
  geo.translate(0, (p1[1] + p2[1]) / 2, (p1[0] + p2[0]) / 2);
  return geo;
}

function perforatedOrLadderWaterfall(type, widthM, heightM, material) {
  const group = new THREE.Group();
  const w = Math.max(0.16, Number(widthM) || 0.22);
  const innerW = Math.max(0.12, w - 0.012);
  const dropPts = sampleWaterfallDropCurve(14);

  // Arc length for undistorted slot pitch
  let arcLen = 0;
  for (let i = 1; i < dropPts.length; i++) {
    arcLen += Math.hypot(dropPts[i][0] - dropPts[i - 1][0], dropPts[i][1] - dropPts[i - 1][1]);
  }
  const repeatU = Math.max(3, Math.round(innerW / WF_SLOT_PITCH_U));
  const repeatV = Math.max(3, Math.round(arcLen / WF_SLOT_PITCH_V));

  const sheetMat = material.clone();
  sheetMat.side = THREE.DoubleSide;
  const slotTex = getWaterfallSlotTexture();
  if (slotTex) {
    const alpha = slotTex.clone();
    alpha.needsUpdate = true;
    alpha.repeat.set(repeatU, repeatV);
    sheetMat.alphaMap = alpha;
    sheetMat.alphaTest = 0.5;
  }

  // Main oval-perforated quarter-round chute shell
  group.add(mesh(buildCurvedSheetGeometry(dropPts, innerW, repeatU, repeatV), sheetMat));

  // Solid top saddle flange hooking over the tray side wall + bottom rolled stiffener lip
  const saddleShape = new THREE.Shape();
  saddleShape.moveTo(-0.029, -0.026);
  saddleShape.lineTo(-0.029, 0.008);
  saddleShape.lineTo(0.010, 0.008);
  saddleShape.lineTo(0.010, 0.003);
  saddleShape.lineTo(-0.023, 0.003);
  saddleShape.lineTo(-0.023, -0.026);
  saddleShape.closePath();
  const saddleGeo = new THREE.ExtrudeGeometry(saddleShape, { depth: w, bevelEnabled: false });
  saddleGeo.translate(0, 0, -w / 2);
  saddleGeo.rotateY(-Math.PI / 2);
  group.add(mesh(saddleGeo, material));

  // Rolled bottom edge lip so cables exit cleanly without sharp edges
  const bottomLip = new THREE.CylinderGeometry(0.005, 0.005, innerW, 8);
  bottomLip.rotateZ(Math.PI / 2);
  bottomLip.translate(0, WF_BOTTOM_Y, WF_EXIT_Z + 0.003);
  group.add(mesh(bottomLip, material));

  // Quarter-round curved cheek flanges on both edges (deeper C-clamp hook for ladder rails)
  const isLadder = type === "ladder";
  const hookDepth = isLadder ? Math.min(0.14, (Number(heightM) || 0.1) + 0.012) : 0.042;
  const cheekGeo = buildQuarterRoundCheekGeometry(hookDepth);
  for (const sx of [-w / 2, w / 2]) {
    const cheek = mesh(cheekGeo, material);
    cheek.position.x = sx;
    group.add(cheek);
  }

  // Mounting latch clips on the inside back apron of the tray rail
  const clipGeos = [];
  const clipOffsets = w >= 0.36 ? [-innerW * 0.36, 0, innerW * 0.36] : [-innerW * 0.32, innerW * 0.32];
  for (const cx of clipOffsets) {
    clipGeos.push(box(0.024, 0.016, 0.010, cx, 0.002, -0.026));
    if (isLadder) {
      clipGeos.push(box(0.016, hookDepth, 0.008, cx, -hookDepth / 2, -0.024));
    }
  }
  if (clipGeos.length) group.add(mesh(mergeGeometries(clipGeos), material));

  return group;
}

function ductWaterfall(widthM, material) {
  const group = new THREE.Group();
  const w = Math.max(0.16, Number(widthM) || 0.22);
  const solidShape = new THREE.Shape();
  solidShape.moveTo(-0.028, -0.025);
  solidShape.lineTo(-0.028, 0.008);
  solidShape.lineTo(0.008, 0.008);
  solidShape.quadraticCurveTo(WF_EXIT_Z, 0.008, WF_EXIT_Z, -0.104);
  solidShape.lineTo(WF_EXIT_Z, WF_BOTTOM_Y);
  solidShape.lineTo(WF_EXIT_Z - 0.010, WF_BOTTOM_Y);
  solidShape.lineTo(WF_EXIT_Z - 0.010, -0.104);
  solidShape.quadraticCurveTo(WF_EXIT_Z - 0.010, -0.002, 0.005, -0.002);
  solidShape.lineTo(-0.021, -0.002);
  solidShape.lineTo(-0.021, -0.025);
  solidShape.closePath();

  const shellGeo = new THREE.ExtrudeGeometry(solidShape, { depth: w, bevelEnabled: false, curveSegments: 14 });
  shellGeo.translate(0, 0, -w / 2);
  shellGeo.rotateY(-Math.PI / 2);
  group.add(mesh(shellGeo, material));

  const cheekGeo = buildQuarterRoundCheekGeometry(0.048);
  for (const sx of [-w / 2, w / 2]) {
    const cheek = mesh(cheekGeo, material);
    cheek.position.x = sx;
    group.add(cheek);
  }
  return group;
}

function wiremeshWaterfall(widthM, material) {
  const group = new THREE.Group();
  const w = Math.max(0.16, Number(widthM) || 0.22);
  const fullCurvePts = [[-0.024, -0.028], [-0.024, 0.006], ...sampleWaterfallDropCurve(10)];
  const wireParts = [];
  const radius = WIRE_T / 2;

  const ribCount = Math.max(3, Math.round(w / 0.055));
  for (let r = 0; r <= ribCount; r++) {
    const x = -w / 2 + (r / ribCount) * w;
    for (let i = 0; i < fullCurvePts.length - 1; i++) {
      const seg = buildWireRodSegment(fullCurvePts[i], fullCurvePts[i + 1], radius);
      if (seg) {
        seg.translate(x, 0, 0);
        wireParts.push(seg);
      }
    }
  }

  // Transverse tie rods across the curved ribs
  for (const idx of [1, 4, 7, 10, fullCurvePts.length - 1]) {
    const [z, y] = fullCurvePts[Math.min(idx, fullCurvePts.length - 1)];
    const cross = new THREE.CylinderGeometry(radius, radius, w, 6);
    cross.rotateZ(Math.PI / 2);
    cross.translate(0, y, z);
    wireParts.push(cross);
  }

  // Side wire containment hoops matching wiremesh basket side walls
  const hoopPts = [
    [-0.026, -0.028],
    [-0.026, 0.044],
    [0.006, 0.044],
    [0.088, 0.022],
    [0.124, -0.056],
    [0.124, -0.148],
  ];
  for (const sx of [-w / 2, w / 2]) {
    for (let i = 0; i < hoopPts.length - 1; i++) {
      const seg = buildWireRodSegment(hoopPts[i], hoopPts[i + 1], radius * 1.1);
      if (seg) {
        seg.translate(sx, 0, 0);
        wireParts.push(seg);
      }
    }
  }

  group.add(mesh(mergeGeometries(wireParts), material));
  return group;
}

/**
 * Build a 3D edge-mounted Tray Waterfall drop guide matching the host tray `type`
 * (`perforated` | `ladder` | `wiremesh` | `duct`) and using the caller's tray material so color blends.
 */
export function buildTrayWaterfall(type, widthM, heightM, material) {
  let assembly;
  if (type === "duct") {
    assembly = ductWaterfall(widthM, material);
  } else if (type === "wiremesh") {
    assembly = wiremeshWaterfall(widthM, material);
  } else {
    assembly = perforatedOrLadderWaterfall(type === "ladder" ? "ladder" : "perforated", widthM, heightM, material);
  }
  assembly.userData.waterfallVariant = TRAY_TYPES.includes(type) ? type : "perforated";
  return assembly;
}
