import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRoomFaces,
  faceAt,
  findFreeEnds,
  isSimplePolygon,
  pointInPolygon,
  polygonArea,
} from "../../frontend/js/roomFaces.js";

/** walls: [[x1, y1, x2, y2], ...]; endpoints with equal coordinates share a node. */
function mk(walls, scale = 30) {
  const nodes = [];
  const ids = new Map();
  const nodeFor = (x, y) => {
    const key = `${x},${y}`;
    if (!ids.has(key)) {
      ids.set(key, `n${ids.size + 1}`);
      nodes.push({ id: ids.get(key), x_px: x, y_px: y });
    }
    return ids.get(key);
  };
  return {
    metadata: { scale_px_per_meter: scale },
    nodes,
    walls: walls.map(([a, b, c, d], i) => ({ id: `w${i + 1}`, start_node: nodeFor(a, b), end_node: nodeFor(c, d) })),
    rooms: [],
  };
}

const box = (x0, y0, x1, y1) => [
  [x0, y0, x1, y0],
  [x1, y0, x1, y1],
  [x1, y1, x0, y1],
  [x0, y1, x0, y0],
];
const OPTS = { gapPx: 8, minAreaPx: 100 };
const areas = (faces) => faces.map((f) => Math.round(Math.abs(f.area)));

test("closed rectangle gives one face with the right area", () => {
  const faces = buildRoomFaces(mk(box(0, 0, 200, 100)), OPTS);
  assert.equal(faces.length, 1);
  assert.equal(Math.round(Math.abs(faces[0].area)), 20000);
  assert.equal(faces[0].polygon.length, 4);
});

test("two rooms sharing a wall give two faces", () => {
  const walls = [...box(0, 0, 400, 200), [200, 0, 200, 200]];
  assert.deepEqual(areas(buildRoomFaces(mk(walls), OPTS)), [40000, 40000]);
});

test("L shaped room gives one face with six vertices", () => {
  const pts = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]];
  const walls = pts.map((p, i) => [...p, ...pts[(i + 1) % pts.length]]);
  const faces = buildRoomFaces(mk(walls), OPTS);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].polygon.length, 6);
  assert.equal(Math.round(Math.abs(faces[0].area)), 50000);
});

test("a 5 px gap closes with gapPx 8", () => {
  const walls = [[0, 0, 200, 0], [200, 0, 200, 200], [0, 200, 98, 200], [103, 200, 200, 200], [0, 200, 0, 0]];
  assert.equal(buildRoomFaces(mk(walls), OPTS).length, 1);
});

test("a 30 px gap does not close with gapPx 8", () => {
  const walls = [[0, 0, 200, 0], [200, 0, 200, 200], [0, 200, 85, 200], [115, 200, 200, 200], [0, 200, 0, 0]];
  assert.equal(buildRoomFaces(mk(walls), OPTS).length, 0);
});

test("a wall ending 3 px short of another wall closes the room (T junction)", () => {
  const walls = [...box(0, 0, 200, 200), [100, 3, 100, 200]];
  const faces = buildRoomFaces(mk(walls), OPTS);
  assert.equal(faces.length, 2);
});

test("two walls crossing without a shared node make four faces", () => {
  const walls = [...box(0, 0, 200, 200), [0, 100, 200, 100], [100, 0, 100, 200]];
  assert.deepEqual(areas(buildRoomFaces(mk(walls), OPTS)), [10000, 10000, 10000, 10000]);
});

test("a dangling stub inside a room does not change its polygon", () => {
  const walls = [...box(0, 0, 200, 200), [100, 0, 100, 60]];
  const faces = buildRoomFaces(mk(walls), OPTS);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].polygon.length, 4);
  assert.equal(Math.round(Math.abs(faces[0].area)), 40000);
});

test("a closed island inside a room leaves the room face intact and adds the island face", () => {
  const walls = [...box(0, 0, 400, 400), ...box(150, 150, 250, 250)];
  assert.deepEqual(areas(buildRoomFaces(mk(walls), OPTS)), [10000, 160000]);
});

test("an open U shape gives no faces", () => {
  const walls = [[0, 0, 0, 200], [0, 200, 200, 200], [200, 200, 200, 0]];
  assert.equal(buildRoomFaces(mk(walls), OPTS).length, 0);
});

test("faces below minAreaPx are dropped", () => {
  assert.equal(buildRoomFaces(mk(box(0, 0, 10, 10)), { gapPx: 2, minAreaPx: 500 }).length, 0);
  assert.equal(buildRoomFaces(mk(box(0, 0, 200, 100)), { gapPx: 8, minAreaPx: 500 }).length, 1);
});

