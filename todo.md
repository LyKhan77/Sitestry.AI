# Sitestry.AI — Phase Task Tracker (`todo.md`)

> **RULE FOR ALL AGENTS**: Overwrite this file (`todo.md`) at the start of every new engineering phase, **only after** verifying that all tasks from the previous phase are marked `[x]` and verified working. Earlier phases (3 to 6) are recorded in `CHANGELOG.md` and git history.

---

## Current Phase: Phase 7 — Stage Edit Rules and Cable Tray Network (branches `fix/stage-edit-lock` then `feat/tray-network`, unmerged)

Specs: `docs/superpowers/specs/2026-11-12-stage-edit-lock-design.md`, `docs/superpowers/specs/2026-11-13-tray-network-design.md`. Plans: `docs/superpowers/plans/2026-11-12-stage-edit-lock.md`, `docs/superpowers/plans/2026-11-13-tray-network.md` (all uncommitted).

### Stage edit rules (`fix/stage-edit-lock`)
- [x] `store.canEdit(kind)`: annotation editable only in Stage 3, equipment and tray only in Stage 5 (commit e52aba4)
- [x] Zone polygons no longer swallow clicks of drawing tools (cc7a89a)
- [x] Canvas edit lock: per-kind `draggable`, Stage 5 annotation click-through (def1ca9)
- [x] Delete and inspector read-only outside their stage (24cddb8)
- [x] Docs (da7e264)

### Cable tray network (`feat/tray-network`)
- [x] Reliable drawing: preview and shapes no longer swallow clicks, quick clicks no longer finish the run, vertex and segment snap, `Shift` ortho, right click to finish (0cdcdee)
- [x] Tray types `perforated`/`ladder`/`duct`/`wiremesh`, `height_m`, ceiling-relative default elevation (12e498d)
- [x] 3D profile per tray type (c540760)
- [x] Shared-vertex `tray_nodes`, legacy `points_px` migration, BoQ unchanged (199ae7d)
- [x] Fitting derivation: end, straight, reducer, elbow, tee, cross (2ee4b42)
- [x] 3D fittings, straight runs stop at the fitting (c4a39f6)
- [x] Docs (40b306f)
- [x] Verification: unit tests 170/170, full Playwright suite 266/266, manually tried by the user (overall as expected)

### Stage 5 Select tool (`feat/stage5-select-tool`, off `feat/tray-network`)
- [x] `Select (V)` button in the rail, default tool in Stage 5, Select picks equipment and tray, empty click clears, `Esc` returns Equipment/Tray to Select, tray selectable on its axis (plan: `docs/superpowers/plans/2026-11-13-stage5-select-tool.md`)
- [x] Full Playwright suite: 271 passed, 1 stale expectation in `workspace.spec.mjs` (stage 5 rail now includes `select`) fixed; that spec 47/47

### Open
- [ ] Merge `fix/stage-edit-lock`, `feat/tray-network` and `feat/stage5-select-tool` to `main` (or open PRs); user decides
- [ ] Independent code review of both branches (the review subagent could not run in the first session)
- [ ] Guided tray draw: deferred. The rung-strip detector found only fragments (Gatsu Battery-AHU run, Ancol Rectifier and Battery rooms) and flagged stairs, a toilet partition and rack rows, so it was not committed. Revisit only if Manual drawing proves insufficient.
- [ ] Minor: inspector keeps a focused input unlocked when the stage changes with the same selection; non-90 degree elbows may leave small gaps; perforation holes are visual only (not in GLB); a few code comments still say "Cable Ladders"; `.gitignore` still lists the unused `tests/browser/pw8031.config.mjs`

## Backlog (carried over from the old Phase 4 handover)

Persistence (workspace save/load) and automatic closed-room detection are done (Phase 6). Still open:

- [ ] Multi-floor elevation stacking.
- [ ] Automated backend `pytest` suite (backend has no tests yet).
- [ ] Validate priorities with the user before starting either item, then save the spec and plan in `docs/superpowers/specs/` and `docs/superpowers/plans/` (uncommitted).
