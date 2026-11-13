/**
 * Sitestry.AI — Centralized Reactive State Store & Undo/Redo History Engine (v3.0)
 * Manages the Standardized JSON Schema (metadata, nodes, walls, columns, openings,
 * rooms, stairs, equipments, cable_trays) and dispatches live sync events between
 * the 5 Segmented Workflow Stages, 2D Konva CAD Canvas, and 3D Three.js Digital Twin.
 */

import { planWallInsertion, planWallSplit } from "./annotationGeometry.js";
import {
  EQUIPMENT_GROUPS,
  getEquipmentPreset,
  resolveEquipmentGroup,
  snapWallMountPosition,
} from "./equipmentCatalog.js";
import { isSimplePolygon, polygonArea } from "./roomFaces.js";
import {
  defaultTrayElevation,
  insertTrayRun,
  migrateTrayNetwork,
  normalizeTrayService,
  pruneTrayNodes,
  trayColorForService,
  trayLengthM,
} from "./trayNetwork.js";
import {
  PIPE_DEFAULT_COLOR,
  defaultPipeElevation,
  insertPipeRun,
  normalizePipeMounting,
  pipeLengthM,
  prunePipeNodes,
} from "./pipeNetwork.js";
import {
  resolveStairGeometry,
  computeDefaultHeading,
  isParametricStair,
  suggestLegacyConversion,
  STAIR_DEFAULT_LANDING_M,
  STAIR_DEFAULT_RISER_M,
  STAIR_MAX_RISERS,
  STAIR_MIN_RISERS,
} from "./stairGeometry.js";

/** Tools whose gesture owns the canvas: other elements are neither selectable nor draggable while one is active. */
export const ISOLATING_TOOLS = new Set(["wall", "stair", "door", "double_door", "window", "column", "room"]);

