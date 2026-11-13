# Sitestry.AI — Phase Task Tracker (`todo.md`)

> **RULE FOR ALL AGENTS**: Overwrite this file (`todo.md`) at the start of every new engineering phase, **only after** verifying that all tasks from the previous phase are marked `[x]` and verified working. Earlier phases (3 to 7) are recorded in `CHANGELOG.md` and git history.

---

## Current Phase: Phase 8 — Stage 5 Cabling, Generic Equipment, Tray Services & Cooling Pipes (`feat/stage5-cabling-cooling`)

Spec: `docs/superpowers/specs/2026-11-13-stage5-cabling-cooling-design.md`.
Plan: `docs/superpowers/plans/2026-11-13-stage5-cabling-cooling.md` (uncommitted).

### Phase 1: Generic Equipment Catalog & Tray Service Categories
- [x] **Task 1**: Pure `equipmentCatalog.js` (5 generic groups: `rack`, `power`, `data`, `cooling`, `security`, subtypes, wall/ceiling mount snap) + `store.js` integration & unit tests
- [x] **Task 2**: Cable Tray `service` (`power` | `data` | `unified`) in `trayNetwork.js` & `store.js` (isolated node snapping/splitting across services, ceiling-relative elevations, legacy `unified` default)
- [x] **Task 3**: Stage 5 Style A UI (5 generic equipment buttons + subtype dropdown, tray service selector, 2D/3D wall-mount & tray service rendering, BoQ group breakdown)

### Phase 2: Cooling Pipe Network & Raised Floor Transparency
- [x] **Task 4**: Pure `pipeNetwork.js` (`pipe_nodes`, `pipe_runs`, `underfloor` vs `overhead`) + `store.js` pipe CRUD & unit tests
- [x] **Task 5**: `Pipe (P)` drawing tool (2D), 3D cylindrical pipes + fittings, and `Transparan Lantai` (3D raised floor X-ray) toggle

### Phase 3: Auto-Cabling Engine, Waterfall Drops & BoQ
- [x] **Task 6**: Pure `cableRouter.js` (Dijkstra on eligible tray/pipe graphs, orthogonal wall-hugging fallback, lateral lane offsets, 3D waterfall drop generation) & unit tests
- [x] **Task 7**: `Cabling (C)` (`Source -> Target`) tool, color-coded 2D/3D cables + curved 3D waterfall meshes, Inspector & live BoQ
- [x] **Task 8**: Update `GLOSSARY.md`, `WORKFLOW.md`, and `CHANGELOG.md` + full verification (unit + Playwright)

---

## Backlog (carried over)
- [ ] Multi-floor elevation stacking (current phase models inter-floor connectivity via wall-hosted `Link / Riser` portals).
- [ ] Automated backend `pytest` suite.
- [ ] Guided tray draw (deferred from Phase 7; revisit only if Manual drawing proves insufficient).
