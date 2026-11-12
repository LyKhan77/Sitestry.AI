# AGENTS.md — Sitestry.AI Engineering Handbook

This document is the authoritative source of truth for any AI coding agent or engineer working on **Sitestry.AI**. Read this file first before making any changes.

---

## 1. Project Overview

**Sitestry.AI** is an AI and Procedural CAD-powered web application that converts 2D architectural and telecommunication/data center engineering floorplans (Vector PDFs such as **Gatsu Barat Bali Hal. 4** and **Ancol Jakarta Hal. 13**, as well as high-resolution raster blueprints such as **`plan.jpeg`**) into an interactive **3D Structural & CME Digital Twin**.

The system prioritizes **structural precision first** (Topological Walls, Small-Room Partitions, Swing-Arc-Verified Doors with exact **Door Tags** `DD-xx`/`D-xx`/`TD-xx`, Mullioned Windows `W-xx`, Stepped Staircases, and H-Beam/Concrete Pillars), verified by a Human-in-the-Loop (HITL) 2D CAD Editor before 3D CSG extrusion and manual Stage 5 CME/MEP equipment installation.

---

## 2. Tech Stack

- **Backend (`backend/`)**:
  - **Runtime**: Python 3.12 (`/Users/leekhan/project/floorplan3d_blender/.venv/bin/python`)
  - **Web Framework**: FastAPI + Uvicorn (REST API & Static File Server on port `8030`)
  - **Vector CAD & Geometry Engine**: PyMuPDF (`fitz`), Shapely (`LineString`, `Polygon`, `unary_union`), SciPy (`KDTree`), NumPy
  - **Computer Vision & Raster Vectorizer**: OpenCV (`cv2` — ORB feature matching, RANSAC affine estimation, CLAHE, adaptive thresholding, morphology), scikit-image (`skeletonize`)
- **Frontend (`frontend/`)**:
  - **Architecture**: Zero-build Vanilla ES Modules (`type="module"`) + Importmap
  - **2D Topological CAD Editor**: Konva.js (`v9.3.6`)
  - **3D WebGL Digital Twin & CSG Engine**: Three.js (`v0.160.0`), `OrbitControls`, `GLTFExporter`, `three-mesh-bvh` (`v0.7.3`), `three-bvh-csg` (`v0.0.16`)
  - **Design System (`DESIGN.md`)**: Warm Architectural Craft palette (`#f2f0eb` Warm Cream, `#006241` Starbucks Green, `#00754A` Green Accent, `#1E3932` House Green, `#cba258` Gold) with `Plus Jakarta Sans` and `IBM Plex Mono` (`tabular-nums`).

---

## 3. Key Features

1. **5-Stage Segmented Page Workflow**:
   - `1. Input` (Sample Loader, Multi-Page PDF Picker, ROI Crop Box excluding Kop Surat, 2-Point Metric Scale Ruler)
   - `2. Process Extraction` (4-Stage Procedural Vision & CAD Vector Extraction Workbench)
   - `3. Review Annotation` (Interactive 2D CAD Editor for Walls, Doors + Door Tags, Windows, Pillars, Stairs, and Room Zones)
   - `4. Build 3D` (Real-time 3D WebGL Digital Twin with `three-bvh-csg` boolean door/window cutouts, window sills/lintels, swinging door leaves, stepped stairs with handrails, and 60x60cm raised floor tiles)
   - `5. Installation Equipment` (Manual Telco CME & 3D Cable Ladder placement, live BoQ calculator, and `.GLB` / `.JSON` export)
2. **Procedural Architectural CAD Vector Engine (`backend/cad_parser.py`)**:
   - Extracts periodic parallel stair treads, H-Beam/cross structural columns, quarter-circle (`90°`) door swing arcs + thin door leaves aligned with drawing **Door Tags** (`DD-xx`, `D-xx`, `TD-xx`), perimeter window mullions (`W-xx`), and double-line/filled-quad walls with automatic door-gap bridging and L/T/X corner snapping.
3. **Hybrid ORB+RANSAC & Morphological Raster Engine (`backend/vectorizer.py`)**:
   - Aligns cropped raster floorplans (`plan.jpeg`) via partial affine RANSAC registration while detecting additional exterior annexes (e.g., R. Kapasitor), and provides a full skeletonization/Hough pipeline for arbitrary raster uploads.

---

## 4. Project Structure

