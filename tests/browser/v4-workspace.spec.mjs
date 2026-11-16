import { test, expect } from "@playwright/test";
import fs from "node:fs";
import {
  currentProject,
  gotoApp,
  gotoAppV4,
  listProjects,
  loadStage,
  resetWorkspace,
  savedProjectJson,
} from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

const edit = (page) =>
  page.evaluate(() => {
    const { store } = window.sitestryApp.canvas2d;
    store.addColumn(40 + store.project.columns.length * 30, 40);
  });

const saveState = (page) => page.evaluate(() => document.body.dataset.save);

const savedProject = (page) => savedProjectJson(page);

async function startAtStage3(page, { autoSave = false } = {}) {
  await gotoAppV4(page, VIEWPORT);
  if (!autoSave) {
    await page.locator("#chkAutoSave").uncheck();
  }
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
      const { projectHash } = await import("/js/workspaceState.js");
      return { columns: store.project.columns.length, hash: projectHash(store.project) };
    });
    expect((await savedProject(page)).columns.length).toBe(live.columns);
    const meta = (await currentProject(page)).meta;
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

  test("stage 5 (Result) is blocked while dirty when auto-save is off and allowed after save", async ({ page }) => {
    await startAtStage3(page, { autoSave: false });
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");

    const blocked = await page.evaluate(() => window.sitestryApp.setWorkflowStage(5));
    expect(blocked).toBe(false);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(3);
    await expect(page.locator("#toastContainer")).toContainText("Simpan dulu");

    await page.locator('.tl-step[data-step="5"]').click();
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(3);

    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await page.locator('.tl-step[data-step="5"]').click();
    await expect.poll(() => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step)).toBe(5);
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
    await page.route("**/api/projects/*/project", (route) =>
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

async function builtAtStage5(page) {
  await startAtStage3(page, { autoSave: false });
  await loadStage(page, 5);
  await page.locator("#btnBuild3D").click();
  await expect.poll(() => buildState(page)).toBe("fresh");
}

test.describe("v4 build 3d", () => {
  test("stage 5 shows an empty 3D with a Build button before the first build", async ({ page }) => {
    await startAtStage3(page, { autoSave: false });
    await loadStage(page, 5);
    expect(await buildState(page)).toBe("none");
    await expect(page.locator("#buildBanner")).toBeVisible();
    await expect(page.locator("#buildBanner")).toContainText("Belum ada 3D");
    await expect(page.locator("#btnBuild3D")).toBeEnabled();
    expect(await sceneCount(page, "column")).toBe(0);
  });

  test("Build creates 3D from the saved project", async ({ page }) => {
    await builtAtStage5(page);
    await expect(page.locator("#buildBanner")).toBeHidden();
    expect(await sceneCount(page, "column")).toBe(await savedColumns(page));
    const meta = (await currentProject(page)).meta;
    expect(meta.built_hash).toBe(meta.saved_hash);
  });

  test("stage 3 edits do not change 3D", async ({ page }) => {
    await builtAtStage5(page);
    const before = await page.evaluate(() => window.sitestryApp.viewer3d.builtRevision);
    const columns = await sceneCount(page, "column");
    await loadStage(page, 3);
    await edit(page);
    await page.waitForTimeout(400);
    expect(await sceneCount(page, "column")).toBe(columns);
    expect(await page.evaluate(() => window.sitestryApp.viewer3d.builtRevision)).toBe(before);
  });

  test("after save the stage 5 banner says stale and 3D is unchanged until Build", async ({ page }) => {
    await builtAtStage5(page);
    const oldColumns = await sceneCount(page, "column");
    await loadStage(page, 3);
    await edit(page);
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await loadStage(page, 5);
    expect(await buildState(page)).toBe("stale");
    await expect(page.locator("#buildBanner")).toContainText("berubah sejak build terakhir");
    expect(await sceneCount(page, "column")).toBe(oldColumns);
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => buildState(page)).toBe("fresh");
    expect(await sceneCount(page, "column")).toBe(oldColumns + 1);
  });

  test("build uses the saved version, not unsaved edits", async ({ page }) => {
    await builtAtStage5(page);
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

  test("installation edits in stage 4 also require rebuild in stage 5", async ({ page }) => {
    await builtAtStage5(page);
    await loadStage(page, 4);
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      const n = store.project.nodes[0];
      store.addEquipment(n.x_px + 60, n.y_px + 60, "rack");
    });
    await expect.poll(() => saveState(page)).toBe("dirty");
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await loadStage(page, 5);
    expect(await buildState(page)).toBe("stale");
    expect(await sceneCount(page, "equipment")).toBe(0);
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => buildState(page)).toBe("fresh");
    expect(await sceneCount(page, "equipment")).toBe(1);
  });
});

