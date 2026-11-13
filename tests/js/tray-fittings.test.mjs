import test from "node:test";
import assert from "node:assert/strict";
import { insertTrayRun } from "../../frontend/js/trayNetwork.js";
import { deriveFittings } from "../../frontend/js/trayFittings.js";

const project = () => ({ metadata: { scale_px_per_meter: 10 }, tray_nodes: [], cable_trays: [] });
const props = (id, width_m = 0.5) => ({ id, name: id, type: "perforated", width_m, height_m: 0.1, elevation_m: 3.35 });
const kinds = (p) => Object.fromEntries([...deriveFittings(p, 10)].map(([, f]) => [`${f.x_px},${f.y_px}`, f.kind]));

test("a straight run has end nodes and a straight middle", () => {
  const p = project();
  insertTrayRun(p, [[0, 0], [100, 0], [200, 0]], props("a"), 1);
  assert.deepEqual(kinds(p), { "0,0": "end", "100,0": "straight", "200,0": "end" });
});

test("a bend is an elbow with two arms", () => {
  const p = project();
  insertTrayRun(p, [[0, 0], [100, 0], [100, 80]], props("a"), 1);
  const f = [...deriveFittings(p, 10).values()].find((x) => x.kind === "elbow");
  assert.equal(f.x_px, 100);
  assert.equal(f.arms.length, 2);
  assert.deepEqual(f.arms.map((a) => a.widthM), [0.5, 0.5]);
});

test("a run ending mid-segment makes a tee with three arms", () => {
  const p = project();
  insertTrayRun(p, [[0, 0], [200, 0]], props("a"), 1);
  insertTrayRun(p, [[100, 90], [100, 1]], props("b"), 2);
  const tee = [...deriveFittings(p, 10).values()].find((x) => x.kind === "tee");
  assert.equal(tee.arms.length, 3);
  assert.deepEqual(new Set(tee.arms.map((a) => a.trayId)), new Set(["a", "b"]));
});

test("two crossing runs make a cross with four arms", () => {
  const p = project();
  insertTrayRun(p, [[0, 0], [200, 0]], props("a"), 1);
  insertTrayRun(p, [[100, -90], [100, 0], [100, 90]], props("b"), 2);
  const cross = [...deriveFittings(p, 10).values()].find((x) => x.kind === "cross");
  assert.equal(cross.arms.length, 4);
});

test("collinear trays of different width meet at a reducer", () => {
  const p = project();
  insertTrayRun(p, [[0, 0], [100, 0]], props("a", 0.4), 1);
  insertTrayRun(p, [[100, 0], [200, 0]], props("b", 0.6), 1);
  assert.equal(kinds(p)["100,0"], "reducer");
});

test("bends within 5 degrees count as straight, beyond as an elbow", () => {
  const bend = (deg) => {
    const p = project();
    const r = (deg * Math.PI) / 180;
    insertTrayRun(p, [[-100, 0], [0, 0], [100 * Math.cos(r), 100 * Math.sin(r)]], props("a"), 0.1);
    return kinds(p)["0,0"];
  };
  assert.equal(bend(4), "straight");
  assert.equal(bend(6), "elbow");
});

test("nodes no tray touches get no fitting", () => {
  const p = project();
  p.tray_nodes.push({ id: "tn_9", x_px: 5, y_px: 5 });
  assert.equal(deriveFittings(p, 10).size, 0);
});