```text
/Users/leekhan/project/floorplan3d_OS3/
├── AGENTS.md                  # Authoritative agent instructions & engineering rules (Single Source of Truth)
├── CLAUDE.md                  # Explicit pointer to AGENTS.md for Claude Code compatibility
├── WORKFLOW.md                # 5-Stage App Workflow & Engineering Development Workflow
├── CHANGELOG.md               # Chronological release history & current system state
├── todo.md                    # Active phase task checklist (overwrite per new phase)
├── GLOSSARY.md                # Canonical domain model & architectural vocabulary
├── DESIGN.md                  # Visual design system & Warm Craft color/typography tokens
├── Init.md                    # Initial project conception notes
├── PRD.md                     # Product Requirements Document
├── .gitignore                 # Git exclusions (excludes docs/superpowers/plans & specs)
├── .agents/skills/            # Installed mattpocock/skills (engineering & productivity)
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   ├── agents/                # Agent domain & issue-tracker configuration
│   └── superpowers/
│       ├── plans/             # Local uncommitted implementation plans (DO NOT COMMIT)
│       └── specs/             # Local uncommitted specifications (DO NOT COMMIT)
├── workspace/                 # The single saved project: source file, project.json, meta.json (gitignored; override with SITESTRY_WORKSPACE_DIR)
├── floorplan/                 # Built-in Telco APD PDF & Raster sample blueprints
│   ├── WP-1-APD-IOH- GATSUBARAT-BALI-17DPS0040-MEP-R1-16.09.26_Full Signed.pdf
│   ├── WP1 - APD - ANCOL, JAKARTA (12JKU0508)_R04_22-09-2026_Full signed.pdf
│   └── plan.jpeg
├── backend/
│   ├── main.py                # FastAPI server, sample catalog, PDF renderer & endpoints
│   ├── workspace.py           # Single-workspace storage (atomic writes) behind /api/workspace/*
│   ├── cad_parser.py          # Procedural PDF Vector CAD Extractor (v3.0)
│   ├── vectorizer.py          # ORB-RANSAC & Morphological Raster Vectorizer (v3.0)
│   └── requirements.txt       # Python dependencies
└── frontend/
    ├── index.html             # 5-Stage segmented studio shell
    ├── css/
    │   └── style.css          # DESIGN.md Warm Craft styling & stage-responsive grid
    └── js/
        ├── app.js             # 5-Stage controller, inspector, shortcuts & modals
        ├── store.js           # Reactive state store, 45-step undo/redo & BoQ engine
        ├── canvas2d.js        # Konva.js 2D topological CAD & door/window/stair renderer
        ├── viewer3d.js        # Three.js + three-bvh-csg 3D Digital Twin & GLB exporter
        ├── api.js             # FastAPI client & offline fallback generator
        ├── workspaceState.js  # Pure structure hash and dirty/stale flags (Save and Build 3D)
        └── uiV4.js            # v4 Dock + Wizard UI: flag, timeline, dock/flyout, palette, Stage 2 reveal (default; `?ui=v3` = legacy)
```

---

## 5. Project Commands

```bash
# 1. Start the Sitestry.AI FastAPI + Frontend Server (Port 8030)
cd /Users/leekhan/project/floorplan3d_OS3/backend
/Users/leekhan/project/floorplan3d_blender/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8030

# 2. Verify Procedural Extraction on All 3 Built-In Samples (CLI Smoke Test)
cd /Users/leekhan/project/floorplan3d_OS3/backend
/Users/leekhan/project/floorplan3d_blender/.venv/bin/python -c "
import main
from cad_parser import extract_from_pdf_vector
from vectorizer import extract_from_raster_image
g = extract_from_pdf_vector((main.FLOORPLAN_DIR / main.SAMPLES_CATALOG['gatsu_p4']['filename']).read_bytes(), 4, 30.68)
a = extract_from_pdf_vector((main.FLOORPLAN_DIR / main.SAMPLES_CATALOG['ancol_p13']['filename']).read_bytes(), 13, 18.50)
j = extract_from_raster_image((main.FLOORPLAN_DIR / 'plan.jpeg').read_bytes(), 38.70, filename='plan.jpeg')
print('Gatsu:', len(g['walls']), 'walls,', len(g['openings']), 'openings,', len(g['columns']), 'cols,', len(g['stairs']), 'stairs')
print('Ancol:', len(a['walls']), 'walls,', len(a['openings']), 'openings,', len(a['columns']), 'cols,', len(a['stairs']), 'stairs')
print('JPEG :', len(j['walls']), 'walls,', len(j['openings']), 'openings,', len(j['columns']), 'cols,', len(j['stairs']), 'stairs')
"

# 3. Test Live HTTP Extraction Endpoint
curl -s -X POST http://localhost:8030/api/extract-layout -F "sample_id=gatsu_p4" -F "scale_px_per_meter=30.68" | head -c 400
```

