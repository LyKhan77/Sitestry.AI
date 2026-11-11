import { test, expect } from "@playwright/test";
import { gotoApp, loadStage, setTool, worldPointsToScreen, dragBy } from "./helpers.mjs";

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
  const opening = store.project.openings[0];
  const wall = store.project.walls.find((item) => item.id === opening.wall_id);
  const n1 = store.getNodeById(wall.start_node);
  const n2 = store.getNodeById(wall.end_node);
  const ratio = opening.offset_ratio ?? 0.5;
  return {
    id: opening.id,
    x: n1.x_px + (n2.x_px - n1.x_px) * ratio,
    y: n1.y_px + (n2.y_px - n1.y_px) * ratio,
    ratio,
  };
}

async function targetState(page, kind, id) {
  return page.evaluate(
    ({ targetKind, targetId }) => {
      const { store } = window.sitestryApp.canvas2d;
      if (targetKind !== "opening") {
        const list = targetKind === "node" ? store.project.nodes : store.project.columns;
        const item = list.find((entry) => entry.id === targetId);
        return item ? { x: item.x_px, y: item.y_px } : null;
      }
      const opening = store.project.openings.find((entry) => entry.id === targetId);
      if (!opening) return null;
      const wall = store.project.walls.find((item) => item.id === opening.wall_id);
      const n1 = store.getNodeById(wall.start_node);
      const n2 = store.getNodeById(wall.end_node);
      const ratio = opening.offset_ratio ?? 0.5;
      return {
        x: n1.x_px + (n2.x_px - n1.x_px) * ratio,
        y: n1.y_px + (n2.y_px - n1.y_px) * ratio,
        ratio,
      };
    },
    { targetKind: kind, targetId: id }
  );
}

test.describe("drawing tool arbitration", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await loadStage(page, 3);
  });

  for (const tool of ["wall", "stair"]) {
    for (const kind of ["node", "opening", "column"]) {
      test(`${tool} gesture starting on an existing ${kind} does not move it`, async ({ page }) => {
        const target = await page.evaluate(readTarget, kind);
        expect(target).toBeTruthy();

        await setTool(page, tool);
        const [point] = await worldPointsToScreen(page, [{ x: target.x, y: target.y }], 0.9);
        await dragBy(page, point, 70, 40);

        const after = await targetState(page, kind, target.id);
        expect(after).not.toBe(null);
        expect(after.x).toBeCloseTo(target.x, 4);
        expect(after.y).toBeCloseTo(target.y, 4);
        if (kind === "opening") expect(after.ratio).toBe(target.ratio);
      });
    }
  }
});
