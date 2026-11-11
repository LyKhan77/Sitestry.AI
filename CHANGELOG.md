# Sitestry.AI — Changelog (`CHANGELOG.md`)

All notable architectural, backend extraction, and frontend UI/UX changes to **Sitestry.AI** are documented in this file.

---

## [v3.0.0] — 2026-11-11 (Current State)

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
