import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const state = (page) =>
  page.evaluate(() => {
    const s = window.sitestryApp.canvas2d.store;
    return { trayType: s.ui.trayType, trays: JSON.parse(JSON.stringify(s.project.cable_trays)) };
  });

async function bootStage5(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 5);
}

test.describe("tray types in the UI", () => {
  test("the tray tool offers four types and perforated is the default", async ({ page }) => {
    await bootStage5(page);
    await setTool(page, "tray");
    const buttons = page.locator("[data-tray-type]");
    await expect(buttons).toHaveCount(4);
    await expect(page.locator('[data-tray-type="perforated"]')).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => document.querySelector('[data-tray-type="duct"]').click());
    expect((await state(page)).trayType).toBe("duct");
    await expect(page.locator('[data-tray-type="duct"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-tray-type="perforated"]')).toHaveAttribute("aria-pressed", "false");
  });

  test("the inspector edits type and height of a selected tray", async ({ page }) => {
    await bootStage5(page);
    await page.evaluate(() => {
      const s = window.sitestryApp.canvas2d.store;
      const tray = s.addCableTray([[1420, 1100], [1620, 1100]]);
      s.selectObject("tray", tray.id);
    });
    await expect(page.locator("#inspectorContent .insp-title")).toHaveText("Jalur Cable Tray");
    await expect(page.locator("#inpTrayType")).toHaveValue("perforated");
    await page.locator("#inpTrayType").selectOption("ladder");
    await page.locator("#inpTrayHeight").fill("0.15");
    await page.locator("#inpTrayHeight").press("Tab");
    const { trays } = await state(page);
    expect(trays[0].type).toBe("ladder");
    expect(trays[0].height_m).toBe(0.15);
    await expect(page.locator("#btnDelObj")).toHaveText("Hapus Cable Tray");
  });
});
