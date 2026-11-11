import { test, expect } from "@playwright/test";
import { gotoApp, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const GATSU_ROI = { x: 63.4, y: 49.0, width: 1172.2, height: 1101.6 };
const JPEG_ROI = { x: 48, y: 28.4, width: 1520, height: 803.3 };

async function requestGuides(request, fields) {
  const response = await request.post("/api/blueprint-guides", {
    multipart: {
      sample_id: fields.sampleId,
      page_number: String(fields.pageNumber),
      roi_json: JSON.stringify(fields.roi),
      scale_px_per_meter: String(fields.scale),
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function pickGuide(page) {
  return page.evaluate(() => {
    const guides = window.sitestryApp.canvas2d.store.guideCandidates || [];
    const usable = guides
      .map((g) => {
        const a = { x: g.start_px.x_px ?? g.start_px.x, y: g.start_px.y_px ?? g.start_px.y };
        const b = { x: g.end_px.x_px ?? g.end_px.x, y: g.end_px.y_px ?? g.end_px.y };
        return { ...g, a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
      })
      .filter((g) => g.len > 100)
      .sort((x, y) => y.confidence - x.confidence);
    return usable[0] || null;
  });
}

async function dragGuide(page, guide) {
  const ux = (guide.b.x - guide.a.x) / guide.len;
  const uy = (guide.b.y - guide.a.y) / guide.len;
  const inset = Math.min(15, guide.len * 0.1);
  const startPoint = { x: guide.a.x + ux * inset + uy * 4, y: guide.a.y + uy * inset - ux * 4 };
  const endPoint = { x: guide.b.x - ux * inset + uy * 4, y: guide.b.y - uy * inset - ux * 4 };
  const midpoint = { x: (startPoint.x + endPoint.x) / 2, y: (startPoint.y + endPoint.y) / 2 };
  const [start, end] = await worldPointsToScreen(page, [startPoint, endPoint, midpoint], 0.9);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return { startPoint, endPoint };
}

function distanceToLine(point, a, b) {
  const px = point.x_px ?? point.x;
  const py = point.y_px ?? point.y;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return Math.abs((px - a.x) * dy - (py - a.y) * dx) / len;
}

test.describe("source-guided walls", () => {
  test("guide endpoint returns real PDF and raster candidates", async ({ request }) => {
    const pdf = await requestGuides(request, {
      sampleId: "gatsu_p4",
      pageNumber: 4,
      roi: GATSU_ROI,
      scale: 30.68,
    });
    expect(pdf.source_kind).toBe("pdf_vector");
    expect(pdf.candidates.length).toBeGreaterThan(0);
    expect(pdf.candidates.some((c) => c.confidence >= 0.65)).toBeTruthy();

    const raster = await requestGuides(request, {
      sampleId: "gatsu_jpeg",
      pageNumber: 1,
      roi: JPEG_ROI,
      scale: 38.7,
    });
    expect(raster.source_kind).toBe("raster_image");
    expect(raster.candidates.length).toBeGreaterThan(0);
  });

  test("guided drag on the PDF source commits a wall on the candidate centerline", async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
    await setTool(page, "wall");
    await page.locator("#btnWallModeGuided").click();
    await page.waitForFunction(
      () => window.sitestryApp.canvas2d.store.guideStatus === "ready",
      null,
      { timeout: 30000 }
    );
    const guide = await pickGuide(page);
    expect(guide).toBeTruthy();
    const before = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.project.walls.length;
    });
    const drag = await dragGuide(page, guide);
    const result = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const wall = store.project.walls[store.project.walls.length - 1];
      const a = store.getNodeById(wall.start_node);
      const b = store.getNodeById(wall.end_node);
      const guides = store.guideCandidates.map((g) => ({
        a: { x: g.start_px.x_px ?? g.start_px.x, y: g.start_px.y_px ?? g.start_px.y },
        b: { x: g.end_px.x_px ?? g.end_px.x, y: g.end_px.y_px ?? g.end_px.y },
      }));
      return { walls: store.project.walls.length, a, b, guides, guideStatus: store.guideStatus };
    });
    expect(result.walls).toBe(before + 1);
    expect(result.guideStatus).toBe("ready");
    const minDistance = Math.min(
      ...result.guides.map((g) =>
        Math.max(distanceToLine(result.a, g.a, g.b), distanceToLine(result.b, g.a, g.b))
      )
    );
    expect(minDistance).toBeLessThan(3);
    expect(drag.startPoint).toBeTruthy();
  });

  test("guided drag on the raster source uses actual raster lines", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => window.sitestryApp.loadSamplePreset("gatsu_jpeg", true));
    await page.waitForFunction(
      () => window.sitestryApp.canvas2d.store.currentSource.sampleId === "gatsu_jpeg" &&
        window.sitestryApp.canvas2d.store.project.walls.length > 0,
      null,
      { timeout: 60000 }
    );
    await loadStage(page, 3);
    await setTool(page, "wall");
    await page.locator("#btnWallModeGuided").click();
    await page.waitForFunction(
      () => window.sitestryApp.canvas2d.store.guideStatus === "ready",
      null,
      { timeout: 30000 }
    );
    const guide = await pickGuide(page);
    expect(guide).toBeTruthy();
    const before = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.project.walls.length;
    });
    await dragGuide(page, guide);
    const result = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const wall = store.project.walls[store.project.walls.length - 1];
      return {
        walls: store.project.walls.length,
        a: store.getNodeById(wall.start_node),
        b: store.getNodeById(wall.end_node),
      };
    });
    expect(result.walls).toBe(before + 1);
    expect(distanceToLine(result.a, guide.a, guide.b)).toBeLessThan(3);
    expect(distanceToLine(result.b, guide.a, guide.b)).toBeLessThan(3);
  });

  test("no candidates keeps manual preview committable", async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
    await setTool(page, "wall");
    await page.locator("#btnWallModeGuided").click();
    await page.waitForFunction(
      () => ["ready", "unavailable", "error"].includes(
        window.sitestryApp.canvas2d.store.guideStatus
      ),
      null,
      { timeout: 30000 }
    );
    await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      store.setGuideCandidates([], "unavailable");
    });
    const before = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.project.walls.length;
    });
    const [start, end] = await worldPointsToScreen(
      page,
      [
        { x: 1400, y: 900 },
        { x: 1500, y: 950 },
      ],
      0.9
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const after = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return { walls: store.project.walls.length, status: store.guideStatus };
    });
    expect(after.walls).toBe(before + 1);
    expect(after.status).toBe("unavailable");
  });
});
