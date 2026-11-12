import { test, expect } from "@playwright/test";
import {
  gotoApp,
  loadStage,
  storeState,
  firstNodeId,
  nodeInStore,
  centerNodeAtViewport,
  dragBy,
  setTool,
  worldPointsToScreen,
} from "./helpers.mjs";

const SAMPLES = [
  { id: "gatsu_p4", label: "Gatsu PDF Hal. 4", width: 1584, height: 1224 },
  { id: "ancol_p13", label: "Ancol PDF Hal. 13", width: 1584, height: 1224 },
  { id: "gatsu_jpeg", label: "plan.jpeg raster", width: 1600, height: 945 },
];

async function ensureSample(page, sample) {
  const current = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return store.currentSource.sampleId;
  });
  if (current !== sample.id) {
    await page.evaluate((id) => window.sitestryApp.loadSamplePreset(id, true), sample.id);
  }
  await page.waitForFunction(
    (id) => {
      const { store } = window.sitestryApp.canvas2d;
      return store.currentSource.sampleId === id && store.project.walls.length > 0;
    },
    sample.id,
    { timeout: 90000 }
  );
}

async function pickGuide(page) {
  return page.evaluate(() => {
    const guides = window.sitestryApp.canvas2d.store.guideCandidates || [];
    return (
      guides
        .map((g) => ({
          ...g,
          a: { x: g.start_px.x_px ?? g.start_px.x, y: g.start_px.y_px ?? g.start_px.y },
          b: { x: g.end_px.x_px ?? g.end_px.x, y: g.end_px.y_px ?? g.end_px.y },
        }))
        .map((g) => ({ ...g, len: Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) }))
        .filter((g) => g.len > 100)
        .sort((x, y) => y.confidence - x.confidence)[0] || null
    );
  });
}

async function exportGlbSummary(page) {
  return page.evaluate(async () => {
    const app = window.sitestryApp;
    const buffer = await app.viewer3d.exportGLB("acceptance.glb", { download: false });
    if (!buffer) return null;
    const view = new DataView(buffer);
    let offset = 12;
    while (offset < buffer.byteLength) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      if (type === 0x4e4f534a) {
        const json = JSON.parse(new TextDecoder().decode(buffer.slice(offset + 8, offset + 8 + length)));
        const nodes = json.nodes || [];
        return {
          treads: nodes.filter((n) => n.extras?.role === "tread").length,
          landings: nodes.filter((n) => n.extras?.role === "landing").length,
          stairs: nodes.filter((n) => n.extras?.role === "staircase").length,
        };
      }
      offset += 8 + length;
    }
    return null;
  });
}

