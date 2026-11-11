import { test, expect } from "@playwright/test";
import { gotoApp, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

async function createStair(page, shape, startPoint, endPoint) {
  await page.evaluate((shapeValue) => {
    const { store } = window.sitestryApp.canvas2d;
    store.ui.stairDefaults.shape = shapeValue;
    store.ui.stairDefaults.turn = "right";
    store.ui.stairDefaults.flight_run_m = shapeValue === "U" ? 3 : null;
    store.setActiveTool("stair");
  }, shape);
  const [a, b] = await worldPointsToScreen(page, [startPoint, endPoint], 0.9);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(350);
  return page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return store.project.stairs[store.project.stairs.length - 1];
  });
}

async function exportAndParse(page, filename) {
  return page.evaluate(async (name) => {
    const app = window.sitestryApp;
    const buffer = await app.viewer3d.exportGLB(name, { download: false });
    if (!buffer) return null;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not GLB");
    let offset = 12;
    let json = null;
    while (offset < buffer.byteLength) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const chunk = buffer.slice(offset + 8, offset + 8 + length);
      if (type === 0x4e4f534a) {
        json = JSON.parse(new TextDecoder().decode(chunk));
        break;
      }
      offset += 8 + length;
    }
    const nodes = json?.nodes || [];
    const summary = {
      revision: app.viewer3d.sceneSync.lastBuiltRevision,
      storeRevision: (await import("/js/store.js")).store.revision,
      stairNodes: nodes.filter((n) => n.extras?.role === "staircase"),
      treads: nodes.filter((n) => n.extras?.role === "tread"),
      landings: nodes.filter((n) => n.extras?.role === "landing"),
      guardrails: nodes.filter((n) => n.extras?.role === "guardrail"),
      nodeCount: nodes.length,
    };
    return summary;
  }, filename);
}

test.describe("3D and GLB stair synchronization", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
  });

  test("parametric L stair exports matching tread and landing mesh counts", async ({ page }) => {
    const stair = await createStair(page, "L", { x: 1150, y: 850 }, { x: 1230, y: 930 });
    const expected = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      const { resolveStairGeometry } = await import("/js/stairGeometry.js");
      const s = store.project.stairs.find((item) => item.id === id);
      const geometry = resolveStairGeometry(s, store.project.metadata.scale_px_per_meter);
      return { treads: geometry.treads.length, landings: geometry.landings.length };
    }, stair.id);
    const glb = await exportAndParse(page, "stair-l.glb");
    expect(glb).toBeTruthy();
    expect(glb.treads.length).toBe(expected.treads);
    expect(glb.landings.length).toBe(expected.landings);
    expect(glb.stairNodes[0].extras.sitestryId).toBe(stair.id);
    expect(glb.stairNodes[0].extras.shape).toBe("L");
    expect(glb.guardrails.length).toBeGreaterThan(0);
    expect(glb.revision).toBe(glb.storeRevision);
  });

  test("immediate export after edit follows the newest commit", async ({ page }) => {
    const stair = await createStair(page, "straight", { x: 1100, y: 800 }, { x: 1200, y: 800 });
    const updated = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      const result = store.updateParametricStair(id, {
        shape: "U",
        heading_rad: 0,
        flight_run_m: 3,
        end_px: { x_px: 1100, y_px: 850 },
        turn: "right",
      });
      return { ok: result.ok, revision: store.revision };
    }, stair.id);
    expect(updated.ok).toBe(true);
    const glb = await exportAndParse(page, "stair-u.glb");
    expect(glb.revision).toBe(updated.revision);
    expect(glb.stairNodes[0].extras.shape).toBe("U");
    expect(glb.landings.length).toBe(1);
  });

  test("export is rejected while a transaction is active", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const token = store.beginTransaction("export-guard");
      const app = window.sitestryApp;
      const buffer = await app.viewer3d.exportGLB("guard.glb", { download: false });
      store.cancelTransaction(token);
      return { buffer, toasts: document.getElementById("toastContainer").textContent };
    });
    expect(result.buffer).toBe(null);
    expect(result.toasts).toMatch(/Selesaikan atau batalkan edit/);
  });

  test("cancelled tentative delete exports the restored committed geometry", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const app = window.sitestryApp;
      const token = store.beginTransaction("tentative-delete");
      store.selectObject("wall", store.project.walls[0].id);
      store.deleteSelected();
      await new Promise((resolve) => setTimeout(resolve, 80));
      store.cancelTransaction(token);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const buffer = await app.viewer3d.exportGLB("cancel.glb", { download: false });
      const view = new DataView(buffer);
      let offset = 12;
      let nodeCount = 0;
      while (offset < buffer.byteLength) {
        const length = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        if (type === 0x4e4f534a) {
          const json = JSON.parse(new TextDecoder().decode(buffer.slice(offset + 8, offset + 8 + length)));
          nodeCount = (json.nodes || []).length;
          break;
        }
        offset += 8 + length;
      }
      return {
        walls: store.project.walls.length,
        nodeCount,
        revision: store.revision,
        built: app.viewer3d.sceneSync.lastBuiltRevision,
      };
    });
    expect(result.walls).toBeGreaterThan(0);
    expect(result.nodeCount).toBeGreaterThan(5);
    expect(result.built).toBe(result.revision);
  });

  test("legacy stairs still render and repeated rebuilds do not leak geometry", async ({ page }) => {
    const counts = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const app = window.sitestryApp;
      app.viewer3d.rebuildScene();
      const rendered = app.viewer3d.selectableMeshes.filter(
        (mesh) => mesh.userData?.sitestryKind === "stair"
      );
      const legacy = store.project.stairs.filter((stair) => !stair.template_version);
      const before = app.viewer3d.renderer.info.memory.geometries;
      for (let i = 0; i < 6; i += 1) {
        app.viewer3d.rebuildScene();
      }
      const after = app.viewer3d.renderer.info.memory.geometries;
      return { renderedStairs: rendered.length, legacyCount: legacy.length, before, after };
    });
    expect(counts.renderedStairs).toBeGreaterThanOrEqual(counts.legacyCount);
    expect(counts.after).toBeLessThanOrEqual(counts.before + 2);
  });

  test("JSON export preserves template parameters and excludes guide cache", async ({ page }) => {
    const stair = await createStair(page, "straight", { x: 1100, y: 750 }, { x: 1180, y: 750 });
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => window.sitestryApp.exportProjectJson());
    const download = await downloadPromise;
    const path = await download.path();
    const fs = await import("node:fs/promises");
    const data = JSON.parse(await fs.readFile(path, "utf8"));
    const exported = data.stairs.find((item) => item.id === stair.id);
    expect(exported.template_version).toBe(1);
    expect(exported.shape).toBe("straight");
    expect(exported.start_px).toBeTruthy();
    expect(exported.end_px).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(data, "guideCandidates")).toBe(false);
  });
});
