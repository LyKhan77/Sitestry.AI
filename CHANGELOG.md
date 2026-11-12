# Sitestry.AI — Changelog (`CHANGELOG.md`)

All notable architectural, backend extraction, and frontend UI/UX changes to **Sitestry.AI** are documented in this file.

---

## [v3.3.0] — Unreleased

### Added — Workspace, Save and Build 3D (v4 UI)
- **Project storage (`backend/workspace.py`, `/api/projects/*`)**: one folder per project under `workspace/projects/<id>/` (gitignored) with the original source, `project.json` and `meta.json`; ids are 8 lowercase hex characters, anything else is 404; an old single-project `workspace/` is migrated automatically at server start (verified copy, then the legacy files are removed); atomic writes, whitelisted meta keys, 25 MiB source and 300 KB thumbnail limits, corrupt folders reported instead of crashing. `SITESTRY_WORKSPACE_DIR` overrides the folder (the Playwright server uses a temp dir).
- **Workspace with many projects**: card grid with `Buka` / `Hapus` (confirmed) and a `Project baru` upload card; every upload creates a new project; switching with unsaved edits asks first; header `Workspace` link. Replaces the earlier single-project card.
- **Manual Save** (`Simpan`, `Ctrl/Cmd+S`, palette): dirty state is a content hash (`workspaceState.js`), so undoing back to the saved state is clean again. `beforeunload` warns only when unsaved. Stage 4 is blocked until saved.
- **Build 3D from the saved version**: 3D structure comes from `store.builtProject`; Stage 1-3 edits never touch 3D; Stage 4/5 banner and `Build 3D` button; equipment stays live.
- **Stage 1 upload-only**: samples hidden in v4, ROI and scale read-only after extraction with a confirmed re-extract.
- Dev/test: `?sample=<id>` boot (skips the home page, creates a workspace from the sample).

### Added — Room zones (v4 and legacy UI)
- **Click inside a room** (`frontend/js/roomFaces.js`): closed rooms are found from the wall graph (planarized with a 0.6 m gap tolerance, dangling walls pruned, outer faces dropped). Hover highlights the room, one click creates a zone of the exact shape; clicking an existing zone selects it. On the real Ancol and Gatsu projects 16 of 19 saved rooms are detected in 5-9 ms.
- **Manual polygon fallback** with node snapping, close by first point / `Enter` / double click on the last point, `Backspace`, `Esc`, and validation messages.
- **Zone vertex handles** in Select mode (one drag = one undo, `Esc` cancels, snap to nodes).
- The room tool now works when the click lands on a wall, node or element. It replaces the old two-corner rectangle. `store.addRoomPolygon` and `store.setRoomVertex` are new; default names are `Ruangan N`.

### Changed — Stage 1-4 quick fixes (v4 UI)
- **Stage 3 is 2D only**: the `2D | Split | 3D` pill is hidden in Stages 1-3 and the command palette offers the view actions only from Stage 4.
- **Tool isolation**: while Wall, Stair, Door, Double Door, Window, Pillar or Room Zone is active, no other canvas element can be selected or dragged. Switching to one of these tools clears the selection and closes the inspector. In v4, `Esc` cancels a draft in progress, and with nothing in progress returns to Select. Stage 5 `equipment` and `tray` tools are unchanged. The selection/drag guards live in `canvas2d.js` and also apply to `?ui=v3`.
- **Dock rail shows each tool's shortcut key** as a corner badge.

### Fixed
- The parametric stair parameter card no longer overflows its flyout, drawer or inspector (grid items now shrink; three long labels shortened).

---

## [v3.2.0] — 2026-11-11

### Added — Dock + Wizard UI (v4, default)
- **Shell (`frontend/js/uiV4.js`, `index.html`, `style.css`)**: all rules gated by `body[data-ui="v4"]`. `?ui=v3` restores the legacy UI and persists; `?ui=v4` switches back. 44 px header, one bottom stage timeline, `Ctrl/Cmd+K` command palette.
- **Stage 3-5 dock workbench**: 56 px icon rail with accessible names and shortcuts, a flyout for secondary controls, and a property panel that floats beside the selection (`Canvas2DEngine.selectedScreenRect()`), clamped inside the canvas. 2D canvas area grows at least 25% versus the legacy layout at 1440x960.
- **Stage 4-5**: one camera preset set, one `Export` menu (keyboard operable), Stage 5 BoQ panel with per-category equipment counts, one-line telemetry.
- **Stage 1-2 wizard cards**: Stage 2 enters first, shows an indeterminate state while extracting, then reveals the result progressively with live counters. Reduced-motion users get the result instantly.

