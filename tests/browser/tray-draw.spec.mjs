import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };
const A = { x: 1420, y: 980 };
const B = { x: 1620, y: 980 };
const MID = { x: 1520, y: 980 };

const store = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) => new Function("store", "arg", `return (${src})(store, arg)`)(window.sitestryApp.canvas2d.store, a),
    [fn.toString(), arg]
  );

async function bootStage5(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 5);
  await setTool(page, "tray");
}

/** Screen positions for world points (stage re-centred on the first point once). */
const screen = (page, pts) => worldPointsToScreen(page, pts, 0.9);

async function click(page, p, opts) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y, opts);
  await page.waitForTimeout(150);
}

const draftLength = (page) => page.evaluate(() => window.sitestryApp.canvas2d.trayDraftPoints.length);
const trays = (page) => store(page, (s) => JSON.parse(JSON.stringify(s.project.cable_trays)));

test.describe("tray drawing reliability", () => {
  test("a click on the dashed preview of the run still adds a point", async ({ page }) => {
    await bootStage5(page);
    const [a, b, m] = await screen(page, [A, B, MID]);
    await click(page, a);
    await click(page, b);
    // MID lies on the A-B stretch that the preview line already covers.
    await click(page, m);
    expect(await draftLength(page)).toBe(3);
    await page.keyboard.press("Enter");
    expect((await trays(page))[0].points_px).toHaveLength(3);
  });

  test("a click on an existing tray strip still adds a point", async ({ page }) => {
    await bootStage5(page);
    await store(page, (s) => s.addCableTray([[1420, 1100], [1620, 1100]]));
    await setTool(page, "tray");
    const [onStrip] = await screen(page, [{ x: 1500, y: 1100 }]);
    await click(page, onStrip);
    expect(await draftLength(page)).toBe(1);
  });

  test("double click on the last point finishes without a duplicate point", async ({ page }) => {
    await bootStage5(page);
    const [a, b] = await screen(page, [A, B]);
    await click(page, a);
    await click(page, b);
    await page.mouse.dblclick(b.x, b.y);
    await page.waitForTimeout(200);
    const list = await trays(page);
    expect(list).toHaveLength(1);
    expect(list[0].points_px).toHaveLength(2);
  });

  test("right click finishes a run with two points and Escape clears the draft", async ({ page }) => {
    await bootStage5(page);
    const [a, b] = await screen(page, [A, B]);
    await click(page, a);
    await click(page, b);
    await click(page, { x: b.x + 40, y: b.y - 40 }, { button: "right" });
    expect(await trays(page)).toHaveLength(1);
    await click(page, a);
    expect(await draftLength(page)).toBe(1);
    await page.keyboard.press("Escape");
    expect(await draftLength(page)).toBe(0);
    expect(await trays(page)).toHaveLength(1);
  });
});
