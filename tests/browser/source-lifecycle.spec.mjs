import { test, expect } from "@playwright/test";
import { gotoApp, loadStage, setTool } from "./helpers.mjs";

test.describe("source lifecycle guards", () => {
  test("stale extraction response cannot replace a newer source", async ({ page }) => {
    await gotoApp(page);
    let first = true;
    await page.route("**/api/extract-layout", async (route) => {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await route.continue();
    });
    await page.evaluate(() => window.sitestryApp.loadSamplePreset("ancol_p13", true));
    await page.waitForTimeout(120);
    await page.evaluate(() => window.sitestryApp.loadSamplePreset("gatsu_jpeg", true));
    await page.waitForFunction(
      () => {
        const { store } = window.sitestryApp.canvas2d;
        return store.currentSource.sampleId === "gatsu_jpeg" && store.project.walls.length > 0;
      },
      null,
      { timeout: 60000 }
    );
    await page.waitForTimeout(1600);
    const state = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return {
        sampleId: store.currentSource.sampleId,
        width: store.currentSource.imageWidthPx,
        walls: store.project.walls.length,
      };
    });
    expect(state.sampleId).toBe("gatsu_jpeg");
    expect(state.width).toBe(1600);
    expect(state.walls).toBeGreaterThan(50);
  });

  test("stale guide response with marker is never applied after source switch", async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
    await setTool(page, "wall");
    let guideCalls = 0;
    await page.route("**/api/blueprint-guides", async (route) => {
      guideCalls += 1;
      if (guideCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            source_digest: "stale",
            detector_version: "blueprint-guides-v1",
            source_kind: "pdf_vector",
            image_width_px: 1584,
            image_height_px: 1224,
            roi_px: { x: 0, y: 0, width: 1584, height: 1224 },
            candidates: [
              {
                id: "STALE_MARKER",
                start_px: { x_px: 1, y_px: 1 },
                end_px: { x_px: 400, y_px: 1 },
                width_px: 8,
                confidence: 1,
                evidence: "parallel_edges",
              },
            ],
            warnings: [],
          }),
        });
      }
      await route.continue();
    });

    await page.locator("#btnWallModeGuided").click();
    await page.evaluate(() => window.sitestryApp.loadSamplePreset("gatsu_p4", true, 5));
    await page.waitForFunction(
      () => {
        const { store } = window.sitestryApp.canvas2d;
        return store.currentSource.pageNumber === 5 && store.project.walls.length > 0;
      },
      null,
      { timeout: 60000 }
    );
    await page.waitForTimeout(2200);
    const state = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return {
        page: store.currentSource.pageNumber,
        ids: store.guideCandidates.map((c) => c.id),
        status: store.guideStatus,
        revision: store.currentSource.revision,
      };
    });
    expect(state.page).toBe(5);
    expect(state.ids).not.toContain("STALE_MARKER");
    expect(["ready", "unavailable", "error", "loading"]).toContain(state.status);
  });

  test("same-source ROI and guided toggles keep geometry undo across re-extraction", async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
    const edited = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const node = store.project.nodes[0];
      const movedX = node.x_px + 12;
      const movedY = node.y_px + 8;
      const token = store.beginTransaction("review-regression");
      store.moveNode(node.id, movedX, movedY, false);
      store.commitTransaction(token);
      return { id: node.id, x: movedX, y: movedY, undo: store.undoStack.length };
    });

    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const roi = store.project.metadata.roi_px;
      store.setRoi({
        x: roi.x,
        y: roi.y,
        width: Math.max(200, roi.width - 80),
        height: Math.max(200, roi.height - 40),
      });
      document.getElementById("btnWallModeGuided").click();
      document.querySelector('[data-wall-mode="manual"]').click();
    });

    await page.evaluate(() => window.sitestryApp.runExtractionPipeline());
    await page.waitForFunction(
      () => {
        const { store } = window.sitestryApp.canvas2d;
        return store.project.walls.length > 0;
      },
      null,
      { timeout: 60000 }
    );

    const afterExtract = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return { undo: store.undoStack.length, mode: store.ui.wallMode };
    });
    expect(afterExtract.mode).toBe("manual");
    expect(afterExtract.undo).toBe(edited.undo + 1);
    const undone = await page.evaluate(async (target) => {
      const { store } = await import("/js/store.js");
      const ok = store.undo();
      const node = store.getNodeById(target.id);
      return { ok, x: node?.x_px, y: node?.y_px, undo: store.undoStack.length };
    }, edited);
    expect(undone.ok).toBe(true);
    expect(undone.x).toBeCloseTo(edited.x, 4);
    expect(undone.y).toBeCloseTo(edited.y, 4);
  });

  test("scale change during extraction is not reverted by the response", async ({ page }) => {
    await gotoApp(page);
    let delayOnce = true;
    await page.route("**/api/extract-layout", async (route) => {
      if (delayOnce) {
        delayOnce = false;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await route.continue();
    });
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const app = window.sitestryApp;
      store.setScale(24.5);
      app.runExtractionPipeline();
    });
    await page.waitForTimeout(1800);
    const state = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return {
        scale: store.project.metadata.scale_px_per_meter,
        status: store.project.walls.length > 0,
      };
    });
    expect(state.scale).toBe(24.5);
    expect(state.status).toBe(true);
  });

  test("upload then sample switch keeps one source of truth", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#fileUploadInput").setInputFiles("../fixtures/upload-smoke.png");
    await page.waitForFunction(
      () => window.sitestryApp.canvas2d.store.currentSource.kind === "upload",
      null,
      { timeout: 30000 }
    );
    const uploadState = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return {
        kind: store.currentSource.kind,
        sampleId: store.activeSampleId,
        hasFile: Boolean(store.uploadedFile),
        width: store.currentSource.imageWidthPx,
      };
    });
    expect(uploadState.kind).toBe("upload");
    expect(uploadState.sampleId).toBe(null);
    expect(uploadState.hasFile).toBe(true);
    expect(uploadState.width).toBe(320);

    await page.locator("#btnSampleGatsuPdf").click();
    await page.waitForFunction(
      () => window.sitestryApp.canvas2d.store.currentSource.sampleId === "gatsu_p4" &&
        window.sitestryApp.canvas2d.store.project.walls.length > 0,
      null,
      { timeout: 60000 }
    );
    const sampleState = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return {
        kind: store.currentSource.kind,
        sampleId: store.currentSource.sampleId,
        hasFile: Boolean(store.uploadedFile),
      };
    });
    expect(sampleState.kind).toBe("sample");
    expect(sampleState.sampleId).toBe("gatsu_p4");
    expect(sampleState.hasFile).toBe(false);
  });
});
