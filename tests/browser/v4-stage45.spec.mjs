import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, storeState } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const visibleCount = (page, selector) =>
  page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null).length,
    selector
  );

test.describe("v4 stage 4-5 dock", () => {
  test("camera presets appear once", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 4);
    expect(
      await visibleCount(
        page,
        '[data-camera-preset="perspective"], #btnStage4CamIso, #btnCamPerspective'
      )
    ).toBe(1);
    expect(await visibleCount(page, '[data-camera-preset="top"], #btnStage4CamTop, #btnCamTop')).toBe(1);
    expect(await visibleCount(page, '[data-camera-preset="walk"], #btnStage4CamWalk, #btnCamWalk')).toBe(1);
  });

  test("export lives in one menu in stages 4-5 only", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    for (const stage of [1, 2, 3]) {
      await loadStage(page, stage);
      await expect(page.locator("#btnExportMenu")).toBeHidden();
    }
    for (const stage of [4, 5]) {
      await loadStage(page, stage);
      await expect(page.locator("#btnExportMenu")).toBeVisible();
      await expect(page.locator("#btnExportJson")).toBeHidden();
      await expect(page.locator("#btnExportGlb")).toBeHidden();
      await expect(page.locator("#btnStage5ExportGlb")).toBeHidden();
    }
    await page.locator("#btnExportMenu").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#miExportJson").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test("export menu is keyboard operable", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 4);
    const trigger = page.locator("#btnExportMenu");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#miExportJson")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#miExportGlb")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("stage 4 flyout is open with toggles and summary", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 4);
    await expect(page.locator("#btnDockPanel")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#btnToggleXray")).toBeVisible();
    await expect(page.locator("#stage4SummaryGrid")).toBeVisible();
  });

  test("stage 5 rail keeps equipment and tray tools, catalog is in the flyout", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 5);
    const tools = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".stage-panel.active .tool-btn"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.dataset.tool)
        .sort()
    );
    expect(tools).toEqual(["equipment", "tray"]);
    await expect(page.locator("#btnDockPanel")).toHaveAttribute("aria-expanded", "true");
    const card = page.locator('.eq-catalog-card[data-eq-cat="ups"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(card).toHaveClass(/active/);
  });

  test("stage 5 shows BoQ and lists equipment after loading the preset", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 5);
    const boq = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.computeBoQSummary();
    });
    const panel = page.locator("#boqPanel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(String(boq.solidWallMeters));
    await page.locator("#btnLoadPresetCme").click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await import("/js/store.js")).store.project.equipments.length)
      )
      .toBeGreaterThan(0);
    await expect(panel.locator(".boq-eq-row").first()).toBeVisible();
    await expect(panel).toContainText("Server Rack 42U");
  });

  test("equipmentTotals groups by category in first-seen order", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    const totals = await page.evaluate(async () => {
      const mod = await import("/js/uiV4.js");
      return mod.equipmentTotals([{ category: "rack" }, { category: "ups" }, { category: "rack" }]);
    });
    expect(totals).toEqual([
      { category: "rack", count: 2 },
      { category: "ups", count: 1 },
    ]);
  });

  test("BoQ panel is hidden outside stage 5", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    for (const stage of [3, 4]) {
      await loadStage(page, stage);
      await expect(page.locator("#boqPanel")).toBeHidden();
    }
  });
});
