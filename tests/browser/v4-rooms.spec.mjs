import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, storeState, worldPointsToScreen } from "./helpers.mjs";

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

/** A point well inside the `which`-th reasonably large face (farthest from its edges). */
const interior = (page, which = 0) =>
  page.evaluate(async (index) => {
    const { pointInPolygon } = await import("/js/roomFaces.js");
    const faces = window.sitestryApp.canvas2d.roomFaces().filter((f) => Math.abs(f.area) > 8000);
    const face = faces[index];
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
    return { x: pick.x, y: pick.y, polygon: face.polygon };
  }, which);

async function clickWorld(page, point, zoom = 0.9) {
  const [p] = await worldPointsToScreen(page, [point], zoom);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
  return p;
}

const sceneCount = (page, kind) =>
  page.evaluate(
    (k) => window.sitestryApp.viewer3d.selectableMeshes.filter((m) => m.userData?.sitestryKind === k).length,
    kind
  );

test.describe("room zones: click inside a closed room", () => {
  test("the room card shows mode buttons only while the room tool is active", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#roomSettingsCard")).toBeHidden();
    await setTool(page, "room");
    await expect(page.locator("#roomSettingsCard")).toBeVisible();
    await expect(page.locator('[data-room-mode="auto"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#lblActiveToolHint")).toContainText("Arahkan kursor");
    await page.locator('[data-room-mode="polygon"]').click();
    await expect(page.locator('[data-room-mode="polygon"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-room-mode="auto"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#lblActiveToolHint")).toContainText("titik sudut");
    await setTool(page, "select");
    await expect(page.locator("#roomSettingsCard")).toBeHidden();
  });

  test("hovering a closed room highlights it", async ({ page }) => {
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    await setTool(page, "room");
    const [p] = await worldPointsToScreen(page, [spot], 0.9);
    await page.mouse.move(p.x, p.y);
    await page.mouse.move(p.x + 1, p.y + 1);
    await page.waitForTimeout(200);
    const hover = await page.evaluate(() => {
      const nodes = window.sitestryApp.canvas2d.overlayLayer.find(".room-hover");
      return nodes.length ? nodes[0].points() : null;
    });
    expect(hover).toEqual(spot.polygon.flat());
  });

  test("click inside a closed room creates one zone that matches the face", async ({ page }) => {
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    const before = await storeState(page);
    await setTool(page, "room");
    await clickWorld(page, spot);
    const state = await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      return { rooms: store.project.rooms, selected: store.ui.selected, focus: document.activeElement?.id };
    });
    expect(state.rooms).toHaveLength(1);
    expect(state.rooms[0].polygon_px).toEqual(spot.polygon);
    expect(state.rooms[0].name).toBe("Ruangan 1");
    expect(state.selected).toEqual({ kind: "room", id: state.rooms[0].id });
    expect(state.focus).toBe("inpRoomName");
    expect((await storeState(page)).undo).toBe(before.undo + 1);
    await page.evaluate(() => window.sitestryApp.canvas2d.store.undo());
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms.length)).toBe(0);
  });

  test("click in an area that already has a zone selects it and creates none", async ({ page }) => {
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    await setTool(page, "room");
    await clickWorld(page, spot);
    const roomId = await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms[0].id);
    await page.evaluate(() => window.sitestryApp.canvas2d.store.selectObject(null, null));
    const before = await storeState(page);
    await clickWorld(page, spot);
    const after = await storeState(page);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms.length)).toBe(1);
    expect(after.undo).toBe(before.undo);
    expect(after.selected).toEqual({ kind: "room", id: roomId });
  });

  test("click on a column inside a room still creates the zone and leaves the column alone", async ({ page }) => {
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    const column = await page.evaluate(({ x, y }) => {
      const { store } = window.sitestryApp.canvas2d;
      const col = store.addColumn(x, y);
      store.selectObject(null, null);
      return { id: col.id, x: col.x_px, y: col.y_px };
    }, spot);
    await setTool(page, "room");
    await clickWorld(page, { x: column.x, y: column.y });
    const state = await page.evaluate((id) => {
      const { store } = window.sitestryApp.canvas2d;
      const col = store.project.columns.find((c) => c.id === id);
      return { rooms: store.project.rooms.length, selected: store.ui.selected, x: col.x_px, y: col.y_px };
    }, column.id);
    expect(state.rooms).toBe(1);
    expect(state.selected.kind).toBe("room");
    expect([state.x, state.y]).toEqual([column.x, column.y]);
  });

  test("click on a wall line never selects the wall and never throws", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await boot(page);
    const mid = await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      const wall = store.project.walls[0];
      const a = store.getNodeById(wall.start_node);
      const b = store.getNodeById(wall.end_node);
      return { x: (a.x_px + b.x_px) / 2, y: (a.y_px + b.y_px) / 2 };
    });
    await setTool(page, "room");
    await clickWorld(page, mid);
    expect((await storeState(page)).selected?.kind).not.toBe("wall");
    expect(errors).toEqual([]);
  });

  test("click outside any closed area toasts and switches to polygon mode", async ({ page }) => {
    await boot(page);
    await clearRooms(page);
    const outside = await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      return {
        x: Math.min(...store.project.nodes.map((n) => n.x_px)) - 120,
        y: Math.min(...store.project.nodes.map((n) => n.y_px)) - 120,
      };
    });
    await setTool(page, "room");
    await clickWorld(page, outside);
    await expect(page.locator("#toastContainer")).toContainText("tidak tertutup");
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.roomMode)).toBe("polygon");
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms.length)).toBe(0);
  });

  test("a created zone survives save and builds in 3D", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await boot(page);
    await clearRooms(page);
    const spot = await interior(page);
    await setTool(page, "room");
    await clickWorld(page, spot);
    await loadStage(page, 4);
    await page.locator("#btnBuild3D").click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.build)).toBe("fresh");
    expect(await sceneCount(page, "room")).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
