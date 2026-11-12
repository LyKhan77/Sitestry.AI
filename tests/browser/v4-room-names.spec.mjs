import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

async function boot(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 3);
}

const clearRooms = (page) =>
  page.evaluate(() => {
    const { store } = window.sitestryApp.canvas2d;
    store.project.rooms = [];
    store.emit("geometryChanged", { source: "test" });
    window.sitestryApp.canvas2d.renderAll();
  });

/** A point well inside the first reasonably large face. */
const interior = (page) =>
  page.evaluate(async () => {
    const { pointInPolygon } = await import("/js/roomFaces.js");
    const face = window.sitestryApp.canvas2d.roomFaces().find((f) => Math.abs(f.area) > 8000);
    const xs = face.polygon.map((p) => p[0]);
    const ys = face.polygon.map((p) => p[1]);
    const edge = (x, y) => {
      let best = Infinity;
      for (let i = 0; i < face.polygon.length; i++) {
        const [x1, y1] = face.polygon[i];
        const [x2, y2] = face.polygon[(i + 1) % face.polygon.length];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t)));
      }
      return best;
    };
    let pick = null;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 6) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 6) {
        if (!pointInPolygon([x, y], face.polygon)) continue;
        const d = edge(x, y);
        if (!pick || d > pick.d) pick = { x, y, d };
      }
    }
    return { x: pick.x, y: pick.y };
  });

async function clickWorld(page, point) {
  const [p] = await worldPointsToScreen(page, [point], 0.9);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
}

const box = (text, spot, confidence = 0.95, height = 14) => ({
  text,
  confidence,
  cx: spot.x,
  cy: spot.y,
  height,
  box: [spot.x - 30, spot.y - height / 2, spot.x + 30, spot.y + height / 2],
});

const names = (page) =>
  page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms.map((r) => r.name));
const status = (page) => page.locator("#lblRoomOcrStatus");

/** Serve canned OCR; `delay` simulates a slow engine. */
async function stubOcr(page, getBody, { delay = 0, statusCode = 200 } = {}) {
  await page.route("**/api/blueprint-text", async (route) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({
      status: statusCode,
      contentType: "application/json",
      body: JSON.stringify(statusCode === 200 ? { image_width_px: 1584, image_height_px: 1224, texts: getBody() } : { detail: "OCR tidak tersedia" }),
    });
  });
}

test.describe("room names from OCR", () => {
  test("click inside a room names the zone from OCR", async ({ page }) => {
    let canned = [];
    await stubOcr(page, () => canned);
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    canned = [box("Pantry", spot)];
    await setTool(page, "room");
    await expect(status(page)).toContainText("Label terbaca");
    await clickWorld(page, spot);
    expect(await names(page)).toEqual(["Pantry"]);
  });

  test("polygon mode names the zone from OCR too", async ({ page }) => {
    let canned = [];
    await stubOcr(page, () => canned);
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    canned = [box("Gudang", spot)];
    await setTool(page, "room");
    await page.evaluate(() => window.sitestryApp.canvas2d.store.setRoomMode("polygon"));
    await expect(status(page)).toContainText("Label terbaca");
    const pts = [[-25, -20], [25, -20], [25, 20], [-25, 20]].map(([dx, dy]) => ({ x: spot.x + dx, y: spot.y + dy }));
    for (const p of pts) await clickWorld(page, p);
    await clickWorld(page, pts[0]);
    expect(await names(page)).toEqual(["Gudang"]);
  });

  test("no text falls back to Ruangan N", async ({ page }) => {
    await stubOcr(page, () => []);
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    await setTool(page, "room");
    await expect(status(page)).toContainText("Label terbaca (0)");
    await clickWorld(page, spot);
    expect(await names(page)).toEqual(["Ruangan 1"]);
  });

  test("503 falls back silently and the status line says so", async ({ page }) => {
    await stubOcr(page, () => [], { statusCode: 503 });
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    await setTool(page, "room");
    await expect(status(page)).toContainText("OCR tidak tersedia");
    await clickWorld(page, spot);
    expect(await names(page)).toEqual(["Ruangan 1"]);
  });

  test("a late response after the source changed is ignored", async ({ page }) => {
    await stubOcr(page, () => [box("Lama", { x: 100, y: 100 })], { delay: 700 });
    await boot(page);
    await setTool(page, "room");
    await page.evaluate(() => {
      window.sitestryApp.canvas2d.store.setSource({ kind: "sample", sampleId: "gatsu_p4", file: null, dataUrl: null, metaOverrides: {} });
    });
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.blueprintTexts)).toBeNull();
  });

  test("the status line shows Membaca label then the count", async ({ page }) => {
    await stubOcr(page, () => [box("Pantry", { x: 100, y: 100 })], { delay: 600 });
    await boot(page);
    await setTool(page, "room");
    await expect(status(page)).toContainText("Membaca label");
    await expect(status(page)).toContainText("Label terbaca (1)");
  });

  test("clicking before OCR finished still creates a generic zone", async ({ page }) => {
    await stubOcr(page, () => [], { delay: 1500 });
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    await setTool(page, "room");
    await clickWorld(page, spot);
    expect(await names(page)).toEqual(["Ruangan 1"]);
  });

  test("real OCR names the Pantry on the Gatsu sample", async ({ page }) => {
    test.setTimeout(120000);
    await boot(page);
    const probe = await page.request.post("/api/blueprint-text", { multipart: { sample_id: "gatsu_p4" }, timeout: 90000 });
    test.skip(probe.status() === 503, "OCR engine not installed");
    const target = await page.evaluate(() => {
      const c = window.sitestryApp.canvas2d;
      const pantry = c.store.project.rooms.find((r) => /pantry/i.test(r.name));
      const poly = pantry.polygon_px;
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      return { x: cx, y: cy, face: Boolean(c.roomFaceAt(cx, cy)) };
    });
    test.skip(!target.face, "the Pantry is not a closed room in this extraction");
    await clearRooms(page);
    await setTool(page, "room");
    await expect(status(page)).toContainText("Label terbaca", { timeout: 90000 });
    await clickWorld(page, target);
    expect((await names(page))[0]).toMatch(/pantry/i);
  });
});