test("collinear vertices are removed from face polygons", () => {
  const walls = [[0, 0, 100, 0], [100, 0, 200, 0], [200, 0, 200, 100], [200, 100, 0, 100], [0, 100, 0, 0]];
  assert.equal(buildRoomFaces(mk(walls), OPTS)[0].polygon.length, 4);
});

test("every face has the same winding", () => {
  const faces = buildRoomFaces(mk([...box(0, 0, 400, 200), [200, 0, 200, 200]]), OPTS);
  assert.ok(faces.every((f) => Math.sign(polygonArea(f.polygon)) === Math.sign(faces[0].area)));
});

test("faceAt returns the smallest containing face and null outside", () => {
  const faces = buildRoomFaces(mk([...box(0, 0, 400, 400), ...box(150, 150, 250, 250)]), OPTS);
  assert.equal(Math.round(Math.abs(faceAt(faces, 200, 200).area)), 10000);
  assert.equal(Math.round(Math.abs(faceAt(faces, 50, 50).area)), 160000);
  assert.equal(faceAt(faces, 600, 600), null);
});

test("isSimplePolygon rejects a bow tie and accepts a rectangle and an L", () => {
  assert.equal(isSimplePolygon([[0, 0], [100, 100], [100, 0], [0, 100]]), false);
  assert.equal(isSimplePolygon([[0, 0], [100, 0], [100, 100], [0, 100]]), true);
  assert.equal(isSimplePolygon([[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]]), true);
  assert.equal(isSimplePolygon([[0, 0], [100, 0]]), false);
  assert.equal(isSimplePolygon([[0, 0], [100, 0], [200, 0]]), false);
});

test("polygonArea and pointInPolygon basics", () => {
  const rect = [[0, 0], [200, 0], [200, 100], [0, 100]];
  assert.equal(Math.abs(polygonArea(rect)), 20000);
  assert.equal(pointInPolygon([100, 50], rect), true);
  assert.equal(pointInPolygon([300, 50], rect), false);
});

test("buildRoomFaces does not mutate the project", () => {
  const project = mk([...box(0, 0, 200, 100), [100, 0, 100, 100]]);
  const before = JSON.stringify(project);
  buildRoomFaces(project, OPTS);
  assert.equal(JSON.stringify(project), before);
});

test("findFreeEnds returns the two ends of an isolated wall", () => {
  const ends = findFreeEnds(mk([[0, 0, 200, 0]]), { gapPx: 8 });
  assert.equal(ends.length, 2);
  assert.deepEqual(ends.map((p) => p.map(Math.round)).sort((a, b) => a[0] - b[0]), [[0, 0], [200, 0]]);
});

test("findFreeEnds ignores ends bridged within the gap", () => {
  assert.equal(findFreeEnds(mk([[0, 0, 98, 0], [102, 0, 200, 0]]), { gapPx: 8 }).length, 2);
  const closedChain = [...box(0, 0, 200, 100), [200, 0, 300, 0]];
  assert.equal(findFreeEnds(mk(closedChain), { gapPx: 8 }).length, 1);
});

test("findFreeEnds returns the open ends of a U shape", () => {
  const walls = [[0, 0, 0, 200], [0, 200, 200, 200], [200, 200, 200, 0]];
  assert.equal(findFreeEnds(mk(walls), { gapPx: 8 }).length, 2);
});

test("findFreeEnds returns nothing for a closed rectangle", () => {
  assert.equal(findFreeEnds(mk(box(0, 0, 200, 100)), { gapPx: 8 }).length, 0);
});

test("real saved rooms are found (local acceptance, skipped without workspace data)", (t) => {
  const root = path.resolve("workspace/projects");
  if (!fs.existsSync(root)) return t.skip("no local workspace");
  let total = 0;
  let found = 0;
  for (const id of fs.readdirSync(root)) {
    const file = path.join(root, id, "project.json");
    if (!fs.existsSync(file)) continue;
    const project = JSON.parse(fs.readFileSync(file, "utf8"));
    const faces = buildRoomFaces(project);
    for (const room of project.rooms || []) {
      const poly = room.polygon_px || [];
      if (poly.length < 3) continue;
      total += 1;
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      if (faceAt(faces, cx, cy)) found += 1;
    }
  }
  if (total === 0) return t.skip("no saved rooms");
  assert.ok(found / total >= 0.8, `${found}/${total} saved rooms matched a face`);
});
