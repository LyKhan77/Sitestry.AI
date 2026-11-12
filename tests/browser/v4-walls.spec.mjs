import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage, setTool, worldPointsToScreen } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

async function boot(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 3);
}

const store = (page, fn, arg) => page.evaluate(fn, arg);
const snapMarkers = (page) =>
  page.evaluate(() =>
    window.sitestryApp.canvas2d.overlayLayer.find(".wall-snap").map((n) => ({ x: n.x(), y: n.y(), kind: n.attrs.kind }))
  );

/** A node with free space around it, plus a blank point well away from every wall. */
const anchors = (page) =>
  page.evaluate(() => {
    const { store: s } = window.sitestryApp.canvas2d;
    const node = s.project.nodes.find((n) => s.project.walls.some((w) => w.start_node === n.id || w.end_node === n.id));
    const xs = s.project.nodes.map((n) => n.x_px);
    const ys = s.project.nodes.map((n) => n.y_px);
    return {
      node: { id: node.id, x: node.x_px, y: node.y_px },
      blank: { x: Math.min(...xs) - 150, y: Math.min(...ys) - 150 },
    };
  });

async function dragWorld(page, a, b, { release = true } = {}) {
  const [from, to] = await worldPointsToScreen(page, [a, b], 0.9);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (release) {
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  return { from, to };
}

const lastWall = (page) =>
  page.evaluate(() => {
    const { store: s } = window.sitestryApp.canvas2d;
    const w = s.project.walls[s.project.walls.length - 1];
    return { ...w, walls: s.project.walls.length, nodes: s.project.nodes.length };
  });

test.describe("wall connection: snap", () => {
  test("endpoint snap is on by default", async ({ page }) => {
    await boot(page);
    expect(await store(page, () => window.sitestryApp.canvas2d.store.ui.endpointSnap)).toBe(true);
    await expect(page.locator("#chkEndpointSnap")).toBeChecked();
  });

  test("a wall drawn ending 6 css px from a node connects to it", async ({ page }) => {
    await boot(page);
    const { node, blank } = await anchors(page);
    await setTool(page, "wall");
    const before = await lastWall(page);
    await dragWorld(page, blank, { x: node.x + 4, y: node.y + 5 });
    const after = await lastWall(page);
    expect(after.walls).toBe(before.walls + 1);
    expect(after.end_node).toBe(node.id);
  });

  test("turning snap off stops the connection", async ({ page }) => {
    await boot(page);
    const { node, blank } = await anchors(page);
    await store(page, () => {
      window.sitestryApp.canvas2d.store.ui.endpointSnap = false;
    });
    await setTool(page, "wall");
    await dragWorld(page, blank, { x: node.x + 4, y: node.y + 5 });
    expect((await lastWall(page)).end_node).not.toBe(node.id);
  });

  test("wall tool shows a snap ring on a nearby node and nothing far from walls", async ({ page }) => {
    await boot(page);
    const { node, blank } = await anchors(page);
    await setTool(page, "wall");
    const [near, far] = await worldPointsToScreen(page, [{ x: node.x + 3, y: node.y + 4 }, blank], 0.9);
    await page.mouse.move(near.x, near.y);
    await page.mouse.move(near.x + 1, near.y + 1);
    await page.waitForTimeout(200);
    const markers = await snapMarkers(page);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ x: node.x, y: node.y, kind: "node" });
    await page.mouse.move(far.x, far.y);
    await page.mouse.move(far.x + 1, far.y + 1);
    await page.waitForTimeout(200);
    expect(await snapMarkers(page)).toHaveLength(0);
  });

  test("wall tool shows a snap marker on a wall interior", async ({ page }) => {
    await boot(page);
    const target = await page.evaluate(() => {
      const { store: s } = window.sitestryApp.canvas2d;
      let best = null;
      for (const w of s.project.walls) {
        const a = s.getNodeById(w.start_node);
        const b = s.getNodeById(w.end_node);
        const len = Math.hypot(b.x_px - a.x_px, b.y_px - a.y_px);
        const mid = { x: (a.x_px + b.x_px) / 2, y: (a.y_px + b.y_px) / 2 };
        const nearest = Math.min(...s.project.nodes.map((n) => Math.hypot(n.x_px - mid.x, n.y_px - mid.y)));
        if (len > 150 && nearest > 30 && (!best || len > best.len)) best = { len, ...mid };
      }
      return best;
    });
    expect(target).toBeTruthy();
    await setTool(page, "wall");
    const [p] = await worldPointsToScreen(page, [{ x: target.x, y: target.y }], 0.9);
    await page.mouse.move(p.x, p.y);
    await page.mouse.move(p.x + 1, p.y + 1);
    await page.waitForTimeout(200);
    const markers = await snapMarkers(page);
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe("wall");
    expect(Math.hypot(markers[0].x - target.x, markers[0].y - target.y)).toBeLessThan(6);
  });

  test("dragging shows markers at both connected ends", async ({ page }) => {
    await boot(page);
    const pair = await page.evaluate(() => {
      const { store: s } = window.sitestryApp.canvas2d;
      const used = s.project.nodes.filter((n) => s.project.walls.some((w) => w.start_node === n.id || w.end_node === n.id));
      const a = used[0];
      // Keep the end on screen: leaving the canvas cancels the drag.
      const b = used.find((n) => {
        const d = Math.hypot(n.x_px - a.x_px, n.y_px - a.y_px);
        return d > 120 && d < 300;
      });
      return { a: { x: a.x_px, y: a.y_px }, b: { x: b.x_px, y: b.y_px } };
    });
    await setTool(page, "wall");
    await dragWorld(page, { x: pair.a.x + 4, y: pair.a.y + 4 }, { x: pair.b.x + 4, y: pair.b.y + 4 }, { release: false });
    await page.waitForTimeout(200);
    expect((await snapMarkers(page)).length).toBeGreaterThanOrEqual(2);
    await page.mouse.up();
  });
});

