# Sitestry.AI — Phase Task Tracker (`todo.md`)

> **RULE FOR ALL AGENTS**: Overwrite this file (`todo.md`) at the start of every new engineering phase, **only after** verifying that all tasks from the previous phase are marked `[x]` and verified working.

---

## Completed Phase: Phase 3 — Procedural Architectural Vision & 5-Stage UI Redesign (v3.0.0)

- [x] Inspect vector drawings and raster geometry for `Gatsu Hal. 4`, `Ancol Hal. 13`, and `plan.jpeg`.
- [x] Rewrite `backend/cad_parser.py` with 4-stage procedural CAD topology extraction:
  - [x] Periodic parallel tread cluster detection for Stairs (`_extract_stairs`).
  - [x] Green H-Beam and structural X-cross grid detection for Pillars (`_extract_columns`).
  - [x] Quarter-circle (`90°`) swing arc + thin door leaf verification & Door Tag (`DD-xx`, `D-xx`, `TD-xx`) alignment (`_extract_doors`).
  - [x] Multi-line perimeter window mullion/glazing detection (`_extract_windows`).
  - [x] Double-line & filled quad wall topology with door-gap bridging and T/L corner node snapping (`_extract_walls_and_attach_openings`).
  - [x] Exclude auto-dumped equipment during structural extraction (`equipments: []`, `cable_trays: []`).
- [x] Rewrite `backend/vectorizer.py` with ORB + RANSAC affine registration for `plan.jpeg` (including R. Kapasitor annex) and morphological skeletonization for general raster uploads.
- [x] Update `backend/main.py` default `roi_px` height (`90%`) so full multi-building layouts (`Ancol Hal. 13`: Gedung A, B, Bridges, and C) are inside the default extraction region.
- [x] Redesign `frontend/index.html` and `frontend/css/style.css` following `DESIGN.md` (Warm Cream `#f2f0eb`, Starbucks Green `#006241`, Green Accent `#00754A` `50px` pills, House Green `#1E3932`, `Plus Jakarta Sans` + `IBM Plex Mono`).
- [x] Implement strict 5-Stage Segmented Page Flow (`1. Input` -> `2. Process Extraction` -> `3. Review Annotation` -> `4. Build 3D` -> `5. Installation Equipment`) in `frontend/js/app.js`, `store.js`, `canvas2d.js`, and `viewer3d.js`.
- [x] Install `mattpocock/skills` (`engineering` & `productivity` suites) and author `AGENTS.md`, `WORKFLOW.md`, `CHANGELOG.md`, `GLOSSARY.md`, and `.gitignore`.

---

## Completed Phase: Phase 4A — Minimal Workspace, Manual/Guided Walls & Parametric Stairs (v3.1.0)

- [x] Stable vertex edit transactions, one-gesture undo, redo preservation, numeric meter inspector, and 45-step history cap.
- [x] Manual wall drag with optional endpoint snap/ortho, atomic wall split + opening remap, and rejection without partial changes.
- [x] Five-stage focused workspace: 75% annotation canvas at 1280/1440, contextual inspector, on-demand layers, narrow overlay panels, and reduced-motion/focus/ARIA handling.
- [x] Source-derived centerline detector for PDF and raster, bounded LRU endpoint, guided overlay, and stale-response guard tied to source revision/ROI/scale/alignment.
- [x] Shared straight/L/U staircase resolver, two-click placement, endpoint/group editing, contextual parameters, and explicit legacy conversion.
- [x] 2D/3D/GLB consumers of the shared resolver, commit-aware scene scheduler, export flush/guard, and resource disposal.
- [x] Node unit suites, Playwright regressions, real-sample acceptance screenshots, GLB JSON inspection, and extraction baseline lock for Gatsu/Ancol/plan.jpeg.
- [x] Review hardening pass 2: same-source history across guide invalidation; wall/stair pointer priority and screen-space vertex handles; bounded guide extraction budgets; inert narrow sidebar; derived stair field refresh and integer riser validation; complete L/U landing guardrails.

## Completed Phase: Phase 5 — Dock + Wizard UI Redesign (behind `?ui=v4`, branch `feat/dock-wizard-ui`)

Spec: `docs/superpowers/specs/2026-11-11-dock-wizard-ui-design.md`. Plan: `docs/superpowers/plans/2026-11-11-dock-wizard-ui.md` (both uncommitted).

- [x] Task 1: Flag, compact header, bottom stage timeline (commit 5d58645; v4-shell + workspace specs 12/12)
- [x] Task 2: Stage 3 dock, floating property panel, view pills (commit dc9dc35; 33/33 specs incl. v4-dock 10/10)
- [x] Task 3: Stage 4-5 dock, single camera set, Export menu, BoQ panel (commit 79cddaf; 39/39 specs incl. v4-stage45 8/8)
- [x] Task 4: Command palette (`Ctrl/Cmd+K`) (commit 77e3e99; 38/38 specs incl. v4-palette 8/8)
- [x] Task 5: Stage 1 wizard card (commit 89ce201; 21/21 specs incl. v4-wizard 4/4)
- [x] Task 6: Stage 2 wizard with honest, progressive extraction reveal (commits ec7c654, 606717a; 33/33 specs incl. v4-wizard 12/12)
- [x] Task 7: Responsive, accessibility, default flip to v4, docs (commits 0d50ee5, 381dee7; full Playwright suite 98/98)

## Current Phase: Phase 6 — Workspace, Save/Build, Room Zones (branch `feat/dock-wizard-ui`)

Spec: `docs/superpowers/specs/2026-11-12-workspace-save-room-design.md` (uncommitted). P1 plan: `docs/superpowers/plans/2026-11-12-quick-fixes-tool-isolation.md`.

- [x] P1 Quick fixes: stair card overlap, Stage 3 2D-only, rail shortcut badges, tool isolation (commits fixed in Tasks 1-4)
- [x] P2 Workspace home, backend save (`workspace/`), Stage 1 upload-only, mandatory Save and manual Build 3D (plan: `docs/superpowers/plans/2026-11-12-workspace-save-build.md`)
- [x] P2b Multi-project workspace: many projects per workspace, migration of the single saved project (plan: `docs/superpowers/plans/2026-11-12-multi-project-workspace.md`)
- [x] P3 Room zones: click-inside-room (A) plus snapped polygon (C) plus zone vertex edit (plan: `docs/superpowers/plans/2026-11-12-room-zones.md`)

## Pending Phase: Phase 4 — Next Agent Handover & Engineering Improvements (Pending Grill Validation)

- [ ] Validate Phase 4 architectural priorities with the user via `grill-me` (Persistence & Project Save/Load, Automatic Polygon Room Cycle Detection `shapely.ops.polygonize`, Multi-Floor Elevation Stacking, and Automated Pytest Suite).
- [ ] Save approved Phase 4 specification and implementation plan to `docs/superpowers/specs/` and `docs/superpowers/plans/` (uncommitted).
- [ ] Execute approved Phase 4 tasks with atomic commits per functional change.
