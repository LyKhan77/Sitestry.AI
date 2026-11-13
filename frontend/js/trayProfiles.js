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

function perforatedProfile(lengthM, widthM, heightM, material) {
  const group = new THREE.Group();
  const plateMat = material.clone();
  const alpha = getPerforationTexture().clone();
  alpha.needsUpdate = true;
  alpha.repeat.set(Math.max(1, lengthM / HOLE_PITCH_M), Math.max(1, widthM / HOLE_PITCH_M));
  plateMat.alphaMap = alpha;
  plateMat.alphaTest = 0.5;
  plateMat.side = THREE.DoubleSide;
  group.add(mesh(box(lengthM, WALL_T, widthM, 0, -heightM + WALL_T / 2, 0), plateMat));
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