test.describe("wall connection: delete cleanup and open ends", () => {
  test("deleting a wall removes its end vertices from the canvas", async ({ page }) => {
    await boot(page);
    await store(page, () => {
      const { store: s } = window.sitestryApp.canvas2d;
      s.project.nodes.push({ id: "tmp_a", x_px: 20, y_px: 20 }, { id: "tmp_b", x_px: 220, y_px: 20 });
      s.project.walls.push({ id: "tmp_w", start_node: "tmp_a", end_node: "tmp_b", thickness_m: 0.2, height_m: 3.8, type: "solid" });
      s.emit("geometryChanged", { source: "test" });
      window.sitestryApp.canvas2d.renderAll();
      s.selectObject("wall", "tmp_w");
    });
    await page.waitForTimeout(200);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(250);
    const state = await store(page, () => {
      const { store: s, nodeVisuals } = window.sitestryApp.canvas2d;
      return { nodes: s.project.nodes.map((n) => n.id), handles: nodeVisuals.length, total: s.project.nodes.length };
    });
    expect(state.nodes).not.toContain("tmp_a");
    expect(state.nodes).not.toContain("tmp_b");
    expect(state.handles).toBe(state.total);
  });

  test("free-end markers show in stage 3 and not in stage 4 or with the layer off", async ({ page }) => {
    await boot(page);
    const expected = await page.evaluate(async () => {
      const { findFreeEnds } = await import("/js/roomFaces.js");
      return findFreeEnds(window.sitestryApp.canvas2d.store.project, { gapPx: 0.3 * 30.68 }).length;
    });
    expect(expected).toBeGreaterThan(0);
    const count = () => page.evaluate(() => window.sitestryApp.canvas2d.stage.find(".free-end").length);
    expect(await count()).toBe(expected);
    await page.evaluate(() => {
      window.sitestryApp.canvas2d.store.ui.layers.freeEnds = false;
      window.sitestryApp.canvas2d.renderAll();
    });
    expect(await count()).toBe(0);
    await page.evaluate(() => {
      window.sitestryApp.canvas2d.store.ui.layers.freeEnds = true;
      window.sitestryApp.canvas2d.renderAll();
    });
    expect(await count()).toBe(expected);
    await loadStage(page, 4);
    await page.waitForTimeout(300);
    expect(await count()).toBe(0);
  });
});
