import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

test.describe("Stage 5 generic equipment, tray services, cooling pipes & cabling", () => {
  test("creates generic equipment, power/data trays, cooling pipe, and auto-cabling with 3D & GLB", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 5);

    // 1. Generic 5-category UI + subtype selector
    await page.locator('.eq-catalog-card[data-eq-group="power"]').click();
    await page.locator("#selEqSubtype").selectOption("panel");
    await expect(page.locator("#selEqSubtype")).toHaveValue("panel");

    // 2. Tray service selector + Pipe mounting + Transparent Floor
    await page.locator('[data-tray-service="power"]').click();
    await expect(page.locator('[data-tray-service="power"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-pipe-mounting="underfloor"]').click();
    await expect(page.locator('[data-pipe-mounting="underfloor"]')).toHaveAttribute("aria-pressed", "true");

    // 3. Programmatically add equipment, trays, pipe, and cables via store and verify BoQ + 3D + GLB
    const metrics = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const app = window.sitestryApp;
      store.ui.trayService = "power";
      store.addCableTray([[200, 200], [450, 200]]);
      store.ui.trayService = "data";
      store.addCableTray([[200, 200], [450, 200]]);
      store.addPipeRun([[200, 320], [450, 320]]);

      const panel = store.addEquipment(210, 220, "panel");
      const rack = store.addEquipment(440, 220, "rack");
      const chiller = store.addEquipment(210, 330, "chiller");
      const pac = store.addEquipment(440, 330, "pac");
      const cctv = store.addEquipment(440, 180, "cctv");

      store.ui.cableSystem = "power";
      store.addCable(panel.id, rack.id);
      store.ui.cableSystem = "cooling";
      store.addCable(chiller.id, pac.id);
      store.ui.cableSystem = "security";
      store.addCable(rack.id, cctv.id);

      app.setViewMode("3d");
      app.viewer3d.rebuildScene();

      const boq = store.computeBoQSummary();
      const cableMeshes = app.viewer3d.selectableMeshes.filter((m) => m.userData?.sitestryKind === "cable").length;
      const pipeMeshes = app.viewer3d.selectableMeshes.filter((m) => m.userData?.sitestryKind === "pipe").length;
      const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
      const glbBuffer = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(app.viewer3d.rootGroup, resolve, reject, { binary: true });
      });
      return {
        boq,
        cableMeshes,
        pipeMeshes,
        trayNodes: store.project.tray_nodes.length,
        glbBytes: glbBuffer?.byteLength || 0,
      };
    });

    // Crossing power & data trays keep separate nodes (2 + 2 = 4)
    expect(metrics.trayNodes).toBe(4);
    expect(metrics.cableMeshes).toBe(3);
    expect(metrics.pipeMeshes).toBe(1);
    expect(metrics.glbBytes).toBeGreaterThan(500);
    expect(Number(metrics.boq.powerTrayMeters)).toBeGreaterThan(0);
    expect(Number(metrics.boq.dataTrayMeters)).toBeGreaterThan(0);
    expect(Number(metrics.boq.pipeLengthMeters)).toBeGreaterThan(0);
    expect(Number(metrics.boq.powerCableMeters)).toBeGreaterThan(0);
    expect(Number(metrics.boq.coolingRouteMeters)).toBeGreaterThan(0);
    expect(Number(metrics.boq.securityCableMeters)).toBeGreaterThan(0);
    expect(metrics.boq.waterfallCount).toBeGreaterThan(0);

    await expect(page.locator("#boqPanel")).toContainText("Kabel Power");
    await expect(page.locator("#boqPanel")).toContainText("Cooling Pipe");
    await expect(page.locator("#boqPanel")).toContainText("Tray Waterfall Drop");

    // 4. BoQ Show/Hide toggle + tool icons for Pan, Pipe, and Cable
    await expect(page.locator('#stagePanel5 [data-tool="pan"] .tool-ico')).toHaveCount(1);
    await expect(page.locator('#stagePanel5 [data-tool="pipe"] .tool-ico')).toHaveCount(1);
    await expect(page.locator('#stagePanel5 [data-tool="cable"] .tool-ico')).toHaveCount(1);
    await page.locator("#btnToggleBoq").click();
    await expect(page.locator("#boqPanel")).toHaveClass(/collapsed/);
    await expect(page.locator("#boqPanel .boq-panel-body")).toBeHidden();
    await page.locator("#btnToggleBoq").click();
    await expect(page.locator("#boqPanel .boq-panel-body")).toBeVisible();

    // 5. Toggle Transparan Lantai
    await page.locator("#chkTransparentFloor").check({ force: true });
    const transparentOn = await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.transparentFloor);
    expect(transparentOn).toBe(true);
  });

  test("Pan tool inspects without selecting equipment on canvas", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 5);

    const eqPos = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const rack = store.addEquipment(1500, 1000, "rack");
      store.selectObject(null, null);
      return { x: rack.x_px, y: rack.y_px };
    });

    await setTool(page, "pan");
    const [pt] = await worldPointsToScreen(page, [eqPos], 0.9);
    const before = await page.evaluate(() => window.sitestryApp.canvas2d.stage.position());
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 80, pt.y + 40);
    await page.mouse.up();

    // Also verify 3D canvas ignores pointer selection while keeping OrbitControls rotate on left-drag
    const res3d = await page.evaluate(async () => {
      const THREE = await import("three");
      const app = window.sitestryApp;
      app.setViewMode("split");
      app.viewer3d.rebuildScene();
      const el = app.viewer3d.renderer.domElement;
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
      return {
        isLeftRotate: app.viewer3d.controls.mouseButtons.LEFT === THREE.MOUSE.ROTATE,
        selected: app.canvas2d.store.ui.selected,
        pos: app.canvas2d.stage.position(),
      };
    });
    expect(res3d.isLeftRotate).toBe(true);
    expect(res3d.selected).toBeNull();
    expect(Math.round(res3d.pos.x - before.x)).toBeGreaterThanOrEqual(70);
  });

  test("groups nearby cable drops into shared edge-mounted Tray Waterfall chutes", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 5);

    const grouped = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const app = window.sitestryApp;
      store.ui.trayService = "power";
      store.addCableTray([[1400, 960], [1800, 960]]);
      const pdu = store.addEquipment(1420, 1020, "panel");
      const rack = store.addEquipment(1780, 1020, "rack");
      store.ui.cableSystem = "power";
      store.ui.cablePathLabel = "A";
      store.addCable(pdu.id, rack.id);
      store.ui.cablePathLabel = "B";
      store.addCable(pdu.id, rack.id);
      app.setViewMode("3d");
      app.viewer3d.rebuildScene();
      const boq = store.computeBoQSummary();
      const chuteMeshes = app.viewer3d.selectableMeshes.filter((m) => m.userData?.role === "tray_waterfall").length;
      return { trayWaterfallCount: boq.trayWaterfallCount, chuteMeshes };
    });
    expect(grouped.trayWaterfallCount).toBe(2);
    expect(grouped.chuteMeshes).toBe(2);
  });

  test("cable tool connects source to target equipment on canvas click", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 5);

    const pts = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.trayService = "power";
      store.addCableTray([[1400, 960], [1800, 960]]);
      const pdu = store.addEquipment(1420, 1020, "panel");
      const rack = store.addEquipment(1780, 1020, "rack");
      return {
        pdu: { x: pdu.x_px, y: pdu.y_px },
        rack: { x: rack.x_px, y: rack.y_px },
      };
    });

    await setTool(page, "cable");
    await page.locator('[data-cable-system="grounding"]').click();

    const [p1, p2] = await worldPointsToScreen(page, [pts.pdu, pts.rack], 0.9);
    await page.mouse.click(p1.x, p1.y);
    await page.waitForTimeout(150);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(150);

    const res = await page.evaluate(() => {
      const store = window.sitestryApp.canvas2d.store;
      return {
        cables: store.project.cables.map((c) => ({ system: c.system, source_id: c.source_id, target_id: c.target_id })),
        draft: window.sitestryApp.canvas2d.cableDraftSourceId,
      };
    });
    expect(res.cables.length).toBe(1);
    expect(res.cables[0].system).toBe("grounding");
    expect(res.draft).toBeNull();
  });
});