### Fixed
- `api.extractLayout` silently returned a client-generated layout when the server failed. The result now carries an `extractionFallback` marker and `api.lastExtractionFallback`, and the v4 Stage 2 card states it and offers a retry.
- Narrow layouts: the legacy inspector drawer no longer overflows the viewport in v4, `Escape` dismisses the tools drawer, and 3D legend/timeline no longer overlap.

### Known limitations
- The v4 BoQ panel is hidden below 1100 px.
- At Stage 1-2 the wizard card overlaps the left edge of the zoomed drawing.

---

## [v3.1.0] — 2026-11-11

### Added — Minimal Workspace, Guided Walls, Parametric Stairs
- **Edit transactions and stable vertex editing (`frontend/js/store.js`, `canvas2d.js`, `app.js`)**:
  - `beginTransaction` / `commitTransaction` / `cancelTransaction`; one successful gesture is one undo, cancel/no-op preserves redo, stale tokens cannot cancel newer edits, history remains capped at 45.
  - Vertex drags keep the active Konva node alive; connected walls and hosted openings update during the gesture. Numeric X/Z meter fields edit canonical source-pixel nodes with finite-number validation.
- **Manual wall drag and atomic topology (`frontend/js/annotationGeometry.js`)**:
  - Pointer-down/move/up creates exactly one wall. Manual is default; endpoint snap (10 CSS px) and ortho assistance are separate opt-ins. Escape, pointer cancel, tool/source changes, and click-without-drag add no geometry or history.
  - Junction planning reuses exact nodes, splits wall interiors, and remaps hosted openings so physical position, tag, and swing survive. Openings that straddle a junction or would remap outside `0.08..0.92` reject the whole transaction.
- **Source-derived guided walls (`backend/blueprint_guides.py`, `/api/blueprint-guides`, `frontend/js/blueprintGuides.js`)**:
  - Vector PDF pages are read at the canonical 2.0x matrix; rasters use bounded OpenCV edge/parallel pairing and filled-strip detection. Candidates carry `confidence` and `evidence`, with 25 MiB / 16 MP / 20k segment / 5k candidate limits and an 8-entry LRU.
  - Guided walls highlight actual source centerlines. Loading/error/no-match fall back to manual preview. Source revision + ROI + scale + alignment keys guard late responses even when abort is ignored.
- **Parametric stairs (`frontend/js/stairGeometry.js`, `store.js`, `canvas2d.js`, `viewer3d.js`)**:
  - Straight, L, and U templates with lower-to-upper route endpoints, deterministic flights/landings, one riser schedule, explicit U flight run, and exposed-edge guardrails. Shared resolver drives preview, 2D, 3D, and GLB.
  - Two-click placement, endpoint handles, group translation, contextual parameter editing, and explicit undoable legacy conversion. Legacy bbox formats are never auto-migrated or guessed.
- **Commit-aware 3D sync (`frontend/js/sceneSync.js`)**:
  - Preview edits do not rebuild 3D; commits coalesce; Split/3D entry and export flush the latest revision. Export is refused during an active transaction. Rebuilds dispose generated geometries, materials, and cloned textures.
- **Focused workspace (`index.html`, `style.css`, `app.js`)**:
  - Annotation canvas is at least 75% of the workspace at 1280/1440 px when nothing is selected. Empty selection hides the inspector; layers collapse on demand; stages expose only relevant tools; narrower layouts use dismissible overlays.
- **Review hardening (post-review pass)**:
  - Tentative edits no longer advance the committed 3D revision; cancelling emits a corrective revision so a prior scheduled rebuild cannot leave GLB stale. Export still refuses active transactions.
  - L/U default headings are derived from endpoints when `heading_rad` is absent/null; horizontal and rotated L placements now work without explicit heading input.
  - Extraction loads no longer push an undo snapshot from the previous source; scale/ROI changes during an in-flight extraction invalidate the response, and duplicate extraction requests are sequenced.
  - Blueprint image loads are revision-guarded. Unknown stair template versions render an explicit error instead of falling back to legacy bbox rendering.
  - `/api/blueprint-guides` validates ROI before cache lookup, pre-checks raster header dimensions before full decode, and runs detection in a threadpool.
  - U landings sit beyond the turn edge, eliminating landing/flight overlap and coplanar z-fighting.
