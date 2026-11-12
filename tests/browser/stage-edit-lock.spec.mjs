import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

/** Shapes and clicks only: OCR answers with no text so zone names stay generic. */
async function boot(page) {
  await page.route("**/api/blueprint-text", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ image_width_px: 1584, image_height_px: 1224, texts: [] }) })
  );
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 3);
}

const store = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) => new Function("store", "arg", `return (${src})(store, arg)`)(window.sitestryApp.canvas2d.store, a),
    [fn.toString(), arg]
  );

/** A point well inside the largest closed face (farthest from its edges). */
const interior = (page) =>
  page.evaluate(async () => {
    const { pointInPolygon } = await import("/js/roomFaces.js");
    const face = window.sitestryApp.canvas2d.roomFaces().filter((f) => Math.abs(f.area) > 8000)[0];
    const xs = face.polygon.map((p) => p[0]);
    const ys = face.polygon.map((p) => p[1]);
    const edgeDist = (x, y) => {
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
        const d = edgeDist(x, y);
        if (!pick || d > pick.d) pick = { x, y, d };
      }
    }
    return { x: pick.x, y: pick.y };
  });

async function clickWorld(page, point, zoom = 0.9) {
  const [p] = await worldPointsToScreen(page, [point], zoom);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
}

/** Boot, then give the interior spot a zone using the room tool (stage 3). */
async function bootWithZone(page) {
  await boot(page);
  await store(page, (s) => {
    s.project.rooms = [];
    s.emit("geometryChanged", { source: "test" });
  });
  const spot = await interior(page);
  await setTool(page, "room");
  await clickWorld(page, spot);
  expect(await store(page, (s) => s.project.rooms.length)).toBe(1);
  return spot;
}

test.describe("drawing tools click through zoned rooms", () => {
  test("stage 5: a cable tray can be drawn inside a zoned room", async ({ page }) => {
    const spot = await bootWithZone(page);
    await loadStage(page, 5);
    await setTool(page, "tray");
    await clickWorld(page, spot);
    await page.waitForTimeout(500);
    await clickWorld(page, { x: spot.x + 15, y: spot.y });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    expect(await store(page, (s) => s.project.cable_trays.length)).toBe(1);
  });

  test("stage 5: equipment can be placed inside a zoned room and is selected", async ({ page }) => {
    const spot = await bootWithZone(page);
    await loadStage(page, 5);
    await setTool(page, "equipment");
    const before = await store(page, (s) => s.project.equipments.length);
    await clickWorld(page, spot);
    expect(await store(page, (s) => s.project.equipments.length)).toBe(before + 1);
    expect(await store(page, (s) => s.ui.selected?.kind)).not.toBe("room");
  });

  test("stage 3: a column is placed on a zoned room without selecting the zone", async ({ page }) => {
    const spot = await bootWithZone(page);
    await setTool(page, "column");
    const before = await store(page, (s) => s.project.columns.length);
    await clickWorld(page, spot);
    expect(await store(page, (s) => s.project.columns.length)).toBe(before + 1);
    expect(await store(page, (s) => s.ui.selected?.kind ?? null)).not.toBe("room");
  });

  test("stage 3: the select tool still selects the zone", async ({ page }) => {
    const spot = await bootWithZone(page);
    await store(page, (s) => s.selectObject(null, null));
    await setTool(page, "select");
    await clickWorld(page, spot);
    expect(await store(page, (s) => s.ui.selected?.kind)).toBe("room");
  });
});

/** Konva nodes that can be dragged in the drawing layers (stage pan and ROI handles excluded). */
const draggableCount = (page, layerName) =>
  page.evaluate(
    (name) => window.sitestryApp.canvas2d[name].find((n) => n.draggable()).length,
    layerName
  );

const layerListening = (page, layerName) =>
  page.evaluate((name) => window.sitestryApp.canvas2d[name].listening(), layerName);

/** Zone + one equipment, then back to stage 3 so the app is in a known state. */
async function bootWithZoneAndEquipment(page) {
  const spot = await bootWithZone(page);
  await store(page, (s, p) => s.addEquipment(p.x, p.y), spot);
  await store(page, (s) => s.selectObject(null, null));
  return spot;
}

