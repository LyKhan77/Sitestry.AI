import { test, expect } from "@playwright/test";
import {
  gotoAppV4,
  loadStage,
  setTool,
  storeState,
  worldPointsToScreen,
  dragBy,
} from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

function fitReport(page, rootSelector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const host = root.closest(".dock-flyout, .stage-sidebar") || root;
    const rootRect = root.getBoundingClientRect();
    const escapes = [...root.querySelectorAll("input, select, label")].filter(
      (el) => el.getBoundingClientRect().right > rootRect.right + 1
    ).length;
    const clippedLabels = [...root.querySelectorAll("label")].filter(
      (el) => el.scrollWidth > el.clientWidth + 1
    ).length;
    return { hostOverflow: host.scrollWidth - host.clientWidth, escapes, clippedLabels };
  }, rootSelector);
}

function expectFits(report) {
  expect(report.hostOverflow).toBeLessThanOrEqual(1);
  expect(report.escapes).toBe(0);
  expect(report.clippedLabels).toBe(0);
}

async function addStair(page, shape, startPoint, endPoint) {
  await page.evaluate((shapeValue) => {
    const { store } = window.sitestryApp.canvas2d;
    store.ui.stairDefaults.shape = shapeValue;
    store.ui.stairDefaults.turn = "right";
    store.setActiveTool("stair");
  }, shape);
  const [a, b] = await worldPointsToScreen(page, [startPoint, endPoint], 0.9);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(120);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(350);
}

