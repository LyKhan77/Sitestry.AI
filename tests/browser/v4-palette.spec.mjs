import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, storeState } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

async function focusCanvas(page) {
  await page.evaluate(() => {
    const el = document.getElementById("konvaContainer");
    el.tabIndex = -1;
    el.focus();
  });
}

const activeTool = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.activeTool);

async function openPalette(page, combo = "Control+k") {
  await focusCanvas(page);
  await page.keyboard.press(combo);
  await expect(page.locator("#cmdPalette")).toBeVisible();
}

test.describe("v4 command palette", () => {
  test("filterActions handles stage, empty and no-match queries", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    const result = await page.evaluate(async () => {
      const { PALETTE_ACTIONS, filterActions } = await import("/js/uiV4.js");
      return {
        all: PALETTE_ACTIONS.length,
        empty: filterActions("", PALETTE_ACTIONS).length,
        stage3: filterActions("stage 3", PALETTE_ACTIONS).map((a) => a.id),
        none: filterActions("zzzz", PALETTE_ACTIONS).length,
        upper: filterActions("STAGE 3", PALETTE_ACTIONS).map((a) => a.id),
      };
    });
    expect(result.all).toBeGreaterThan(10);
    expect(result.empty).toBe(result.all);
    expect(result.stage3[0]).toBe("stage-3");
    expect(result.upper).toEqual(result.stage3);
    expect(result.none).toBe(0);
  });

  test("Ctrl+K opens, Esc closes and restores focus", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await openPalette(page);
    await expect(page.locator("#cmdInput")).toBeFocused();
    await expect(page.locator("#cmdPalette")).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#cmdPalette")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("konvaContainer");
  });

  test("Meta+K works too", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await openPalette(page, "Meta+k");
    await expect(page.locator("#cmdInput")).toBeFocused();
  });

  test("typing does not trigger tool shortcuts", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    expect(await activeTool(page)).toBe("select");
    await openPalette(page);
    await page.keyboard.type("wdbn");
    await expect(page.locator("#cmdInput")).toHaveValue("wdbn");
    expect(await activeTool(page)).toBe("select");
  });

  test("Enter runs the highlighted action and closes", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await openPalette(page);
    await page.keyboard.type("stage 4");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storeState(page)).stage).toBe(4);
    await expect(page.locator("#cmdPalette")).toBeHidden();
  });

  test("arrow keys move the highlight", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await openPalette(page);
    const input = page.locator("#cmdInput");
    await expect(input).toHaveAttribute("aria-activedescendant", "cmdOpt-0");
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", "cmdOpt-1");
    await expect(page.locator("#cmdOpt-1")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveAttribute("aria-activedescendant", "cmdOpt-0");
  });

  test("actions respect when()", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.undoStack.length = 0;
      store.redoStack.length = 0;
    });
    await openPalette(page);
    await page.keyboard.type("undo");
    await expect(page.locator('#cmdList [role="option"]')).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.setScale(31);
    });
    await openPalette(page);
    await page.keyboard.type("undo");
    await expect(page.locator('#cmdList [role="option"]')).toHaveCount(1);
  });

  test("palette is inert when the flag is off", async ({ page }) => {
    await page.goto("/?ui=v3");
    await page.waitForFunction(() => window.sitestryApp && window.sitestryApp.canvas2d);
    await page.keyboard.press("Control+k");
    await expect(page.locator("#cmdPalette")).toBeHidden();
  });
});