test.describe("edit lock per stage", () => {
  test("stage 4: nothing in the 2D canvas can be dragged, but objects can still be selected", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await loadStage(page, 4);
    await setTool(page, "select");
    await store(page, (s) => s.selectObject("room", s.project.rooms[0].id));
    for (const layer of ["roomsLayer", "cadLayer", "cmeLayer", "overlayLayer"]) {
      expect(await draggableCount(page, layer), layer).toBe(0);
    }
    expect(await layerListening(page, "cadLayer")).toBe(true);
    expect(await layerListening(page, "roomsLayer")).toBe(true);
  });

  test("stage 5: annotation is click-through and only equipment can be dragged", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await loadStage(page, 5);
    await setTool(page, "select");
    expect(await layerListening(page, "cadLayer")).toBe(false);
    expect(await layerListening(page, "roomsLayer")).toBe(false);
    expect(await draggableCount(page, "cadLayer")).toBe(0);
    // cmeLayer also draws stairs; in stage 5 only the single equipment may be draggable.
    expect(await draggableCount(page, "cmeLayer")).toBe(1);
    const mid = await store(page, (s) => {
      const w = s.project.walls[0];
      const a = s.getNodeById(w.start_node);
      const b = s.getNodeById(w.end_node);
      return { x: (a.x_px + b.x_px) / 2, y: (a.y_px + b.y_px) / 2 };
    });
    await clickWorld(page, mid);
    expect(await store(page, (s) => s.ui.selected)).toBeNull();
  });

  test("stage 3: annotation is editable again after visiting stage 5", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await loadStage(page, 5);
    await loadStage(page, 3);
    await setTool(page, "select");
    expect(await layerListening(page, "cadLayer")).toBe(true);
    expect(await draggableCount(page, "cadLayer")).toBeGreaterThan(0);
    // cmeLayer holds stairs (editable here) and no draggable equipment.
    expect(await draggableCount(page, "cmeLayer")).toBe(await store(page, (s) => s.project.stairs.length));
  });
});

test.describe("delete and inspector follow the stage rule", () => {
  const wallCount = (page) => store(page, (s) => s.project.walls.length);
  const enabledFields = (page) =>
    page.evaluate(
      () => document.querySelectorAll("#inspectorContent input:not([disabled]), #inspectorContent select:not([disabled]), #inspectorContent button:not([disabled])").length
    );

  test("stage 4: Delete key, Hapus button and inspector are inert for a selected wall", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await loadStage(page, 4);
    await setTool(page, "select");
    await store(page, (s) => s.selectObject("wall", s.project.walls[0].id));
    const before = await wallCount(page);
    await page.keyboard.press("Delete");
    await page.evaluate(() => document.getElementById("btnDeleteSelected").click());
    expect(await wallCount(page)).toBe(before);
    expect(await enabledFields(page)).toBe(0);
  });

  test("stage 4: equipment is read-only too", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await loadStage(page, 4);
    await setTool(page, "select");
    await store(page, (s) => s.selectObject("equipment", s.project.equipments[0].id));
    await page.keyboard.press("Backspace");
    expect(await store(page, (s) => s.project.equipments.length)).toBe(1);
    expect(await enabledFields(page)).toBe(0);
  });

  test("stage 3: Delete still removes a selected wall and inspector is editable", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await setTool(page, "select");
    await store(page, (s) => s.selectObject("wall", s.project.walls[0].id));
    expect(await enabledFields(page)).toBeGreaterThan(0);
    const before = await wallCount(page);
    await page.keyboard.press("Delete");
    expect(await wallCount(page)).toBe(before - 1);
  });

  test("stage 5: equipment inspector is editable and Delete removes it", async ({ page }) => {
    await bootWithZoneAndEquipment(page);
    await loadStage(page, 5);
    await setTool(page, "select");
    await store(page, (s) => s.selectObject("equipment", s.project.equipments[0].id));
    expect(await enabledFields(page)).toBeGreaterThan(0);
    await page.keyboard.press("Delete");
    expect(await store(page, (s) => s.project.equipments.length)).toBe(0);
  });
});
