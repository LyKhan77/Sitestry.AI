/**
 * Sitestry.AI — client-side blueprint guide session.
 *
 * Owns the guide request lifecycle for the ACTIVE source only. Every response
 * is checked against the captured source/ROI/scale key, even when AbortController
 * did not stop the server. Candidate cache lives outside project JSON and undo.
 */

export const GUIDE_MIN_CONFIDENCE = 0.65;

export class BlueprintGuideSession {
  constructor(store, fetchGuides) {
    this.store = store;
    this.fetchGuides = fetchGuides;
    this.currentKey = null;
    this.status = "idle";
    this.controller = null;
    this.requestCounter = 0;
  }

  contextKey(context) {
    if (!context) return null;
    return JSON.stringify({
      sourceRevision: context.sourceRevision,
      detectorVersion: context.detectorVersion,
      kind: context.kind,
      sampleId: context.sampleId,
      hasFile: Boolean(context.file),
      pageNumber: context.pageNumber,
      roiPx: context.roiPx,
      scalePxPerMeter: context.scalePxPerMeter,
      imageWidthPx: context.imageWidthPx,
      imageHeightPx: context.imageHeightPx,
      alignment: context.alignment,
    });
  }

  async load(context) {
    const key = this.contextKey(context);
    if (!key) return "unavailable";
    if (this.currentKey === key && (this.status === "ready" || this.status === "unavailable")) {
      return this.status;
    }
    if (this.controller) this.controller.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.currentKey = key;
    this.status = "loading";
    this.requestCounter += 1;
    const requestId = this.requestCounter;
    this.store.setGuideCandidates([], "loading");

    try {
      const result = await this.fetchGuides({
        sampleId: context.sampleId,
        file: context.file,
        pageNumber: context.pageNumber,
        roiPx: context.roiPx,
        scalePxPerMeter: context.scalePxPerMeter,
        signal: controller.signal,
      });
      if (this.currentKey !== key || requestId !== this.requestCounter) {
        return "stale";
      }
      const candidates = (result.candidates || []).filter(
        (candidate) => Number(candidate.confidence) >= GUIDE_MIN_CONFIDENCE
      );
      this.status = candidates.length > 0 ? "ready" : "unavailable";
      this.store.setGuideCandidates(candidates, this.status);
      return this.status;
    } catch (error) {
      if (controller.signal.aborted || this.currentKey !== key || requestId !== this.requestCounter) {
        return "stale";
      }
      this.status = "error";
      this.store.setGuideCandidates([], "error", String(error?.message || error));
      return "error";
    }
  }

  invalidate() {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    this.currentKey = null;
    this.status = "idle";
    this.requestCounter += 1;
    this.store.clearGuideCandidates();
  }
}
