import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };
const EQ = { x: 1420, y: 980 };
const BLANK = { x: 1420, y: 1180 };
const TRAY_A = { x: 1600, y: 1100 };
const TRAY_B = { x: 1800, y: 1100 };

const store = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) => new Function("store", "arg", `return (${src})(store, arg)`)(window.sitestryApp.canvas2d.store, a),
    [fn.toString(), arg]
  );

async function bootStage5(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 5);
}

async function click(page, world) {
  const [p] = await worldPointsToScreen(page, [world], 0.9);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  return p;
}

const selected = (page) => store(page, (s) => s.ui.selected?.kind ?? null);
const tool = (page) => store(page, (s) => s.ui.activeTool);

test.describe("stage 5 select tool", () => {
  test("entering stage 5 starts in Select with a visible Select button", async ({ page }) => {
    await bootStage5(page);
    expect(await tool(page)).toBe("select");
    const button = page.locator('#stagePanel5 [data-tool="select"]');
    await expect(button).toHaveCount(1);
    await expect(button).toHaveClass(/active/);
  });

  test("the Select button switches back from a drawing tool", async ({ page }) => {
    await bootStage5(page);
    await setTool(page, "tray");
    await page.evaluate(() => document.querySelector('#stagePanel5 [data-tool="select"]').click());
    expect(await tool(page)).toBe("select");
  });

  test("Select picks equipment, clears on empty click and places nothing", async ({ page }) => {
    await bootStage5(page);
    await store(page, (s, p) => s.addEquipment(p.x, p.y), EQ);
    await store(page, (s) => s.selectObject(null, null));
    await setTool(page, "select");
    await click(page, EQ);
    expect(await selected(page)).toBe("equipment");
    await click(page, BLANK);
    expect(await selected(page)).toBeNull();
    expect(await store(page, (s) => s.project.equipments.length)).toBe(1);
  });

  test("Select picks a tray", async ({ page }) => {
    await bootStage5(page);
    await store(page, (s, pts) => s.addCableTray(pts), [[TRAY_A.x, TRAY_A.y], [TRAY_B.x, TRAY_B.y]]);
    await store(page, (s) => s.selectObject(null, null));
    await setTool(page, "select");
    await click(page, { x: 1700, y: 1100 });
    expect(await selected(page)).toBe("tray");
  });

  test("the equipment tool still places equipment on empty canvas", async ({ page }) => {
    await bootStage5(page);
    await setTool(page, "equipment");
    await click(page, BLANK);
    expect(await store(page, (s) => s.project.equipments.length)).toBe(1);
  });

  test("Escape returns equipment and tray tools to Select; a tray draft is cleared first", async ({ page }) => {
    await bootStage5(page);
    await setTool(page, "equipment");
    await page.keyboard.press("Escape");
    expect(await tool(page)).toBe("select");

    await setTool(page, "tray");
    await click(page, TRAY_A);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.trayDraftPoints.length)).toBe(1);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.trayDraftPoints.length)).toBe(0);
    expect(await tool(page)).toBe("tray");
    await page.keyboard.press("Escape");
    expect(await tool(page)).toBe("select");
  });
});
