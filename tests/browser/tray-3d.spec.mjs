import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };
const TYPES = ["perforated", "ladder", "duct", "wiremesh"];

async function bootStage5(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 5);
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
    await bootStage5(page);
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
    await bootStage5(page);
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
