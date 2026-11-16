import { test, expect } from "@playwright/test";
import { gotoApp, gotoAppV4, loadStage, setTool, storeState } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const clearSelection = (page) =>
  page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    store.selectObject(null, null);
  });

const selectFirstWall = (page) =>
  page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    store.selectObject("wall", store.project.walls[0].id);
  });

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);

function expectInside(inner, outer) {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - 1);
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - 1);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 1);
}

async function canvasArea(browser, open) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await open(page);
  await loadStage(page, 3);
  await clearSelection(page);
  await page.waitForTimeout(300);
  const area = await page.evaluate(() => {
    const r = document.getElementById("konvaContainer").getBoundingClientRect();
    return r.width * r.height;
  });
  await context.close();
  return area;
}

test.describe("v4 stage 3 dock", () => {
  test("canvas area grows at least 25 percent versus legacy", async ({ browser }) => {
    const legacy = await canvasArea(browser, (page) => gotoApp(page, VIEWPORT, "/?ui=v3"));
    const v4 = await canvasArea(browser, (page) => gotoAppV4(page, VIEWPORT));
    expect(v4 / legacy).toBeGreaterThanOrEqual(1.25);
  });

  test("dock exposes the same tools with accessible names", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    const tools = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".stage-panel.active .tool-btn"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ tool: el.dataset.tool, label: el.getAttribute("aria-label") }))
    );
    expect(tools.map((t) => t.tool).sort()).toEqual(
      ["select", "pan", "wall", "door", "double_door", "window", "column", "stair", "room"].sort()
    );
    for (const t of tools) expect(t.label && t.label.trim().length).toBeGreaterThan(0);
  });

  test("dock is a 56px rail", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    const { width } = await rectOf(page, "#stageSidebar");
    expect(width).toBeLessThanOrEqual(64);
  });

  test("hint is not truncated", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    const clipped = await page.evaluate(() => {
      const el = document.getElementById("lblActiveToolHint");
      return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    });
    expect(clipped).toBe(false);
  });

  test("view switch only in stage 5 (Result)", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    for (const s of [1, 2, 3, 4]) {
      await loadStage(page, s);
      await expect(page.locator(".view-mode-group")).toBeHidden();
    }
    await loadStage(page, 5);
    await expect(page.locator(".view-mode-group")).toBeVisible();
  });

  test("Escape closes the inspector", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await selectFirstWall(page);
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await storeState(page)).selected).toBe(null);
  });

  test("stair parameters follow the Stair tool", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await setTool(page, "stair");
    await expect(page.locator("#stairSettingsCard")).toBeVisible();
    const rect = await rectOf(page, "#stairSettingsCard");
    expect(rect.left).toBeLessThan(400);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(VIEWPORT.width);
  });

  test("dock flyout exposes wall assist and layers and toggles", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await expect(page.locator("#btnDockPanel")).toBeHidden();
    await loadStage(page, 3);
    const toggle = page.locator("#btnDockPanel");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#btnWallModeGuided")).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#btnWallModeGuided")).toBeVisible();
    await expect(page.locator("#chkEndpointSnap")).toBeVisible();
    await expect(page.locator("#chkOrthoSnap")).toBeVisible();
    await page.locator("#layerDetails summary").click();
    await expect(page.locator("#chkLayerBlueprint")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#btnWallModeGuided")).toBeHidden();
  });
});
