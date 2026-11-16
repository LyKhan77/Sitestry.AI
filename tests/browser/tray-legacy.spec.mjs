import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

test("a legacy points_px tray renders in 2D and 3D after migration", async ({ page }) => {
  await gotoAppV4(page, { width: 1440, height: 960 });
  await loadStage(page, 4);
  const info = await page.evaluate(() => {
    const app = window.sitestryApp;
    const store = app.canvas2d.store;
    const data = JSON.parse(JSON.stringify(store.project));
    data.cable_trays = [
      { id: "old", name: "Old", type: "ladder", width_m: 0.5, elevation_m: 2.75, color: "#cba258", points_px: [[600, 600], [800, 600], [800, 700]] },
    ];
    delete data.tray_nodes;
    store.loadProjectData(data, true);
    store.builtProject = structuredClone(store.project);
    app.canvas2d.renderAll();
    app.viewer3d.rebuildScene();
    const all = app.viewer3d.selectableMeshes.filter((g) => g.userData?.sitestryKind === "tray");
    const groups = all.filter((g) => !g.userData.fittingKind);
    return {
      nodes: store.project.tray_nodes.length,
      hasPoints: "points_px" in store.project.cable_trays[0],
      konvaTrayLines: app.canvas2d.cmeLayer.find((n) => n.className === "Line" && (n.dash() || []).length === 0 && n.opacity() === 0.42).length,
      groups: groups.length,
      type: groups[0]?.userData.trayType,
      fittings: all.filter((g) => g.userData.fittingKind).map((g) => g.userData.fittingKind),
    };
  });
  expect(info.nodes).toBe(3);
  expect(info.hasPoints).toBe(false);
  expect(info.konvaTrayLines).toBe(1);
  expect(info.groups).toBe(1);
  expect(info.type).toBe("ladder");
  expect(info.fittings).toEqual(["elbow"]);
});
