import test from "node:test";
import assert from "node:assert/strict";
import { SceneSync } from "../../frontend/js/sceneSync.js";

function harness() {
  const builds = [];
  const scheduled = [];
  const cancelled = [];
  const sync = new SceneSync({
    rebuild: (revision) => builds.push(revision),
    schedule: (fn) => {
      scheduled.push(fn);
      return scheduled.length - 1;
    },
    cancel: (handle) => cancelled.push(handle),
  });
  return { sync, builds, scheduled, cancelled };
}

test("commits coalesce into one scheduled rebuild with the latest revision", () => {
  const { sync, builds, scheduled } = harness();
  sync.markDirty(1);
  sync.markDirty(2);
  sync.markDirty(3);
  assert.equal(scheduled.length, 1);
  assert.equal(builds.length, 0);
  scheduled[0]();
  assert.deepEqual(builds, [3]);
  assert.equal(sync.isDirty, false);
});

test("preview-only changes are not represented as dirty revisions", () => {
  const { sync, scheduled } = harness();
  assert.equal(sync.markDirty(undefined), false);
  assert.equal(scheduled.length, 0);
});

test("ensureCurrent flushes pending scene immediately for export", () => {
  const { sync, builds, cancelled } = harness();
  sync.markDirty(7);
  const revision = sync.ensureCurrent();
  assert.equal(revision, 7);
  assert.deepEqual(builds, [7]);
  assert.equal(cancelled.length, 1);
});

test("ensureCurrent is a no-op when already current", () => {
  const { sync, builds } = harness();
  sync.markDirty(4);
  sync.ensureCurrent();
  sync.ensureCurrent();
  assert.deepEqual(builds, [4]);
});

test("selection updates never mark the scene dirty", () => {
  const { sync, scheduled } = harness();
  sync.ensureCurrent();
  assert.equal(scheduled.length, 0);
});

test("dispose cancels a pending rebuild", () => {
  const { sync, builds, cancelled } = harness();
  sync.markDirty(9);
  sync.dispose();
  assert.equal(cancelled.length, 1);
  assert.equal(sync.ensureCurrent(), -1);
  assert.deepEqual(builds, []);
});

test("same built revision is not rebuilt again", () => {
  const { sync, builds } = harness();
  sync.markDirty(5);
  sync.flush();
  assert.equal(sync.markDirty(5), false);
  sync.flush();
  assert.deepEqual(builds, [5]);
});
