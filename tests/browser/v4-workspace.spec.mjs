import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const edit = (page) =>
  page.evaluate(() => {
    const { store } = window.sitestryApp.canvas2d;
    store.addColumn(40 + store.project.columns.length * 30, 40);
  });

const saveState = (page) => page.evaluate(() => document.body.dataset.save);

const savedProject = async (page) => (await page.request.get("/api/workspace/project")).json();

async function startAtStage3(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 3);
  await page.waitForFunction(() => document.body.dataset.save === "clean");
}

test.describe("v4 save", () => {
  test("save button is clean after load and dirty after an edit", async ({ page }) => {
    await startAtStage3(page);
    await expect(page.locator("#btnSave")).toBeVisible();
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    await expect(page.locator("#saveStatus")).toHaveText("Belum disimpan");
  });

  test("undo back to the saved state clears dirty", async ({ page }) => {
    await startAtStage3(page);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    await page.evaluate(() => window.sitestryApp.canvas2d.store.undo());
    await expect.poll(() => saveState(page)).toBe("clean");
  });

  test("clicking Save writes the project", async ({ page }) => {
    await startAtStage3(page);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    const live = await page.evaluate(async () => {
      const { store } = window.sitestryApp.canvas2d;
      const { structureHash } = await import("/js/workspaceState.js");
      return { columns: store.project.columns.length, hash: structureHash(store.project) };
    });
    expect((await savedProject(page)).columns.length).toBe(live.columns);
    const meta = (await (await page.request.get("/api/workspace")).json()).meta;
    expect(meta.saved_hash).toBe(live.hash);
    expect(meta.saved_at).toBeTruthy();
    expect(meta.thumbnail).toMatch(/^data:image\/jpeg/);
  });

  for (const combo of ["Control+s", "Meta+s"]) {
    test(`${combo} saves and the stair shortcut does not fire`, async ({ page }) => {
      await startAtStage3(page);
      await edit(page);
      await expect.poll(() => saveState(page)).toBe("dirty");
      await page.evaluate(() => {
        const el = document.getElementById("konvaContainer");
        el.tabIndex = -1;
        el.focus();
      });
      await page.keyboard.press(combo);
      await expect.poll(() => saveState(page)).toBe("clean");
      expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.activeTool)).toBe("select");
    });
  }

  test("stage 4 is blocked while dirty and allowed after save", async ({ page }) => {
    await startAtStage3(page);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");

    const blocked = await page.evaluate(() => window.sitestryApp.setWorkflowStage(4));
    expect(blocked).toBe(false);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(3);
    await expect(page.locator("#toastContainer")).toContainText("Simpan dulu");

    await page.locator('.tl-step[data-step="4"]').click();
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(3);
    await page.locator("#tlNext").click();
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(3);

    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await page.locator("#tlNext").click();
    await expect.poll(() => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(4);
  });

  test("beforeunload warns only when dirty", async ({ page }) => {
    await startAtStage3(page);
    const fire = () =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await fire()).toBe(false);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    expect(await fire()).toBe(true);
  });

  test("save is refused during an active edit transaction", async ({ page }) => {
    await startAtStage3(page);
    await edit(page);
    const before = await savedProject(page);
    const result = await page.evaluate(async () => {
      const app = window.sitestryApp;
      const token = app.canvas2d.store.beginTransaction("test");
      const saved = await app.saveWorkspace();
      app.canvas2d.store.cancelTransaction(token);
      return saved;
    });
    expect(result).toBe(false);
    expect(await savedProject(page)).toEqual(before);
  });

  test("save failure keeps dirty and says so", async ({ page }) => {
    await startAtStage3(page);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    await page.route("**/api/workspace/project", (route) =>
      route.request().method() === "PUT" ? route.abort() : route.continue()
    );
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("error");
    await expect(page.locator("#saveStatus")).toContainText("Gagal");
    expect(await page.evaluate(() => window.sitestryApp.hasUnsavedChanges())).toBe(true);
  });
});