const FIXTURE = new URL("../fixtures/upload-smoke.png", import.meta.url).pathname;
const WORKSPACE_DIR = "/tmp/sitestry-workspace-test";

const stepOf = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.step);
const viewOf = (page) => page.evaluate(() => document.body.dataset.view);

async function openHome(page) {
  await resetWorkspace(page);
  await page.goto("/?ui=v4");
  await page.waitForFunction(() => window.sitestryApp && document.body.dataset.view);
  await expect(page.locator("#workspaceHome")).toBeVisible();
}

/** Upload the fixture from the home page, add one column, save, optionally go to a stage. */
async function uploadAndSave(page, { stage = 1, build = false } = {}) {
  await openHome(page);
  await page.setInputFiles("#homeUploadInput", FIXTURE);
  await expect.poll(() => viewOf(page)).toBe("stage");
  await page.evaluate(() => {
    const { store } = window.sitestryApp.canvas2d;
    store.addColumn(40, 40);
  });
  await page.evaluate(() => window.sitestryApp.saveWorkspace());
  if (stage > 1) await loadStage(page, stage);
  if (build) {
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => buildState(page)).toBe("fresh");
  }
}

const cards = (page) => page.locator("#homeGrid .project-card");
const cardOf = (page, title) => page.locator("#homeGrid .project-card", { hasText: title });
const workspaceId = (page) => page.evaluate(() => window.sitestryApp.workspace.id);
const storeColumns = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.project.columns.length);

async function goHome(page) {
  await page.locator("#btnWorkspace").click();
  await expect.poll(() => viewOf(page)).toBe("home");
  await expect(page.locator("#homeGrid")).toBeVisible();
}

/** Create a project from the visible home upload field, optionally edit/save/advance. */
async function createViaHome(page, name, { edit: doEdit = false, save = true, stage = 1 } = {}) {
  const input = (await page.locator("#homeEmpty").isVisible()) ? "#homeUploadInput" : "#homeNewInput";
  await page.setInputFiles(input, { name, mimeType: "image/png", buffer: fs.readFileSync(FIXTURE) });
  await expect.poll(() => viewOf(page)).toBe("stage");
  const id = await workspaceId(page);
  if (doEdit) await page.evaluate(() => window.sitestryApp.canvas2d.store.addColumn(40, 40));
  if (save) await page.evaluate(() => window.sitestryApp.saveWorkspace());
  if (stage > 1) await loadStage(page, stage);
  return id;
}

const projectJson = async (page, id) => (await page.request.get(`/api/projects/${id}/project`)).json();
const projectMeta = async (page, id) => (await (await page.request.get(`/api/projects/${id}`)).json()).meta;

