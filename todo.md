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

## Active Phase: Phase 4 — Next Agent Handover & Engineering Improvements (Pending Grill Validation)

- [ ] Validate Phase 4 architectural priorities with the user via `grill-me` (Persistence & Project Save/Load, Automatic Polygon Room Cycle Detection `shapely.ops.polygonize`, Multi-Floor Elevation Stacking, and Automated Pytest Suite).
- [ ] Save approved Phase 4 specification and implementation plan to `docs/superpowers/specs/` and `docs/superpowers/plans/` (uncommitted).
- [ ] Execute approved Phase 4 tasks with atomic commits per functional change.