test.describe("v4 stair parameter card", () => {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1200, height: 900 },
  ]) {
    test(`stair card fits the flyout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await gotoAppV4(page, viewport);
      await loadStage(page, 3);
      await setTool(page, "stair");
      expectFits(await fitReport(page, "#stairSettingsCard"));
    });
  }

  test("stair card fits the narrow drawer at 900x700", async ({ page }) => {
    await gotoAppV4(page, { width: 900, height: 700 });
    await loadStage(page, 3);
    await setTool(page, "stair");
    await page.locator("#btnToggleTools").click();
    await page.waitForTimeout(250);
    expectFits(await fitReport(page, "#stairSettingsCard"));
  });

  test("stair inspector rows fit after placing a stair", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await addStair(page, "L", { x: 1200, y: 900 }, { x: 1260, y: 960 });
    expect((await storeState(page)).selected?.kind).toBe("stair");
    await page.waitForTimeout(300);
    expectFits(await fitReport(page, "#rightInspector"));
  });
});

test.describe("v4 stage 3 is 2D only", () => {
  test("view pill is hidden in stages 1-3 and shown in 4-5", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    for (const stage of [1, 2, 3]) {
      await loadStage(page, stage);
      await expect(page.locator(".view-mode-group")).toBeHidden();
    }
    for (const stage of [4, 5]) {
      await loadStage(page, stage);
      await expect(page.locator(".view-mode-group")).toBeVisible();
    }
  });

  test("palette view actions are offered only from stage 4", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    const enabled = () =>
      page.evaluate(async () => {
        const { PALETTE_ACTIONS } = await import("/js/uiV4.js");
        return PALETTE_ACTIONS.filter((a) => a.id.startsWith("view-")).map((a) =>
          a.when ? a.when() : true
        );
      });
    await loadStage(page, 3);
    const atStage3 = await enabled();
    expect(atStage3.length).toBe(3);
    expect(atStage3.every((v) => v === false)).toBe(true);
    await loadStage(page, 4);
    expect((await enabled()).every((v) => v === true)).toBe(true);
  });

  test("stage 3 keeps the 2D view", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.store.ui.viewMode)).toBe("2d");
  });
});

test.describe("v4 dock shortcut badges", () => {
  test("rail buttons show their shortcut key at 1440x960", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    const badges = await page.evaluate(() =>
      [...document.querySelectorAll("#stageSidebar .tool-btn[data-tool]")]
        .filter((btn) => btn.querySelector(".kbd") && btn.getBoundingClientRect().width > 0)
        .map((btn) => {
          const kbd = btn.querySelector(".kbd");
          const k = kbd.getBoundingClientRect();
          const b = btn.getBoundingClientRect();
          return {
            tool: btn.dataset.tool,
            w: k.width,
            h: k.height,
            fontSize: parseFloat(getComputedStyle(kbd).fontSize),
            inside:
              k.left >= b.left - 1 && k.right <= b.right + 1 && k.top >= b.top - 1 && k.bottom <= b.bottom + 1,
            len: kbd.textContent.trim().length,
          };
        })
    );
    expect(badges.length).toBeGreaterThanOrEqual(8);
    for (const badge of badges) {
      expect(badge.w, badge.tool).toBeGreaterThanOrEqual(14);
      expect(badge.h, badge.tool).toBeGreaterThanOrEqual(14);
      expect(badge.fontSize, badge.tool).toBeGreaterThanOrEqual(11);
      expect(badge.inside, badge.tool).toBe(true);
      expect(badge.len, badge.tool).toBe(1);
    }
  });

  test("badge does not remove the accessible name", async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await expect(page.locator('#stageSidebar .tool-btn[data-tool="wall"]')).toHaveAttribute(
      "aria-label",
      "Draw Wall (W)"
    );
  });

  test("narrow drawer shows label and key", async ({ page }) => {
    await gotoAppV4(page, { width: 900, height: 700 });
    await loadStage(page, 3);
    await page.locator("#btnToggleTools").click();
    await page.waitForTimeout(250);
    const sizes = await page.evaluate(() => {
      const btn = document.querySelector('#stageSidebar .tool-btn[data-tool="wall"]');
      const label = btn.querySelector("span:not(.kbd)").getBoundingClientRect();
      const kbd = btn.querySelector(".kbd").getBoundingClientRect();
      return { label: label.width, kbd: kbd.width };
    });
    expect(sizes.label).toBeGreaterThan(14);
    expect(sizes.kbd).toBeGreaterThan(14);
  });
});

function readTarget(kind) {
  const { store } = window.sitestryApp.canvas2d;
  if (kind === "node") {
    const node = store.project.nodes[0];
    return { id: node.id, x: node.x_px, y: node.y_px };
  }
  if (kind === "column") {
    const column = store.project.columns[0];
    return { id: column.id, x: column.x_px, y: column.y_px };
  }
  if (kind === "stair") {
    const stair = store.project.stairs.find((s) => Number.isFinite(s.x_px) && Number.isFinite(s.y_px));
    return { id: stair.id, x: stair.x_px, y: stair.y_px };
  }
  const opening = store.project.openings[0];
  const wall = store.project.walls.find((item) => item.id === opening.wall_id);
  const n1 = store.getNodeById(wall.start_node);
  const n2 = store.getNodeById(wall.end_node);
  const ratio = opening.offset_ratio ?? 0.5;
  return {
    id: opening.id,
    x: n1.x_px + (n2.x_px - n1.x_px) * ratio,
    y: n1.y_px + (n2.y_px - n1.y_px) * ratio,
  };
}

function readPosition({ kind, id }) {
  const { store } = window.sitestryApp.canvas2d;
  if (kind === "opening") {
    const opening = store.project.openings.find((o) => o.id === id);
    return { x: opening.offset_ratio, y: 0 };
  }
  const list = { node: store.project.nodes, column: store.project.columns, stair: store.project.stairs }[kind];
  const item = list.find((entry) => entry.id === id);
  return { x: item.x_px, y: item.y_px };
}

// Longest wall without openings: its midpoint is clear of nodes, columns and door symbols.
function plainWallMidpoint() {
  const { store } = window.sitestryApp.canvas2d;
  const hosts = new Set(store.project.openings.map((o) => o.wall_id));
  let best = null;
  for (const wall of store.project.walls) {
    if (hosts.has(wall.id)) continue;
    const n1 = store.getNodeById(wall.start_node);
    const n2 = store.getNodeById(wall.end_node);
    const len = Math.hypot(n2.x_px - n1.x_px, n2.y_px - n1.y_px);
    if (!best || len > best.len) {
      best = { id: wall.id, len, x: (n1.x_px + n2.x_px) / 2, y: (n1.y_px + n2.y_px) / 2 };
    }
  }
  return best;
}

test.describe("v4 tool isolation", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppV4(page, VIEWPORT);
    await loadStage(page, 3);
    await page.evaluate(() => window.sitestryApp.canvas2d.store.selectObject(null, null));
  });

  for (const tool of ["room", "column", "door", "window"]) {
    for (const kind of ["node", "opening", "column", "stair"]) {
      test(`click on ${kind} with ${tool} tool does not select it`, async ({ page }) => {
        const target = await page.evaluate(readTarget, kind);
        // Door/window tools may legitimately place a new opening when the click lands on a wall
        // beneath the element; that new object may be selected, but no pre-existing one may be.
        // The room tool may legitimately select an existing zone (or create one) for a click inside a
        // room, so zones are not part of the "must stay unselected" set for that tool.
        const existing = await page.evaluate((activeTool) => {
          const { project } = window.sitestryApp.canvas2d.store;
          return [
            ...project.nodes,
            ...project.walls,
            ...project.columns,
            ...project.openings,
            ...project.stairs,
            ...(activeTool === "room" ? [] : project.rooms),
          ].map((item) => item.id);
        }, tool);
        await setTool(page, tool);
        const [point] = await worldPointsToScreen(page, [{ x: target.x, y: target.y }], 0.9);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(250);
        const { selected } = await storeState(page);
        if (selected) expect(existing).not.toContain(selected.id);
      });

      test(`drag on ${kind} with ${tool} tool does not move it`, async ({ page }) => {
        const target = await page.evaluate(readTarget, kind);
        const before = await page.evaluate(readPosition, { kind, id: target.id });
        await setTool(page, tool);
        const [point] = await worldPointsToScreen(page, [{ x: target.x, y: target.y }], 0.9);
        await dragBy(page, point, 70, 40);
        const after = await page.evaluate(readPosition, { kind, id: target.id });
        expect(after.x).toBeCloseTo(before.x, 4);
        expect(after.y).toBeCloseTo(before.y, 4);
      });
    }
  }

  test("clicking a wall with the room tool does not select it", async ({ page }) => {
    const wall = await page.evaluate(plainWallMidpoint);
    await setTool(page, "room");
    const [point] = await worldPointsToScreen(page, [{ x: wall.x, y: wall.y }], 0.9);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(250);
    // A zone may be selected or created by the room tool; the wall itself must not be.
    expect((await storeState(page)).selected?.kind).not.toBe("wall");
  });

  test("switching to a drawing tool clears the selection", async ({ page }) => {
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.selectObject("wall", store.project.walls[0].id);
    });
    await page.waitForTimeout(250);
    await setTool(page, "room");
    expect((await storeState(page)).selected).toBe(null);
    await expect(page.locator("#rightInspector")).toBeHidden();
  });

  test("switching to Select keeps the selection", async ({ page }) => {
    await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      store.selectObject("wall", store.project.walls[0].id);
    });
    await setTool(page, "select");
    expect((await storeState(page)).selected?.kind).toBe("wall");
  });

  test("a selection made by the tool gesture survives", async ({ page }) => {
    const wall = await page.evaluate(plainWallMidpoint);
    const before = await storeState(page);
    await setTool(page, "door");
    const [point] = await worldPointsToScreen(page, [{ x: wall.x, y: wall.y }], 0.9);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
    const after = await storeState(page);
    expect(after.openings).toBe(before.openings + 1);
    expect(after.selected?.kind).toBe("opening");
  });

  test("stage 5 equipment stays selectable", async ({ page }) => {
    await loadStage(page, 5);
    const eq = await page.evaluate(() => {
      const { store } = window.sitestryApp.canvas2d;
      const wall = store.project.walls[0];
      const n1 = store.getNodeById(wall.start_node);
      const item = store.addEquipment(n1.x_px + 40, n1.y_px + 40, "rack");
      store.selectObject(null, null);
      return { id: item.id, x: item.x_px, y: item.y_px };
    });
    await setTool(page, "equipment");
    const [point] = await worldPointsToScreen(page, [{ x: eq.x, y: eq.y }], 0.9);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
    expect((await storeState(page)).selected).toEqual({ kind: "equipment", id: eq.id });
  });

  test("Esc returns to Select only when nothing is in progress", async ({ page }) => {
    await setTool(page, "wall");
    await page.keyboard.press("Escape");
    expect((await storeState(page)).tool).toBe("select");

    await setTool(page, "stair");
    const [point] = await worldPointsToScreen(page, [{ x: 1200, y: 900 }], 0.9);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.stairDraft !== null)).toBe(true);
    await page.keyboard.press("Escape");
    expect((await storeState(page)).tool).toBe("stair");
    expect(await page.evaluate(() => window.sitestryApp.canvas2d.stairDraft)).toBe(null);
    await page.keyboard.press("Escape");
    expect((await storeState(page)).tool).toBe("select");
  });
});
