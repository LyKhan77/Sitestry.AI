/**
 * Sitestry.AI — commit-aware scene scheduler.
 *
 * Preview changes stay in 2D. Committed revisions mark the 3D scene dirty and
 * coalesce rebuilds. Entering a 3D view or exporting calls ensureCurrent() so
 * serialization always follows the latest canonical commit.
 */

export class SceneSync {
  constructor({ rebuild, schedule = (fn) => setTimeout(fn, 0), cancel = (handle) => clearTimeout(handle) } = {}) {
    this.rebuild = rebuild;
    this.schedule = schedule;
    this.cancel = cancel;
    this.lastBuiltRevision = -1;
    this.pendingRevision = null;
    this.handle = null;
  }

  markDirty(revision) {
    const value = Number(revision);
    if (!Number.isFinite(value)) return false;
    if (value === this.lastBuiltRevision && this.pendingRevision === null) return false;
    if (this.pendingRevision === value && this.handle !== null) return false;
    this.pendingRevision = value;
    if (this.handle === null) {
      this.handle = this.schedule(() => this.flush());
    }
    return true;
  }

  get isDirty() {
    return this.pendingRevision !== null;
  }

  flush() {
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
    if (this.pendingRevision === null) return this.lastBuiltRevision;
    const revision = this.pendingRevision;
    this.pendingRevision = null;
    this.lastBuiltRevision = revision;
    this.rebuild(revision);
    return revision;
  }

  ensureCurrent() {
    return this.flush();
  }

  dispose() {
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
    this.pendingRevision = null;
  }
}
