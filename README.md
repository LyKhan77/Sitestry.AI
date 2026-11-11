# Sitestry.AI (v2.0 Studio)
**AI-Powered 2D Technical Floorplan to 3D Data Center & Telco CME Digital Twin Studio**

Sitestry.AI converts 2D Engineering / Telco / Data Center floorplans (**AutoCAD PDF multi-page exports** and **PNG/JPG/WEBP raster blueprints**) into an interactive, metrically calibrated **3D Structural & CME/MEP Digital Twin** following a Human-in-the-Loop (HITL) workflow inspired by Homistry AI:

1. **Ingest, Page Selector, ROI Crop & Metric Scale Calibration** (`mm` / `m` 2-Point Ruler & Auto-Detect Grid)
2. **Dual-Engine AI/CAD Extraction & Interactive 2D Konva Vector Editor** (Double-Line Wall Pairing, Green H-Beam Columns, 90° Door Swing Arcs, Room Zones, CME Equipments, Cable Ladders)
3. **Real-Time 2D/3D Split & Sync WebGL Builder** (60x60cm Raised Floor Shader, Plenum Elevation, Wiremesh Cages, Detailed 3D Racks/UPS/Battery/Panels/PAC, 3D Overhead Cable Ladders, Floating Room Labels, `.json` & `.glb` Export)

---

## Quickstart

### 1. Install Python Dependencies
```bash
pip install -r backend/requirements.txt
```

### 2. Run the FastAPI Server
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Open Sitestry.AI Studio in Browser
Navigate to:
```text
http://localhost:8000
```

---

## Built-in Telco APD Samples (`floorplan/`)
Use the **APD SAMPLES** buttons in the Top Ribbon to immediately load and extract:
- **`Gatsu Hal. 4 (PDF)`**: `WP-1-APD-IOH- GATSUBARAT-BALI-17DPS0040-MEP-R1-16.09.26_Full Signed.pdf` (Page 4 of 11 — MSC Gatsu Lantai 1 Route Cable Power Proposed, 18 H-Beam Columns A-F / 1-3, Battery & UPS 250kVA Room, New Panel SDP, AHU Room, MDF Room, Capacitor Room).
- **`Ancol Hal. 13 (PDF)`**: `WP1 - APD - ANCOL, JAKARTA (12JKU0508)_R04_22-09-2026_Full signed.pdf` (Page 13 of 28 — Layout Gedung A, B, C Lt. 2 Route Cable ke R. Nava, Battery Room, Rectifier & Panel Room, IM-2 32 New Rack, Ruang Perangkat 47 New Rack, Seamewe & WIC NA-3 Raised Floor Rooms).
- **`plan.jpeg (Raster)`**: High-resolution cropped raster blueprint (`1600x945 px`) of MSC Gatsu Lantai 1.

---

## CAD Keyboard Shortcuts
| Key | Tool / Action |
| :--- | :--- |
| **`V`** | Select / Move Vertex Node, Column, Equipment, or Stair |
| **`C`** | Interactive ROI Crop Box (Exclude Kop Surat / Title Block) |
| **`R`** | 2-Point Metric Calibration Ruler (`6000 mm`, `4000 mm`, `600 mm`) |
| **`W`** | Draw Chained Wall Segments (`Double-Click` existing wall to split in 2) |
| **`P`** | Place Structural Column (`Steel H-Beam` or `Concrete Pillar`) |
| **`D`** | Attach Door / Raised Floor Ramp to Wall (`Single`, `Double`, `Ramp`) |
| **`Z`** | Draw Room Zone (with 60x60cm Raised Floor & 3D Floating Label) |
| **`E`** | Place Telco CME Equipment (`42U Rack`, `UPS`, `Battery`, `Rectifier`, `Panel`, `PAC`) |
| **`T`** | Draw 3D Cable Ladder Polyline (`Enter` or `Double-Click` to finish) |
| **`S`** | Place 3D Stepped Staircase |
| **`Del` / `Backspace`** | Delete Selected Element |
| **`Ctrl+Z` / `Ctrl+Y`** | Undo / Redo Topological State |
| **`Space + Drag`** | Pan 2D Blueprint Canvas |
