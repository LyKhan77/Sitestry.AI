import { test, expect } from "@playwright/test";
import {
  gotoApp,
  loadStage,
  storeState,
  nodeInStore,
  firstNodeId,
  centerNodeAtViewport,
  dragBy,
} from "./helpers.mjs";

test.describe("vertex drag", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
  });

  test("node handle radius and hit stroke remain screen-space while zooming", async ({ page }) => {
    const box = await page.locator("#konvaContainer").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => {
      const engine = window.sitestryApp.canvas2d;
      const scale = engine.stage.scaleX();
      const visual = engine.nodeVisuals[0];
      return {
        scale,
        screenRadius: visual.circle.radius() * scale,
        screenHit: visual.circle.hitStrokeWidth() * scale,
        selected: visual.selected,
      };
    });
    expect(metrics.selected).toBe(false);
    expect(metrics.screenRadius).toBeCloseTo(3.8, 1);
    expect(metrics.screenHit).toBeCloseTo(10, 1);
  });

  for (const zoom of [0.5, 1, 2]) {
    test(`first and repeated vertex drag move the canonical node at ${zoom}x`, async ({ page }) => {
      const nodeId = await firstNodeId(page);
      expect(nodeId).toBeTruthy();
      const before = await nodeInStore(page, nodeId);
      const stateBefore = await storeState(page);
      await page.evaluate(async () => {
        const { store } = await import("/js/store.js");
        store.ui.orthoSnap = false;
      });

      const point = await centerNodeAtViewport(page, nodeId, zoom);
      await dragBy(page, point, 55, 35);
      const after = await nodeInStore(page, nodeId);
      expect(after.x).toBeCloseTo(before.x + 55 / zoom, 0);
      expect(after.y).toBeCloseTo(before.y + 35 / zoom, 0);
      expect((await storeState(page)).undo).toBe(stateBefore.undo + 1);

      const second = await centerNodeAtViewport(page, nodeId, zoom);
      await dragBy(page, second, -25, 15);
      const afterSecond = await nodeInStore(page, nodeId);
      expect(afterSecond.x).toBeCloseTo(after.x - 25 / zoom, 0);
      expect(afterSecond.y).toBeCloseTo(after.y + 15 / zoom, 0);
      expect((await storeState(page)).undo).toBe(stateBefore.undo + 2);

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      const undone = await nodeInStore(page, nodeId);
      expect(undone.x).toBeCloseTo(after.x, 0);
      expect(undone.y).toBeCloseTo(after.y, 0);
    });
  }

  test("escape cancels an in-progress vertex drag without history", async ({ page }) => {
    const nodeId = await firstNodeId(page);
    const before = await nodeInStore(page, nodeId);
    const stateBefore = await storeState(page);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.orthoSnap = false;
    });
    const point = await centerNodeAtViewport(page, nodeId, 1.5);

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 40, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await nodeInStore(page, nodeId);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    const stateAfter = await storeState(page);
    expect(stateAfter.undo).toBe(stateBefore.undo);
  });
});
