import test from "node:test";
import assert from "node:assert/strict";
import { SitestryStore } from "../../frontend/js/store.js";
import { BlueprintGuideSession } from "../../frontend/js/blueprintGuides.js";

function context(overrides = {}) {
  return {
    sourceRevision: 1,
    detectorVersion: "blueprint-guides-v1",
    kind: "sample",
    sampleId: "gatsu_p4",
    file: null,
    pageNumber: 4,
    roiPx: { x: 0, y: 0, width: 1000, height: 800 },
    scalePxPerMeter: 30.68,
    imageWidthPx: 1584,
    imageHeightPx: 1224,
    alignment: null,
    ...overrides,
  };
}

function candidate(id, confidence = 0.9) {
  return {
    id,
    start_px: { x_px: 10, y_px: 10 },
    end_px: { x_px: 110, y_px: 10 },
    width_px: 8,
    confidence,
    evidence: "parallel_edges",
  };
}

test("late_request_cannot_overwrite_newer_request", async () => {
  const store = new SitestryStore();
  const pending = [];
  const session = new BlueprintGuideSession(store, (args) => {
    return new Promise((resolve) => pending.push({ args, resolve }));
  });

  const first = session.load(context({ sourceRevision: 1 }));
  const second = session.load(context({ sourceRevision: 2 }));
  pending[1].resolve({ candidates: [candidate("new")] });
  assert.equal(await second, "ready");
  pending[0].resolve({ candidates: [candidate("old")] });
  assert.equal(await first, "stale");
  assert.deepEqual(store.guideCandidates.map((c) => c.id), ["new"]);
});

test("abort_ignored_by_server_still_rejects_stale_result", async () => {
  const store = new SitestryStore();
  let resolveRequest;
  const session = new BlueprintGuideSession(store, () => {
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  });
  const request = session.load(context());
  session.invalidate();
  resolveRequest({ candidates: [candidate("stale")] });
  assert.equal(await request, "stale");
  assert.equal(store.guideCandidates.length, 0);
  assert.equal(store.guideStatus, "idle");
});

test("confidence_filter_and_unavailable_status", async () => {
  const store = new SitestryStore();
  const session = new BlueprintGuideSession(store, async () => ({
    candidates: [candidate("low", 0.2), candidate("ok", 0.65)],
  }));
  assert.equal(await session.load(context()), "ready");
  assert.deepEqual(store.guideCandidates.map((c) => c.id), ["ok"]);

  const empty = new BlueprintGuideSession(store, async () => ({ candidates: [] }));
  assert.equal(await empty.load(context()), "unavailable");
  assert.equal(store.guideStatus, "unavailable");
});

test("error_keeps_manual_preview_available", async () => {
  const store = new SitestryStore();
  const session = new BlueprintGuideSession(store, async () => {
    throw new Error("backend unavailable");
  });
  assert.equal(await session.load(context()), "error");
  assert.equal(store.guideStatus, "error");
  assert.equal(store.guideCandidates.length, 0);
  assert.match(store.guideError, /backend unavailable/);
});

test("guide_cache_is_outside_project_and_undo", async () => {
  const store = new SitestryStore();
  const before = JSON.stringify(store.project);
  const undoBefore = store.undoStack.length;
  store.setGuideCandidates([candidate("g1")], "ready");
  assert.equal(JSON.stringify(store.project), before);
  assert.equal(store.undoStack.length, undoBefore);
});

test("context_changes_produce_different_keys_and_new_requests", async () => {
  const store = new SitestryStore();
  let calls = 0;
  const session = new BlueprintGuideSession(store, async () => {
    calls += 1;
    return { candidates: [candidate(`g${calls}`)] };
  });
  await session.load(context({ pageNumber: 4 }));
  await session.load(context({ pageNumber: 4 }));
  assert.equal(calls, 1);
  await session.load(context({ pageNumber: 5 }));
  assert.equal(calls, 2);
  await session.load(context({ pageNumber: 5, roiPx: { x: 1, y: 1, width: 90, height: 90 } }));
  assert.equal(calls, 3);
  await session.load(context({ pageNumber: 5, roiPx: { x: 1, y: 1, width: 90, height: 90 }, scalePxPerMeter: 31 }));
  assert.equal(calls, 4);
});

test("source_setter_bumps_revision_and_clears_cross_source_history", () => {
  const store = new SitestryStore();
  store.pushHistorySnapshot();
  const revision = store.currentSource.revision;
  store.setSource({ kind: "sample", sampleId: "ancol_p13", metaOverrides: { page_number: 13 } });
  assert.equal(store.currentSource.revision, revision + 1);
  assert.equal(store.undoStack.length, 0);
  assert.equal(store.activeSampleId, "ancol_p13");
  assert.equal(store.uploadedFile, null);
  assert.equal(store.getGuideContext().pageNumber, 13);
});
