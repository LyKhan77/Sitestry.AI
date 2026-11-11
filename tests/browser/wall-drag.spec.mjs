import { test, expect } from "@playwright/test";
import {
  gotoApp,
  loadStage,
  storeState,
  worldToScreen,
  worldPointsToScreen,
  dragBy,
  setTool,
} from "./helpers.mjs";

async function wallSnapshot(page) {
  return page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return JSON.parse(JSON.stringify(store.project.walls));
  });
}

test.describe("manual wall drag", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
    await setTool(page, "wall");
  });

  test("drag on blank canvas adds one wall and one undo step", async ({ page }) => {
    const before = await storeState(page);
    const start = await worldToScreen(page, 1420, 980, 0.9);
    await dragBy(page, start, 90, 0);
    const after = await storeState(page);
    expect(after.walls).toBe(before.walls + 1);
    expect(after.undo).toBe(before.undo + 1);
  });

  test("diagonal drag is preserved when assistance is off", async ({ page }) => {
    const start = await worldToScreen(page, 1420, 900, 0.9);
    await dragBy(page, start, 70, 45);
    const wall = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const w = store.project.walls[store.project.walls.length - 1];
      const a = store.getNodeById(w.start_node);
      const b = store.getNodeById(w.end_node);
      return { a, b, dx: b.x_px - a.x_px, dy: b.y_px - a.y_px };
    });
    expect(Math.abs(wall.dx)).toBeGreaterThan(10);
    expect(Math.abs(wall.dy)).toBeGreaterThan(4);
  });

  test("drag ending on an existing node reuses that node", async ({ page }) => {
    const node = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return { ...store.project.nodes[1] };
    });
    const [start, end] = await worldPointsToScreen(
      page,
      [
        { x: node.x_px - 90, y: node.y_px + 45 },
        { x: node.x_px, y: node.y_px },
      ],
      1
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const wall = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      return store.project.walls[store.project.walls.length - 1];
    });
    expect([wall.start_node, wall.end_node]).toContain(node.id);
  });

  test("click without drag and escape add no wall or history", async ({ page }) => {
    const before = await storeState(page);
    const point = await worldToScreen(page, 1420, 1000, 1);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(250);
    let after = await storeState(page);
    expect(after.walls).toBe(before.walls);
    expect(after.undo).toBe(before.undo);

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 40, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(250);
    after = await storeState(page);
    expect(after.walls).toBe(before.walls);
    expect(after.undo).toBe(before.undo);
  });

  test("point end on a blank canvas after leaving the canvas cancels", async ({ page }) => {
    const before = await storeState(page);
    const point = await worldToScreen(page, 1420, 1000, 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 40, point.y + 10, { steps: 4 });
    await page.mouse.move(5, 5, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await storeState(page);
    expect(after.walls).toBe(before.walls);
    expect(after.undo).toBe(before.undo);
  });

  test("split on existing wall preserves openings and is one undo", async ({ page }) => {
    const target = await page.evaluate(async () => {
      const { store } = await import("/js/store.js");
      const wall = store.project.walls.find(
        (w) => w.type === "solid" && !store.project.openings.some((o) => o.wall_id === w.id)
      );
      const a = store.getNodeById(wall.start_node);
      const b = store.getNodeById(wall.end_node);
      return {
        id: wall.id,
        mx: (a.x_px + b.x_px) / 2,
        my: (a.y_px + b.y_px) / 2,
        count: store.project.openings.length,
      };
    });
    const before = await storeState(page);
    const start = await worldToScreen(page, target.mx, target.my, 1);
    await dragBy(page, start, 0, -55);
    const after = await storeState(page);
    expect(after.walls).toBe(before.walls + 2);
    expect(after.openings).toBe(target.count);
    expect(after.undo).toBe(before.undo + 1);
    const wallStillExists = await page.evaluate(async (id) => {
      const { store } = await import("/js/store.js");
      return store.project.walls.some((w) => w.id === id);
    }, target.id);
    expect(wallStillExists).toBe(true);
  });
});