test.describe("v4 project list", () => {
  test("empty workspace shows only the upload field", async ({ page }) => {
    await openHome(page);
    await expect(page.locator("#homeEmpty")).toBeVisible();
    await expect(page.locator("#homeUploadInput")).toHaveCount(1);
    await expect(page.locator("#homeList")).toBeHidden();
    await expect(page.locator("#workspaceHome .sample-select-card")).toHaveCount(0);
  });

  test("upload from the empty home creates the first project and opens stage 1", async ({ page }) => {
    await openHome(page);
    const id = await createViaHome(page, "alpha.png", { save: false });
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(await stepOf(page)).toBe(1);
    expect(await listProjects(page)).toHaveLength(1);
    expect(await page.evaluate(() => document.body.dataset.save)).toBe("dirty");
  });

  test("home lists both projects after a second upload and the first keeps its data", async ({ page }) => {
    await openHome(page);
    const alpha = await createViaHome(page, "alpha.png", { edit: true });
    await goHome(page);
    await expect(cards(page)).toHaveCount(1);
    await createViaHome(page, "beta.png");
    await goHome(page);
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator("#homeGrid .project-new")).toHaveCount(1);
    expect((await projectJson(page, alpha)).columns.length).toBeGreaterThanOrEqual(1);
  });

  test("cards show title, counts and status chips per project", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "alpha.png", { edit: true });
    await goHome(page);
    await createViaHome(page, "beta.png", { save: false });
    await page.reload();
    await expect(cards(page)).toHaveCount(2);
    await expect(cardOf(page, "alpha.png").locator(".pc-counts")).toContainText("1 pilar");
    await expect(cardOf(page, "alpha.png").locator(".pc-chips")).toContainText("Editor tersimpan");
    await expect(cardOf(page, "beta.png").locator(".pc-chips")).not.toContainText("Editor tersimpan");
  });

  test("Buka restores that project and stage", async ({ page }) => {
    await openHome(page);
    const alpha = await createViaHome(page, "alpha.png", { edit: true, stage: 3 });
    await goHome(page);
    const beta = await createViaHome(page, "beta.png");
    await page.reload();
    await cardOf(page, "alpha.png").locator(".pc-open").click();
    await expect.poll(() => viewOf(page)).toBe("stage");
    expect(await stepOf(page)).toBe(3);
    expect(await workspaceId(page)).toBe(alpha);
    const hash = await page.evaluate(async () => {
      const { projectHash } = await import("/js/workspaceState.js");
      return projectHash(window.sitestryApp.canvas2d.store.project);
    });
    expect(hash).toBe((await projectMeta(page, alpha)).saved_hash);

    await goHome(page);
    await cardOf(page, "beta.png").locator(".pc-open").click();
    await expect.poll(() => workspaceId(page)).toBe(beta);
    expect(await stepOf(page)).toBe(1);
  });

  test("the open project's card is marked current and says Kembali", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "alpha.png");
    await goHome(page);
    await createViaHome(page, "beta.png");
    await goHome(page);
    await expect(cardOf(page, "beta.png")).toHaveAttribute("data-current", "true");
    await expect(cardOf(page, "beta.png").locator(".pc-open")).toHaveText("Kembali");
    await expect(cardOf(page, "alpha.png")).toHaveAttribute("data-current", "false");
    await expect(cardOf(page, "alpha.png").locator(".pc-open")).toHaveText("Buka");
  });

  test("Kembali resumes in place with unsaved edits", async ({ page }) => {
    await startAtStage3(page);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    await page.locator("#btnWorkspace").click();
    await expect.poll(() => viewOf(page)).toBe("home");
    await expect(cards(page).first().locator(".pc-chips")).toContainText("belum disimpan");
    await cards(page).first().locator(".pc-open").click();
    await expect.poll(() => viewOf(page)).toBe("stage");
    expect(await stepOf(page)).toBe(3);
    expect(await page.evaluate(() => window.sitestryApp.hasUnsavedChanges())).toBe(true);
  });

  test("Hapus asks first and cancel changes nothing", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "alpha.png");
    await goHome(page);
    await createViaHome(page, "beta.png");
    await page.reload();
    await cardOf(page, "alpha.png").locator(".pc-delete").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#confirmModal")).toBeHidden();
    expect(await listProjects(page)).toHaveLength(2);
    await expect(cards(page)).toHaveCount(2);
  });

  test("Hapus removes only that project", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "alpha.png");
    await goHome(page);
    const beta = await createViaHome(page, "beta.png");
    await page.reload();
    await cardOf(page, "alpha.png").locator(".pc-delete").click();
    await page.locator("#confirmOk").click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("beta.png");
    expect((await listProjects(page)).map((p) => p.id)).toEqual([beta]);
  });

  test("deleting the open project resets the session and a later save is a no-op", async ({ page }) => {
    await openHome(page);
    const alpha = await createViaHome(page, "alpha.png");
    await goHome(page);
    await cardOf(page, "alpha.png").locator(".pc-delete").click();
    await page.locator("#confirmOk").click();
    await expect(page.locator("#homeEmpty")).toBeVisible();
    expect((await listProjects(page)).map((p) => p.id)).not.toContain(alpha);
    expect(await page.evaluate(() => window.sitestryApp.workspaceActive())).toBe(false);
    expect(await page.evaluate(() => window.sitestryApp.saveWorkspace())).toBe(false);
  });

  test("opening another project with unsaved edits asks first and cancel keeps the edits", async ({ page }) => {
    await openHome(page);
    const alpha = await createViaHome(page, "alpha.png");
    await goHome(page);
    const beta = await createViaHome(page, "beta.png");
    await page.reload();
    await cardOf(page, "alpha.png").locator(".pc-open").click();
    await expect.poll(() => workspaceId(page)).toBe(alpha);
    await edit(page);
    await expect.poll(() => saveState(page)).toBe("dirty");
    const edited = await storeColumns(page);
    await goHome(page);

    await cardOf(page, "beta.png").locator(".pc-open").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#confirmModal")).toBeHidden();
    expect(await workspaceId(page)).toBe(alpha);
    expect(await page.evaluate(() => window.sitestryApp.hasUnsavedChanges())).toBe(true);

    await cardOf(page, "beta.png").locator(".pc-open").click();
    await page.locator("#confirmOk").click();
    await expect.poll(() => workspaceId(page)).toBe(beta);
    expect(await viewOf(page)).toBe("stage");
    expect(await storeColumns(page)).toBe((await projectJson(page, beta)).columns.length);
    expect(edited).toBeGreaterThan(await storeColumns(page));
  });

  test("a broken project card shows only Hapus", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "alpha.png");
    await goHome(page);
    const beta = await createViaHome(page, "beta.png");
    fs.writeFileSync(`${WORKSPACE_DIR}/projects/${beta}/project.json`, "{not json");
    await page.reload();
    await expect(cards(page)).toHaveCount(2);
    const broken = page.locator(`#homeGrid .project-card[data-project-id="${beta}"]`);
    await expect(broken.locator(".pc-error")).toBeVisible();
    await expect(broken.locator(".pc-open")).toBeHidden();
    await expect(broken.locator(".pc-delete")).toBeVisible();
    await expect(cardOf(page, "alpha.png").locator(".pc-open")).toBeVisible();
  });

  test("restore works with a non-ASCII file name", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "Denah Lantai 1 \u2013 Gatsu.png");
    await page.reload();
    await expect(cards(page).first().locator(".pc-title")).toContainText("Gatsu");
    await cards(page).first().locator(".pc-open").click();
    await expect.poll(() => viewOf(page)).toBe("stage");
    expect(await stepOf(page)).toBe(1);
  });

  test("restore auto-builds 3D only when the saved and built hashes match", async ({ page }) => {
    await openHome(page);
    await createViaHome(page, "alpha.png", { edit: true, stage: 5 });
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => buildState(page)).toBe("fresh");
    await page.reload();
    await cards(page).first().locator(".pc-open").click();
    await expect.poll(() => stepOf(page)).toBe(5);
    expect(await buildState(page)).toBe("fresh");
    expect(await sceneCount(page, "column")).toBe(1);

    await loadStage(page, 3);
    await edit(page);
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await page.reload();
    await cards(page).first().locator(".pc-open").click();
    await expect.poll(() => stepOf(page)).toBe(5);
    expect(await buildState(page)).toBe("stale");
    expect(await sceneCount(page, "column")).toBe(0);
  });

  test("save and build in one project leave the other untouched", async ({ page }) => {
    await openHome(page);
    const alpha = await createViaHome(page, "alpha.png", { edit: true });
    await goHome(page);
    const beta = await createViaHome(page, "beta.png", { edit: true });
    const before = await projectMeta(page, beta);
    await goHome(page);
    await cardOf(page, "alpha.png").locator(".pc-open").click();
    await expect.poll(() => workspaceId(page)).toBe(alpha);
    await edit(page);
    await page.locator("#btnSave").click();
    await expect.poll(() => saveState(page)).toBe("clean");
    await loadStage(page, 5);
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => buildState(page)).toBe("fresh");
    const after = await projectMeta(page, beta);
    expect(after.saved_hash).toBe(before.saved_hash);
    expect(after.built_hash).toBe(before.built_hash);
    expect(after.saved_at).toBe(before.saved_at);
  });

  test("project id is set after sample boot and after upload", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    expect(await workspaceId(page)).toMatch(/^[0-9a-f]{8}$/);
    await openHome(page);
    await createViaHome(page, "alpha.png", { save: false });
    expect(await workspaceId(page)).toMatch(/^[0-9a-f]{8}$/);
  });

  test("uploading from stage 1 creates a second project and keeps the first", async ({ page }) => {
    await startAtStage3(page);
    const first = await workspaceId(page);
    await page.setInputFiles("#fileUploadInput", FIXTURE);
    await expect.poll(async () => (await listProjects(page)).length).toBe(2);
    await expect.poll(() => workspaceId(page)).not.toBe(first);
    expect((await (await page.request.get(`/api/projects/${first}`)).json()).has_project).toBe(true);
    await expect(page.locator("#confirmModal")).toBeHidden();
  });

  test("sample boot still skips home", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    expect(await viewOf(page)).toBe("stage");
    await expect(page.locator("#workspaceHome")).toBeHidden();
  });
});