- **Review hardening (second pass)**:
  - Guide-cache invalidation is decoupled from the loaded-source marker. Changing ROI/scale or switching Guided→Manual and re-extracting the same source now keeps same-source undo/redo, while a genuine source switch still resets history.
  - Wall and stair tools own the pointer over existing nodes, openings, columns, and stairs; those objects no longer drag or select during a drawing gesture. Vertex handles divide radius and hit stroke by the stage scale so targets stay screen-space at every zoom.
  - The blueprint guide detector enforces segment, drawing-strip, Hough, and contour budgets while iterating drawings and returns HTTP 422 immediately when a limit is exceeded.
  - The off-canvas sidebar below 1100 px is `inert`, `aria-hidden`, and `visibility: hidden` while closed, and keyboard focus cannot enter it.
  - Stair shape/turn edits refresh derived `heading_rad` and `flight_run_m` inspector fields without replacing the focused control. Fractional or out-of-range risers are rejected with visible feedback and no transaction.
  - L and U landing guardrails now cover every exposed perimeter span outside flight attachments, including the L second-flight side and the U far edge and inter-flight gap, without crossing the walking route.
- **Verification harness (`tests/`)**: Node `node:test` unit suites, Playwright browser regressions for vertex/wall/stair/source lifecycle/workspace/export, real-sample acceptance, and a locked extraction baseline for all three samples.

### Unchanged / Boundaries
- Existing extraction schema, source pixel/meter conventions, and legacy stair rendering remain intact.
- Input PDFs, persistence, multi-floor stacking, room polygonization, spiral stairs, code certification, slab openings, and headroom checks remain out of scope. Phase 4 handover tasks remain pending.

## [v3.0.0] — 2026-11-11

### Added — Procedural Vision & Architectural CAD Engine (`backend/`)
- **`TopologicalGraphBuilder` & `VectorCADExtractor` (`backend/cad_parser.py`)**:
  - **4-Stage Deterministic Procedural Extraction** replacing heuristic bounding-box approximations:
    1. **Stair Tread Cluster Detection (`_extract_stairs`)**: Automatically detects periodic parallel step tread clusters ($\ge 5$ equidistant lines spaced `3.8–11.5 px`) and masks stair bounding boxes from wall candidates. Extracts all **4 staircases** in Gatsu Hal. 4 and **2 staircases** in Ancol Hal. 13.
    2. **Structural Column Grid Detection (`_extract_columns`)**: Extracts green H-Beam steel columns (**18 columns** in Gatsu Hal. 4) and structural X-cross / grid columns (**66 columns** across Gedung A, B, and C in Ancol Hal. 13).
    3. **Door Leaf, Quarter-Circle Swing Arc & Door Tag Alignment (`_extract_doors`)**: Extracts open `90°` quarter-circle door swing arcs in Gatsu (**15 doors**: `DD-01..DD-03`, `D-01..D-04`, `TD-01..TD-04`) and swing-arc-verified thin door leaf quads in Ancol (**40 doors** across Gedung A, B, Connecting Bridges, and Gedung C), attaching exact drawing **Door Tags** (`tag`) and **Swing Directions** (`swing_dir`).
    4. **Window Mullion & Glazing Detection (`_extract_windows`)**: Extracts perimeter multi-line window glazing bays (**4 windows** `W-01..W-04` in Gatsu; **15 windows** `W-01..W-15` in Ancol).
    5. **Wall & Small-Room Topology (`_extract_walls_and_attach_openings`)**: Combines filled wall quads (`1.3–5.5 px` thick) with parallel double-line `'l'` pairs (`1.3–5.5 px` gap) to capture all small rooms, toilet cubicles, musholla, pantry, lift cores, and connecting bridges (**86 walls** in Gatsu, **159 walls** in Ancol). Bridges wall intervals across door/window spans (`±5.5 px`) and snaps L-corners and T-junctions (`snap_tol = 6.5 px`).
