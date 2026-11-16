import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);

const visibleBottom = (page, selector) =>
  page.evaluate((sel) => {
    let bottom = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
        bottom = Math.max(bottom, r.bottom);
      }
    }
    return bottom;
  }, selector);

const selectWall = (page, index) =>
  page.evaluate((i) => {
    const { store } = window.sitestryApp.canvas2d;
    store.selectObject("wall", store.project.walls[i < 0 ? store.project.walls.length + i : i].id);
  }, index);

const selectNewRoom = (page) =>
  page.evaluate(() => {
    const { store } = window.sitestryApp.canvas2d;
    store.project.rooms = [];
    store.addRoomPolygon([[100, 100], [400, 100], [400, 300], [100, 300]]);
  });

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 1280, height: 800 },
]) {
  test.describe(`docked inspector at ${viewport.width}x${viewport.height}`, () => {
    test("docks at the right edge of the work area", async ({ page }) => {
      await gotoAppV4(page, viewport);
      await loadStage(page, 3);
      await selectWall(page, 0);
      await page.waitForTimeout(300);
      const insp = await rectOf(page, "#rightInspector");
      const host = await rectOf(page, "#studioBody");
      expect(insp.width).toBeGreaterThan(200);
      expect(host.right - insp.right).toBeGreaterThanOrEqual(8);
      expect(host.right - insp.right).toBeLessThanOrEqual(14);
      expect(await page.evaluate(() => getComputedStyle(document.getElementById("rightInspector")).position)).toBe("absolute");
    });

    test("sits below the view controls in every stage", async ({ page }) => {
      await gotoAppV4(page, viewport);
      for (const stage of [3, 4, 5]) {
        await loadStage(page, stage);
        await selectWall(page, 0);
        await page.waitForTimeout(300);
        const insp = await rectOf(page, "#rightInspector");
        const controls = await visibleBottom(page, "#btnZoomFit2D, .cam-btn");
        expect(controls, `stage ${stage} has view controls`).toBeGreaterThan(0);
        expect(insp.top, `stage ${stage}`).toBeGreaterThanOrEqual(controls + 4);
      }
    });

    test("does not move when the selection moves", async ({ page }) => {
      await gotoAppV4(page, viewport);
      await loadStage(page, 3);
      await selectWall(page, 0);
      await page.waitForTimeout(300);
      const first = await rectOf(page, "#rightInspector");
      await selectWall(page, -1);
      await page.waitForTimeout(300);
      const second = await rectOf(page, "#rightInspector");
      expect([second.left, second.top]).toEqual([first.left, first.top]);
    });

    test("stays above the timeline even when tall", async ({ page }) => {
      await gotoAppV4(page, viewport);
      await loadStage(page, 3);
      await selectNewRoom(page);
      await page.waitForTimeout(300);
      const insp = await rectOf(page, "#rightInspector");
      const timeline = await rectOf(page, "#stageTimeline");
      expect(insp.bottom).toBeLessThanOrEqual(timeline.top - 4);
    });

    test("stage 5 BoQ panel moves left of an open inspector", async ({ page }) => {
      await gotoAppV4(page, viewport);
      await loadStage(page, 4);
      await page.evaluate(() => {
        const { store } = window.sitestryApp.canvas2d;
        const n = store.project.nodes[0];
        const eq = store.addEquipment(n.x_px + 60, n.y_px + 60, "rack");
        store.selectObject("equipment", eq.id);
      });
      await loadStage(page, 5);
      await page.evaluate(() => {
        const { store } = window.sitestryApp.canvas2d;
        const eq = store.project.equipments[0];
        store.selectObject("equipment", eq.id);
      });
      await page.waitForTimeout(400);
      const insp = await rectOf(page, "#rightInspector");
      const boq = await rectOf(page, "#boqPanel");
      expect(insp && boq).toBeTruthy();
      const overlap = insp.left < boq.right && boq.left < insp.right && insp.top < boq.bottom && boq.top < insp.bottom;
      expect(overlap).toBe(false);
    });
  });
}
