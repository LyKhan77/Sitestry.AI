import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };
const TYPES = ["perforated", "ladder", "duct", "wiremesh"];

async function bootStage4(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 4);
}

/** One 4 m tray per type on separate rows, then rebuild the 3D scene and describe every tray group. */
const buildAndDescribe = (page) =>
  page.evaluate(async () => {
    const THREE = await import("three");
    const app = window.sitestryApp;
    const store = app.canvas2d.store;
    store.project.cable_trays = [];
    const scale = store.project.metadata.scale_px_per_meter;
    ["perforated", "ladder", "duct", "wiremesh"].forEach((type, i) => {
      store.addCableTray([[600, 600 + i * 40], [600 + 4 * scale, 600 + i * 40]], { type });
    });
    store.builtProject = structuredClone(store.project);
    app.viewer3d.rebuildScene();
    const groups = app.viewer3d.selectableMeshes.filter((g) => g.userData?.sitestryKind === "tray");
    return groups.map((g) => {
      const box = new THREE.Box3().setFromObject(g);
      const meshes = [];
      g.traverse((o) => o.isMesh && meshes.push(o));
      const tray = store.project.cable_trays.find((t) => t.id === g.userData.sitestryId);
      return {
        type: g.userData.trayType,
        expectedType: tray.type,
        top: box.max.y,
        height: box.max.y - box.min.y,
        elevation: tray.elevation_m,
        heightM: tray.height_m,
        signature: meshes.map((m) => m.geometry.attributes.position.count).join(","),
      };
    });
  });

test.describe("3D tray profiles", () => {
  test("each type builds its own profile with the top at the tray elevation", async ({ page }) => {
    await bootStage4(page);
    const trays = await buildAndDescribe(page);
    expect(trays).toHaveLength(4);
    for (const t of trays) {
      expect(TYPES).toContain(t.type);
      expect(t.type).toBe(t.expectedType);
      expect(Math.abs(t.top - t.elevation)).toBeLessThan(0.01);
      expect(Math.abs(t.height - t.heightM)).toBeLessThan(0.011);
    }
    expect(new Set(trays.map((t) => t.signature)).size).toBe(4);
  });

  test("GLB export still works with every tray type in the scene", async ({ page }) => {
    await bootStage4(page);
    await buildAndDescribe(page);
    const info = await page.evaluate(async () => {
      const buffer = await window.sitestryApp.viewer3d.exportGLB("trays.glb", { download: false });
      const view = new DataView(buffer);
      const jsonLength = view.getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(buffer.slice(20, 20 + jsonLength)));
      return {
        magic: view.getUint32(0, true),
        trayNodes: json.nodes.filter((n) => n.extras?.sitestryKind === "tray").length,
      };
    });
    expect(info.magic).toBe(0x46546c67);
    expect(info.trayNodes).toBe(4);
  });
});

/** L, T, plus and reducer scenes built through the store, then describe every fitting group. */
const buildFittingScenes = (page) =>
  page.evaluate(async () => {
    const THREE = await import("three");
    const app = window.sitestryApp;
    const store = app.canvas2d.store;
    store.project.cable_trays = [];
    store.project.tray_nodes = [];
    // L (elbow at 700,600)
    store.addCableTray([[600, 600], [700, 600], [700, 680]]);
    // T: second run ends mid-segment of the first
    store.addCableTray([[600, 800], [800, 800]]);
    store.addCableTray([[700, 880], [700, 800]]);
    // Plus: second run crosses the first mid-segment
    store.addCableTray([[1000, 600], [1200, 600]]);
    store.addCableTray([[1100, 520], [1100, 600], [1100, 680]]);
    // Reducer: collinear runs of different width
    store.addCableTray([[1000, 900], [1100, 900]], { width_m: 0.4 });
    store.addCableTray([[1100, 900], [1200, 900]], { width_m: 0.6 });
    store.builtProject = structuredClone(store.project);
    app.viewer3d.rebuildScene();
    const nodeAt = (x, y) => store.project.tray_nodes.find((n) => Math.hypot(n.x_px - x, n.y_px - y) < 1);
    const fittings = app.viewer3d.selectableMeshes
      .filter((g) => g.userData?.fittingKind)
      .map((g) => {
        const box = new THREE.Box3().setFromObject(g);
        return {
          kind: g.userData.fittingKind,
          wallCount: g.userData.wallCount,
          sizeX: box.max.x - box.min.x,
          sizeZ: box.max.z - box.min.z,
          meshes: (() => { let n = 0; g.traverse((o) => o.isMesh && n++); return n; })(),
        };
      });
    // Distance from the elbow node to the nearest straight segment of the L tray.
    const elbowNode = nodeAt(700, 600);
    const centre = app.viewer3d.pxToMeter3D(elbowNode.x_px, elbowNode.y_px);
    const lTrayId = store.project.cable_trays[0].id;
    const lGroup = app.viewer3d.selectableMeshes.find((g) => g.userData?.sitestryId === lTrayId && !g.userData.fittingKind);
    const segDistances = lGroup.children.map((seg) => {
      const b = new THREE.Box3().setFromObject(seg);
      return Math.hypot(
        Math.max(b.min.x - centre.x, 0, centre.x - b.max.x),
        Math.max(b.min.z - centre.z, 0, centre.z - b.max.z)
      );
    });
    return { fittings, segDistances };
  });

test.describe("3D tray fittings", () => {
  test("elbow, tee, cross and reducer are built once each at the right nodes", async ({ page }) => {
    await bootStage4(page);
    const { fittings } = await buildFittingScenes(page);
    const byKind = Object.fromEntries(fittings.map((f) => [f.kind, f]));
    expect(fittings.map((f) => f.kind).sort()).toEqual(["cross", "elbow", "reducer", "tee"]);
    expect(byKind.elbow.wallCount).toBe(2);
    expect(byKind.tee.wallCount).toBe(1);
    expect(byKind.cross.wallCount).toBe(0);
    for (const f of fittings) expect(f.meshes).toBeGreaterThan(0);
    expect(Math.abs(byKind.cross.sizeX - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(byKind.cross.sizeZ - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(byKind.reducer.sizeX - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(byKind.reducer.sizeZ - 0.6)).toBeLessThan(0.03);
  });

  test("straight segments stop at the fitting instead of overlapping it", async ({ page }) => {
    await bootStage4(page);
    const { segDistances } = await buildFittingScenes(page);
    expect(segDistances).toHaveLength(2);
    for (const d of segDistances) expect(d).toBeGreaterThan(0.24);
  });

  test("GLB export includes the fitting groups", async ({ page }) => {
    await bootStage4(page);
    await buildFittingScenes(page);
    const info = await page.evaluate(async () => {
      const app = window.sitestryApp;
      const expected = app.viewer3d.selectableMeshes.filter((g) => g.userData?.sitestryKind === "tray").length;
      const buffer = await app.viewer3d.exportGLB("fittings.glb", { download: false });
      const view = new DataView(buffer);
      const json = JSON.parse(new TextDecoder().decode(buffer.slice(20, 20 + view.getUint32(12, true))));
      const nodes = json.nodes.filter((n) => n.extras?.sitestryKind === "tray");
      return { expected, trayNodes: nodes.length, fittingNodes: nodes.filter((n) => n.extras.fittingKind).length };
    });
    expect(info.trayNodes).toBe(info.expected);
    expect(info.fittingNodes).toBe(4);
  });
});
