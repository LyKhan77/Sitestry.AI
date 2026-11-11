/**
 * Sitestry.AI — Centralized Reactive State Store & Undo/Redo History Engine (v3.0)
 * Manages the Standardized JSON Schema (metadata, nodes, walls, columns, openings,
 * rooms, stairs, equipments, cable_trays) and dispatches live sync events between
 * the 5 Segmented Workflow Stages, 2D Konva CAD Canvas, and 3D Three.js Digital Twin.
 */

export class SitestryStore extends EventTarget {
  constructor() {
    super();

    this.project = {
      project_id: "sitestry_default",
      project_name: "MSC Gatsu Lantai 1 (Hal. 4)",
      metadata: {
        source_type: "pdf_vector",
        page_number: 4,
        total_pages: 11,
        image_width_px: 1584,
        image_height_px: 1224,
        scale_px_per_meter: 30.68,
        default_wall_height_m: 3.8,
        raised_floor_grid_m: 0.6,
        roi_px: { x: 63.4, y: 49.0, width: 1172.2, height: 1101.6 },
      },
      nodes: [],
      walls: [],
      columns: [],
      openings: [],
      rooms: [],
      stairs: [],
      equipments: [],
      cable_trays: [],
    };

    // UI & Editor state across the 5 Segmented Stages:
    // 1: Input -> 2: Process Extraction -> 3: Review Annotation -> 4: Build 3D -> 5: Installation Equipment
    this.ui = {
      step: 1,
      viewMode: "2d", // "2d" | "split" | "3d"
      activeTool: "roi", // "select" | "roi" | "ruler" | "wall" | "column" | "door" | "double_door" | "window" | "room" | "stair" | "equipment" | "tray"
      pendingEquipmentCategory: "rack",
      selected: null, // { kind: "wall"|"node"|"column"|"opening"|"room"|"equipment"|"tray"|"stair", id: string }
      orthoSnap: true,
      blueprintOpacity: 0.68,
      show3DLabels: true,
      xrayWalls: false,
      layers: {
        blueprint: true,
        roi: true,
        walls: true,
        columns: true,
        rooms: true,
        equipments: true,
        trays: true,
        grid: true,
      },
    };

    this.blueprintDataUrl = null;
    this.uploadedFile = null;
    this.activeSampleId = "gatsu_p4";

    // Undo / Redo Stacks (stores deep-cloned snapshots of this.project)
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 45;
  }

  emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  // ==================== SNAPSHOT & UNDO / REDO ====================
  pushHistorySnapshot() {
    const snap = JSON.stringify(this.project);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snap) {
      return;
    }
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(JSON.stringify(this.project));
    const prev = JSON.parse(this.undoStack.pop());
    this.project = prev;
    this.ui.selected = null;
    this.emit("geometryChanged", { source: "undo" });
    this.emit("selectionChanged", { selected: null });
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(JSON.stringify(this.project));
    const next = JSON.parse(this.redoStack.pop());
    this.project = next;
    this.ui.selected = null;
    this.emit("geometryChanged", { source: "redo" });
    this.emit("selectionChanged", { selected: null });
    return true;
  }

  // ==================== PROJECT & BLUEPRINT LOADING ====================
  setBlueprint(dataUrl, metaOverrides = {}) {
    this.blueprintDataUrl = dataUrl;
    Object.assign(this.project.metadata, metaOverrides);
    if (metaOverrides.title) {
      this.project.project_name = metaOverrides.title;
    }
    this.emit("blueprintLoaded", {
      dataUrl,
      metadata: this.project.metadata,
    });
  }

  loadProjectData(data, preserveBlueprint = true) {
    this.pushHistorySnapshot();
    const oldMeta = this.project.metadata;
    this.project = {
      project_id: data.project_id || "sitestry_project",
      project_name: data.project_name || this.project.project_name,
      metadata: {
        ...oldMeta,
        ...(data.metadata || {}),
      },
      nodes: data.nodes || [],
      walls: data.walls || [],
      columns: data.columns || [],
      openings: data.openings || [],
      rooms: data.rooms || [],
      stairs: data.stairs || [],
      equipments: data.equipments || [],
      cable_trays: data.cable_trays || [],
    };
    this.ui.selected = null;
    this.emit("geometryChanged", { source: "extract" });
    this.emit("selectionChanged", { selected: null });
  }

  // ==================== SELECTION & ACTIVE TOOL ====================
  setActiveTool(toolName) {
    this.ui.activeTool = toolName;
    this.emit("toolChanged", { tool: toolName });
  }

  selectObject(kind, id) {
    if (!kind || !id) {
      this.ui.selected = null;
    } else {
      this.ui.selected = { kind, id };
    }
    this.emit("selectionChanged", { selected: this.ui.selected });
  }

  getSelectedObject() {
    const sel = this.ui.selected;
    if (!sel) return null;
    const map = {
      node: this.project.nodes,
      wall: this.project.walls,
      column: this.project.columns,
      opening: this.project.openings,
      room: this.project.rooms,
      equipment: this.project.equipments,
      tray: this.project.cable_trays,
      stair: this.project.stairs,
    };
    const arr = map[sel.kind];
    if (!arr) return null;
    return arr.find((item) => item.id === sel.id) || null;
  }

  // ==================== METRIC CALIBRATION & ROI ====================
  setScale(pxPerMeter) {
    const valid = Math.max(2.0, Math.min(500.0, Number(pxPerMeter) || 30.68));
    this.pushHistorySnapshot();
    this.project.metadata.scale_px_per_meter = Number(valid.toFixed(2));
    this.emit("geometryChanged", { source: "scale" });
  }

  setRoi(roiRect) {
    this.project.metadata.roi_px = {
      x: Math.round(roiRect.x * 10) / 10,
      y: Math.round(roiRect.y * 10) / 10,
      width: Math.round(Math.max(80, roiRect.width) * 10) / 10,
      height: Math.round(Math.max(80, roiRect.height) * 10) / 10,
    };
    this.emit("roiChanged", { roi_px: this.project.metadata.roi_px });
  }

  // ==================== TOPOLOGICAL CAD MUTATIONS ====================
  getNodeById(nodeId) {
    return this.project.nodes.find((n) => n.id === nodeId) || null;
  }

  findOrCreateNode(x_px, y_px, snapRadiusPx = 11) {
    for (const n of this.project.nodes) {
      if (Math.hypot(n.x_px - x_px, n.y_px - y_px) <= snapRadiusPx) {
        return n;
      }
    }
    const newId = `n_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`;
    const node = {
      id: newId,
      x_px: Math.round(x_px * 10) / 10,
      y_px: Math.round(y_px * 10) / 10,
    };
    this.project.nodes.push(node);
    return node;
  }

  moveNode(nodeId, newX, newY, withOrthoSnap = false, anchorNodeId = null) {
    const node = this.getNodeById(nodeId);
    if (!node) return;

    let tx = newX;
    let ty = newY;

    if (withOrthoSnap && this.ui.orthoSnap) {
      const connectedWalls = this.project.walls.filter(
        (w) => w.start_node === nodeId || w.end_node === nodeId
      );
      for (const w of connectedWalls) {
        const otherId = w.start_node === nodeId ? w.end_node : w.start_node;
        const other = this.getNodeById(otherId);
        if (!other) continue;
        if (Math.abs(tx - other.x_px) < 10) tx = other.x_px;
        if (Math.abs(ty - other.y_px) < 10) ty = other.y_px;
      }
    }

    node.x_px = Math.round(tx * 10) / 10;
    node.y_px = Math.round(ty * 10) / 10;
    this.emit("geometryChanged", { source: "moveNode", nodeId });
  }

  addWallSegment(x1, y1, x2, y2, wallType = "solid") {
    if (Math.hypot(x2 - x1, y2 - y1) < 8) return null;
    this.pushHistorySnapshot();

    let ex2 = x2;
    let ey2 = y2;
    if (this.ui.orthoSnap) {
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      if (dx < dy * 0.18) ex2 = x1;
      else if (dy < dx * 0.18) ey2 = y1;
    }

    const nStart = this.findOrCreateNode(x1, y1);
    const nEnd = this.findOrCreateNode(ex2, ey2);
    if (nStart.id === nEnd.id) return null;

    const newWall = {
      id: `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`,
      start_node: nStart.id,
      end_node: nEnd.id,
      thickness_m: wallType === "cage_mesh" ? 0.08 : 0.2,
      height_m: this.project.metadata.default_wall_height_m || 3.8,
      type: wallType,
      label: wallType === "cage_mesh" ? "Wiremesh Server Cage" : "Concrete Wall",
    };

    this.project.walls.push(newWall);
    this.selectObject("wall", newWall.id);
    this.emit("geometryChanged", { source: "addWall" });
    return newWall;
  }

  splitWall(wallId, splitX = null, splitY = null) {
    const idx = this.project.walls.findIndex((w) => w.id === wallId);
    if (idx === -1) return null;
    const w = this.project.walls[idx];
    const n1 = this.getNodeById(w.start_node);
    const n2 = this.getNodeById(w.end_node);
    if (!n1 || !n2) return null;

    this.pushHistorySnapshot();
    const mx = splitX !== null ? splitX : (n1.x_px + n2.x_px) / 2;
    const my = splitY !== null ? splitY : (n1.y_px + n2.y_px) / 2;

    const midNode = this.findOrCreateNode(mx, my, 2);

    const w1 = {
      ...w,
      id: `${w.id}_a`,
      start_node: n1.id,
      end_node: midNode.id,
    };
    const w2 = {
      ...w,
      id: `${w.id}_b`,
      start_node: midNode.id,
      end_node: n2.id,
    };

    this.project.walls.splice(idx, 1, w1, w2);
    this.selectObject("node", midNode.id);
    this.emit("geometryChanged", { source: "splitWall" });
    return midNode;
  }

  addColumn(x_px, y_px) {
    this.pushHistorySnapshot();
    const col = {
      id: `col_${this.project.columns.length + 1}_${Date.now().toString(36).slice(-3)}`,
      x_px: Math.round(x_px * 10) / 10,
      y_px: Math.round(y_px * 10) / 10,
      width_m: 0.55,
      depth_m: 0.55,
      height_m: this.project.metadata.default_wall_height_m || 3.8,
      type: "h_beam",
      grid_label: `C-${this.project.columns.length + 1}`,
    };
    this.project.columns.push(col);
    this.selectObject("column", col.id);
    this.emit("geometryChanged", { source: "addColumn" });
    return col;
  }

  addOpeningOnNearestWall(x_px, y_px, openingType = "single_door") {
    let bestWall = null;
    let bestDist = Infinity;
    let bestRatio = 0.5;
    let bestProjX = x_px;
    let bestProjY = y_px;

    for (const w of this.project.walls) {
      const n1 = this.getNodeById(w.start_node);
      const n2 = this.getNodeById(w.end_node);
      if (!n1 || !n2) continue;

      const dx = n2.x_px - n1.x_px;
      const dy = n2.y_px - n1.y_px;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1) continue;

      let t = ((x_px - n1.x_px) * dx + (y_px - n1.y_px) * dy) / lenSq;
      t = Math.max(0.12, Math.min(0.88, t));
      const projX = n1.x_px + t * dx;
      const projY = n1.y_px + t * dy;
      const d = Math.hypot(x_px - projX, y_px - projY);
      if (d < bestDist) {
        bestDist = d;
        bestWall = w;
        bestRatio = Number(t.toFixed(3));
        bestProjX = projX;
        bestProjY = projY;
      }
    }

    if (!bestWall || bestDist > 65) return null;

    this.pushHistorySnapshot();
    const isWindow = openingType === "window";
    const isDouble = openingType === "double_door";
    const idxNum = this.project.openings.length + 1;
    const defaultTag = isWindow
      ? `W-${String(idxNum).padStart(2, "0")}`
      : isDouble
      ? `DD-${String(idxNum).padStart(2, "0")}`
      : `D-${String(idxNum).padStart(2, "0")}`;

    const op = {
      id: `op_${idxNum}_${Date.now().toString(36).slice(-3)}`,
      wall_id: bestWall.id,
      type: openingType, // "single_door" | "double_door" | "window" | "ramp"
      offset_ratio: bestRatio,
      width_m: isWindow ? 1.6 : isDouble ? 1.6 : 0.9,
      height_m: isWindow ? 1.25 : 2.15,
      elevation_m: isWindow ? 0.95 : 0.0,
      swing_dir: "in-left",
      tag: defaultTag,
      label: isWindow
        ? `Window (${defaultTag})`
        : isDouble
        ? `Double Door (${defaultTag})`
        : `Single Door (${defaultTag})`,
      x_px: Math.round(bestProjX * 10) / 10,
      y_px: Math.round(bestProjY * 10) / 10,
    };
    this.project.openings.push(op);
    this.selectObject("opening", op.id);
    this.emit("geometryChanged", { source: "addOpening" });
    return op;
  }

  addRoomZone(x1, y1, x2, y2, name = "NEW ROOM ZONE") {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    if (maxX - minX < 25 || maxY - minY < 25) return null;

    this.pushHistorySnapshot();
    const room = {
      id: `room_${this.project.rooms.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name,
      floor_type: "raised_floor_60cm",
      elevation_m: 0.45,
      color: "#00754A",
      polygon_px: [
        [Math.round(minX), Math.round(minY)],
        [Math.round(maxX), Math.round(minY)],
        [Math.round(maxX), Math.round(maxY)],
        [Math.round(minX), Math.round(maxY)],
      ],
    };
    this.project.rooms.push(room);
    this.selectObject("room", room.id);
    this.emit("geometryChanged", { source: "addRoom" });
    return room;
  }

  addEquipment(x_px, y_px, category = null) {
    this.pushHistorySnapshot();
    const cat = category || this.ui.pendingEquipmentCategory || "rack";
    const presets = {
      rack: { name: `Server Rack 42U #${this.project.equipments.length + 1}`, w: 0.6, d: 1.1, h: 2.1, elev: 0.45 },
      ups: { name: `UPS Frame 250kVA #${this.project.equipments.length + 1}`, w: 1.6, d: 0.95, h: 2.0, elev: 0.0 },
      battery: { name: `Lithium Battery Bank #${this.project.equipments.length + 1}`, w: 2.2, d: 0.9, h: 2.0, elev: 0.0 },
      rectifier: { name: `DC Rectifier Cabinet #${this.project.equipments.length + 1}`, w: 1.2, d: 0.8, h: 2.0, elev: 0.0 },
      panel: { name: `ACPDB / SDP Panel #${this.project.equipments.length + 1}`, w: 1.4, d: 0.65, h: 2.0, elev: 0.0 },
      pac: { name: `PAC Downflow Cooling #${this.project.equipments.length + 1}`, w: 1.9, d: 0.95, h: 2.15, elev: 0.45 },
    };
    const p = presets[cat] || presets.rack;
    const eq = {
      id: `eq_${this.project.equipments.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name: p.name,
      category: cat,
      x_px: Math.round(x_px * 10) / 10,
      y_px: Math.round(y_px * 10) / 10,
      width_m: p.w,
      depth_m: p.d,
      height_m: p.h,
      elevation_m: p.elev,
      rotation_deg: 0,
    };
    this.project.equipments.push(eq);
    this.selectObject("equipment", eq.id);
    this.emit("geometryChanged", { source: "addEquipment" });
    return eq;
  }

  addCableTray(points_px) {
    if (!points_px || points_px.length < 2) return null;
    this.pushHistorySnapshot();
    const tray = {
      id: `tray_${this.project.cable_trays.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name: `3D Cable Ladder Route #${this.project.cable_trays.length + 1}`,
      type: "ladder",
      width_m: 0.5,
      elevation_m: 2.75,
      color: "#cba258",
      points_px: points_px.map((pt) => [Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10]),
    };
    this.project.cable_trays.push(tray);
    this.selectObject("tray", tray.id);
    this.emit("geometryChanged", { source: "addTray" });
    return tray;
  }

  addStaircase(x_px, y_px) {
    this.pushHistorySnapshot();
    const scale = this.project.metadata.scale_px_per_meter || 30.68;
    const wM = 2.4;
    const dM = 3.2;
    const hw = (wM * scale) / 2;
    const hd = (dM * scale) / 2;
    const stair = {
      id: `stair_${this.project.stairs.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name: `Emergency Staircase #${this.project.stairs.length + 1}`,
      x_px: Math.round(x_px * 10) / 10,
      y_px: Math.round(y_px * 10) / 10,
      width_m: wM,
      depth_m: dM,
      height_m: this.project.metadata.default_wall_height_m || 3.8,
      steps: 14,
      direction: "north",
      bbox_px: [
        Math.round((x_px - hw) * 10) / 10,
        Math.round((y_px - hd) * 10) / 10,
        Math.round((x_px + hw) * 10) / 10,
        Math.round((y_px + hd) * 10) / 10,
      ],
    };
    this.project.stairs.push(stair);
    this.selectObject("stair", stair.id);
    this.emit("geometryChanged", { source: "addStair" });
    return stair;
  }

  loadPresetTelcoEquipment() {
    this.pushHistorySnapshot();
    const roi = this.project.metadata.roi_px || { x: 100, y: 100, width: 900, height: 600 };
    const cx = roi.x + roi.width * 0.45;
    const cy = roi.y + roi.height * 0.48;

    const sampleEq = [
      { name: "Server Rack 42U #01", category: "rack", dx: -95, dy: -45, w: 0.6, d: 1.1, h: 2.1, elev: 0.45, rot: 0 },
      { name: "Server Rack 42U #02", category: "rack", dx: -72, dy: -45, w: 0.6, d: 1.1, h: 2.1, elev: 0.45, rot: 0 },
      { name: "Server Rack 42U #03", category: "rack", dx: -49, dy: -45, w: 0.6, d: 1.1, h: 2.1, elev: 0.45, rot: 0 },
      { name: "Server Rack 42U #04", category: "rack", dx: -26, dy: -45, w: 0.6, d: 1.1, h: 2.1, elev: 0.45, rot: 0 },
      { name: "UPS System 250kVA #A", category: "ups", dx: 55, dy: -35, w: 1.6, d: 0.95, h: 2.0, elev: 0.0, rot: 0 },
      { name: "Lithium Battery Bank #A", category: "battery", dx: 125, dy: -35, w: 2.2, d: 0.9, h: 2.0, elev: 0.0, rot: 0 },
      { name: "DC Rectifier System", category: "rectifier", dx: 55, dy: 45, w: 1.2, d: 0.8, h: 2.0, elev: 0.0, rot: 0 },
      { name: "ACPDB / LVMDP Panel", category: "panel", dx: 115, dy: 45, w: 1.4, d: 0.65, h: 2.0, elev: 0.0, rot: 0 },
      { name: "PAC Precision Cooling #1", category: "pac", dx: -145, dy: 20, w: 1.9, d: 0.95, h: 2.15, elev: 0.45, rot: 90 },
    ];

    sampleEq.forEach((item, idx) => {
      this.project.equipments.push({
        id: `eq_preset_${idx + 1}_${Date.now().toString(36).slice(-2)}`,
        name: item.name,
        category: item.category,
        x_px: Math.round((cx + item.dx) * 10) / 10,
        y_px: Math.round((cy + item.dy) * 10) / 10,
        width_m: item.w,
        depth_m: item.d,
        height_m: item.h,
        elevation_m: item.elev,
        rotation_deg: item.rot,
      });
    });

    this.project.cable_trays.push({
      id: `tray_preset_1_${Date.now().toString(36).slice(-2)}`,
      name: "Main Overhead Power & Fiber Ladder",
      type: "ladder",
      width_m: 0.5,
      elevation_m: 2.75,
      color: "#cba258",
      points_px: [
        [Math.round(cx - 115), Math.round(cy - 10)],
        [Math.round(cx + 135), Math.round(cy - 10)],
        [Math.round(cx + 135), Math.round(cy + 45)],
      ],
    });

    this.emit("geometryChanged", { source: "presetEquipment" });
  }

  updateSelectedProperty(patch) {
    const obj = this.getSelectedObject();
    if (!obj) return;
    this.pushHistorySnapshot();
    Object.assign(obj, patch);
    this.emit("geometryChanged", { source: "inspector", selected: this.ui.selected });
  }

  deleteSelected() {
    const sel = this.ui.selected;
    if (!sel) return false;
    this.pushHistorySnapshot();

    if (sel.kind === "node") {
      this.project.nodes = this.project.nodes.filter((n) => n.id !== sel.id);
      this.project.walls = this.project.walls.filter(
        (w) => w.start_node !== sel.id && w.end_node !== sel.id
      );
    } else if (sel.kind === "wall") {
      this.project.walls = this.project.walls.filter((w) => w.id !== sel.id);
      this.project.openings = this.project.openings.filter((o) => o.wall_id !== sel.id);
    } else if (sel.kind === "column") {
      this.project.columns = this.project.columns.filter((c) => c.id !== sel.id);
    } else if (sel.kind === "opening") {
      this.project.openings = this.project.openings.filter((o) => o.id !== sel.id);
    } else if (sel.kind === "room") {
      this.project.rooms = this.project.rooms.filter((r) => r.id !== sel.id);
    } else if (sel.kind === "equipment") {
      this.project.equipments = this.project.equipments.filter((e) => e.id !== sel.id);
    } else if (sel.kind === "tray") {
      this.project.cable_trays = this.project.cable_trays.filter((t) => t.id !== sel.id);
    } else if (sel.kind === "stair") {
      this.project.stairs = this.project.stairs.filter((s) => s.id !== sel.id);
    }

    this.ui.selected = null;
    this.emit("geometryChanged", { source: "delete" });
    this.emit("selectionChanged", { selected: null });
    return true;
  }

  // ==================== BILL OF QUANTITIES (BOQ) CALCULATOR ====================
  computeBoQSummary() {
    const scale = this.project.metadata.scale_px_per_meter || 30.68;
    let solidWallMeters = 0;
    let cageWallMeters = 0;
    let glassWallMeters = 0;

    for (const w of this.project.walls) {
      const n1 = this.getNodeById(w.start_node);
      const n2 = this.getNodeById(w.end_node);
      if (!n1 || !n2) continue;
      const lenM = Math.hypot(n2.x_px - n1.x_px, n2.y_px - n1.y_px) / scale;
      if (w.type === "cage_mesh") cageWallMeters += lenM;
      else if (w.type === "glass") glassWallMeters += lenM;
      else solidWallMeters += lenM;
    }

    let raisedFloorAreaM2 = 0;
    for (const r of this.project.rooms) {
      if (!r.polygon_px || r.polygon_px.length < 3) continue;
      let areaPx2 = 0;
      const pts = r.polygon_px;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        areaPx2 += x1 * y2 - x2 * y1;
      }
      const areaM2 = Math.abs(areaPx2) / 2.0 / (scale * scale);
      if (r.floor_type === "raised_floor_60cm") {
        raisedFloorAreaM2 += areaM2;
      }
    }

    const raisedFloorTiles = Math.ceil(raisedFloorAreaM2 / 0.36);

    let trayLengthMeters = 0;
    for (const t of this.project.cable_trays) {
      const pts = t.points_px || [];
      for (let i = 0; i < pts.length - 1; i++) {
        trayLengthMeters +=
          Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / scale;
      }
    }

    const doorsCount = this.project.openings.filter(
      (o) => o.type === "single_door" || o.type === "double_door"
    ).length;
    const windowsCount = this.project.openings.filter((o) => o.type === "window").length;

    return {
      solidWallMeters: solidWallMeters.toFixed(1),
      cageWallMeters: cageWallMeters.toFixed(1),
      glassWallMeters: glassWallMeters.toFixed(1),
      raisedFloorAreaM2: raisedFloorAreaM2.toFixed(1),
      raisedFloorTiles,
      trayLengthMeters: trayLengthMeters.toFixed(1),
      columnsCount: this.project.columns.length,
      doorsCount,
      windowsCount,
      stairsCount: this.project.stairs.length,
      roomsCount: this.project.rooms.length,
      equipmentsCount: this.project.equipments.length,
    };
  }
}

export const store = new SitestryStore();
