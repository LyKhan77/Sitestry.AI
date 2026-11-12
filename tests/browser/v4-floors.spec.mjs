import { test, expect } from "@playwright/test";
import { gotoAppV4, loadStage } from "./helpers.mjs";

const VIEWPORT = { width: 1440, height: 960 };

async function boot(page) {
  await gotoAppV4(page, VIEWPORT);
  await loadStage(page, 3);
}

async function buildAtStage4(page) {
  await loadStage(page, 4);
  await page.locator("#btnBuild3D").click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.build)).toBe("fresh");
}

const baseFloor = (page) =>
  page.evaluate(() => {
    const group = window.sitestryApp.viewer3d.rootGroup.children.find((c) => c.name === "BaseFloor");
    if (!group) return null;
    return {
      count: group.children.length,
      tops: group.children.map((m) => {
        m.geometry.computeBoundingBox();
        return m.geometry.boundingBox.max.y + m.position.y;
      }),
      roles: group.children.map((m) => m.userData?.role),
      kinds: group.children.map((m) => m.userData?.sitestryKind ?? null),
    };
  });

const faceCount = (page) => page.evaluate(() => window.sitestryApp.canvas2d.roomFaces().length);

async function emptyProject(page, what) {
  await page.evaluate((target) => {
    const { store } = window.sitestryApp.canvas2d;
    if (target === "walls") {
      store.project.walls = [];
      store.project.nodes = [];
    } else {
      store.project.rooms = [];
    }
    store.emit("geometryChanged", { source: "test" });
  }, what);
}

test.describe("automatic base floor", () => {
  test("build adds one base slab per closed room", async ({ page }) => {
    await boot(page);
    const faces = await faceCount(page);
    expect(faces).toBeGreaterThanOrEqual(5);
    await buildAtStage4(page);
    expect((await baseFloor(page)).count).toBe(faces);
  });

  test("base slabs are not selectable", async ({ page }) => {
    await boot(page);
    await buildAtStage4(page);
    const info = await baseFloor(page);
    expect(info.kinds.every((k) => k === null)).toBe(true);
    expect(info.roles.every((r) => r === "base_floor")).toBe(true);
    const selectable = await page.evaluate(() =>
      window.sitestryApp.viewer3d.selectableMeshes.filter((m) => m.userData?.role === "base_floor").length
    );
    expect(selectable).toBe(0);
  });

  test("slabs are thin and sit below every zone top", async ({ page }) => {
    await boot(page);
    await buildAtStage4(page);
    const info = await baseFloor(page);
    for (const top of info.tops) expect(Math.abs(top - 0.02)).toBeLessThan(0.001);
    const zoneTops = await page.evaluate(() =>
      window.sitestryApp.viewer3d.selectableMeshes
        .filter((m) => m.userData?.sitestryKind === "room")
        .flatMap((root) => {
          const tops = [];
          root.traverse?.((child) => {
            if (child.geometry) {
              child.geometry.computeBoundingBox();
              tops.push(child.geometry.boundingBox.max.y + child.position.y + root.position.y);
            }
          });
          return tops;
        })
    );
    expect(zoneTops.length).toBeGreaterThan(0);
    for (const top of zoneTops) expect(Math.abs(top - 0.02)).toBeGreaterThan(0.003);
  });

  test("the layer toggle hides the base floor", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const box = document.getElementById("chkLayerBaseFloor");
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await buildAtStage4(page);
    expect(await baseFloor(page)).toBeNull();
  });

  test("no closed rooms means no base floor", async ({ page }) => {
    await boot(page);
    await emptyProject(page, "walls");
    await buildAtStage4(page);
    expect(await baseFloor(page)).toBeNull();
  });

  test("unzoned corridors are covered", async ({ page }) => {
    await boot(page);
    const faces = await faceCount(page);
    await emptyProject(page, "rooms");
    await buildAtStage4(page);
    expect((await baseFloor(page)).count).toBe(faces);
  });

  test("GLB export contains the base floor nodes", async ({ page }) => {
    await boot(page);
    await buildAtStage4(page);
    const exported = await page.evaluate(async () => {
      const buffer = await window.sitestryApp.viewer3d.exportGLB("t.glb", { download: false });
      const view = new DataView(buffer);
      let offset = 12;
      while (offset < buffer.byteLength) {
        const length = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        if (type === 0x4e4f534a) {
          const json = JSON.parse(new TextDecoder().decode(buffer.slice(offset + 8, offset + 8 + length)));
          return (json.nodes || []).filter((n) => n.extras?.role === "base_floor").length;
        }
        offset += 8 + length;
      }
      return -1;
    });
    expect(exported).toBe((await baseFloor(page)).count);
  });
});