- **Affine-Registered & Morphological Raster Vectorizer (`backend/vectorizer.py`)**:
  - Uses ORB feature matching (`cv2.ORB_create(4000)`) + RANSAC partial affine estimation (`s = 1.2619, tx = -61.59, ty = -314.27`, 89 inliers) to register `floorplan/plan.jpeg` (`1600x945`) against the CAD ground truth while adding the right-hand exterior **R. Kapasitor** annex (`x=1432..1575, y=566..685`), yielding **90 walls, 20 openings, 18 columns, and 4 stairs**.
  - Includes a general OpenCV + scikit-image (`skeletonize`) + SciPy + Shapely procedural raster pipeline for arbitrary uploaded floorplan images.
- **Full-Complex Default ROI (`backend/main.py`)**:
  - Updated default PDF `roi_px` vertical coverage (`y: 4%`, `height: 90%`, `x: 4%`, `width: 74%`) so multi-building sheets like **Ancol Hal. 13** include Gedung A, Gedung B, the two connecting bridges, and Gedung C in full.
  - Fixed `POST /api/extract-layout` `page_number` fallback so built-in samples always default to their target floorplan page (`Page 4` for Gatsu, `Page 13` for Ancol) when `page_number` is omitted.

### Changed — Warm Architectural Craft UI Redesign & 5-Stage Segmented Flow (`frontend/`)
- **Complete UI/UX Redesign (`frontend/index.html`, `frontend/css/style.css`)**:
  - Implemented the exact visual topology from `DESIGN.md`: Warm Cream Canvas `#f2f0eb`, Ceramic `#edebe9`, White `#ffffff` `12px` radius surface cards with whisper-soft dual shadow (`0 0 0.5px rgba(0,0,0,0.14), 0 1px 1px rgba(0,0,0,0.24)`), Four-Tier Green Hierarchy (`#006241` Starbucks Green, `#00754A` Green Accent `50px` pill CTAs, `#1E3932` House Green, `#d4e9e2` Green Light), Gold `#cba258` highlights, and `Plus Jakarta Sans` + `IBM Plex Mono` typography.
  - Segmented the application into **5 Dedicated Workflow Stages** (`1. Input` -> `2. Process Extraction` -> `3. Review Annotation` -> `4. Build 3D` -> `5. Installation Equipment`) so each stage displays only its relevant tools and panels.
- **2D Architectural Symbols & Draggable Openings (`frontend/js/canvas2d.js`)**:
  - Renders authentic CAD **Door Leaves**, dashed **90° Quarter-Circle Swing Arcs**, readable **Door Tag Badges** (`DD-01`, `D-02`, `TD-01`), **Multi-Line Window Glazing** (`W-01`), and **Stepped Stair Treads** with directional arrows.
  - Added interactive drag-along-wall support for Doors and Windows so users can slide openings along their host wall in Stage 3 (`Review Annotation`).
- **3D CSG Windows with Sill/Lintel & Swinging Doors (`frontend/js/viewer3d.js`)**:
  - Added elevated boolean CSG subtraction (`three-bvh-csg`) for `window` openings (`elevation_m: 0.95m`, `height_m: 1.25m`), preserving both the bottom sill wall and upper lintel wall while inserting a 3D mullioned aluminum frame and translucent glass pane.
  - Upgraded 3D `single_door` and `double_door` meshes with 3D door frames and semi-open swinging door leaves oriented by `swing_dir`.

### Engineering & Agent Tooling
- Installed `mattpocock/skills` (`engineering` and `productivity` skill suites including `grill-me`, `grilling`, `grill-with-docs`, `domain-modeling`, `codebase-design`, `tdd`, `diagnosing-bugs`, `code-review`, `to-spec`, `to-tickets`, `handoff`) into `.agents/skills/`, `~/.gemini/skills/`, and `~/.claude/skills/`.
- Created core engineering documentation: `AGENTS.md`, `WORKFLOW.md`, `CHANGELOG.md`, `todo.md`, `GLOSSARY.md`, and `.gitignore`.

---

## [v2.0.0] — 2026-11-10

### Added
- Initial FastAPI backend (`backend/main.py`) with `/api/samples`, `/api/load-sample`, `/api/pdf-info`, `/api/pdf-to-image`, `/api/detect-grid`, and `/api/extract-layout`.
- Interactive 2D Konva.js canvas (`frontend/js/canvas2d.js`) and 3D Three.js viewport (`frontend/js/viewer3d.js`) with `three-bvh-csg` boolean cutouts and `.GLB` export.
- Centralized state store (`frontend/js/store.js`) with 45-step Undo/Redo history and Bill of Quantities (BoQ) calculator.
