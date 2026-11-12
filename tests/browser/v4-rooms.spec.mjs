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

const setRoomMode = (page, mode) =>
  page.evaluate((m) => window.sitestryApp.canvas2d.store.setRoomMode(m), mode);
const roomCount = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms.length);
const draftLength = (page) => page.evaluate(() => window.sitestryApp.canvas2d.roomDraft.length);
const activeTool = (page) => page.evaluate(() => window.sitestryApp.canvas2d.store.ui.activeTool);

const around = (spot, offsets) => offsets.map(([dx, dy]) => ({ x: spot.x + dx, y: spot.y + dy }));
const RECT = [[-25, -20], [25, -20], [25, 20], [-25, 20]];

/** Boot, clear zones and open the polygon mode at a free spot. */
async function polygonSession(page) {
  await boot(page);
  await clearRooms(page);
  const spot = await interior(page);
  await setTool(page, "room");
  await setRoomMode(page, "polygon");
  return spot;
}

test.describe("room zones: manual polygon (C)", () => {
  test("four clicks and a click on the first point close the polygon", async ({ page }) => {
    const spot = await polygonSession(page);
    const before = await storeState(page);
    const pts = around(spot, RECT);
    for (const p of pts) await clickWorld(page, p);
    expect(await roomCount(page)).toBe(0);
    await clickWorld(page, pts[0]);
    const state = await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      return { rooms: store.project.rooms, selected: store.ui.selected };
    });
    expect(state.rooms).toHaveLength(1);
    expect(state.rooms[0].polygon_px).toHaveLength(4);
    expect(state.rooms[0].name).toBe("Ruangan 1");
    expect(state.selected).toEqual({ kind: "room", id: state.rooms[0].id });
    expect((await storeState(page)).undo).toBe(before.undo + 1);
    expect(await draftLength(page)).toBe(0);
  });

  test("Enter closes a triangle", async ({ page }) => {
    const spot = await polygonSession(page);
    for (const p of around(spot, [[-30, 20], [30, 20], [0, -30]])) await clickWorld(page, p);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    expect(await roomCount(page)).toBe(1);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms[0].polygon_px.length)).toBe(3);
  });

  test("double click closes the polygon without duplicate points", async ({ page }) => {
    const spot = await polygonSession(page);
    const pts = around(spot, RECT);
    for (const p of pts.slice(0, 3)) await clickWorld(page, p);
    const [last] = await worldPointsToScreen(page, [pts[3]], 0.9);
    await page.mouse.dblclick(last.x, last.y);
    await page.waitForTimeout(300);
    expect(await roomCount(page)).toBe(1);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms[0].polygon_px.length)).toBe(4);
  });

  test("fewer than three points on Enter creates nothing and toasts", async ({ page }) => {
    const spot = await polygonSession(page);
    for (const p of around(spot, [[-30, 0], [30, 0]])) await clickWorld(page, p);
    await page.keyboard.press("Enter");
    await expect(page.locator("#toastContainer")).toContainText("3 titik");
    expect(await roomCount(page)).toBe(0);
    expect(await draftLength(page)).toBe(2);
  });

  test("a bow tie is rejected and the draft is kept", async ({ page }) => {
    const spot = await polygonSession(page);
    for (const p of around(spot, [[-25, -25], [25, 25], [25, -25], [-25, 25]])) await clickWorld(page, p);
    await page.keyboard.press("Enter");
    await expect(page.locator("#toastContainer")).toContainText("saling berpotongan");
    expect(await roomCount(page)).toBe(0);
    expect(await draftLength(page)).toBe(4);
  });

  test("a tiny polygon is rejected", async ({ page }) => {
    const spot = await polygonSession(page);
    for (const p of around(spot, [[0, 0], [16, 0], [8, 14]])) await clickWorld(page, p);
    await page.keyboard.press("Enter");
    await expect(page.locator("#toastContainer")).toContainText("terlalu kecil");
    expect(await roomCount(page)).toBe(0);
    expect(await draftLength(page)).toBe(3);
  });

  test("clicks within 10 CSS px of a wall node snap to the node", async ({ page }) => {
    await boot(page);
    await clearRooms(page);
    await setTool(page, "room");
    await setRoomMode(page, "polygon");
    const node = await page.evaluate(() => {
      const n = window.sitestryApp.canvas2d.store.project.nodes[0];
      return { x: n.x_px, y: n.y_px };
    });
    // 6 CSS px at zoom 0.9 is about 6.7 world px.
    await clickWorld(page, { x: node.x + 4, y: node.y + 5 });
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.roomDraft[0])).toEqual([node.x, node.y]);
  });

  test("Backspace removes the last point", async ({ page }) => {
    const spot = await polygonSession(page);
    for (const p of around(spot, [[-30, 20], [30, 20], [0, -30]])) await clickWorld(page, p);
    await page.keyboard.press("Backspace");
    expect(await draftLength(page)).toBe(2);
  });

  test("Esc cancels the draft with no history and a second Esc returns to Select", async ({ page }) => {
    const spot = await polygonSession(page);
    const before = await storeState(page);
    for (const p of around(spot, [[-30, 20], [30, 20]])) await clickWorld(page, p);
    await page.keyboard.press("Escape");
    expect(await draftLength(page)).toBe(0);
    expect(await activeTool(page)).toBe("room");
    expect((await storeState(page)).undo).toBe(before.undo);
    await page.keyboard.press("Escape");
    expect(await activeTool(page)).toBe("select");
  });

  test("the draft preview draws the points so far plus the cursor", async ({ page }) => {
    const spot = await polygonSession(page);
    const pts = around(spot, [[-30, 20], [30, 20]]);
    for (const p of pts) await clickWorld(page, p);
    const [cursor] = await worldPointsToScreen(page, [{ x: spot.x, y: spot.y - 40 }], 0.9);
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.move(cursor.x + 1, cursor.y + 1);
    await page.waitForTimeout(200);
    const length = await page.evaluate(() => {
      const nodes = window.sitestryApp.canvas2d.overlayLayer.find(".room-draft");
      return nodes.length ? nodes[0].points().length : 0;
    });
    expect(length).toBe(6);
  });

  test("the room tool still works after switching tools and back", async ({ page }) => {
    const spot = await polygonSession(page);
    const draw = async () => {
      const pts = around(spot, RECT);
      for (const p of pts) await clickWorld(page, p);
      await clickWorld(page, pts[0]);
    };
    await draw();
    await setTool(page, "select");
    await setTool(page, "room");
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.roomMode)).toBe("polygon");
    await draw();
    expect(await roomCount(page)).toBe(2);
  });
});

