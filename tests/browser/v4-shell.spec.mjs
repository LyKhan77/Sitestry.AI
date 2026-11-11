import { test, expect } from "@playwright/test";
import { gotoApp, gotoAppV4, loadStage, storeState } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const uiFlag = (page) => page.evaluate(() => document.body.dataset.ui);

async function waitForFlag(page) {
  await page.waitForFunction(() => Boolean(document.body.dataset.ui));
}

test.describe("v4 shell", () => {
  test("flag off keeps legacy shell", async ({ page }) => {
    await gotoApp(page);
    expect(await uiFlag(page)).toBe("v3");
    await expect(page.locator("#stageTimeline")).toBeHidden();
    await expect(page.locator(".step-item").first()).toBeVisible();
  });

  test("?ui=v4 and ?ui=v3 both persist across reloads", async ({ page }) => {
    await page.goto("/?ui=v4");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v4");

    await page.goto("/");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v4");

    await page.goto("/?ui=v3");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v3");

    await page.goto("/");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v3");
  });

  test("v4 header is compact", async ({ page }) => {
    await gotoAppV4(page);
    const height = await page
      .locator(".top-ribbon")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(44);
    await expect(page.locator(".step-item").first()).toBeHidden();
    await expect(page.locator("#stageTimeline")).toBeVisible();
    await expect(page.locator("#stageTimeline .tl-step")).toHaveCount(5);
  });

  test("timeline navigates", async ({ page }) => {
    await gotoAppV4(page);
    await loadStage(page, 1);
    await expect(page.locator("#tlBack")).toBeDisabled();

    await page.locator('.tl-step[data-step="3"]').click();
    await expect.poll(async () => (await storeState(page)).stage).toBe(3);
    await expect(page.locator('.tl-step[data-step="3"]')).toHaveAttribute("aria-current", "step");
    await expect(page.locator('.tl-step[data-step="2"]')).not.toHaveAttribute("aria-current", "step");

    await page.locator("#tlNext").click();
    await expect.poll(async () => (await storeState(page)).stage).toBe(4);
    await page.locator("#tlBack").click();
    await expect.poll(async () => (await storeState(page)).stage).toBe(3);

    await page.locator('.tl-step[data-step="5"]').click();
    await expect.poll(async () => (await storeState(page)).stage).toBe(5);
    await expect(page.locator("#tlNext")).toBeDisabled();
  });

  test("timeline next at stage 1 runs extraction and enters stage 2", async ({ page }) => {
    await gotoAppV4(page);
    await loadStage(page, 1);
    await page.locator("#tlNext").click();
    await expect.poll(async () => (await storeState(page)).stage).toBe(2);
    await expect.poll(async () => (await storeState(page)).walls).toBeGreaterThan(0);
  });
});

test.describe("v4 responsive, accessibility, default", () => {
  test("default is v4 and ?ui=v3 is a persistent escape hatch", async ({ page }) => {
    await page.goto("/");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v4");
    await page.goto("/?ui=v3");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v3");
    await page.goto("/");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v3");
    await page.goto("/?ui=v4");
    await waitForFlag(page);
    expect(await uiFlag(page)).toBe("v4");
  });

  test("narrow v4: dock is an inert drawer until opened and the timeline stays reachable", async ({
    page,
  }) => {
    await gotoAppV4(page, { width: 900, height: 700 });
    await loadStage(page, 3);
    const sidebar = page.locator("#stageSidebar");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(await sidebar.evaluate((el) => el.inert)).toBe(true);
    await expect(page.locator("#btnDockPanel")).toBeHidden();

    await page.locator("#btnToggleTools").click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    expect(await sidebar.evaluate((el) => el.inert)).toBe(false);
    // The open drawer covers the Tools toggle, so Escape must dismiss it.
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(await sidebar.evaluate((el) => el.inert)).toBe(true);

    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.selectObject("wall", store.project.walls[0].id);
    });
    await page.waitForTimeout(300);
    const inspector = await page.evaluate(() => {
      const r = document.getElementById("rightInspector").getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    expect(inspector.left).toBeGreaterThanOrEqual(0);
    expect(inspector.right).toBeLessThanOrEqual(900 + 1);
    expect(inspector.bottom).toBeLessThanOrEqual(700 + 1);
    await page.locator("#btnCloseInspector").click();

    const timeline = await page.evaluate(() => {
      const r = document.getElementById("stageTimeline").getBoundingClientRect();
      return { left: r.left, right: r.right, bottom: r.bottom };
    });
    expect(timeline.left).toBeGreaterThanOrEqual(0);
    expect(timeline.right).toBeLessThanOrEqual(900 + 1);
    expect(timeline.bottom).toBeLessThanOrEqual(700 + 1);
    await page.locator('.tl-step[data-step="4"]').click();
    await expect.poll(async () => (await storeState(page)).stage).toBe(4);
  });

  test("keyboard walk reaches the dock and timeline with visible focus, never in hidden containers", async ({
    page,
  }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await page.evaluate(() => document.activeElement?.blur());
    const seen = new Map();
    for (let i = 0; i < 80 && !(seen.has("tlNext") && seen.has("dock") && seen.has("tool")); i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          isTool: el.classList.contains("tool-btn"),
          inert: Boolean(el.closest("[inert]")),
          hidden: cs.visibility === "hidden" || r.width === 0 || r.height === 0,
          outline: cs.outlineStyle,
          outlineWidth: parseFloat(cs.outlineWidth),
        };
      });
      if (!info) continue;
      expect(info.inert).toBe(false);
      expect(info.hidden).toBe(false);
      const key = info.id === "tlNext" ? "tlNext" : info.id === "btnDockPanel" ? "dock" : info.isTool ? "tool" : null;
      if (key && !seen.has(key)) {
        expect(info.outline).not.toBe("none");
        expect(info.outlineWidth).toBeGreaterThan(0);
        seen.set(key, info);
      }
    }
    expect([...seen.keys()].sort()).toEqual(["dock", "tlNext", "tool"]);
  });

  test("functional text is at least 11px", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    const small = async (selector) =>
      page.evaluate((sel) => {
        const root = document.querySelector(sel);
        if (!root) return [`missing ${sel}`];
        const bad = [];
        for (const el of root.querySelectorAll("*")) {
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!hasText) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 2 || r.height <= 2 || getComputedStyle(el).visibility === "hidden") continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 11) bad.push(`${sel} ${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 24)}" ${size}px`);
        }
        return bad;
      }, selector);

    await loadStage(page, 2);
    expect(await small(".top-ribbon")).toEqual([]);
    expect(await small("#stageTimeline")).toEqual([]);
    expect(await small("#stage2Card")).toEqual([]);
    await loadStage(page, 5);
    expect(await small(".top-ribbon")).toEqual([]);
    expect(await small("#boqPanel")).toEqual([]);
    await page.locator("#btnDockPanel").focus();
    await page.keyboard.press("Control+k");
    await expect(page.locator("#cmdPalette")).toBeVisible();
    expect(await small("#cmdPalette")).toEqual([]);
  });
});
