import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

test.describe("Installation polishing, Auto-Save & Procedural Flow", () => {
  test("rotated equipment keeps label horizontal while body & front indicator rotate", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 4);

    const check = await page.evaluate(() => {
      const app = window.sitestryApp;
      const { store } = app.canvas2d;
      const eq = store.addEquipment(1400, 980, "rack");
      store.selectObject("equipment", eq.id);
      store.updateSelectedProperty({ rotation_deg: 90, name: "RACK-01" });
      app.canvas2d.renderAll();

      const eqGroups = app.canvas2d.cmeLayer
        .getChildren((n) => n.userData?.sitestryKind === "equipment" && n.userData?.sitestryId === eq.id);
      const eqGroup = eqGroups[0];
      const children = eqGroup.getChildren();
      const bodyGroup = children.find((c) => c.getClassName?.() === "Group");
      const textNode = children.find((c) => c.getClassName?.() === "Text");
      return {
        outerRot: eqGroup.rotation(),
        bodyRot: bodyGroup?.rotation(),
        textRot: textNode?.rotation(),
        textVal: textNode?.text(),
      };
    });

    expect(check.outerRot).toBe(0);
    expect(check.bodyRot).toBe(90);
    expect(check.textRot).toBe(0);
    expect(check.textVal).toBe("RACK-01");
  });

  test("auto-cabling disables cable clicks, hides cables while connecting, and shows hover indicator", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 4);

    const pts = await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.ui.trayService = "power";
      store.addCableTray([[1350, 960], [1850, 960]]);
      const pdu = store.addEquipment(1400, 1020, "panel");
      const r1 = store.addEquipment(1620, 1020, "rack");
      const r2 = store.addEquipment(1800, 1020, "rack");
      // Existing cable crossing over r1
      store.ui.cableSystem = "power";
      store.addCable(pdu.id, r2.id);
      return {
        pdu: { x: pdu.x_px, y: pdu.y_px },
        r1: { x: r1.x_px, y: r1.y_px },
        r2: { x: r2.x_px, y: r2.y_px },
      };
    });

    await setTool(page, "cable");

    // Existing cable line has listening=false while cable tool is active
    const listeningBeforeConnect = await page.evaluate(() =>
      window.sitestryApp.canvas2d.cmeLayer
        .getChildren((n) => n.className === "Line" && n.hitStrokeWidth() === 10)
        .every((l) => l.listening() === false)
    );
    expect(listeningBeforeConnect).toBe(true);

    // Hover over pdu -> overlay shows Source hover badge
    const [pPdu, pR1] = await worldPointsToScreen(page, [pts.pdu, pts.r1], 0.9);
    await page.mouse.move(pPdu.x, pPdu.y);
    await page.waitForTimeout(150);
    const hoverSourceText = await page.evaluate(() =>
      window.sitestryApp.canvas2d.overlayLayer
        .getChildren((n) => n.className === "Text")
        .map((t) => t.text())
    );
    expect(hoverSourceText.some((t) => t.startsWith("Source:"))).toBe(true);

    // Click pdu as Source -> existing cables are hidden during connection
    await page.mouse.click(pPdu.x, pPdu.y);
    await page.waitForTimeout(150);
    const cableLinesDuringConnect = await page.evaluate(() =>
      window.sitestryApp.canvas2d.cmeLayer
        .getChildren((n) => n.className === "Line" && n.hitStrokeWidth() === 10).length
    );
    expect(cableLinesDuringConnect).toBe(0);

    // Hover over r1 -> overlay shows "Hubungkan ke ..."
    await page.mouse.move(pR1.x, pR1.y);
    await page.waitForTimeout(150);
    const hoverTargetText = await page.evaluate(() =>
      window.sitestryApp.canvas2d.overlayLayer
        .getChildren((n) => n.className === "Text")
        .map((t) => t.text())
    );
    expect(hoverTargetText.some((t) => t.startsWith("Hubungkan ke "))).toBe(true);

    // Click r1 as Target -> new cable created and all cables reappear
    await page.mouse.click(pR1.x, pR1.y);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      cableCount: window.sitestryApp.canvas2d.store.project.cables.length,
      renderedLines: window.sitestryApp.canvas2d.cmeLayer
        .getChildren((n) => n.className === "Line" && n.hitStrokeWidth() === 10).length,
    }));
    expect(after.cableCount).toBe(2);
    expect(after.renderedLines).toBe(2);
  });

  test("Auto-Save is ON by default, saves Stage 3 & 4 edits, and toggle persists", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);

    const chk = page.locator("#chkAutoSave");
    await expect(chk).toBeChecked();

    // Edit in Stage 3 (Room Layout) -> auto-saves to clean
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.addColumn(100, 100);
    });
    await expect.poll(() => page.evaluate(() => document.body.dataset.save)).toBe("dirty");
    await expect.poll(() => page.evaluate(() => document.body.dataset.save), { timeout: 4000 }).toBe("clean");

    // Edit in Stage 4 (Installation) -> auto-saves to clean
    await loadStage(page, 4);
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.addEquipment(1400, 980, "rack");
    });
    await expect.poll(() => page.evaluate(() => document.body.dataset.save), { timeout: 4000 }).toBe("clean");

    // Disable Auto-Save -> remains dirty on edit & persists across reload
    await chk.uncheck();
    expect(await page.evaluate(() => window.localStorage.getItem("sitestry.autosave"))).toBe("0");
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.addEquipment(1460, 980, "ups");
    });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => document.body.dataset.save)).toBe("dirty");

    await page.reload();
    await page.waitForFunction(() => window.sitestryApp && window.sitestryApp.canvas2d);
    await expect(page.locator("#chkAutoSave")).not.toBeChecked();
  });

  test("Build & Lihat Result builds 3D; revising Stage 3 preserves Stage 4 & marks Result stale; Result is read-only", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 4);
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.addEquipment(1400, 980, "rack");
    });

    // Click Build & Lihat Result CTA -> builds and opens Stage 5 Result
    await page.evaluate(() => document.getElementById("btnNextToStage5").click());
    await expect.poll(() => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(5);
    await expect.poll(() => page.evaluate(() => document.body.dataset.build)).toBe("fresh");
    await expect(page.locator(".view-mode-group")).toBeVisible();

    // Switch to Split view in Result -> verify strictly read-only
    await page.locator("#btnViewSplit").click();
    await page.waitForTimeout(200);
    const readOnlyCheck = await page.evaluate(() => {
      const c2d = window.sitestryApp.canvas2d;
      const draggables = ["roomsLayer", "cadLayer", "cmeLayer"].reduce(
        (acc, name) => acc + c2d[name].find((n) => n.draggable()).length,
        0
      );
      return {
        canEditWall: c2d.store.canEdit("wall"),
        canEditEq: c2d.store.canEdit("equipment"),
        draggables,
      };
    });
    expect(readOnlyCheck.canEditWall).toBe(false);
    expect(readOnlyCheck.canEditEq).toBe(false);
    expect(readOnlyCheck.draggables).toBe(0);

    // Go back to Stage 3 Room Layout, revise a column -> Stage 4 equipment preserved, Stage 5 stale
    await loadStage(page, 3);
    await page.evaluate(() => window.sitestryApp.canvas2d.store.addColumn(150, 150));
    await expect.poll(() => page.evaluate(() => document.body.dataset.save), { timeout: 4000 }).toBe("clean");
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.project.equipments.length)).toBe(1);

    await loadStage(page, 5);
    expect(await page.evaluate(() => document.body.dataset.build)).toBe("stale");
    await expect(page.locator("#buildBanner")).toBeVisible();
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.build)).toBe("fresh");
  });
});
