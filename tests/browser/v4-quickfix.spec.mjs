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

test.describe("v4 stage 3 is 2D only", () => {
  test("view pill is hidden in stages 1-3 and shown in 4-5", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    for (const stage of [1, 2, 3]) {
      await loadStage(page, stage);
      await expect(page.locator(".view-mode-group")).toBeHidden();
    }
    for (const stage of [4, 5]) {
      await loadStage(page, stage);
      await expect(page.locator(".view-mode-group")).toBeVisible();
    }
  });

  test("palette view actions are offered only from stage 4", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    const enabled = () =>
      page.evaluate(async () => {
        const { PALETTE_ACTIONS } = await import("/js/uiV4.js");
        return PALETTE_ACTIONS.filter((a) => a.id.startsWith("view-")).map((a) =>
          a.when ? a.when() : true
        );
      });
    await loadStage(page, 3);
    const atStage3 = await enabled();
    expect(atStage3.length).toBe(3);
    expect(atStage3.every((v) => v === false)).toBe(true);
    await loadStage(page, 4);
    expect((await enabled()).every((v) => v === true)).toBe(true);
  });

  test("stage 3 keeps the 2D view", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.viewMode)).toBe("2d");
  });
});

test.describe("v4 dock shortcut badges", () => {
  test("rail buttons show their shortcut key at 1440x960", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    const badges = await page.evaluate(() =>
      [...document.querySelectorAll("#stageSidebar .tool-btn[data-tool]")]
        .filter((btn) => btn.querySelector(".kbd") && btn.getBoundingClientRect().width > 0)
        .map((btn) => {
          const kbd = btn.querySelector(".kbd");
          const k = kbd.getBoundingClientRect();
          const b = btn.getBoundingClientRect();
          return {
            tool: btn.dataset.tool,
            w: k.width,
            h: k.height,
            fontSize: parseFloat(getComputedStyle(kbd).fontSize),
            inside:
              k.left >= b.left - 1 && k.right <= b.right + 1 && k.top >= b.top - 1 && k.bottom <= b.bottom + 1,
            len: kbd.textContent.trim().length,
          };
        })
    );
    expect(badges.length).toBeGreaterThanOrEqual(8);
    for (const badge of badges) {
      expect(badge.w, badge.tool).toBeGreaterThanOrEqual(14);
      expect(badge.h, badge.tool).toBeGreaterThanOrEqual(14);
      expect(badge.fontSize, badge.tool).toBeGreaterThanOrEqual(11);
      expect(badge.inside, badge.tool).toBe(true);
      expect(badge.len, badge.tool).toBe(1);
    }
  });

  test("badge does not remove the accessible name", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await expect(page.locator('#stageSidebar .tool-btn[data-tool="wall"]')).toHaveAttribute(
      "aria-label",
      "Draw Wall (W)"
    );
  });

  test("narrow drawer shows label and key", async ({ page }) => {
    await gotoAppV4(page, { width: 900, height: 700 });
    await loadStage(page, 3);
    await page.locator("#btnToggleTools").click();
    await page.waitForTimeout(250);
    const sizes = await page.evaluate(() => {
      const btn = document.querySelector('#stageSidebar .tool-btn[data-tool="wall"]');
      const label = btn.querySelector("span:not(.kbd)").getBoundingClientRect();
      const kbd = btn.querySelector(".kbd").getBoundingClientRect();
      return { label: label.width, kbd: kbd.width };
    });
    expect(sizes.label).toBeGreaterThan(14);
    expect(sizes.kbd).toBeGreaterThan(14);
  });
});
