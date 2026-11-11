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

const extractState = (page) => page.evaluate(() => document.body.dataset.extract);
const waitExtract = (page, state, timeout = 30000) =>
  page.waitForFunction((s) => document.body.dataset.extract === s, state, { timeout });

async function delayExtraction(page, ms) {
  await page.route("**/api/extract-layout", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

const layersState = (page) =>
  page.evaluate(async () => ({ ...(await import("/js/store.js")).store.ui.layers }));

test.describe("v4 stage 2 wizard", () => {
  test("entering stage 2 starts extraction after navigation", async ({ page }) => {
    await delayExtraction(page, 800);
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.locator("#tlNext").click();
    await page.waitForFunction(
      () =>
        document.body.dataset.extract === "running" &&
        window.sitestryApp.canvas2d.store.ui.step === 2
    );
    await expect(page.locator("#stage2Card")).toBeVisible();
    await waitExtract(page, "done");
  });

  test("reveal ends with true counts", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.locator("#tlNext").click();
    await waitExtract(page, "done");
    const expected = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const boq = store.computeBoQSummary();
      return {
        walls: store.project.walls.length,
        doors: boq.doorsCount,
        windows: boq.windowsCount,
      };
    });
    for (const [key, value] of Object.entries(expected)) {
      await expect(page.locator(`#wizCounts [data-count="${key}"]`)).toHaveText(String(value));
    }
  });

  test("no fake progress while running", async ({ page }) => {
    await delayExtraction(page, 1500);
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.locator("#tlNext").click();
    await waitExtract(page, "running");
    const text = await page.locator("#stage2Card").innerText();
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/detik/i);
    const bar = page.locator('#stage2Card [role="progressbar"]');
    await expect(bar).toBeVisible();
    expect(await bar.getAttribute("aria-valuenow")).toBe(null);
    await waitExtract(page, "done");
    await expect(bar).toBeHidden();
  });

  test("failure is stated honestly and retry works", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.route("**/api/extract-layout", (route) => route.abort());
    await page.locator("#tlNext").click();
    await waitExtract(page, "fallback");
    await expect(page.locator("#wizStatus")).toContainText(/tidak terjangkau/i);
    await expect(page.locator("#btnRetryExtract")).toBeVisible();

    await page.unroute("**/api/extract-layout");
    await page.locator("#btnRetryExtract").click();
    await waitExtract(page, "done");
    await expect(page.locator("#btnRetryExtract")).toBeHidden();
  });

  test("stage change cancels the reveal", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await delayExtraction(page, 600);
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.locator("#tlNext").click();
    await loadStage(page, 3);
    await page.waitForTimeout(2000);
    const layers = await layersState(page);
    expect(layers.walls).toBe(true);
    expect(layers.columns).toBe(true);
    expect(layers.rooms).toBe(true);
    expect(layers.trays).toBe(true);
    expect(layers.roi).toBe(false);
    expect(await extractState(page)).not.toBe("running");
    expect(errors).toEqual([]);
  });

  test("rerun does not stack animations", async ({ page }) => {
    const responses = [];
    await delayExtraction(page, 500);
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    // Listen only after boot so the initial sample extraction is not counted.
    page.on("response", async (res) => {
      if (res.url().includes("/api/extract-layout")) responses.push(await res.json());
    });
    await page.locator("#tlNext").click();
    await waitExtract(page, "running");
    await page.evaluate(() => {
      window.__extractLog = [];
      new MutationObserver(() => window.__extractLog.push(document.body.dataset.extract)).observe(
        document.body,
        { attributes: true, attributeFilter: ["data-extract"] }
      );
    });
    await page.locator("#btnRunExtract").click();
    await page.locator("#btnRunExtract").click();
    await waitExtract(page, "done");
    await page.waitForTimeout(1800);
    await expect.poll(() => responses.length).toBe(3);
    const log = await page.evaluate(() => window.__extractLog);
    expect(log.filter((s) => s === "done")).toHaveLength(1);
    const walls = await page.evaluate(
      async () => (await import("/js/store.js")).store.project.walls.length
    );
    expect(walls).toBe(responses.at(-1).walls.length);
    const layers = await layersState(page);
    expect([layers.walls, layers.columns, layers.rooms, layers.trays]).toEqual([true, true, true, true]);
  });

  test("reduced motion reveals instantly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 1);
    await page.locator("#tlNext").click();
    await waitExtract(page, "done");
    const layers = await layersState(page);
    expect([layers.walls, layers.columns, layers.rooms, layers.trays]).toEqual([true, true, true, true]);
    const wallsText = await page.locator('#wizCounts [data-count="walls"]').innerText();
    const walls = await page.evaluate(
      async () => (await import("/js/store.js")).store.project.walls.length
    );
    expect(wallsText).toBe(String(walls));
  });

  test("legacy flow still extracts before entering stage 2", async ({ page }) => {
    await page.goto("/?ui=v3");
    await page.waitForFunction(
      () => window.sitestryApp && window.sitestryApp.canvas2d.store.project.nodes.length > 0,
      null,
      { timeout: 60000 }
    );
    await loadStage(page, 1);
    await page.evaluate(() => {
      const app = window.sitestryApp;
      window.__log = [];
      const extract = app.runExtractionPipeline.bind(app);
      app.runExtractionPipeline = async (...args) => {
        window.__log.push("extract:start");
        const result = await extract(...args);
        window.__log.push("extract:end");
        return result;
      };
      const setStage = app.setWorkflowStage.bind(app);
      app.setWorkflowStage = (step) => {
        window.__log.push(`stage:${step}`);
        return setStage(step);
      };
    });
    await page.locator("#btnNextToStage2").click();
    await expect.poll(() => page.evaluate(() => window.__log.join(","))).toBe(
      "extract:start,extract:end,stage:2"
    );
  });
});
