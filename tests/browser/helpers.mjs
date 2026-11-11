import { expect } from "@playwright/test";

export async function gotoApp(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto("/");
  await page.waitForFunction(() => window.sitestryApp && window.sitestryApp.canvas2d);
  await page.waitForFunction(
    () => {
      const app = window.sitestryApp;
      return app && app.canvas2d.store.project.nodes.length > 0;
    },
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(400);
}

export async function loadStage(page, stage) {
  await page.evaluate((step) => window.sitestryApp.setWorkflowStage(step), stage);
  await page.waitForTimeout(250);
}

export async function storeState(page) {
  return page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return {
      revision: store.revision,
      undo: store.undoStack.length,
      redo: store.redoStack.length,
      selected: store.ui.selected,
      nodes: store.project.nodes.length,
      walls: store.project.walls.length,
      stairs: store.project.stairs.length,
      openings: store.project.openings.length,
      tool: store.ui.activeTool,
      stage: store.ui.step,
    };
  });
}

export async function nodeInStore(page, nodeId) {
  return page.evaluate(async (id) => {
    const { store } = await import("/js/store.js");
    const node = store.getNodeById(id);
    return node ? { x: node.x_px, y: node.y_px } : null;
  }, nodeId);
}

export async function firstNodeId(page) {
  return page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return store.project.nodes[0]?.id ?? null;
  });
}

export async function centerNodeAtViewport(page, nodeId, zoom) {
  return page.evaluate(
    ({ id, z }) => {
      const engine = window.sitestryApp.canvas2d;
      const stage = engine.stage;
      const node = engine.store.getNodeById(id);
      stage.scale({ x: z, y: z });
      stage.position({
        x: stage.width() / 2 - node.x_px * z,
        y: stage.height() / 2 - node.y_px * z,
      });
      stage.batchDraw();
      const box = stage.container().getBoundingClientRect();
      return {
        x: box.left + stage.width() / 2,
        y: box.top + stage.height() / 2,
        node: { x: node.x_px, y: node.y_px },
      };
    },
    { id: nodeId, z: zoom }
  );
}

export async function dragBy(page, point, dx, dy) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

export async function expectNoConsoleErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}
