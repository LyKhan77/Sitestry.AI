import { test, expect } from "@playwright/test";
import {
  gotoAppV4,
  loadStage,
  setTool,
  storeState,
  worldPointsToScreen,
  dragBy,
} from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

function fitReport(page, rootSelector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const host = root.closest(".dock-flyout, .stage-sidebar") || root;
    const rootRect = root.getBoundingClientRect();
    const escapes = [...root.querySelectorAll("input, select, label")].filter(
      (el) => el.getBoundingClientRect().right > rootRect.right + 1
    ).length;
    const clippedLabels = [...root.querySelectorAll("label")].filter(
      (el) => el.scrollWidth > el.clientWidth + 1
    ).length;
    return { hostOverflow: host.scrollWidth - host.clientWidth, escapes, clippedLabels };
  }, rootSelector);
}

function expectFits(report) {
  expect(report.hostOverflow).toBeLessThanOrEqual(1);
  expect(report.escapes).toBe(0);
  expect(report.clippedLabels).toBe(0);
}

async function addStair(page, shape, startPoint, endPoint) {
  await page.evaluate((shapeValue) => {
    const { store } = window.sitestryApp.canvas2d;
    store.ui.stairDefaults.shape = shapeValue;
    store.ui.stairDefaults.turn = "right";
    store.setActiveTool("stair");
  }, shape);
  const [a, b] = await worldPointsToScreen(page, [startPoint, endPoint], 0.9);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(120);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(350);
}

test.describe("v4 stair parameter card", () => {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1200, height: 900 },
  ]) {
    test(`stair card fits the flyout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await gotoAppV4(page, viewport);
      await loadStage(page, 3);
      await setTool(page, "stair");
      expectFits(await fitReport(page, "#stairSettingsCard"));
    });
  }

  test("stair card fits the narrow drawer at 900x700", async ({ page }) => {
    await gotoAppV4(page, { width: 900, height: 700 });
    await loadStage(page, 3);
    await setTool(page, "stair");
    await page.locator("#btnToggleTools").click();
    await page.waitForTimeout(250);
    expectFits(await fitReport(page, "#stairSettingsCard"));
  });

  test("stair inspector rows fit after placing a stair", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await addStair(page, "L", { x: 1200, y: 900 }, { x: 1260, y: 960 });
    expect((await storeState(page)).selected?.kind).toBe("stair");
    await page.waitForTimeout(300);
    expectFits(await fitReport(page, "#rightInspector"));
  });
});
