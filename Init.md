# ROLE & OBJECTIVE
Act as a Principal Computer Vision, CAD Geometry & 3D Web Graphics Engineer. Build a complete, runnable end-to-end application called **Sitestry.AI** inside the current workspace (`/Users/leekhan/project/floorplan3d_OS3`).

**Sitestry.AI** converts 2D Data Center / Telco / Technical Site Engineering Floorplans (`PDF` multi-page CAD exports and `PNG/JPG/WEBP` raster images, specifically tailored for real Indonesian Telco APD drawings such as **Indosat Ancol Page 13**, **Gatsu Barat Page 4**, and **`plan.jpeg`**) into an interactive, metrically accurate **3D Structural & CME/MEP Digital Twin** following a Human-in-the-Loop (HITL) workflow inspired by Homistry AI:

**1. Ingest, Page Select, Crop ROI & Metric Calibration $\rightarrow$ 2. Hybrid AI/CAD Extraction & 2D Vector Editor $\rightarrow$ 3. Real-time 2D/3D Split & Sync Builder.**

---

# CORE CAPABILITIES & EXTRACTED 3D ELEMENTS
1. **Structural Elements:**
   - **Perimeter & Interior Walls:** Supports *Double-Line Hollow CAD Wall Pairing* (collapsing parallel CAD lines into a single wall centerline with exact measured thickness), with 3 material types: `solid` (Concrete/Brick/Gypsum), `cage_mesh` (Server Cage Wiremesh), and `glass` (NOC/Control Room Glass Partition).
   - **Structural Columns:** Supports `concrete` square pillars and `h_beam` steel columns (automatically detected from green/boxed H-beam CAD symbols in Gatsu & Ancol).
   - **Openings (Doors & Ramps):** Supports `single_door`, `double_door`, and `ramp` (automatically detected from 90° CAD door swing arcs and paired arcs, cut from walls in 3D via CSG / procedural wall splitting).
2. **Spatial & Floor Elements:**
   - **Room Polygons & 3D Floating Labels:** Closed room zones with floating 3D nameplates (e.g., *BATTERY ROOM*, *RECTIFIER & PANEL ROOM*, *AHU ROOM*, *MDF ROOM*, *R. MEETING*, *GUDANG*, *CAPACITOR ROOM*, *MSC*), floor surface type (`raised_floor_60cm`, `concrete`, `ceramic`), and Finished Floor Level (`elevation_m`, supporting raised floor plenum height differences of 15–30cm).
3. **Telco CME / MEP Elements:**
   - **3D Equipment Meshes:** Distinct procedural 3D meshes (not plain boxes) for `rack` (42U Server Rack with perforated front door & LED strips), `battery` (Lithium/VRLA Battery Bank frames), `ups` (UPS System Cabinet with status panel), `rectifier` (Telco Power Rectifier), `panel` (Electrical ACPDB/SDP/LVMDP distribution boards with warning badge), and `pac` (Precision Air Conditioning / AHU unit with top/front grilles).
   - **3D Cable Trays / Ladders:** Multi-point polyline paths rendered in 3D as metallic ladder/rungs with configurable width (`width_m`) and elevation (`elevation_m`: overhead ~2.6m or underfloor ~0.15m).
   - **3D Architectural Stairs:** Procedural stepped 3D stair flights with handrails.

---

