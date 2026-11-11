# Sitestry.AI — Domain Glossary

Canonical domain language for **Sitestry.AI** (2D Architectural & Engineering Floorplan to 3D Digital Twin Studio). All agents and contributors must use these exact terms in code, UI copy, schemas, and discussions.

---

## Core Spatial & CAD Concepts

- **Blueprint**: The source 2D architectural or engineering floorplan loaded into the studio, either as a multi-page Vector PDF (`pdf_vector`) or a high-resolution Raster Image (`raster_image`).
- **Active ROI (Region of Interest)**: The rectangular bounding box (`roi_px: {x, y, width, height}`) on the Blueprint that isolates the actual building floorplan and excludes the right-hand **Kop Surat** (Title Block), legends, and sheet borders.
- **Metric Scale (`scale_px_per_meter`)**: The calibration factor converting 2D pixel coordinates on the rendered Blueprint (`2.0x` PDF matrix or native raster resolution) into real-world meters (`m`).
- **Topological Node (`node`)**: A shared 2D vertex (`{id, x_px, y_px}`) where one or more Wall Segments start, terminate, or intersect (L-corners, T-junctions, X-crossings). Moving a Topological Node stretches all connected Wall Segments.
- **Wall Segment (`wall`)**: A linear structural barrier connecting `start_node` and `end_node` with physical `thickness_m`, `height_m`, and material `type` (`solid` concrete/brick, `cage_mesh` wiremesh partition, or `glass` glazing partition).

---

## Architectural Openings & Vertical Circulation

- **Opening (`opening`)**: A wall-hosted architectural cut-out attached to a specific `wall_id` at a normalized position `offset_ratio` (`0.08..0.92`). Every Opening is one of four canonical types:
  - **Single Door (`single_door`)**: A single-leaf hinged door (`D-xx`, `TD-xx`) verified in CAD by a thin door leaf and a 90-degree quarter-circle swing arc.
  - **Double Door (`double_door`)**: A dual-leaf hinged door (`DD-xx`) verified by two opposing 90-degree swing arcs meeting at the center.
  - **Window (`window`)**: An elevated perimeter or interior glazing bay (`W-xx`) with a bottom sill wall (`elevation_m`, default `0.95m`) and upper lintel wall.
  - **Access Ramp (`ramp`)**: A sloped floor transition into a Raised Floor Plenum.
- **Door Tag (`tag`)**: The alphanumeric architectural identifier printed on the drawing near a door or window (e.g., `DD-01`, `D-02`, `TD-04`, `W-01`).
- **Swing Direction (`swing_dir`)**: The hinge and swing orientation of a door relative to its host Wall Segment (`in-left`, `in-right`, `out-left`, `out-right`).
- **Structural Pillar / Column (`column`)**: A vertical load-bearing element (`h_beam` steel profile or `concrete` pillar) positioned on structural grid intersections (`grid_label`).
- **Staircase (`stair`)**: A vertical circulation flight detected from periodic parallel step tread clusters (`steps` count, `direction`, `bbox_px`, `width_m`, `depth_m`, `height_m`).

---

## Facility Zones & Stage 5 Equipment

- **Room Zone (`room`)**: A closed 2D polygon (`polygon_px`) representing a named functional space (e.g., `BATTERY ROOM`, `RECTIFIER ROOM`, `R. NAVA`, `TOILET`) with a specific `floor_type` (`raised_floor_60cm`, `concrete`, `ceramic`) and floor `elevation_m`.
- **Raised Floor Plenum (`raised_floor_60cm`)**: An elevated 60x60cm anti-static modular tile floor system used in telecommunication and data center halls.
- **CME / MEP Equipment (`equipment`)**: Manual Stage 5 facility hardware placed inside the 3D Digital Twin (`rack` 42U Server Cabinet, `ups` UPS Frame, `battery` Battery Bank, `rectifier` DC Rectifier/Capacitor, `panel` ACPDB/SDP/LVMDP Panel, `pac` Precision Air Conditioning).
- **Cable Ladder (`tray`)**: A 3D multi-point overhead or underfloor cable routing structure (`points_px`, `width_m`, `elevation_m`).