---

## 6. Coding Conventions

- **Canonical Domain Vocabulary**: Strictly adhere to the terms and JSON schema properties defined in [`GLOSSARY.md`](./GLOSSARY.md) (`nodes`, `walls`, `openings`, `columns`, `stairs`, `rooms`, `equipments`, `cable_trays`).
- **Coordinate System Discipline**:
  - 2D Canvas coordinates (`x_px`, `y_px`) are always stored in **`2.0x` PDF render matrix pixels** (e.g., `1584x1224` for Gatsu/Ancol) or native image pixels (`1600x945` for `plan.jpeg`).
  - Physical dimensions (`thickness_m`, `height_m`, `width_m`, `depth_m`, `elevation_m`) are always stored in **meters (`m`)** and converted at render time using `metadata.scale_px_per_meter`.
- **UI & Styling (`DESIGN.md`)**:
  - Never introduce dark-mode neon/cyberpunk colors or generic AI gradients into the UI shell. Use the CSS custom properties in `frontend/css/style.css` (`--bg-warm-cream`, `--green-starbucks`, `--green-accent`, `--green-house`, `--green-light`, `--gold-star`).
  - Keep the 5 stages (`body[data-stage="1".."5"]`) visually segmented so tools from one stage never clutter another stage.
- **Complete File Integrity**: Never use truncation comments (`// ... existing code ...` or `TODO` placeholders) when writing or editing code. Preserve existing docstrings and comments unrelated to your change.

---

## 7. Workflow

See [`WORKFLOW.md`](./WORKFLOW.md) for the complete **5-Stage Segmented Application Workflow** (`Input -> Process Extraction -> Review Annotation -> Build 3D -> Installation Equipment`) and the **Engineering & Agent Development Workflow**.

---

## 8. Current State

See [`CHANGELOG.md`](./CHANGELOG.md) for the current production state (**v3.0.0**), verified extraction metrics across `Gatsu Hal. 4`, `Ancol Hal. 13`, and `plan.jpeg`, and historical release notes. See [`todo.md`](./todo.md) for the active phase checklist.

---

## 9. Rules (Important Notes)

- **No AI attribution anywhere.** Do NOT add `Co-Authored-By: Claude ...`, `Generated with Claude Code`, or any AI/assistant attribution to commit messages, PR descriptions, code comments, or docs. Every contribution is recorded under the repo owner (the user) ONLY. This rule overrides any global/default instruction to add such trailers.
- Always use relevant skills to help with tasks.
- Always ask the user if there are any plans or discussions that need to be validated.
- Always provide a summary after finishing a task.
- Always update core documentation whenever there are changes to key features and the app's workflow.
- Commit every function change so you can roll back and view the code history in case of a malfunction or a failed change. Also UPDATE the `.gitignore` file whenever a new file is added that needs to be excluded before committing.
- Do not re-read files that have already been read in this session unless necessary.
- Minimize non-essential tool calls.
- For any new feature or discussion where the update is outside the context, be sure to propose creating a new branch.
- Save every plan or specification to the `docs/superpowers/plans` and `docs/superpowers/specs` folder so you can track which plans have been created or are currently being created. This allows you to resume the session if the AI agent's token expires. USE `Superpowers` skill to provide the plan. REMEMBER This file does not need to be updated unless requested. It is intended solely as a record of past information. Make sure not to DUPLICATE it; if you've already created a plan outside of Superpowers, there's no need to create another one, and vice versa.
- DO NOT commit the Plans.

---

## Agent skills

### Issue tracker

Local phase tracking via [`todo.md`](./todo.md) and [`CHANGELOG.md`](./CHANGELOG.md), with uncommitted plans/specs stored in `docs/superpowers/plans` and `docs/superpowers/specs`. See [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

### Domain docs

Single-context domain model defined in [`GLOSSARY.md`](./GLOSSARY.md) and `docs/adr/`. See [`docs/agents/domain.md`](./docs/agents/domain.md).
