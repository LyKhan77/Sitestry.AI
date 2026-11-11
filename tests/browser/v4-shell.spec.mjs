import { test, expect } from "@playwright/test";
import { gotoApp, gotoAppV4, loadStage, storeState } from "./helpers.mjs";

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

  test("?ui=v4 persists and ?ui=v3 clears", async ({ page }) => {
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
