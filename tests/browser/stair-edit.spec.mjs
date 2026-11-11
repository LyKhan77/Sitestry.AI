import { test, expect } from "@playwright/test";
import { gotoApp, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

async function stairCounts(page) {
  return page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return { stairs: store.project.stairs.length, undo: store.undoStack.length };
  });
}

async function addStair(page, shape, startPoint, endPoint, defaults = {}) {
  await page.evaluate(
    ({ shapeValue, extra }) => {
      const { store } = window.sitestryApp.canvas2d;
      store.ui.stairDefaults.shape = shapeValue;
      store.ui.stairDefaults.turn = extra.turn || "right";
      if (extra.flight_run_m !== undefined) store.ui.stairDefaults.flight_run_m = extra.flight_run_m;
      store.setActiveTool("stair");
    },
    { shapeValue: shape, extra: defaults }
  );
  const [a, b] = await worldPointsToScreen(page, [startPoint, endPoint], 0.9);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(120);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(350);
}

test.describe("parametric stair editing", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
  });

  test("two clicks create one parametric L stair with flights and landing", async ({ page }) => {
    const before = await stairCounts(page);
    await addStair(page, "L", { x: 1200, y: 900 }, { x: 1260, y: 960 });
    const state = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const { resolveStairGeometry } = await import("/js/stairGeometry.js");
      const stair = store.project.stairs[store.project.stairs.length - 1];
      const geometry = resolveStairGeometry(stair, store.project.metadata.scale_px_per_meter);
      return {
        stairs: store.project.stairs.length,
        undo: store.undoStack.length,
        template: stair.template_version,
        shape: stair.shape,
        bbox: stair.bbox_px,
        flights: geometry.ok ? geometry.flights.length : -1,
        landings: geometry.ok ? geometry.landings.length : -1,
      };
    });
    expect(state.stairs).toBe(before.stairs + 1);
    expect(state.undo).toBe(before.undo + 1);
    expect(state.template).toBe(1);
    expect(state.shape).toBe("L");
    expect(state.bbox).toBe(undefined);
    expect(state.flights).toBe(2);
    expect(state.landings).toBe(1);
  });

  test("shape and turn changes refresh derived heading and run fields without losing focus", async ({ page }) => {
    await addStair(page, "L", { x: 1200, y: 900 }, { x: 1260, y: 960 });
    await page.waitForTimeout(200);
    expect((await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.getSelectedObject()?.shape;
    }))).toBe("L");
    expect(await page.inputValue("#inpStairRun")).toBe("");

    await page.locator("#selStairShape").focus();
    await page.locator("#selStairShape").selectOption("U");
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("selStairShape");

    const derived = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const stair = store.getSelectedObject();
      return {
        headingDeg: ((((Number(stair.heading_rad) || 0) * 180) / Math.PI) % 360 + 360) % 360,
        run: stair.flight_run_m,
      };
    });
    expect(Number(await page.inputValue("#inpStairHeading"))).toBeCloseTo(derived.headingDeg, 1);
    expect(Number(await page.inputValue("#inpStairRun"))).toBeCloseTo(derived.run, 4);

    await page.locator("#selStairTurn").focus();
    await page.locator("#selStairTurn").selectOption("left");
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("selStairTurn");
    const turned = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const stair = store.getSelectedObject();
      return ((((Number(stair.heading_rad) || 0) * 180) / Math.PI) % 360 + 360) % 360;
    });
    expect(Number(await page.inputValue("#inpStairHeading"))).toBeCloseTo(turned, 1);
  });

  test("fractional or out-of-range riser input is rejected without committing", async ({ page }) => {
    await addStair(page, "straight", { x: 1200, y: 900 }, { x: 1300, y: 900 });
    await page.waitForTimeout(200);
    const before = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const stair = store.getSelectedObject();
      return { steps: stair.steps, undo: store.undoStack.length };
    });

    for (const invalid of ["4.5", "3", "129", ""]) {
      await page.locator("#inpStairSteps").fill(invalid);
      await page.locator("#inpStairSteps").press("Tab");
      await page.waitForTimeout(150);
      const state = await page.evaluate(async () => {
        const { store } = await import("/js/store.js");
        const stair = store.getSelectedObject();
        const error = document.getElementById("stairParamError");
        return {
          steps: stair.steps,
          undo: store.undoStack.length,
          errorHidden: error.classList.contains("hidden"),
          errorText: error.textContent,
        };
      });
      expect(state.steps).toBe(before.steps);
      expect(state.undo).toBe(before.undo);
      expect(state.errorHidden).toBe(false);
      expect(state.errorText).toMatch(/bilangan bulat 4\.\.128/);
    }

    await page.locator("#inpStairSteps").fill("12");
    await page.locator("#inpStairSteps").press("Tab");
    await page.waitForTimeout(250);
    const after = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return {
        steps: store.getSelectedObject().steps,
        undo: store.undoStack.length,
        errorHidden: document.getElementById("stairParamError").classList.contains("hidden"),
      };
    });
    expect(after.steps).toBe(12);
    expect(after.undo).toBe(before.undo + 1);
    expect(after.errorHidden).toBe(true);
  });

  test("escape and tool switch do not create stairs or history", async ({ page }) => {
    const before = await stairCounts(page);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.stairDefaults.shape = "straight";
      store.setActiveTool("stair");
    });
    const [first] = await worldPointsToScreen(page, [{ x: 1200, y: 900 }], 0.9);
    await page.mouse.click(first.x, first.y);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    let state = await stairCounts(page);
    expect(state.stairs).toBe(before.stairs);
    expect(state.undo).toBe(before.undo);

    await page.mouse.click(first.x, first.y);
    await setTool(page, "select");
    await page.waitForTimeout(250);
    state = await stairCounts(page);
    expect(state.stairs).toBe(before.stairs);
    expect(state.undo).toBe(before.undo);
  });

  test("infeasible U keeps preview editable and commits nothing until feasible", async ({ page }) => {
    const before = await stairCounts(page);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.stairDefaults.shape = "U";
      store.ui.stairDefaults.turn = "right";
      store.ui.stairDefaults.flight_run_m = 3;
      store.setActiveTool("stair");
    });
    const [start, invalidEnd, validEnd] = await worldPointsToScreen(
      page,
      [
        { x: 1200, y: 900 },
        { x: 1200, y: 908 },
        { x: 1200, y: 980 },
      ],
      0.9
    );
    await page.mouse.click(start.x, start.y);
    await page.mouse.move(invalidEnd.x, invalidEnd.y, { steps: 4 });
    await page.mouse.click(invalidEnd.x, invalidEnd.y);
    await page.waitForTimeout(300);
    let state = await stairCounts(page);
    expect(state.stairs).toBe(before.stairs);
    expect(state.undo).toBe(before.undo);

    await page.mouse.move(validEnd.x, validEnd.y, { steps: 5 });
    await page.mouse.click(validEnd.x, validEnd.y);
    await page.waitForTimeout(350);
    state = await stairCounts(page);
    expect(state.stairs).toBe(before.stairs + 1);
    expect(state.undo).toBe(before.undo + 1);
    const flightCount = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const { resolveStairGeometry } = await import("/js/stairGeometry.js");
      const stair = store.project.stairs[store.project.stairs.length - 1];
      return resolveStairGeometry(stair, store.project.metadata.scale_px_per_meter).flights.length;
    });
    expect(flightCount).toBe(2);
  });

  test("endpoint handle drag regenerates the stair and undo restores", async ({ page }) => {
    await addStair(page, "straight", { x: 1150, y: 850 }, { x: 1250, y: 850 });
    await setTool(page, "select");
    const stair = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs[store.project.stairs.length - 1];
      store.selectObject("stair", s.id);
      return { id: s.id, end: { ...s.end_px } };
    });
    await page.waitForTimeout(250);
    const [handle, target] = await worldPointsToScreen(
      page,
      [
        { x: stair.end.x_px, y: stair.end.y_px },
        { x: stair.end.x_px + 40, y: stair.end.y_px + 30 },
      ],
      1
    );
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const updated = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs.find((item) => item.id === id);
      return { end: { ...s.end_px }, undo: store.undoStack.length };
    }, stair.id);
    expect(updated.end.x_px).toBeGreaterThan(stair.end.x_px + 10);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const restored = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      return { ...store.project.stairs.find((item) => item.id === id).end_px };
    }, stair.id);
    expect(restored.x_px).toBeCloseTo(stair.end.x_px, 0);
    expect(restored.y_px).toBeCloseTo(stair.end.y_px, 0);
  });

  test("group drag translates both endpoints and undo restores", async ({ page }) => {
    await addStair(page, "straight", { x: 1150, y: 880 }, { x: 1250, y: 880 });
    await setTool(page, "select");
    const before = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs[store.project.stairs.length - 1];
      store.selectObject("stair", s.id);
      return { id: s.id, start: { ...s.start_px }, end: { ...s.end_px } };
    });
    await page.waitForTimeout(250);
    const [center] = await worldPointsToScreen(
      page,
      [{ x: (before.start.x_px + before.end.x_px) / 2, y: before.start.y_px }],
      1
    );
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 25, center.y + 15, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const moved = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs.find((item) => item.id === id);
      return { start: { ...s.start_px }, end: { ...s.end_px } };
    }, before.id);
    expect(moved.start.x_px).toBeGreaterThan(before.start.x_px + 10);
    expect(moved.end.x_px).toBeGreaterThan(before.end.x_px + 10);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const restored = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs.find((item) => item.id === id);
      return { start: { ...s.start_px }, end: { ...s.end_px } };
    }, before.id);
    expect(restored.start.x_px).toBeCloseTo(before.start.x_px, 0);
    expect(restored.end.x_px).toBeCloseTo(before.end.x_px, 0);
  });


  test("escape cancels an in-progress endpoint drag without history", async ({ page }) => {
    await addStair(page, "straight", { x: 1150, y: 820 }, { x: 1250, y: 820 });
    await setTool(page, "select");
    const before = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs[store.project.stairs.length - 1];
      store.selectObject("stair", s.id);
      return { id: s.id, end: { ...s.end_px }, undo: store.undoStack.length };
    });
    await page.waitForTimeout(250);
    const [handle] = await worldPointsToScreen(
      page,
      [{ x: before.end.x_px, y: before.end.y_px }],
      1
    );
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs.find((item) => item.id === id);
      return { end: { ...s.end_px }, undo: store.undoStack.length };
    }, before.id);
    expect(after.end.x_px).toBeCloseTo(before.end.x_px, 0);
    expect(after.end.y_px).toBeCloseTo(before.end.y_px, 0);
    expect(after.undo).toBe(before.undo);
  });

  test("legacy stair remains untouched until explicit conversion", async ({ page }) => {
    const legacy = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const s = store.project.stairs.find((item) => !item.template_version);
      store.selectObject("stair", s.id);
      return JSON.parse(JSON.stringify(s));
    });
    await page.waitForTimeout(250);
    await expect(page.locator("#btnPreviewConvertStair")).toBeVisible();
    const unchanged = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      return store.project.stairs.find((item) => item.id === id);
    }, legacy.id);
    expect(unchanged.template_version).toBe(undefined);
    expect(unchanged.bbox_px).toEqual(legacy.bbox_px);

    await page.locator("#btnPreviewConvertStair").click();
    await expect(page.locator("#stairConvertPanel")).toBeVisible();
    await expect(page.locator("#btnConfirmConvertStair")).toBeVisible();
    await page.locator("#btnConfirmConvertStair").click();
    await page.waitForTimeout(300);
    const converted = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      return store.project.stairs.find((item) => item.id === id);
    }, legacy.id);
    expect(converted.template_version).toBe(1);
    expect(converted.shape).toBe("straight");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const back = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      return store.project.stairs.find((item) => item.id === id);
    }, legacy.id);
    expect(back.template_version).toBe(undefined);
    expect(back.bbox_px).toEqual(legacy.bbox_px);
  });
});