// Annotation is edited only in Stage 3; equipment and cable trays only in Stage 5.
const STRUCTURAL_KINDS = new Set(["node", "wall", "opening", "column", "stair", "room"]);
const INSTALL_KINDS = new Set(["equipment", "tray", "pipe"]);

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
      tray_nodes: [],
      pipe_runs: [],
      pipe_nodes: [],
    };

    // UI & Editor state across the 5 Segmented Stages:
    // 1: Input -> 2: Process Extraction -> 3: Review Annotation -> 4: Build 3D -> 5: Installation Equipment
    this.ui = {
      step: 1,
      viewMode: "2d", // "2d" | "split" | "3d"
      activeTool: "roi", // "select" | "roi" | "ruler" | "wall" | "column" | "door" | "double_door" | "window" | "room" | "stair" | "equipment" | "tray"
      pendingEquipmentGroup: "rack",
      pendingEquipmentCategory: "rack",
      trayType: "perforated", // "perforated" | "ladder" | "duct" | "wiremesh"
      trayService: "unified", // "power" | "data" | "unified"
      pipeMounting: "underfloor", // "underfloor" | "overhead"
      transparentFloor: false,
      selected: null, // { kind: "wall"|"node"|"column"|"opening"|"room"|"equipment"|"tray"|"stair", id: string }
      wallMode: "manual", // "manual" | "guided"
      endpointSnap: true,
      orthoSnap: false,
      panelOpen: false,
      roomMode: "auto", // "auto" (click inside a closed room) | "polygon" (manual points)
      calibLocked: false, // v4 workspace: ROI and scale are read-only after extraction
      stairDefaults: {
        shape: "straight",
        width_m: 1.2,
        height_m: null,
        steps: null,
        turn: "right",
        heading_rad: null,
        landing_depth_m: 1.2,
        flight_run_m: null,
      },
      guideStatus: "idle",
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
        pipes: true,
        grid: true,
        freeEnds: true,
        baseFloor: true,
      },
    };

    this.blueprintDataUrl = null;
    // Snapshot of the saved project that Build 3D renders in the v4 workspace.
    this.builtProject = null;
    this.uploadedFile = null;
    this.activeSampleId = "gatsu_p4";

    // Undo / Redo Stacks (stores deep-cloned snapshots of this.project)
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 45;

    // Commit revision and one-shot edit transaction state.
    // The source identity lives outside project/undo because it is not geometry.
    this.revision = 0;
    this.activeTransaction = null;
    this._transactionCounter = 0;
    this.guideCandidates = [];
    this.guideStatus = "idle";
    this.guideError = null;
    this._loadedSourceRevision = 0;
    this.currentSource = {
      revision: 0,
      kind: "sample",
      file: null,
      sampleId: "gatsu_p4",
      pageNumber: 4,
      imageWidthPx: 1584,
      imageHeightPx: 1224,
      alignment: null,
    };
  }

  // ==================== EDIT TRANSACTIONS ====================
  beginTransaction(label = "edit") {
    if (this.activeTransaction) return null;
    this._transactionCounter += 1;
    const token = {
      id: `tx_${this._transactionCounter}`,
      label,
      snapshot: JSON.stringify(this.project),
      selection: this.ui.selected ? { ...this.ui.selected } : null,
    };
    this.activeTransaction = token;
    return token;
  }

  commitTransaction(token) {
    if (!token || this.activeTransaction !== token) return false;
    this.activeTransaction = null;
    const after = JSON.stringify(this.project);
    if (after === token.snapshot) {
      this.emit("geometryPreviewChanged", { source: "transaction-noop", token: token.id });
      return false;
    }
    this.undoStack.push(token.snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.revision += 1;
    this.emit("geometryChanged", { source: "transaction", label: token.label, revision: this.revision });
    return true;
  }

  cancelTransaction(token) {
    if (!token || this.activeTransaction !== token) return false;
    this.project = JSON.parse(token.snapshot);
    this.ui.selected = token.selection;
    this.activeTransaction = null;
    this.revision += 1;
    this.emit("geometryChanged", {
      source: "transaction-cancel",
      revision: this.revision,
    });
    this.emit("selectionChanged", { selected: this.ui.selected });
    return true;
  }

  notifyGeometryChange(source, affectedIds = []) {
    if (this.activeTransaction) {
      this.emit("geometryPreviewChanged", {
        source,
        token: this.activeTransaction.id,
        affectedIds,
      });
      return;
    }
    this.revision += 1;
    this.emit("geometryChanged", { source, revision: this.revision });
  }

  emit(eventName, detail = {}) {
    // Every committed geometry change carries a monotonic revision so the 3D
    // scheduler can never treat a different project as already built.
    let payload = detail;
    if (
      eventName === "geometryChanged" &&
      detail.revision === undefined &&
      !this.activeTransaction
    ) {
      this.revision += 1;
      payload = { ...detail, revision: this.revision };
    }
    this.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }

  // ==================== SNAPSHOT & UNDO / REDO ====================
  pushHistorySnapshot() {
    // During an explicit transaction the pre-gesture snapshot is owned by the
    // transaction token; intermediate mutation must not create extra undo steps.
    if (this.activeTransaction) return false;
    const snap = JSON.stringify(this.project);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snap) {
      return false;
    }
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }

  undo() {
    if (this.activeTransaction) {
      this.cancelTransaction(this.activeTransaction);
    }
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(JSON.stringify(this.project));
    const prev = JSON.parse(this.undoStack.pop());
    this.project = prev;
    this.ui.selected = null;
    this.revision += 1;
    this.emit("geometryChanged", { source: "undo", revision: this.revision });
    this.emit("selectionChanged", { selected: null });
    return true;
  }

  redo() {
    if (this.activeTransaction) {
      this.cancelTransaction(this.activeTransaction);
    }
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(JSON.stringify(this.project));
    const next = JSON.parse(this.redoStack.pop());
    this.project = next;
    this.ui.selected = null;
    this.revision += 1;
    this.emit("geometryChanged", { source: "redo", revision: this.revision });
    this.emit("selectionChanged", { selected: null });
    return true;
  }

  // ==================== SOURCE IDENTITY ====================
  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  setSource({
    kind = "sample",
    file = null,
    sampleId = null,
    dataUrl = null,
    metaOverrides = {},
    title = null,
    alignment = null,
  } = {}) {
    if (this.activeTransaction) {
      this.cancelTransaction(this.activeTransaction);
    }
    this.uploadedFile = file;
    this.activeSampleId = sampleId;
    this.currentSource = {
      revision: this.currentSource.revision + 1,
      kind,
      file,
      sampleId,
      pageNumber: metaOverrides.page_number ?? 1,
      imageWidthPx: metaOverrides.image_width_px ?? this.project.metadata.image_width_px,
      imageHeightPx: metaOverrides.image_height_px ?? this.project.metadata.image_height_px,
      alignment,
    };
    this.resetHistory();
    this.clearGuideCandidates();
    if (dataUrl) {
      this.setBlueprint(dataUrl, { ...metaOverrides, ...(title ? { title } : {}) });
    } else {
      Object.assign(this.project.metadata, metaOverrides);
      if (title) this.project.project_name = title;
    }
    this.emit("sourceChanged", { source: { ...this.currentSource } });
  }

  getGuideContext() {
    const meta = this.project.metadata;
    return {
      sourceRevision: this.currentSource.revision,
      detectorVersion: "blueprint-guides-v1",
      kind: this.currentSource.kind,
      file: this.currentSource.file,
      sampleId: this.currentSource.sampleId,
      pageNumber: meta.page_number || this.currentSource.pageNumber || 1,
      roiPx: meta.roi_px ? { ...meta.roi_px } : null,
      scalePxPerMeter: meta.scale_px_per_meter,
      imageWidthPx: meta.image_width_px,
      imageHeightPx: meta.image_height_px,
      alignment: this.currentSource.alignment,
    };
  }

  getGuideKey() {
    return JSON.stringify(this.getGuideContext());
  }

  setGuideCandidates(candidates = [], status = "ready", error = null) {
    this.guideCandidates = Array.isArray(candidates) ? candidates : [];
    this.guideStatus = status;
    this.guideError = error;
    this.emit("guidesChanged", {
      status,
      error,
      candidates: this.guideCandidates,
    });
  }

  clearGuideCandidates() {
    // Guide cache is advisory and independent from the geometry history. ROI or
    // mode changes may drop candidates, but the loaded source revision must stay
    // intact so re-extracting the same source preserves undo/redo.
    this.guideCandidates = [];
    this.guideStatus = "idle";
    this.guideError = null;
    this.emit("guidesChanged", { status: "idle", error: null, candidates: [] });
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
    if (this._loadedSourceRevision !== this.currentSource.revision) {
      this.resetHistory();
      this._loadedSourceRevision = this.currentSource.revision;
    } else {
      this.pushHistorySnapshot();
    }
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
      tray_nodes: data.tray_nodes || [],
      pipe_runs: data.pipe_runs || [],
      pipe_nodes: data.pipe_nodes || [],
    };
    migrateTrayNetwork(this.project);
    this.ui.selected = null;
    this.emit("geometryChanged", { source: "extract" });
    this.emit("selectionChanged", { selected: null });
  }

  // ==================== SELECTION & ACTIVE TOOL ====================
  setActiveTool(toolName) {
    if (this.ui.calibLocked && (toolName === "roi" || toolName === "ruler")) return;
    if (ISOLATING_TOOLS.has(toolName) && this.ui.selected) this.selectObject(null, null);
    this.ui.activeTool = toolName;
    this.emit("toolChanged", { tool: toolName });
  }

  /** True when objects of this kind may be changed in the current workflow stage. */
  canEdit(kind) {
    if (this.ui.step === 3) return STRUCTURAL_KINDS.has(kind);
    if (this.ui.step === 5) return INSTALL_KINDS.has(kind);
    return false;
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
      pipe: this.project.pipe_runs,
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
    const affectedIds = this.project.walls
      .filter((w) => w.start_node === nodeId || w.end_node === nodeId)
      .map((w) => w.id);
    this.notifyGeometryChange("moveNode", affectedIds);
  }

  setNodePosition(nodeId, x_px, y_px) {
    const x = Number(x_px);
    const y = Number(y_px);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const node = this.getNodeById(nodeId);
    if (!node) return false;
    if (node.x_px === Math.round(x * 10) / 10 && node.y_px === Math.round(y * 10) / 10) {
      return false;
    }
    const token = this.beginTransaction("node-numeric-edit");
    if (!token) return false;
    node.x_px = Math.round(x * 10) / 10;
    node.y_px = Math.round(y * 10) / 10;
    return this.commitTransaction(token);
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

  allocateId(prefix = "id") {
    this._idCounter = (this._idCounter || 0) + 1;
    return `${prefix}_${Date.now().toString(36)}_${this._idCounter}`;
  }

  applyGeometryPatch(patch) {
    this.project.nodes = patch.nodes;
    this.project.walls = patch.walls;
    this.project.openings = patch.openings;
  }

  insertWall(preview, properties = {}) {
    const token = this.beginTransaction("insert-wall");
    if (!token) return { ok: false, error: "Transaksi lain sedang aktif." };
    const plan = planWallInsertion({
      project: this.project,
      preview,
      properties,
      allocateId: (prefix) => this.allocateId(prefix),
    });
    if (!plan.ok) {
      this.cancelTransaction(token);
      return plan;
    }
    this.applyGeometryPatch(plan.patch);
    const wall = this.project.walls.find((w) => w.id === plan.wallId) || null;
    if (wall) this.selectObject("wall", wall.id);
    this.commitTransaction(token);
    return { ok: true, wall };
  }

  splitWall(wallId, splitX = null, splitY = null) {
    const wall = this.project.walls.find((w) => w.id === wallId);
    if (!wall) return null;
    const n1 = this.getNodeById(wall.start_node);
    const n2 = this.getNodeById(wall.end_node);
    if (!n1 || !n2) return null;
    const mx = splitX !== null ? splitX : (n1.x_px + n2.x_px) / 2;
    const my = splitY !== null ? splitY : (n1.y_px + n2.y_px) / 2;

    const token = this.beginTransaction("split-wall");
    if (!token) return null;
    const plan = planWallSplit(
      this.project,
      wallId,
      { x_px: mx, y_px: my },
      (prefix) => this.allocateId(prefix)
    );
    if (!plan.ok) {
      this.cancelTransaction(token);
      this.emit("toast", { message: plan.error });
      return null;
    }
    this.applyGeometryPatch(plan.patch);
    this.commitTransaction(token);
    this.selectObject("node", plan.midNodeId);
    return this.getNodeById(plan.midNodeId);
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

  setRoomMode(mode) {
    if (mode !== "auto" && mode !== "polygon") return;
    this.ui.roomMode = mode;
    this.emit("roomModeChanged", { mode });
  }

  /** Create a zone from a simple polygon (a detected face or manual points). One history step. */
  addRoomPolygon(points, { name = null } = {}) {
    const round = (v) => Math.round(Number(v) * 10) / 10;
    const polygon = (points || []).map(([x, y]) => [round(x), round(y)]);
    const scale = this.project.metadata.scale_px_per_meter || 30.68;
    if (polygon.length < 3 || polygon.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
    if (!isSimplePolygon(polygon)) return null;
    if (Math.abs(polygonArea(polygon)) < 0.25 * scale * scale) return null;

    this.pushHistorySnapshot();
    const taken = new Set(this.project.rooms.map((r) => r.name));
    let n = this.project.rooms.length + 1;
    while (!name && taken.has(`Ruangan ${n}`)) n += 1;
    const room = {
      id: `room_${this.project.rooms.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name: name || `Ruangan ${n}`,
      floor_type: "raised_floor_60cm",
      elevation_m: 0.45,
      color: "#00754A",
      polygon_px: polygon,
    };
    this.project.rooms.push(room);
    this.selectObject("room", room.id);
    this.emit("geometryChanged", { source: "addRoom" });
    return room;
  }

  setRoomVertex(roomId, index, x, y) {
    const nx = Number(x);
    const ny = Number(y);
    const room = this.project.rooms.find((r) => r.id === roomId);
    if (!room || !Number.isInteger(index) || index < 0 || index >= (room.polygon_px || []).length) return false;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
    room.polygon_px[index] = [Math.round(nx * 10) / 10, Math.round(ny * 10) / 10];
    this.notifyGeometryChange("moveRoomVertex", [roomId]);
    return true;
  }

  addEquipment(x_px, y_px, category = null) {
    this.pushHistorySnapshot();
    const subtype = category || this.ui.pendingEquipmentCategory || "rack";
    const preset = getEquipmentPreset(subtype);
    const scale = this.project.metadata.scale_px_per_meter || 30.68;
    const wallHeight = Number(this.project.metadata.default_wall_height_m) || 3.8;
    let px = Math.round(x_px * 10) / 10;
    let py = Math.round(y_px * 10) / 10;
    let rot = 0;
    let wallId = null;

    if (preset.mount === "wall") {
      const snapped = snapWallMountPosition(px, py, this.project.walls, this.project.nodes, 1.2 * scale);
      if (snapped) {
        px = snapped.x_px;
        py = snapped.y_px;
        rot = snapped.rotation_deg;
        wallId = snapped.wall_id;
      }
    }

    const elev =
      preset.mount === "ceiling"
        ? Math.max(0.2, Math.round((wallHeight - preset.h - 0.05) * 100) / 100)
        : preset.elev;

    const eq = {
      id: `eq_${this.project.equipments.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name: `${preset.label} #${this.project.equipments.length + 1}`,
      category: subtype,
      domain_group: preset.group,
      subtype,
      mount: preset.mount,
      wall_id: wallId,
      x_px: px,
      y_px: py,
      width_m: preset.w,
      depth_m: preset.d,
      height_m: preset.h,
      elevation_m: elev,
      rotation_deg: rot,
    };
    this.project.equipments.push(eq);
    this.selectObject("equipment", eq.id);
    this.emit("geometryChanged", { source: "addEquipment" });
    return eq;
  }

  addCableTray(points_px, opts = {}) {
    if (!points_px || points_px.length < 2) return null;
    this.pushHistorySnapshot();
    const service = normalizeTrayService(opts.service || this.ui.trayService);
    const tray = insertTrayRun(
      this.project,
      points_px,
      {
        id: `tray_${this.project.cable_trays.length + 1}_${Date.now().toString(36).slice(-3)}`,
        name: `Cable Tray Route #${this.project.cable_trays.length + 1}`,
        type: opts.type || this.ui.trayType || "perforated",
        service,
        width_m: opts.width_m ?? 0.5,
        height_m: 0.1,
        elevation_m: opts.elevation_m ?? defaultTrayElevation(this.project, service),
        color: opts.color || trayColorForService(service),
      },
      1.5
    );
    if (!tray) return null;
    this.selectObject("tray", tray.id);
    this.emit("geometryChanged", { source: "addTray" });
    return tray;
  }

  addPipeRun(points_px, opts = {}) {
    if (!points_px || points_px.length < 2) return null;
    this.pushHistorySnapshot();
    const mounting = normalizePipeMounting(opts.mounting || this.ui.pipeMounting);
    const pipe = insertPipeRun(
      this.project,
      points_px,
      {
        id: `pipe_${(this.project.pipe_runs?.length || 0) + 1}_${Date.now().toString(36).slice(-3)}`,
        name: `Cooling Pipe #${(this.project.pipe_runs?.length || 0) + 1}`,
        mounting,
        diameter_m: opts.diameter_m ?? 0.1,
        elevation_m: opts.elevation_m ?? defaultPipeElevation(this.project, mounting),
        color: opts.color || PIPE_DEFAULT_COLOR,
      },
      1.5
    );
    if (!pipe) return null;
    this.selectObject("pipe", pipe.id);
    this.emit("geometryChanged", { source: "addPipe" });
    return pipe;
  }

  buildStairParameters(parameters = {}) {
    const meta = this.project.metadata;
    const defaults = this.ui.stairDefaults || {};
    const start = parameters.start_px || { x_px: 0, y_px: 0 };
    const end = parameters.end_px || { x_px: 0, y_px: 0 };
    const shape = parameters.shape || defaults.shape || "straight";
    const turn = parameters.turn || defaults.turn || "right";
    const height = Number(parameters.height_m ?? defaults.height_m ?? meta.default_wall_height_m ?? 3.8);
    const rawSteps = parameters.steps ?? defaults.steps;
    const hasExplicitSteps =
      rawSteps !== null && rawSteps !== undefined && rawSteps !== "";
    const stepsInput = hasExplicitSteps ? Number(rawSteps) : NaN;
    // Explicit fractional/out-of-range values must reach the resolver and be
    // rejected instead of being rounded or replaced by a hidden default.
    const steps = hasExplicitSteps
      ? stepsInput
      : Math.max(STAIR_MIN_RISERS, Math.min(STAIR_MAX_RISERS, Math.round(height / STAIR_DEFAULT_RISER_M)));
    const width = Number(parameters.width_m ?? defaults.width_m ?? 1.2);
    const landing =
      parameters.landing_depth_m === undefined
        ? Math.max(
            width,
            Number(defaults.landing_depth_m ?? STAIR_DEFAULT_LANDING_M)
          )
        : Number(parameters.landing_depth_m);
    const rawHeading = parameters.heading_rad ?? defaults.heading_rad;
    const explicitHeading =
      rawHeading === null || rawHeading === undefined || rawHeading === "" ? NaN : Number(rawHeading);
    const heading = Number.isFinite(explicitHeading)
      ? explicitHeading
      : computeDefaultHeading(start, end, shape, turn);
    const run = Number(parameters.flight_run_m ?? defaults.flight_run_m);
    return {
      shape,
      start_px: { x_px: Number(start.x_px), y_px: Number(start.y_px) },
      end_px: { x_px: Number(end.x_px), y_px: Number(end.y_px) },
      width_m: width,
      height_m: height,
      steps,
      turn,
      heading_rad: heading,
      landing_depth_m: landing,
      flight_run_m: shape === "U" && Number.isFinite(run) && run > 0
        ? run
        : shape === "U"
        ? Math.max(1, Math.floor(steps / 2) * 0.28)
        : null,
      name: parameters.name || null,
      id: parameters.id || null,
    };
  }

  stairDerived(stair, geometry) {
    const points = geometry.footprint_px.flat();
    const xs = points.map((p) => p.x_px);
    const ys = points.map((p) => p.y_px);
    const x_px = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y_px = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ux = Math.cos(Number(stair.heading_rad) || 0);
    const uy = Math.sin(Number(stair.heading_rad) || 0);
    const projections = points.map((p) => (p.x_px - x_px) * ux + (p.y_px - y_px) * uy);
    return {
      x_px: Math.round(x_px * 10) / 10,
      y_px: Math.round(y_px * 10) / 10,
      depth_m: Math.max(...projections) - Math.min(...projections),
    };
  }

  previewParametricStair(parameters = {}) {
    const built = this.buildStairParameters(parameters);
    const stair = {
      id: built.id || "stair_preview",
      name: built.name || "Parametric Stair",
      template_version: 1,
      shape: built.shape,
      start_px: built.start_px,
      end_px: built.end_px,
      width_m: built.width_m,
      height_m: built.height_m,
      steps: built.steps,
      turn: built.turn,
      heading_rad: built.heading_rad,
      landing_depth_m: built.landing_depth_m,
      flight_run_m: built.flight_run_m,
    };
    const geometry = resolveStairGeometry(stair, this.project.metadata.scale_px_per_meter || 30.68);
    if (!geometry.ok) {
      return { ok: false, error: geometry, parameters: stair };
    }
    Object.assign(stair, this.stairDerived(stair, geometry));
    return { ok: true, stair, geometry, parameters: stair };
  }

  addParametricStair(parameters = {}) {
    const preview = this.previewParametricStair(parameters);
    if (!preview.ok) return preview;
    const token = this.beginTransaction("add-parametric-stair");
    if (!token) return { ok: false, error: { message: "Transaksi lain sedang aktif." } };
    const stair = {
      ...preview.stair,
      id: this.allocateId("stair"),
      name: parameters.name || `Parametric Staircase #${this.project.stairs.length + 1}`,
    };
    this.project.stairs.push(stair);
    this.selectObject("stair", stair.id);
    this.commitTransaction(token);
    return { ok: true, stair };
  }

  updateParametricStair(id, patch = {}) {
    const stair = this.project.stairs.find((item) => item.id === id);
    if (!stair) return { ok: false, error: { message: "Stair tidak ditemukan." } };
    if (!isParametricStair(stair)) {
      return { ok: false, error: { code: "legacy_stair", message: "Stair legacy harus dikonversi eksplisit." } };
    }
    const merged = { ...stair, ...patch, id: stair.id, template_version: 1 };
    const geometry = resolveStairGeometry(merged, this.project.metadata.scale_px_per_meter || 30.68);
    if (!geometry.ok) return { ok: false, error: geometry };
    const token = this.beginTransaction("update-parametric-stair");
    if (!token) return { ok: false, error: { message: "Transaksi lain sedang aktif." } };
    Object.assign(stair, merged);
    Object.assign(stair, this.stairDerived(stair, geometry));
    this.commitTransaction(token);
    return { ok: true, stair, geometry };
  }

  previewStairEndpoint(id, which, pointPx) {
    const stair = this.project.stairs.find((item) => item.id === id);
    if (!stair || !isParametricStair(stair)) return { ok: false };
    if (which !== "start_px" && which !== "end_px") return { ok: false };
    const x = Number(pointPx.x_px ?? pointPx.x);
    const y = Number(pointPx.y_px ?? pointPx.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
    const merged = { ...stair, [which]: { x_px: x, y_px: y } };
    const geometry = resolveStairGeometry(merged, this.project.metadata.scale_px_per_meter || 30.68);
    if (!geometry.ok) return { ok: false, error: geometry };
    stair[which] = { x_px: x, y_px: y };
    Object.assign(stair, this.stairDerived(stair, geometry));
    this.notifyGeometryChange("stair-endpoint", [stair.id]);
    return { ok: true, geometry };
  }

  translateParametricStair(id, deltaPx) {
    const stair = this.project.stairs.find((item) => item.id === id);
    if (!stair || !isParametricStair(stair)) return { ok: false };
    const dx = Number(deltaPx?.dx ?? deltaPx?.x ?? 0);
    const dy = Number(deltaPx?.dy ?? deltaPx?.y ?? 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return { ok: false };
    const moved = {
      ...stair,
      start_px: { x_px: stair.start_px.x_px + dx, y_px: stair.start_px.y_px + dy },
      end_px: { x_px: stair.end_px.x_px + dx, y_px: stair.end_px.y_px + dy },
    };
    const geometry = resolveStairGeometry(moved, this.project.metadata.scale_px_per_meter || 30.68);
    if (!geometry.ok) return { ok: false, error: geometry };
    const token = this.beginTransaction("translate-stair");
    if (!token) return { ok: false };
    Object.assign(stair, moved);
    Object.assign(stair, this.stairDerived(stair, geometry));
    this.commitTransaction(token);
    return { ok: true, stair };
  }

  suggestLegacyStairConversion(id) {
    const stair = this.project.stairs.find((item) => item.id === id);
    if (!stair || isParametricStair(stair)) return null;
    return suggestLegacyConversion(stair, this.project.metadata.scale_px_per_meter || 30.68);
  }

  convertLegacyStair(id, parameters = null) {
    const index = this.project.stairs.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, error: { message: "Stair tidak ditemukan." } };
    const legacy = this.project.stairs[index];
    if (isParametricStair(legacy)) return { ok: false, error: { message: "Stair sudah parametrik." } };
    const suggested = parameters || this.suggestLegacyStairConversion(id);
    if (!suggested) return { ok: false, error: { message: "Parameter konversi tidak tersedia." } };
    const preview = this.previewParametricStair({
      ...suggested,
      id: legacy.id,
      name: legacy.name,
    });
    if (!preview.ok) return preview;
    const token = this.beginTransaction("convert-legacy-stair");
    if (!token) return { ok: false, error: { message: "Transaksi lain sedang aktif." } };
    const converted = {
      ...preview.stair,
      id: legacy.id,
      name: legacy.name || preview.stair.name,
    };
    this.project.stairs.splice(index, 1, converted);
    this.selectObject("stair", converted.id);
    this.commitTransaction(token);
    return { ok: true, stair: converted };
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

    insertTrayRun(
      this.project,
      [
        [Math.round(cx - 115), Math.round(cy - 10)],
        [Math.round(cx + 135), Math.round(cy - 10)],
        [Math.round(cx + 135), Math.round(cy + 45)],
      ],
      {
        id: `tray_preset_1_${Date.now().toString(36).slice(-2)}`,
        name: "Main Overhead Power & Fiber Tray",
        type: "perforated",
        width_m: 0.5,
        height_m: 0.1,
        elevation_m: defaultTrayElevation(this.project),
        color: "#cba258",
      },
      1.5
    );

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

    // Nodes that only the removed walls used would otherwise stay behind as orphan vertices.
    const loosened = new Set();
    if (sel.kind === "node") {
      for (const w of this.project.walls) {
        if (w.start_node === sel.id || w.end_node === sel.id) {
          loosened.add(w.start_node);
          loosened.add(w.end_node);
        }
      }
      this.project.nodes = this.project.nodes.filter((n) => n.id !== sel.id);
      this.project.walls = this.project.walls.filter(
        (w) => w.start_node !== sel.id && w.end_node !== sel.id
      );
    } else if (sel.kind === "wall") {
      const wall = this.project.walls.find((w) => w.id === sel.id);
      if (wall) {
        loosened.add(wall.start_node);
        loosened.add(wall.end_node);
      }
      this.project.walls = this.project.walls.filter((w) => w.id !== sel.id);
      this.project.openings = this.project.openings.filter((o) => o.wall_id !== sel.id);
    }
    if (loosened.size) {
      const used = new Set(this.project.walls.flatMap((w) => [w.start_node, w.end_node]));
      this.project.nodes = this.project.nodes.filter((n) => !loosened.has(n.id) || used.has(n.id));
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
      pruneTrayNodes(this.project);
    } else if (sel.kind === "pipe") {
      this.project.pipe_runs = (this.project.pipe_runs || []).filter((p) => p.id !== sel.id);
      prunePipeNodes(this.project);
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
    let powerTrayMeters = 0;
    let dataTrayMeters = 0;
    let unifiedTrayMeters = 0;
    for (const t of this.project.cable_trays) {
      const len = trayLengthM(this.project, t, scale);
      trayLengthMeters += len;
      const svc = normalizeTrayService(t.service);
      if (svc === "power") powerTrayMeters += len;
      else if (svc === "data") dataTrayMeters += len;
      else unifiedTrayMeters += len;
    }

    let pipeLengthMeters = 0;
    for (const p of this.project.pipe_runs || []) {
      pipeLengthMeters += pipeLengthM(this.project, p, scale);
    }

    const doorsCount = this.project.openings.filter(
      (o) => o.type === "single_door" || o.type === "double_door"
    ).length;
    const windowsCount = this.project.openings.filter((o) => o.type === "window").length;

    const equipmentsByGroup = Object.fromEntries(EQUIPMENT_GROUPS.map((g) => [g, 0]));
    for (const eq of this.project.equipments) {
      const grp = resolveEquipmentGroup(eq);
      equipmentsByGroup[grp] = (equipmentsByGroup[grp] || 0) + 1;
    }

    return {
      solidWallMeters: solidWallMeters.toFixed(1),
      cageWallMeters: cageWallMeters.toFixed(1),
      glassWallMeters: glassWallMeters.toFixed(1),
      raisedFloorAreaM2: raisedFloorAreaM2.toFixed(1),
      raisedFloorTiles,
      trayLengthMeters: trayLengthMeters.toFixed(1),
      powerTrayMeters: powerTrayMeters.toFixed(1),
      dataTrayMeters: dataTrayMeters.toFixed(1),
      unifiedTrayMeters: unifiedTrayMeters.toFixed(1),
      pipeLengthMeters: pipeLengthMeters.toFixed(1),
      columnsCount: this.project.columns.length,
      doorsCount,
      windowsCount,
      stairsCount: this.project.stairs.length,
      roomsCount: this.project.rooms.length,
      equipmentsCount: this.project.equipments.length,
      equipmentsByGroup,
    };
  }
}

export const store = new SitestryStore();