for (const sample of SAMPLES) {
  test(`acceptance walkthrough — ${sample.label}`, async ({ page }, testInfo) => {
    await gotoApp(page, { width: 1440, height: 960 });
    await ensureSample(page, sample);
    await loadStage(page, 3);
    await page.screenshot({ path: testInfo.outputPath(`stage3-${sample.id}.png`) });

    // 1. Stable vertex drag at a real zoom.
    const nodeId = await firstNodeId(page);
    const beforeNode = await nodeInStore(page, nodeId);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.orthoSnap = false;
    });
    const point = await centerNodeAtViewport(page, nodeId, 1);
    await dragBy(page, point, 30, 20);
    const afterNode = await nodeInStore(page, nodeId);
    expect(afterNode.x).not.toBe(beforeNode.x);
    expect(afterNode.y).not.toBe(beforeNode.y);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const undoneNode = await nodeInStore(page, nodeId);
    expect(undoneNode.x).toBeCloseTo(beforeNode.x, 0);

    // 2. Manual wall drag.
    await setTool(page, "wall");
    const wallBefore = (await storeState(page)).walls;
    const [wallStart] = await worldPointsToScreen(
      page,
      [{ x: sample.width * 0.88, y: sample.height * 0.9 }],
      0.9
    );
    await dragBy(page, wallStart, 80, 30);
    expect((await storeState(page)).walls).toBe(wallBefore + 1);

    // 3. Guided wall drag from the actual source.
    // Endpoint snap is on by default; guide ends coincide with extracted walls and would snap onto
    // them (rejected as a duplicate), so the guide step runs with snap off.
    await page.evaluate(() => {
      window.sitestryApp.canvas2d.store.ui.endpointSnap = false;
    });
    await page.locator("#btnWallModeGuided").click();
    await page.waitForFunction(
      () => ["ready", "unavailable", "error"].includes(
        window.sitestryApp.canvas2d.store.guideStatus
      ),
      null,
      { timeout: 45000 }
    );
    const guide = await pickGuide(page);
    if (guide) {
      const guidedBefore = (await storeState(page)).walls;
      const ux = (guide.b.x - guide.a.x) / guide.len;
      const uy = (guide.b.y - guide.a.y) / guide.len;
      const inset = Math.min(15, guide.len * 0.1);
      const [a, b] = await worldPointsToScreen(
        page,
        [
          { x: guide.a.x + ux * inset + uy * 3, y: guide.a.y + uy * inset - ux * 3 },
          { x: guide.b.x - ux * inset + uy * 3, y: guide.b.y - uy * inset - ux * 3 },
        ],
        0.9
      );
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(350);
      expect((await storeState(page)).walls).toBe(guidedBefore + 1);
    }

    // 4. Parametric straight + U stairs with undo/redo.
    await setTool(page, "stair");
    const stairBefore = (await storeState(page)).stairs;
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.stairDefaults.shape = "straight";
      store.ui.stairDefaults.turn = "right";
      store.ui.stairDefaults.flight_run_m = null;
    });
    const [s0, s1] = await worldPointsToScreen(
      page,
      [
        { x: sample.width * 0.42, y: sample.height * 0.7 },
        { x: sample.width * 0.42 + 70, y: sample.height * 0.7 },
      ],
      0.9
    );
    await page.mouse.click(s0.x, s0.y);
    await page.mouse.move(s1.x, s1.y, { steps: 5 });
    await page.mouse.click(s1.x, s1.y);
    await page.waitForTimeout(300);
    expect((await storeState(page)).stairs).toBe(stairBefore + 1);

    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.ui.stairDefaults.shape = "U";
      store.ui.stairDefaults.flight_run_m = 3;
    });
    const uScale = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.project.metadata.scale_px_per_meter;
    });
    const [u0, u1] = await worldPointsToScreen(
      page,
      [
        { x: sample.width * 0.52, y: sample.height * 0.7 },
        { x: sample.width * 0.52, y: sample.height * 0.7 + uScale * 2.4 },
      ],
      0.9
    );
    await page.mouse.click(u0.x, u0.y);
    await page.mouse.move(u1.x, u1.y, { steps: 5 });
    await page.mouse.click(u1.x, u1.y);
    await page.waitForTimeout(300);
    expect((await storeState(page)).stairs).toBe(stairBefore + 2);

    const undoCount = (await storeState(page)).undo;
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    expect((await storeState(page)).stairs).toBe(stairBefore + 1);
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(250);
    expect((await storeState(page)).stairs).toBe(stairBefore + 2);
    expect((await storeState(page)).undo).toBe(undoCount);

    // 5. Stage progression and screenshots.
    await loadStage(page, 1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath(`stage1-${sample.id}.png`) });
    await loadStage(page, 2);
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath(`stage2-${sample.id}.png`) });
    await loadStage(page, 3);
    await page.waitForTimeout(300);
    await loadStage(page, 4);
    await page.waitForTimeout(700);
    await page.screenshot({ path: testInfo.outputPath(`stage4-${sample.id}.png`) });
    await loadStage(page, 5);
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath(`stage5-${sample.id}.png`) });
    await page.setViewportSize({ width: 900, height: 700 });
    await loadStage(page, 3);
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath(`stage3-narrow-${sample.id}.png`) });
    await loadStage(page, 4);
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath(`stage4-narrow-${sample.id}.png`) });
    await loadStage(page, 5);
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath(`stage5-narrow-${sample.id}.png`) });

    // 6. Export GLB + JSON and verify parametric content.
    await page.setViewportSize({ width: 1440, height: 960 });
    const glb = await exportGlbSummary(page);
    expect(glb).toBeTruthy();
    expect(glb.stairs).toBeGreaterThanOrEqual(2);
    expect(glb.landings).toBeGreaterThanOrEqual(1);
    expect(glb.treads).toBeGreaterThan(0);

    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => window.sitestryApp.exportProjectJson());
    const download = await downloadPromise;
    const fs = await import("node:fs/promises");
    const project = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    expect(project.stairs.some((s) => s.template_version === 1 && s.shape === "U")).toBe(true);

    // 7. Keyboard shortcuts only fire outside inputs and only for the active stage.
    await loadStage(page, 3);
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.setActiveTool("select");
    });
    await page.keyboard.press("w");
    expect((await storeState(page)).tool).toBe("wall");
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.selectObject("wall", store.project.walls[0].id);
    });
    await page.waitForTimeout(250);
    await page.locator("#inpWallLabel").focus();
    await page.keyboard.press("d");
    expect((await storeState(page)).tool).toBe("wall");
  });
}
