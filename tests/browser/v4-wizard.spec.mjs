import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);

const activeTool = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.activeTool);

test.describe("v4 stage 1 wizard card", () => {
  test("stage 1 is a floating card over a full-bleed canvas", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    const body = await rectOf(page, "#studioBody");
    const canvas = await rectOf(page, "#konvaContainer");
    const card = await rectOf(page, "#stagePanel1");
    expect(Math.abs(canvas.width - body.width)).toBeLessThanOrEqual(2);
    expect(card.width).toBeLessThanOrEqual(360);
    expect(card.left).toBeGreaterThanOrEqual(canvas.left - 1);
    expect(card.top).toBeGreaterThanOrEqual(canvas.top - 1);
    expect(card.right).toBeLessThanOrEqual(canvas.right + 1);
    expect(card.bottom).toBeLessThanOrEqual(canvas.bottom + 1);
    await expect(page.locator("#stagePanel1 .stage-hero-banner")).toBeHidden();
  });

  test("stage 1 keeps ROI and ruler tools", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    const tools = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".stage-panel.active .tool-btn"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.dataset.tool)
        .sort()
    );
    expect(tools).toEqual(["roi", "ruler"]);
    await page.keyboard.press("r");
    expect(await activeTool(page)).toBe("ruler");
    await page.keyboard.press("c");
    expect(await activeTool(page)).toBe("roi");
  });

  test("sample selection and scale remain functional", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.locator("#btnSampleAncolPdf").click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => (await import("/js/store.js")).store.currentSource.sampleId),
        { timeout: 60000 }
      )
      .toBe("ancol_p13");
    await expect(page.locator("#lblStage1Scale")).toHaveText(/px\/m$/);
  });

  test("primary CTA is the timeline Next", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await expect(page.locator("#btnNextToStage2")).toBeHidden();
    await expect(page.locator("#tlNext")).toBeVisible();
  });
});
