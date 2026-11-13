import { test, expect } from "@playwright/test";
import { gotoApp, loadStage, storeState } from "./helpers.mjs";

async function canvasRatio(page) {
  return page.evaluate(() => {
    const body = document.getElementById("studioBody").getBoundingClientRect();
    const canvas = document.getElementById("konvaContainer").getBoundingClientRect();
    return canvas.width / body.width;
  });
}

async function visibleTools(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".stage-panel.active .tool-btn"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.dataset.tool)
  );
}

test.describe("focused workspace", () => {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1280, height: 800 },
  ]) {
    test(`annotation canvas is at least 75 percent at ${viewport.width}px`, async ({ page }) => {
      await gotoApp(page, viewport);
      await loadStage(page, 3);
      await page.evaluate(async () => {
        const { store } = await import("/js/store.js");
        store.selectObject(null, null);
      });
      await page.waitForTimeout(250);
      expect(await canvasRatio(page)).toBeGreaterThanOrEqual(0.75);
      const inspectorDisplay = await page.evaluate(
        () => getComputedStyle(document.getElementById("rightInspector")).display
      );
      expect(inspectorDisplay).toBe("none");
    });
  }

  test("selection opens the inspector and empty selection closes it", async ({ page }) => {
    await gotoApp(page, { width: 1440, height: 960 });
    await loadStage(page, 3);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.selectObject("wall", store.project.walls[0].id);
    });
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => getComputedStyle(document.getElementById("rightInspector")).display)
    ).not.toBe("none");
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.selectObject(null, null);
    });
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => getComputedStyle(document.getElementById("rightInspector")).display)
    ).toBe("none");
  });

  test("typing survives a same-selection refresh", async ({ page }) => {
    await gotoApp(page, { width: 1440, height: 960 });
    await loadStage(page, 3);
    const wallId = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const id = store.project.walls[0].id;
      store.selectObject("wall", id);
      return id;
    });
    await page.waitForTimeout(250);
    const input = page.locator("#inpWallLabel");
    await input.click();
    await input.fill("Typed Partition Draft");
    await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      store.selectObject("wall", id);
    }, wallId);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Typed Partition Draft");
  });

  test("each stage exposes only its relevant tools", async ({ page }) => {
    await gotoApp(page, { width: 1440, height: 960 });
    await loadStage(page, 1);
    expect((await visibleTools(page)).sort()).toEqual(["roi", "ruler"]);
    await loadStage(page, 3);
    expect((await visibleTools(page)).sort()).toEqual(
      ["select", "pan", "wall", "door", "double_door", "window", "column", "stair", "room"].sort()
    );
    await loadStage(page, 5);
    expect((await visibleTools(page)).sort()).toEqual(
      ["select", "pan", "equipment", "tray", "pipe", "cable"].sort()
    );
  });

  test("closed narrow sidebar is inert and cannot receive keyboard focus", async ({ page }) => {
    await gotoApp(page, { width: 900, height: 700 });
    await loadStage(page, 3);

    const sidebar = page.locator("#stageSidebar");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(await sidebar.evaluate((el) => el.inert)).toBe(true);
    expect(await sidebar.evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");

    // Tab from the last header control would previously enter the off-canvas drawer.
    await page.locator(".step-item").last().focus();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest("#stageSidebar"))
      );
      expect(inside).toBe(false);
    }

    await page.locator("#btnToggleTools").click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    expect(await sidebar.evaluate((el) => el.inert)).toBe(false);
    expect(await sidebar.evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");
    await page.waitForTimeout(250);
    await page.locator('#stagePanel3 .tool-btn[data-tool="select"]').focus();
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest("#stageSidebar")))
    ).toBe(true);

    await page.evaluate(() => document.getElementById("btnToggleTools").click());
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(await sidebar.evaluate((el) => el.inert)).toBe(true);
  });

  test("narrow layout uses dismissible overlays", async ({ page }) => {
    await gotoApp(page, { width: 900, height: 700 });
    await loadStage(page, 3);
    const toolsBtn = page.locator("#btnToggleTools");
    await expect(toolsBtn).toBeVisible();
    await expect(toolsBtn).toHaveAttribute("aria-expanded", "false");
    await toolsBtn.click();
    await expect(toolsBtn).toHaveAttribute("aria-expanded", "true");
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.selectObject("wall", store.project.walls[0].id);
    });
    await page.waitForTimeout(250);
    await page.locator("#btnCloseInspector").click();
    await page.waitForTimeout(200);
    const state = await storeState(page);
    expect(state.selected).toBe(null);
  });
});