# TECH STACK CONSTRAINTS (100% OPEN-SOURCE, ZERO FRONTEND BUILD STEP)
- **Frontend:** Pure HTML5, CSS3, and Vanilla JavaScript (ES6 Modules) using `<script type="importmap">`. Zero Node.js/Webpack/Vite build step required so it can be served directly via FastAPI `StaticFiles`.
  - **2D Canvas Engine:** `Konva.js` (loaded via CDN) for high-res blueprint rendering, pan/zoom, interactive **ROI Crop Box** (to exclude Title Block / Kop Surat), **2-Point Calibration Ruler**, and interactive topological node/wall/column/door/room/equipment/cable-tray editing with magnetic 0°/90° ortho-snap.
  - **3D WebGL Engine:** `Three.js` (v0.160.0+ via ES module CDN), `OrbitControls`, `GLTFExporter`, and `three-bvh-csg` (plus procedural CSG opening builder) with procedural 60x60cm Raised Floor grid shader, metallic cable ladders, detailed CME equipment meshes, and HTML/Canvas 3D Room & Equipment floating labels.
  - **UI/UX Aesthetic:** Industrial Precision CAD Dark Mode (`#070B12` base, `#003473` deep engineering navy, `#0EA5E9` cyan telemetry accent, `#F59E0B` amber metrology accent) with glassmorphic floating docks, `Space Grotesk` + `IBM Plex Mono` typography, and instant 1-click preset loaders for **Ancol (Hal. 13)**, **Gatsu (Hal. 4)**, and **Gatsu Raster (`plan.jpeg`)**.
- **Backend:** Python 3.10+ with `FastAPI`, `uvicorn`, `python-multipart`, `PyMuPDF` (`fitz`), `opencv-python-headless`, `numpy`, `scikit-image`, `scipy`, `shapely`, and `networkx`.

---

# DIRECTORY STRUCTURE
```text
floorplan3d_OS3/
├── Init.md                      # Project Initiation & Technical Blueprint
├── PRD.md                       # Production-Grade Product Requirements Document (Sitestry.AI v2.0)
├── README.md                    # Quickstart guide, architecture overview & testing instructions
├── floorplan/                   # Real Telco APD Sample Drawings
│   ├── WP1 - APD - ANCOL, JAKARTA (12JKU0508)_R04_22-09-2026_Full signed.pdf
│   ├── WP-1-APD-IOH- GATSUBARAT-BALI-17DPS0040-MEP-R1-16.09.26_Full Signed.pdf
│   └── plan.jpeg
├── backend/
│   ├── main.py                  # FastAPI server: /api/samples, /api/pdf-info, /api/pdf-to-image, /api/extract-layout, /api/detect-grid
│   ├── cad_parser.py            # Direct PDF Vector CAD Extractor (PyMuPDF get_drawings() -> Double-Line Wall Pairing, Green H-Beam Columns, 90° Door Swing Arcs, Gray 60cm Grid, Telco Room/Equipment Semantic Matcher)
│   ├── vectorizer.py            # Raster OpenCV + scikit-image + Shapely pipeline (ROI Crop -> Double-Line & Morphology -> Skeletonize -> EDT Thickness -> RDP Simplify -> Ortho 90° Snap -> Node Welding)
│   └── requirements.txt         # Pinned open-source Python dependencies
└── frontend/
    ├── index.html               # Main studio UI: Top Stepper Ribbon, Sample Loader, PDF Page Picker Modal, Left CAD Toolbar & Layer Toggles, Split 2D/3D Workspace, Right Property Inspector, Bottom Telemetry Bar
    ├── css/
    │   └── style.css            # Complete Industrial Dark Mode & Glassmorphic UI styling, split-screen resizer, custom CAD controls
    └── js/
        ├── store.js             # Reactive Single Source of Truth (SSOT) State & EventTarget Bus managing the Sitestry.AI v2.0 JSON schema + Undo/Redo history stack
        ├── app.js               # Studio controller, stepper workflow, sample presets, PDF page selector, keyboard shortcuts, Inspector bindings, JSON/GLB export
        ├── canvas2d.js          # Konva.js engine: Blueprint layer, Interactive ROI Crop Box, 2-Point Ruler, Node/Wall/Column/Door/Room/Equipment/CableTray/Stair editor, Magnetic Ortho-Snap
        ├── viewer3d.js          # Three.js engine: Procedural 60x60cm Raised Floor shader & plenum elevation, Wall/Cage/Glass extruder with door openings, H-Beam columns, detailed CME Equipment & Cable Ladder meshes, 3D Floating Room Labels, GLB exporter
        └── api.js               # Backend API client + rich offline fallback templates for Ancol Page 13, Gatsu Page 4, and Demo Data Center
```