test.describe("room zones: vertex editing", () => {
  const handles = (page) =>
    page.evaluate(() => window.sitestryApp.canvas2d.stage.find(".room-vertex").length);
  const polygonOf = (page, id) =>
    page.evaluate((roomId) => window.sitestryApp.canvas2d.store.project.rooms.find((r) => r.id === roomId).polygon_px, id);

  async function selectedZone(page) {
    const spot = await polygonSession(page);
    const pts = around(spot, RECT);
    for (const p of pts) await clickWorld(page, p);
    await clickWorld(page, pts[0]);
    await setTool(page, "select");
    const id = await page.evaluate(() => window.sitestryApp.canvas2d.store.project.rooms[0].id);
    await page.evaluate((roomId) => window.sitestryApp.canvas2d.store.selectObject("room", roomId), id);
    await page.waitForTimeout(250);
    return { id, spot, pts };
  }

  test("a selected zone shows one handle per vertex only in Select mode", async ({ page }) => {
    const { id } = await selectedZone(page);
    expect(await handles(page)).toBe(4);
    await page.evaluate(() => window.sitestryApp.canvas2d.store.selectObject("wall", window.sitestryApp.canvas2d.store.project.walls[0].id));
    await page.waitForTimeout(150);
    expect(await handles(page)).toBe(0);
    await page.evaluate((roomId) => window.sitestryApp.canvas2d.store.selectObject("room", roomId), id);
    await setTool(page, "wall");
    await page.waitForTimeout(150);
    expect(await handles(page)).toBe(0);
  });

  test("dragging one handle moves only that vertex", async ({ page }) => {
    const { id, pts } = await selectedZone(page);
    const before = await polygonOf(page, id);
    const [grab] = await worldPointsToScreen(page, [{ x: before[2][0], y: before[2][1] }], 0.9);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 30, grab.y + 18, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await polygonOf(page, id);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(after[3]).toEqual(before[3]);
    expect(after[2][0]).toBeGreaterThan(before[2][0] + 20);
    expect(after[2][1]).toBeGreaterThan(before[2][1] + 10);
    expect(pts).toHaveLength(4);
  });

  test("a vertex drag is one undo step and undo restores the polygon", async ({ page }) => {
    const { id } = await selectedZone(page);
    const before = await polygonOf(page, id);
    const undoBefore = (await storeState(page)).undo;
    const [grab] = await worldPointsToScreen(page, [{ x: before[1][0], y: before[1][1] }], 0.9);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 25, grab.y - 12, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await storeState(page)).undo).toBe(undoBefore + 1);
    await page.evaluate(() => window.sitestryApp.canvas2d.store.undo());
    expect(await polygonOf(page, id)).toEqual(before);
  });

  test("a vertex drag snaps to a nearby node", async ({ page }) => {
    const { id } = await selectedZone(page);
    const node = await page.evaluate(() => {
      const n = window.sitestryApp.canvas2d.store.project.nodes[0];
      return { x: n.x_px, y: n.y_px };
    });
    const before = await polygonOf(page, id);
    // One call so both points use the same view transform.
    const [grab, drop] = await worldPointsToScreen(
      page,
      [
        { x: before[0][0], y: before[0][1] },
        { x: node.x + 3, y: node.y + 3 },
      ],
      0.9
    );
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await polygonOf(page, id))[0]).toEqual([node.x, node.y]);
  });

  test("Esc during a vertex drag restores the polygon with no history", async ({ page }) => {
    const { id } = await selectedZone(page);
    const before = await polygonOf(page, id);
    const undoBefore = (await storeState(page)).undo;
    const [grab] = await worldPointsToScreen(page, [{ x: before[2][0], y: before[2][1] }], 0.9);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 40, grab.y + 30, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await polygonOf(page, id)).toEqual(before);
    expect((await storeState(page)).undo).toBe(undoBefore);
  });

  test("handles keep a constant screen size while zooming", async ({ page }) => {
    await selectedZone(page);
    const radius = () =>
      page.evaluate(() => {
        const engine = window.sitestryApp.canvas2d;
        const handle = engine.stage.find(".room-vertex")[0];
        return { screen: handle.radius() * engine.stage.scaleX(), scale: engine.stage.scaleX() };
      });
    const before = await radius();
    const box = await page.locator("#konvaContainer").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(250);
    const after = await radius();
    expect(after.scale).not.toBe(before.scale);
    expect(Math.abs(after.screen - before.screen) / before.screen).toBeLessThan(0.05);
  });
});