const calibTool = (page, tool) => page.locator(`#stagePanel1 [data-tool="${tool}"]`);
const activeTool = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.activeTool);
const wallCount = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.project.walls.length);

test.describe("v4 stage 1 upload-only and locked calibration", () => {
  test("stage 1 shows no sample choices in v4 but still does in v3", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await expect(page.locator("#btnSampleGatsuPdf")).toBeHidden();
    await expect(page.locator("#fileUploadInput")).toHaveCount(1);
    await gotoApp(page, VIEWPORT, "/?ui=v3&sample=gatsu_p4");
    await expect(page.locator("#btnSampleGatsuPdf")).toBeVisible();
  });

  test("before extraction ROI and scale controls are editable", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    expect(await page.evaluate(() => document.body.dataset.calib)).toBe("open");
    await expect(calibTool(page, "roi")).toBeVisible();
    await expect(page.locator("#btnAutoScale")).toBeVisible();
    await expect(page.locator("#calibSummary")).toBeHidden();
  });

  test("after extraction ROI and scale are read-only and summarized", async ({ page }) => {
    await startAtStage3(page);
    await loadStage(page, 1);
    expect(await page.evaluate(() => document.body.dataset.calib)).toBe("locked");
    await expect(page.locator("#calibSummary")).toBeVisible();
    await expect(page.locator("#calibSummary")).toContainText("30.68");
    await expect(calibTool(page, "roi")).toBeHidden();
    await expect(calibTool(page, "ruler")).toBeHidden();
    await expect(page.locator("#btnAutoScale")).toBeHidden();
    expect(await activeTool(page)).not.toBe("roi");
    await page.keyboard.press("c");
    await page.keyboard.press("r");
    expect(["roi", "ruler"]).not.toContain(await activeTool(page));
  });

  test("Ubah ROI/Skala asks first and cancel keeps the project", async ({ page }) => {
    await startAtStage3(page);
    await loadStage(page, 1);
    const walls = await wallCount(page);
    await page.locator("#btnReextract").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#confirmModal")).toBeHidden();
    expect(await wallCount(page)).toBe(walls);
    await expect(page.locator("#calibSummary")).toBeVisible();
  });

  test("confirming unlocks the controls and clears the project and built 3D", async ({ page }) => {
    await builtAtStage5(page);
    await loadStage(page, 1);
    await page.locator("#btnReextract").click();
    await page.locator("#confirmOk").click();
    await expect(page.locator("#calibSummary")).toBeHidden();
    await expect(calibTool(page, "roi")).toBeVisible();
    expect(await wallCount(page)).toBe(0);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.builtProject)).toBe(null);
    await expect.poll(() => buildState(page)).toBe("none");
    await page.evaluate(() => window.sitestryApp.canvas2d.store.setActiveTool("roi"));
    expect(await activeTool(page)).toBe("roi");
    await expect.poll(async () => (await currentProject(page)).meta.extracted).toBe(false);
    const meta = (await currentProject(page)).meta;
    expect(meta.extracted).toBe(false);
    expect(meta.built_hash).toBe(null);
  });

  test("rerun in stage 2 asks first and cancel leaves the project", async ({ page }) => {
    await startAtStage3(page);
    await loadStage(page, 2);
    const walls = await wallCount(page);
    await page.locator("#btnRunExtract").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#confirmModal")).toBeHidden();
    expect(await wallCount(page)).toBe(walls);
  });

  test("extraction state survives reload", async ({ page }) => {
    await uploadAndSave(page, { stage: 3 });
    await page.reload();
    await cards(page).first().locator(".pc-open").click();
    await expect.poll(() => stepOf(page)).toBe(3);
    await loadStage(page, 1);
    expect(await page.evaluate(() => document.body.dataset.calib)).toBe("locked");
    await expect(page.locator("#calibSummary")).toBeVisible();
  });
});
