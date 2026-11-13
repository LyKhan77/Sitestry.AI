/**
 * Sitestry.AI — 3D cable tray profiles.
 *
 * One cross-section per tray type, swept along a straight segment. The group is centered on the
 * segment midpoint, the long axis is local X and the tray top sits at y = 0 (the caller places the
 * group at `elevation_m`, which is the tray top).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const WALL_T = 0.02; // side wall and plate thickness
const WIRE_T = 0.006; // wire mesh wire thickness
const HOLE_PITCH_M = 0.05; // perforation spacing

let perforationTexture = null;

/** Repeating dot pattern used as an alpha map so the base plate looks perforated. */
function getPerforationTexture() {
  if (perforationTexture) return perforationTexture;
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
  const alpha = getPerforationTexture().clone();
  alpha.needsUpdate = true;
  alpha.repeat.set(Math.max(1, lengthM / HOLE_PITCH_M), Math.max(1, widthM / HOLE_PITCH_M));
  plateMat.alphaMap = alpha;
  plateMat.alphaTest = 0.5;
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
