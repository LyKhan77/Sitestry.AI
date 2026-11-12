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

const sceneCount = (page, kind) =>
  page.evaluate(
    (k) => window.sitestryApp.viewer3d.selectableMeshes.filter((m) => m.userData?.sitestryKind === k).length,
    kind
  );

const savedColumns = (page) => page.evaluate(() => window.sitestryApp.workspace.savedProject.columns.length);
const buildState = (page) => page.evaluate(() => document.body.dataset.build);

async function builtAtStage4(page) {
  await startAtStage3(page);
  await loadStage(page, 4);
  await page.locator("#btnBuild3D").click();
  await expect.poll(() => buildState(page)).toBe("fresh");
}

test.describe("v4 build 3d", () => {
  test("stage 4 shows an empty 3D with a Build button before the first build", async ({ page }) => {
    await startAtStage3(page);
    await loadStage(page, 4);
    expect(await buildState(page)).toBe("none");
    await expect(page.locator("#buildBanner")).toBeVisible();
    await expect(page.locator("#buildBanner")).toContainText("Belum ada 3D");
    await expect(page.locator("#btnBuild3D")).toBeEnabled();
    expect(await sceneCount(page, "column")).toBe(0);
  });

  test("Build creates 3D from the saved project", async ({ page }) => {
    await builtAtStage4(page);
    await expect(page.locator("#buildBanner")).toBeHidden();
    expect(await sceneCount(page, "column")).toBe(await savedColumns(page));
    const meta = (await (await page.request.get("/api/workspace")).json()).meta;
    expect(meta.built_hash).toBe(meta.saved_hash);
  });

  test("stage 3 edits do not change 3D", async ({ page }) => {
    await builtAtStage4(page);
    const before = await page.evaluate(() => window.sitestryApp.viewer3d.builtRevision);
    const columns = await sceneCount(page, "column");
    await loadStage(page, 3);
    await edit(page);
    await page.waitForTimeout(400);
    expect(await sceneCount(page, "column")).toBe(columns);
    expect(await page.evaluate(() => window.sitestryApp.viewer3d.builtRevision)).toBe(before);
  });

  test("after save the stage 4 banner says stale and 3D is unchanged until Build", async ({ page }) => {
    await builtAtStage4(page);
    const oldColumns = await sceneCount(page, "column");
    await loadStage(page, 3);
    await edit(page);
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await loadStage(page, 4);
    expect(await buildState(page)).toBe("stale");
    await expect(page.locator("#buildBanner")).toContainText("Denah berubah sejak build terakhir");
    expect(await sceneCount(page, "column")).toBe(oldColumns);
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => buildState(page)).toBe("fresh");
    expect(await sceneCount(page, "column")).toBe(oldColumns + 1);
  });

  test("build uses the saved version, not unsaved edits", async ({ page }) => {
    await builtAtStage4(page);
    await loadStage(page, 3);
    await edit(page);
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    const saved = await savedColumns(page);
    await page.evaluate(() => window.sitestryApp.buildFromSaved());
    expect(await sceneCount(page, "column")).toBe(saved);
    const live = await page.evaluate(() => window.sitestryApp.canvas2d.store.project.columns.length);
    expect(live).toBe(saved + 1);
  });

  test("equipment stays live in stage 5", async ({ page }) => {
    await builtAtStage4(page);
    const columns = await sceneCount(page, "column");
    await loadStage(page, 5);
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      const n = store.project.nodes[0];
      store.addEquipment(n.x_px + 60, n.y_px + 60, "rack");
    });
    await expect.poll(() => sceneCount(page, "equipment")).toBe(1);
    expect(await sceneCount(page, "column")).toBe(columns);
  });
});
