/**
 * Sitestry.AI — 2D Interactive Konva.js Topological CAD & HITL Editor (v3.0)
 * Renders the Blueprint Raster/PDF Layer, 60x60cm Raised Floor Grid, Draggable ROI Box,
 * 2-Point Calibration Ruler, Room Polygons, Architectural Stepped Stairs, H-Beam Columns,
 * Topological Walls with CAD Door Swing Arcs + Door Tags (DD-xx / D-xx / TD-xx),
 * Multi-Line Window Glazing Symbols (W-xx), and Stage 5 CME Equipments / Cable Ladders.
 */

import { computeWallPreview } from "./annotationGeometry.js";
import { isParametricStair, resolveStairGeometry } from "./stairGeometry.js";
import { ISOLATING_TOOLS } from "./store.js";

const NODE_HIT_DIAMETER_PX = 11;

export class Canvas2DEngine {
  constructor(containerId, store) {
    this.container = document.getElementById(containerId);
    this.store = store;

    this.stage = new Konva.Stage({
      container: containerId,
      width: this.container.clientWidth || 800,
      height: this.container.clientHeight || 600,
      draggable: true,
    });

    this.blueprintLayer = new Konva.Layer();
    this.gridLayer = new Konva.Layer({ listening: false });
    this.roomsLayer = new Konva.Layer();
    this.cadLayer = new Konva.Layer();
    this.cmeLayer = new Konva.Layer();
    this.roiLayer = new Konva.Layer();
    this.overlayLayer = new Konva.Layer();

    this.stage.add(this.blueprintLayer);
    this.stage.add(this.gridLayer);
    this.stage.add(this.roomsLayer);
    this.stage.add(this.cadLayer);
    this.stage.add(this.cmeLayer);
    this.stage.add(this.roiLayer);
    this.stage.add(this.overlayLayer);

    this.blueprintImageNode = null;
    this.imageObj = null;

    // Interactive drawing state
    this.wallChainNode = null;
    this.rulerPoints = [];
    this.roomDragStart = null;
    this.trayDraftPoints = [];
    this.cursorPosPx = { x: 0, y: 0 };
    this.isDraggingNode = false;
    this.dragTransaction = null;
    this.wallVisuals = [];
    this.guideVisuals = [];
    this.wallDrag = null;
    this.spacePan = false;
    this.panState = null;
    this.stairDraft = null;
    this.isDraggingStair = false;
    this.stairDragTransaction = null;
    this.stairEndpointValid = true;
    this.nodeVisuals = [];

    this.bindStageEvents();
    this.bindStoreEvents();
    this.syncStageDraggable();
  }

  bindStoreEvents() {
    this.store.addEventListener("blueprintLoaded", (e) => {
      this.loadBlueprintImage(e.detail.dataUrl);
    });
    this.store.addEventListener("geometryChanged", () => {
      if (this.isDraggingNode) {
        this.syncDraggedGeometry();
        return;
      }
      if (this.isDraggingStair) return;
      this.renderAll();
    });
    this.store.addEventListener("geometryPreviewChanged", () => {
      if (this.isDraggingNode) {
        this.syncDraggedGeometry();
      }
    });
    this.store.addEventListener("selectionChanged", () => {
      // Selection must never destroy the handle that is being dragged.
      if (this.isDraggingNode || this.isDraggingStair) return;
      this.renderAll();
    });
    this.store.addEventListener("roiChanged", () => {
      this.renderRoiOverlay();
    });
    this.store.addEventListener("sourceChanged", () => {
      this.cancelNodeDrag();
      this.cancelStairDrag();
      this.clearTempDrawing();
      this.renderAll();
    });
    this.store.addEventListener("guidesChanged", () => {
      if (this.wallDrag) {
        this.renderTempOverlay(this.wallDrag.cursorPx || this.wallDrag.startPx);
      }
    });
    this.store.addEventListener("toolChanged", () => {
      this.cancelNodeDrag();
      this.cancelStairDrag();
      this.clearTempDrawing();
      this.syncStageDraggable();
      this.renderAll();
    });
  }

  syncDraggedGeometry() {
    for (const visual of this.wallVisuals) {
      const n1 = this.store.getNodeById(visual.wall.start_node);
      const n2 = this.store.getNodeById(visual.wall.end_node);
      if (!n1 || !n2) continue;
      const points = [n1.x_px, n1.y_px, n2.x_px, n2.y_px];
      visual.lines.forEach((line) => line.points(points));
      const dx = n2.x_px - n1.x_px;
      const dy = n2.y_px - n1.y_px;
      for (const { group, ratio } of visual.openings) {
        group.position({ x: n1.x_px + dx * ratio, y: n1.y_px + dy * ratio });
        group.rotation((Math.atan2(dy, dx) * 180) / Math.PI);
      }
    }
    this.cadLayer.batchDraw();
  }

  cancelStairDrag() {
    if (!this.isDraggingStair) return false;
    const token = this.stairDragTransaction;
    this.isDraggingStair = false;
    this.stairDragTransaction = null;
    if (token) this.store.cancelTransaction(token);
    this.renderAll();
    return true;
  }

  cancelNodeDrag() {
    if (!this.isDraggingNode) return false;
    const token = this.dragTransaction;
    this.isDraggingNode = false;
    this.dragTransaction = null;
    if (token) this.store.cancelTransaction(token);
    this.renderAll();
    return true;
  }

  loadBlueprintImage(dataUrl) {
    const sourceRevision = this.store.currentSource.revision;
    const img = new Image();
    img.onload = () => {
      if (sourceRevision !== this.store.currentSource.revision) return;
      this.imageObj = img;
      this.blueprintLayer.destroyChildren();
      this.blueprintImageNode = new Konva.Image({
        x: 0,
        y: 0,
        image: img,
        width: img.width,
        height: img.height,
        opacity: this.store.ui.blueprintOpacity,
        listening: false,
      });
      this.blueprintLayer.add(this.blueprintImageNode);
      this.blueprintLayer.batchDraw();
      this.zoomToFit();
      this.renderAll();
    };
    img.src = dataUrl;
  }

  zoomToFit() {
    const meta = this.store.project.metadata;
    const iw = meta.image_width_px || 1584;
    const ih = meta.image_height_px || 1224;
    const sw = this.stage.width();
    const sh = this.stage.height();
    if (sw < 40 || sh < 40) return;

    const pad = 36;
    const scale = Math.min((sw - pad * 2) / iw, (sh - pad * 2) / ih);
    this.stage.scale({ x: scale, y: scale });
    this.stage.position({
      x: (sw - iw * scale) / 2,
      y: (sh - ih * scale) / 2,
    });
    this.stage.batchDraw();
  }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 10 && h > 10) {
      this.stage.width(w);
      this.stage.height(h);
      this.stage.batchDraw();
    }
  }

  /** World-space bounding box of the selected object ({x1,y1,x2,y2}), or null when unresolvable. */
  selectedWorldBox() {
    const sel = this.store.ui.selected;
    const obj = this.store.getSelectedObject();
    if (!sel || !obj) return null;
    const pt = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p?.x_px ?? p?.x, p?.y_px ?? p?.y]);
    let pts = [];
    if (sel.kind === "node" || sel.kind === "column" || sel.kind === "equipment") {
      pts = [[obj.x_px, obj.y_px]];
    } else if (sel.kind === "wall" || sel.kind === "opening") {
      const wall = sel.kind === "wall" ? obj : this.store.project.walls.find((w) => w.id === obj.wall_id);
      const n1 = wall && this.store.getNodeById(wall.start_node);
      const n2 = wall && this.store.getNodeById(wall.end_node);
      if (!n1 || !n2) return null;
      if (sel.kind === "wall") pts = [[n1.x_px, n1.y_px], [n2.x_px, n2.y_px]];
      else {
        const r = obj.offset_ratio ?? 0.5;
        pts = [[n1.x_px + (n2.x_px - n1.x_px) * r, n1.y_px + (n2.y_px - n1.y_px) * r]];
      }
    } else if (sel.kind === "room") {
      pts = (obj.polygon_px || []).map(pt);
    } else if (sel.kind === "tray") {
      pts = (obj.points_px || []).map(pt);
    } else if (sel.kind === "stair") {
      pts = [obj.start_px, obj.end_px].filter(Boolean).map(pt);
      if (!pts.length && Array.isArray(obj.bbox_px) && obj.bbox_px.length >= 4) {
        const b = obj.bbox_px;
        pts = [[b[0], b[1]], [b[2], b[3]]];
      }
    }
    pts = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }

  /** Screen rect (px, relative to #pane2D) of the selected object, or null when none/unresolvable. */
  selectedScreenRect() {
    const box = this.selectedWorldBox();
    const pane = document.getElementById("pane2D");
    if (!box || !pane) return null;
    const transform = this.stage.getAbsoluteTransform();
    const a = transform.point({ x: box.x1, y: box.y1 });
    const b = transform.point({ x: box.x2, y: box.y2 });
    const paneRect = pane.getBoundingClientRect();
    const hostRect = this.container.getBoundingClientRect();
    const dx = hostRect.left - paneRect.left;
    const dy = hostRect.top - paneRect.top;
    return {
      x: Math.min(a.x, b.x) + dx,
      y: Math.min(a.y, b.y) + dy,
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }

  getWorldPointerPosition() {
    const transform = this.stage.getAbsoluteTransform().copy();
    transform.invert();
    const pos = this.stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return transform.point(pos);
  }

  syncStageDraggable() {
    const tool = this.store.ui.activeTool;
    this.stage.draggable(tool === "select");
  }

  isDrawingTool() {
    return ISOLATING_TOOLS.has(this.store.ui.activeTool);
  }

  hasTempDrawing() {
    return Boolean(
      this.wallDrag ||
        this.stairDraft ||
        this.wallChainNode ||
        this.rulerPoints.length ||
        this.roomDragStart ||
        this.trayDraftPoints.length
    );
  }

  stageScale() {
    const scale = this.stage.scaleX();
    return Number.isFinite(scale) && scale > 0 ? Math.max(0.05, scale) : 1;
  }

  syncNodeHandleScale() {
    const nodeScale = this.stageScale();
    for (const { circle, selected } of this.nodeVisuals) {
      const radiusCss = selected ? 6.0 : 3.8;
      // Keep the total target at a fixed screen diameter. An unbounded stroke
      // would let nearby vertices capture each other's centers.
      circle.radius(radiusCss / nodeScale);
      circle.hitStrokeWidth(Math.max(0, NODE_HIT_DIAMETER_PX - radiusCss * 2) / nodeScale);
      circle.strokeWidth(1.8 / nodeScale);
    }
    this.cadLayer.batchDraw();
  }

  handleStairClick(pt) {
    if (!this.stairDraft) {
      this.stairDraft = { startPx: { x_px: pt.x, y_px: pt.y }, cursorPx: { x_px: pt.x, y_px: pt.y } };
      this.renderTempOverlay(pt);
      return;
    }
    const defaults = this.store.ui.stairDefaults || {};
    const result = this.store.addParametricStair({
      ...defaults,
      start_px: this.stairDraft.startPx,
      end_px: { x_px: pt.x, y_px: pt.y },
    });
    if (result.ok) {
      this.stairDraft = null;
      this.overlayLayer.destroyChildren();
      this.overlayLayer.batchDraw();
    } else {
      this.stairDraft.error = result.error?.message || "Konfigurasi tangga tidak valid.";
      this.store.emit("toast", { message: this.stairDraft.error });
      this.renderTempOverlay(pt);
    }
  }

  drawStairGeometry(geometry, layer, options = {}) {
    if (!geometry?.ok) return;
    const preview = Boolean(options.preview);
    const selected = Boolean(options.selected);
    const stroke = preview ? "#cba258" : selected ? "#00754A" : "#b45309";
    const fill = preview ? "rgba(203, 162, 88, 0.16)" : "rgba(203, 162, 88, 0.22)";

    for (const flight of geometry.flights) {
      const flat = flight.footprint_px.flatMap((p) => [p.x_px, p.y_px]);
      layer.add(
        new Konva.Line({
          points: flat,
          closed: true,
          fill,
          stroke,
          strokeWidth: preview ? 1.4 : 1.2,
          listening: false,
        })
      );
      for (const tread of flight.treads) {
        layer.add(
          new Konva.Line({
            points: [
              tread.footprint_px[0].x_px,
              tread.footprint_px[0].y_px,
              tread.footprint_px[1].x_px,
              tread.footprint_px[1].y_px,
            ],
            stroke: stroke,
            strokeWidth: 0.9,
            opacity: 0.75,
            listening: false,
          })
        );
      }
    }
    for (const landing of geometry.landings) {
      const flat = landing.footprint_px.flatMap((p) => [p.x_px, p.y_px]);
      layer.add(
        new Konva.Line({
          points: flat,
          closed: true,
          fill: preview ? "rgba(0, 117, 74, 0.2)" : "rgba(0, 117, 74, 0.16)",
          stroke: "#006241",
          strokeWidth: 1.3,
          listening: false,
        })
      );
    }
    layer.add(
      new Konva.Arrow({
        points: geometry.route_px.flatMap((p) => [p.x_px, p.y_px]),
        pointerLength: 7,
        pointerWidth: 6,
        stroke: "#78350f",
        fill: "#78350f",
        strokeWidth: 1.4,
        listening: false,
      })
    );
  }

  clearWallDrag() {
    this.wallDrag = null;
    this.overlayLayer.destroyChildren();
    this.overlayLayer.batchDraw();
  }

  clearTempDrawing() {
    this.wallDrag = null;
    this.stairDraft = null;
    this.wallChainNode = null;
    this.rulerPoints = [];
    this.roomDragStart = null;
    this.trayDraftPoints = [];
    this.overlayLayer.destroyChildren();
    this.overlayLayer.batchDraw();
  }

  // ==================== STAGE POINTER & WHEEL EVENTS ====================
  bindStageEvents() {
    this.stage.on("wheel", (e) => {
      e.evt.preventDefault();
      const oldScale = this.stage.scaleX();
      const pointer = this.stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - this.stage.x()) / oldScale,
        y: (pointer.y - this.stage.y()) / oldScale,
      };

      const scaleBy = 1.1;
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clamped = Math.max(0.12, Math.min(6.0, newScale));

      this.stage.scale({ x: clamped, y: clamped });
      this.stage.position({
        x: pointer.x - mousePointTo.x * clamped,
        y: pointer.y - mousePointTo.y * clamped,
      });
      this.syncNodeHandleScale();
      this.stage.batchDraw();
    });

    this.stage.on("mousemove", () => {
      const pt = this.getWorldPointerPosition();
      this.cursorPosPx = pt;
      const scale = this.store.project.metadata.scale_px_per_meter || 30.68;
      const xm = (pt.x / scale).toFixed(2);
      const ym = (pt.y / scale).toFixed(2);
      const cursorEl = document.getElementById("lblStatusCursor");
      if (cursorEl) {
        cursorEl.textContent = `X: ${xm}m, Z: ${ym}m (${Math.round(pt.x)}, ${Math.round(pt.y)} px)`;
      }
      if (this.wallDrag) {
        this.wallDrag.cursorPx = pt;
        this.renderTempOverlay(pt);
      } else {
        this.renderTempOverlay(pt);
      }
    });

    this.stage.on("mousedown", (e) => {
      if (e.evt.button === 1 || (e.evt.button === 0 && this.spacePan)) {
        e.evt.preventDefault();
        const pos = this.stage.position();
        this.panState = {
          startX: e.evt.clientX,
          startY: e.evt.clientY,
          stageX: pos.x,
          stageY: pos.y,
        };
        return;
      }
      if (e.evt.button !== 0) return;
      const tool = this.store.ui.activeTool;
      const pt = this.getWorldPointerPosition();

      if (tool === "wall") {
        this.beginWallDrag(pt);
        return;
      }
      if (tool === "stair") {
        this.handleStairClick(pt);
        return;
      }

      if (e.target === this.stage) {
        if (tool === "select") {
          this.store.selectObject(null, null);
        } else if (tool === "wall") {
          this.handleWallToolClick(pt);
        } else if (tool === "column") {
          this.store.addColumn(pt.x, pt.y);
        } else if (tool === "door") {
          const op = this.store.addOpeningOnNearestWall(pt.x, pt.y, "single_door");
          if (!op) {
            this.store.emit("toast", { message: "Klik tepat pada segmen garis dinding untuk memasang Pintu Single." });
          }
        } else if (tool === "double_door") {
          const op = this.store.addOpeningOnNearestWall(pt.x, pt.y, "double_door");
          if (!op) {
            this.store.emit("toast", { message: "Klik tepat pada segmen garis dinding untuk memasang Pintu Double." });
          }
        } else if (tool === "window") {
          const op = this.store.addOpeningOnNearestWall(pt.x, pt.y, "window");
          if (!op) {
            this.store.emit("toast", { message: "Klik tepat pada segmen garis dinding untuk memasang Jendela." });
          }
        } else if (tool === "equipment") {
          this.store.addEquipment(pt.x, pt.y);
        } else if (tool === "stair") {
          this.store.addStaircase(pt.x, pt.y);
        } else if (tool === "ruler") {
          this.handleRulerClick(pt);
        } else if (tool === "room") {
          this.handleRoomToolClick(pt);
        } else if (tool === "tray") {
          this.handleTrayToolClick(pt);
        }
      }
    });

    this.stage.on("dblclick", () => {
      if (this.store.ui.activeTool === "wall") {
        this.clearTempDrawing();
      } else if (this.store.ui.activeTool === "tray" && this.trayDraftPoints.length >= 2) {
        this.store.addCableTray(this.trayDraftPoints);
        this.clearTempDrawing();
      }
    });

    this.stage.on("mouseup", (e) => {
      if (this.wallDrag && (e.evt.button === 0 || e.evt.button === undefined)) {
        this.finishWallDrag(this.getWorldPointerPosition());
      }
    });

    this.stage.on("mouseleave", () => {
      if (this.wallDrag) this.clearWallDrag();
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.panState) return;
      this.stage.position({
        x: this.panState.stageX + (e.clientX - this.panState.startX),
        y: this.panState.stageY + (e.clientY - this.panState.startY),
      });
      this.stage.batchDraw();
    });

    window.addEventListener("mouseup", () => {
      this.panState = null;
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        this.spacePan = true;
      }
      if (e.key === "Escape") {
        const hadNodeDrag = this.cancelNodeDrag();
        const hadStairDrag = this.cancelStairDrag();
        const hadDraft = this.hasTempDrawing();
        this.clearTempDrawing();
        const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
        if (
          !hadNodeDrag &&
          !hadStairDrag &&
          !hadDraft &&
          !typing &&
          document.body.dataset.ui === "v4" &&
          this.isDrawingTool()
        ) {
          this.store.setActiveTool("select");
        }
      } else if (e.key === "Enter" && this.store.ui.activeTool === "tray" && this.trayDraftPoints.length >= 2) {
        this.store.addCableTray(this.trayDraftPoints);
        this.clearTempDrawing();
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.spacePan = false;
    });

    window.addEventListener("pointercancel", () => {
      this.cancelNodeDrag();
      this.cancelStairDrag();
      this.clearTempDrawing();
    });
  }

  buildWallPreview(cursorPt) {
    const preview = computeWallPreview({
      startPx: this.wallDrag.startPx,
      endPx: cursorPt,
      viewScale: this.stage.scaleX(),
      mode: this.store.ui.wallMode || "manual",
      assistance: {
        endpointSnap: Boolean(this.store.ui.endpointSnap),
        ortho: Boolean(this.store.ui.orthoSnap),
      },
      guides: this.store.guideCandidates || [],
      project: this.store.project,
    });
    this.wallDrag.preview = preview;
    return preview;
  }

  beginWallDrag(pt) {
    if (this.wallDrag) return;
    this.wallDrag = {
      startPx: { x_px: pt.x, y_px: pt.y },
      cursorPx: { x_px: pt.x, y_px: pt.y },
      preview: null,
    };
    this.buildWallPreview(pt);
    this.renderTempOverlay(pt);
  }

  finishWallDrag(pt) {
    if (!this.wallDrag) return;
    const preview = this.buildWallPreview(pt);
    const screenLength = Math.hypot(
      preview.endPx.x_px - preview.startPx.x_px,
      preview.endPx.y_px - preview.startPx.y_px
    ) * this.stage.scaleX();
    if (screenLength >= 3) {
      const result = this.store.insertWall(preview, { type: "solid" });
      if (!result.ok) {
        this.store.emit("toast", { message: result.error });
      }
    }
    this.clearWallDrag();
  }

  handleWallToolClick(pt) {
    if (!this.wallChainNode) {
      this.wallChainNode = { x: pt.x, y: pt.y };
    } else {
      const w = this.store.addWallSegment(
        this.wallChainNode.x,
        this.wallChainNode.y,
        pt.x,
        pt.y,
        "solid"
      );
      if (w) {
        const endNode = this.store.getNodeById(w.end_node);
        this.wallChainNode = endNode ? { x: endNode.x_px, y: endNode.y_px } : { x: pt.x, y: pt.y };
      }
    }
  }

  handleRulerClick(pt) {
    this.rulerPoints.push(pt);
    if (this.rulerPoints.length === 2) {
      const [p1, p2] = this.rulerPoints;
      const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      this.store.emit("rulerCompleted", { p1, p2, pxDist: distPx });
      this.rulerPoints = [];
    }
  }

  handleRoomToolClick(pt) {
    if (!this.roomDragStart) {
      this.roomDragStart = pt;
    } else {
      this.store.addRoomZone(this.roomDragStart.x, this.roomDragStart.y, pt.x, pt.y);
      this.clearTempDrawing();
    }
  }

  handleTrayToolClick(pt) {
    this.trayDraftPoints.push([pt.x, pt.y]);
  }

  // ==================== MASTER RENDER PIPELINE ====================
  renderAll() {
    const layers = this.store.ui.layers;

    if (this.blueprintImageNode) {
      this.blueprintImageNode.visible(layers.blueprint);
      this.blueprintImageNode.opacity(this.store.ui.blueprintOpacity);
      this.blueprintLayer.batchDraw();
    }

    this.renderRaisedFloorGrid();
    this.renderRoomZones();
    this.renderCadTopology();
    this.renderCmeAndTrays();
    this.renderRoiOverlay();
  }

  renderRaisedFloorGrid() {
    this.gridLayer.destroyChildren();
    if (!this.store.ui.layers.grid) {
      this.gridLayer.batchDraw();
      return;
    }

    const scale = this.store.project.metadata.scale_px_per_meter || 30.68;
    const stepPx = Math.max(10, scale * 0.6); // 60cm raised floor tile
    const roi = this.store.project.metadata.roi_px;
    if (!roi) return;

    const group = new Konva.Group({ opacity: 0.25 });
    for (let x = roi.x; x <= roi.x + roi.width; x += stepPx) {
      group.add(
        new Konva.Line({
          points: [x, roi.y, x, roi.y + roi.height],
          stroke: "#006241",
          strokeWidth: 0.6,
        })
      );
    }
    for (let y = roi.y; y <= roi.y + roi.height; y += stepPx) {
      group.add(
        new Konva.Line({
          points: [roi.x, y, roi.x + roi.width, y],
          stroke: "#006241",
          strokeWidth: 0.6,
        })
      );
    }

    this.gridLayer.add(group);
    this.gridLayer.batchDraw();
  }

  renderRoomZones() {
    this.roomsLayer.destroyChildren();
    if (!this.store.ui.layers.rooms) {
      this.roomsLayer.batchDraw();
      return;
    }

    const sel = this.store.ui.selected;

    for (const room of this.store.project.rooms) {
      if (!room.polygon_px || room.polygon_px.length < 3) continue;
      const flatPts = room.polygon_px.flat();
      const isSelected = sel?.kind === "room" && sel?.id === room.id;

      const poly = new Konva.Line({
        points: flatPts,
        closed: true,
        fill: room.color || "#00754A",
        opacity: isSelected ? 0.24 : 0.1,
        stroke: isSelected ? "#00754A" : room.color || "#006241",
        strokeWidth: isSelected ? 2.4 : 1.1,
        dash: room.floor_type === "raised_floor_60cm" ? [6, 4] : [],
      });

      poly.on("click", (ev) => {
        if (this.isDrawingTool()) return;
        ev.cancelBubble = true;
        this.store.selectObject("room", room.id);
      });

      let cx = 0;
      let cy = 0;
      room.polygon_px.forEach(([px, py]) => {
        cx += px;
        cy += py;
      });
      cx /= room.polygon_px.length;
      cy /= room.polygon_px.length;

      const labelTag = new Konva.Text({
        x: cx - 70,
        y: cy - 8,
        width: 140,
        align: "center",
        text: room.name,
        fontSize: 9.5,
        fontFamily: "IBM Plex Mono",
        fontStyle: "bold",
        fill: "#1E3932",
        listening: false,
      });

      this.roomsLayer.add(poly);
      this.roomsLayer.add(labelTag);
    }

    this.roomsLayer.batchDraw();
  }

  renderCadTopology() {
    this.cadLayer.destroyChildren();
    this.wallVisuals = [];
    this.nodeVisuals = [];
    const wallVisualMap = new Map();
    const layers = this.store.ui.layers;
    const sel = this.store.ui.selected;
    const scale = this.store.project.metadata.scale_px_per_meter || 30.68;

    // 1. Render Walls + Attached Doors & Windows
    if (layers.walls) {
      for (const wall of this.store.project.walls) {
        const n1 = this.store.getNodeById(wall.start_node);
        const n2 = this.store.getNodeById(wall.end_node);
        if (!n1 || !n2) continue;

        const isSelected = sel?.kind === "wall" && sel?.id === wall.id;
        const thickPx = Math.max(4.5, (wall.thickness_m || 0.2) * scale);

        let strokeColor = "#1E3932"; // Deep House Green structural wall ink
        let dashPattern = [];
        if (wall.type === "cage_mesh") {
          strokeColor = "#b45309";
          dashPattern = [7, 5];
        } else if (wall.type === "glass") {
          strokeColor = "#0284c7";
          dashPattern = [10, 3];
        }
        if (isSelected) {
          strokeColor = "#00754A";
        }

        // Outer casing stroke for crisp architectural double-line contrast
        const wallOuter = new Konva.Line({
          points: [n1.x_px, n1.y_px, n2.x_px, n2.y_px],
          stroke: isSelected ? "#006241" : "#1E3932",
          strokeWidth: thickPx + (isSelected ? 3.5 : 1.4),
          lineCap: "round",
          opacity: isSelected ? 0.95 : 0.88,
        });

        const wallFill = new Konva.Line({
          points: [n1.x_px, n1.y_px, n2.x_px, n2.y_px],
          stroke: isSelected ? "#00754A" : wall.type === "solid" ? "#335248" : strokeColor,
          strokeWidth: Math.max(2.2, thickPx - 1.2),
          dash: dashPattern,
          lineCap: "round",
          hitStrokeWidth: 16,
        });

        const handleSelectWall = (ev) => {
          ev.cancelBubble = true;
          const tool = this.store.ui.activeTool;
          if (tool === "wall" || tool === "stair") return;
          if (tool === "room" || tool === "column") return;
          if (tool === "door") {
            const pt = this.getWorldPointerPosition();
            this.store.addOpeningOnNearestWall(pt.x, pt.y, "single_door");
          } else if (tool === "double_door") {
            const pt = this.getWorldPointerPosition();
            this.store.addOpeningOnNearestWall(pt.x, pt.y, "double_door");
          } else if (tool === "window") {
            const pt = this.getWorldPointerPosition();
            this.store.addOpeningOnNearestWall(pt.x, pt.y, "window");
          } else {
            this.store.selectObject("wall", wall.id);
          }
        };

        wallOuter.on("click", handleSelectWall);
        wallFill.on("click", handleSelectWall);

        wallFill.on("dblclick", (ev) => {
          ev.cancelBubble = true;
          const pt = this.getWorldPointerPosition();
          this.store.splitWall(wall.id, pt.x, pt.y);
        });

        this.cadLayer.add(wallOuter);
        this.cadLayer.add(wallFill);

        const wallVisual = { wall, lines: [wallOuter, wallFill], openings: [] };
        this.wallVisuals.push(wallVisual);
        wallVisualMap.set(wall.id, wallVisual);

        // Metric wall dimension label when selected
        const lenPx = Math.hypot(n2.x_px - n1.x_px, n2.y_px - n1.y_px);
        if (isSelected && lenPx > 28) {
          const lenM = (lenPx / scale).toFixed(2);
          const mx = (n1.x_px + n2.x_px) / 2;
          const my = (n1.y_px + n2.y_px) / 2;
          this.cadLayer.add(
            new Konva.Text({
              x: mx - 26,
              y: my - 16,
              text: `${lenM}m`,
              fontSize: 9.5,
              fontFamily: "IBM Plex Mono",
              fontStyle: "bold",
              fill: "#006241",
              listening: false,
            })
          );
        }
      }

      // 2. Render Openings (Architectural CAD Doors with Swing Arcs + Tags, and Windows)
      for (const op of this.store.project.openings) {
        const w = this.store.project.walls.find((item) => item.id === op.wall_id);
        if (!w) continue;
        const n1 = this.store.getNodeById(w.start_node);
        const n2 = this.store.getNodeById(w.end_node);
        if (!n1 || !n2) continue;

        const ratio = op.offset_ratio ?? 0.5;
        const ox = n1.x_px + (n2.x_px - n1.x_px) * ratio;
        const oy = n1.y_px + (n2.y_px - n1.y_px) * ratio;
        const angleRad = Math.atan2(n2.y_px - n1.y_px, n2.x_px - n1.x_px);
        const angleDeg = (angleRad * 180) / Math.PI;
        const widthPx = Math.max(12, (op.width_m || 1.2) * scale);
        const wallThickPx = Math.max(5.5, (w.thickness_m || 0.2) * scale + 2.5);
        const isSelected = sel?.kind === "opening" && sel?.id === op.id;

        const opGroup = new Konva.Group({
          x: ox,
          y: oy,
          rotation: angleDeg,
          draggable: !this.isDrawingTool(),
        });

        // White wall cut-out mask
        opGroup.add(
          new Konva.Rect({
            x: -widthPx / 2,
            y: -wallThickPx / 2,
            width: widthPx,
            height: wallThickPx,
            fill: "#f8f6f2",
            stroke: isSelected ? "#00754A" : op.type === "window" ? "#0284c7" : "#b45309",
            strokeWidth: isSelected ? 2.0 : 1.0,
            cornerRadius: 1,
          })
        );

        if (op.type === "window") {
          // Architectural multi-line window glazing symbol
          opGroup.add(
            new Konva.Line({
              points: [-widthPx / 2, -1.6, widthPx / 2, -1.6],
              stroke: "#0284c7",
              strokeWidth: 1.4,
            })
          );
          opGroup.add(
            new Konva.Line({
              points: [-widthPx / 2, 1.6, widthPx / 2, 1.6],
              stroke: "#0284c7",
              strokeWidth: 1.4,
            })
          );
          // Center mullion tick
          opGroup.add(
            new Konva.Line({
              points: [0, -wallThickPx / 2, 0, wallThickPx / 2],
              stroke: "#0284c7",
              strokeWidth: 1.2,
            })
          );
        } else if (op.type === "double_door") {
          // Double Door: two leaves + two 90-degree swing arcs
          const leafLen = widthPx * 0.48;
          const swingSign = (op.swing_dir || "in-left").startsWith("out") ? -1 : 1;
          // Left leaf & arc
          opGroup.add(
            new Konva.Line({
              points: [-widthPx / 2, 0, -widthPx / 2, swingSign * leafLen],
              stroke: isSelected ? "#00754A" : "#b45309",
              strokeWidth: 2.0,
            })
          );
          opGroup.add(
            new Konva.Arc({
              x: -widthPx / 2,
              y: 0,
              innerRadius: leafLen,
              outerRadius: leafLen,
              angle: 90,
              rotation: swingSign > 0 ? 0 : -90,
              stroke: isSelected ? "#00754A" : "#d97706",
              strokeWidth: 1.1,
              dash: [3, 2],
            })
          );
          // Right leaf & arc
          opGroup.add(
            new Konva.Line({
              points: [widthPx / 2, 0, widthPx / 2, swingSign * leafLen],
              stroke: isSelected ? "#00754A" : "#b45309",
              strokeWidth: 2.0,
            })
          );
          opGroup.add(
            new Konva.Arc({
              x: widthPx / 2,
              y: 0,
              innerRadius: leafLen,
              outerRadius: leafLen,
              angle: 90,
              rotation: swingSign > 0 ? 90 : 180,
              stroke: isSelected ? "#00754A" : "#d97706",
              strokeWidth: 1.1,
              dash: [3, 2],
            })
          );
        } else {
          // Single Door: hinge leaf + 90-degree quarter-circle swing arc
          const leafLen = widthPx * 0.92;
          const swingDir = op.swing_dir || "in-left";
          const swingSign = swingDir.startsWith("out") ? -1 : 1;
          const hingeRight = swingDir.endsWith("right");
          const hx = hingeRight ? widthPx / 2 : -widthPx / 2;

          opGroup.add(
            new Konva.Line({
              points: [hx, 0, hx, swingSign * leafLen],
              stroke: isSelected ? "#00754A" : "#b45309",
              strokeWidth: 2.1,
            })
          );
          let arcRot = 0;
          if (!hingeRight && swingSign > 0) arcRot = 0;
          else if (!hingeRight && swingSign < 0) arcRot = -90;
          else if (hingeRight && swingSign > 0) arcRot = 90;
          else arcRot = 180;

          opGroup.add(
            new Konva.Arc({
              x: hx,
              y: 0,
              innerRadius: leafLen,
              outerRadius: leafLen,
              angle: 90,
              rotation: arcRot,
              stroke: isSelected ? "#00754A" : "#d97706",
              strokeWidth: 1.15,
              dash: [3, 2],
            })
          );
        }

        // Door / Window Tag Badge (unrotated so always readable)
        if (op.tag) {
          const tagText = new Konva.Text({
            x: ox - 20,
            y: oy - 16,
            width: 40,
            align: "center",
            text: op.tag,
            fontSize: 8.5,
            fontFamily: "IBM Plex Mono",
            fontStyle: "bold",
            fill: op.type === "window" ? "#0369a1" : "#92400e",
            listening: false,
          });
          this.cadLayer.add(tagText);
        }

        opGroup.on("click", (ev) => {
          ev.cancelBubble = true;
          if (this.isDrawingTool()) return;
          this.store.selectObject("opening", op.id);
        });

        // Allow dragging the opening along its host wall
        opGroup.on("dragmove", () => {
          const pos = opGroup.position();
          const dx = n2.x_px - n1.x_px;
          const dy = n2.y_px - n1.y_px;
          const lenSq = dx * dx + dy * dy;
          if (lenSq > 1) {
            let t = ((pos.x - n1.x_px) * dx + (pos.y - n1.y_px) * dy) / lenSq;
            t = Math.max(0.08, Math.min(0.92, t));
            opGroup.position({
              x: n1.x_px + t * dx,
              y: n1.y_px + t * dy,
            });
          }
        });

        opGroup.on("dragend", () => {
          const pos = opGroup.position();
          const dx = n2.x_px - n1.x_px;
          const dy = n2.y_px - n1.y_px;
          const lenSq = dx * dx + dy * dy;
          if (lenSq > 1) {
            let t = ((pos.x - n1.x_px) * dx + (pos.y - n1.y_px) * dy) / lenSq;
            t = Math.max(0.08, Math.min(0.92, t));
            this.store.pushHistorySnapshot();
            op.offset_ratio = Number(t.toFixed(3));
            op.x_px = Math.round((n1.x_px + t * dx) * 10) / 10;
            op.y_px = Math.round((n1.y_px + t * dy) * 10) / 10;
            this.store.selectObject("opening", op.id);
            this.store.emit("geometryChanged", { source: "moveOpening" });
          }
        });

        const openingVisual = wallVisualMap.get(w.id);
        if (openingVisual) {
          openingVisual.openings.push({ group: opGroup, ratio: op.offset_ratio ?? 0.5 });
        }

        this.cadLayer.add(opGroup);
      }

      // 3. Render Draggable Topological Vertex Nodes
      for (const node of this.store.project.nodes) {
        const isSelected = sel?.kind === "node" && sel?.id === node.id;
        const nodeScale = this.stageScale();
        const radiusCss = isSelected ? 6.0 : 3.8;
        const circle = new Konva.Circle({
          x: node.x_px,
          y: node.y_px,
          // Handles and their hit stroke are screen-space: source-pixel radii
          // would shrink below a usable target when the drawing is zoomed out.
          radius: radiusCss / nodeScale,
          fill: isSelected ? "#cba258" : "#ffffff",
          stroke: isSelected ? "#006241" : "#1E3932",
          strokeWidth: 1.8 / nodeScale,
          draggable: !this.isDrawingTool(),
          hitStrokeWidth: Math.max(0, NODE_HIT_DIAMETER_PX - radiusCss * 2) / nodeScale,
        });
        this.nodeVisuals.push({ circle, selected: isSelected });

        circle.on("click", (ev) => {
          ev.cancelBubble = true;
          if (this.isDrawingTool()) return;
          this.store.selectObject("node", node.id);
        });

        circle.on("dragstart", () => {
          this.isDraggingNode = true;
          this.dragTransaction = this.store.beginTransaction("vertex-drag");
          this.store.selectObject("node", node.id);
        });

        circle.on("dragmove", () => {
          this.store.moveNode(node.id, circle.x(), circle.y(), true);
        });

        circle.on("dragend", () => {
          const token = this.dragTransaction;
          this.isDraggingNode = false;
          this.dragTransaction = null;
          if (token) this.store.commitTransaction(token);
          this.store.selectObject("node", node.id);
          this.renderAll();
        });

        this.cadLayer.add(circle);
      }
    }

    // 4. Render Structural H-Beam / Concrete Columns
    if (layers.columns) {
      for (const col of this.store.project.columns) {
        const isSelected = sel?.kind === "column" && sel?.id === col.id;
        const wPx = Math.max(9, (col.width_m || 0.55) * scale);
        const dPx = Math.max(9, (col.depth_m || 0.55) * scale);

        const group = new Konva.Group({
          x: col.x_px,
          y: col.y_px,
          draggable: !this.isDrawingTool(),
        });

        group.add(
          new Konva.Rect({
            x: -wPx / 2,
            y: -dPx / 2,
            width: wPx,
            height: dPx,
            fill: isSelected ? "#d4e9e2" : "rgba(0, 117, 74, 0.24)",
            stroke: isSelected ? "#cba258" : "#00754A",
            strokeWidth: isSelected ? 2.2 : 1.5,
            cornerRadius: 1.5,
          })
        );

        // H-Beam cross/flange lines
        group.add(
          new Konva.Line({
            points: [-wPx * 0.35, -dPx * 0.35, wPx * 0.35, dPx * 0.35],
            stroke: "#006241",
            strokeWidth: 1.1,
          })
        );
        group.add(
          new Konva.Line({
            points: [-wPx * 0.35, dPx * 0.35, wPx * 0.35, -dPx * 0.35],
            stroke: "#006241",
            strokeWidth: 1.1,
          })
        );

        if (col.grid_label) {
          group.add(
            new Konva.Text({
              x: -wPx / 2 - 4,
              y: dPx / 2 + 2,
              text: col.grid_label,
              fontSize: 8.5,
              fontFamily: "IBM Plex Mono",
              fontStyle: "bold",
              fill: "#006241",
            })
          );
        }

        group.on("click", (ev) => {
          ev.cancelBubble = true;
          if (this.isDrawingTool()) return;
          this.store.selectObject("column", col.id);
        });

        group.on("dragend", () => {
          this.store.pushHistorySnapshot();
          col.x_px = Math.round(group.x() * 10) / 10;
          col.y_px = Math.round(group.y() * 10) / 10;
          this.store.emit("geometryChanged", { source: "moveColumn" });
        });

        this.cadLayer.add(group);
      }
    }

    this.cadLayer.batchDraw();
  }

  renderParametricStair2D(st, isSelected) {
    const scale = this.store.project.metadata.scale_px_per_meter || 30.68;
    const geometry = resolveStairGeometry(st, scale);
    const group = new Konva.Group({
      x: 0,
      y: 0,
      draggable: !this.isDrawingTool(),
    });
    group.userData = { sitestryKind: "stair", sitestryId: st.id };

    if (!geometry.ok) {
      group.add(
        new Konva.Text({
          x: st.x_px - 40,
          y: st.y_px - 8,
          width: 120,
          align: "center",
          text: `INVALID STAIR: ${geometry.message}`,
          fontSize: 9,
          fontFamily: "IBM Plex Mono",
          fill: "#b91c1c",
          listening: false,
        })
      );
      this.cmeLayer.add(group);
      return;
    }

    group.add(
      new Konva.Rect({
        x: geometry.bounds_px.x_min,
        y: geometry.bounds_px.y_min,
        width: Math.max(1, geometry.bounds_px.x_max - geometry.bounds_px.x_min),
        height: Math.max(1, geometry.bounds_px.y_max - geometry.bounds_px.y_min),
        fill: "rgba(0, 0, 0, 0.001)",
        listening: true,
      })
    );
    this.drawStairGeometry(geometry, group, { selected: isSelected });

    group.add(
      new Konva.Text({
        x: geometry.bounds_px.x_min,
        y: geometry.bounds_px.y_min - 14,
        width: Math.max(90, geometry.bounds_px.x_max - geometry.bounds_px.x_min),
        text: `${st.name || "STAIRS"} · ${st.shape.toUpperCase()}`,
        fontSize: 8.5,
        fontFamily: "IBM Plex Mono",
        fontStyle: "bold",
        fill: "#78350f",
        listening: false,
      })
    );

    const handleRadius = 6 / Math.max(0.15, this.stage.scaleX());
    if (isSelected) {
      for (const which of ["start_px", "end_px"]) {
        const point = st[which];
        const handle = new Konva.Circle({
          x: point.x_px,
          y: point.y_px,
          radius: handleRadius,
          fill: which === "start_px" ? "#cba258" : "#00754A",
          stroke: "#ffffff",
          strokeWidth: 1.5,
          draggable: this.store.ui.activeTool === "select",
        });
        handle.on("click", (ev) => {
          ev.cancelBubble = true;
          this.store.selectObject("stair", st.id);
        });
        handle.on("dragstart", () => {
          this.isDraggingStair = true;
          this.stairEndpointValid = true;
          this.stairDragTransaction = this.store.beginTransaction("stair-endpoint");
          this.store.selectObject("stair", st.id);
        });
        handle.on("dragmove", () => {
          const result = this.store.previewStairEndpoint(st.id, which, {
            x_px: handle.x(),
            y_px: handle.y(),
          });
          this.stairEndpointValid = result.ok;
          if (result.ok) {
            const fresh = resolveStairGeometry(st, scale);
            if (fresh.ok) {
              // Draw the live preview on the overlay so the active handle is
              // never destroyed mid-drag; the committed layer rebuilds on dragend.
              this.overlayLayer.destroyChildren();
              this.drawStairGeometry(fresh, this.overlayLayer, { preview: true });
              this.overlayLayer.batchDraw();
            }
          }
        });
        handle.on("dragend", () => {
          const token = this.stairDragTransaction;
          const valid = this.stairEndpointValid;
          this.isDraggingStair = false;
          this.stairDragTransaction = null;
          if (valid && token) {
            this.store.commitTransaction(token);
          } else if (token) {
            this.store.cancelTransaction(token);
            this.store.emit("toast", {
              message: "Endpoint tangga tidak feasible; perubahan dibatalkan.",
            });
          }
          this.overlayLayer.destroyChildren();
          this.overlayLayer.batchDraw();
          this.store.selectObject("stair", st.id);
          this.renderAll();
        });
        group.add(handle);
      }
    }

    group.on("click", (ev) => {
      ev.cancelBubble = true;
      if (this.isDrawingTool()) return;
      this.store.selectObject("stair", st.id);
    });

    group.on("dragend", () => {
      const dx = group.x();
      const dy = group.y();
      group.position({ x: 0, y: 0 });
      if (dx !== 0 || dy !== 0) {
        this.store.translateParametricStair(st.id, { dx, dy });
      }
      this.renderAll();
    });

    this.cmeLayer.add(group);
  }

  renderCmeAndTrays() {
    this.cmeLayer.destroyChildren();
    const layers = this.store.ui.layers;
    const sel = this.store.ui.selected;
    const scale = this.store.project.metadata.scale_px_per_meter || 30.68;

    // 1. Render 3D Cable Ladders / Trays
    if (layers.trays) {
      for (const tray of this.store.project.cable_trays) {
        if (!tray.points_px || tray.points_px.length < 2) continue;
        const isSelected = sel?.kind === "tray" && sel?.id === tray.id;
        const flatPts = tray.points_px.flat();
        const widthPx = Math.max(8, (tray.width_m || 0.45) * scale);

        const railLine = new Konva.Line({
          points: flatPts,
          stroke: isSelected ? "#00754A" : tray.color || "#cba258",
          strokeWidth: widthPx,
          opacity: 0.42,
          lineCap: "round",
          lineJoin: "round",
        });

        const centerLine = new Konva.Line({
          points: flatPts,
          stroke: isSelected ? "#006241" : "#92400e",
          strokeWidth: 2,
          dash: [5, 5],
        });

        railLine.on("click", (ev) => {
          ev.cancelBubble = true;
          this.store.selectObject("tray", tray.id);
        });

        this.cmeLayer.add(railLine);
        this.cmeLayer.add(centerLine);
      }

      // 2. Render Architectural Stepped Stairs
      for (const st of this.store.project.stairs) {
        const isSelected = sel?.kind === "stair" && sel?.id === st.id;
        if (st.template_version !== undefined) {
          this.renderParametricStair2D(st, isSelected);
          continue;
        }
        let wPx = Math.max(24, (st.width_m || 2.4) * scale);
        let dPx = Math.max(24, (st.depth_m || 3.0) * scale);
        if (st.bbox_px && st.bbox_px.length === 4) {
          wPx = Math.max(16, st.bbox_px[2] - st.bbox_px[0]);
          dPx = Math.max(16, st.bbox_px[3] - st.bbox_px[1]);
        }

        const stGroup = new Konva.Group({
          x: st.x_px,
          y: st.y_px,
          draggable: !this.isDrawingTool(),
        });

        stGroup.add(
          new Konva.Rect({
            x: -wPx / 2,
            y: -dPx / 2,
            width: wPx,
            height: dPx,
            fill: isSelected ? "rgba(0, 117, 74, 0.22)" : "rgba(203, 162, 88, 0.22)",
            stroke: isSelected ? "#00754A" : "#b45309",
            strokeWidth: isSelected ? 2.2 : 1.5,
            cornerRadius: 2,
          })
        );

        const numSteps = Math.max(6, Math.min(20, st.steps || 12));
        const isHorizontalRun = st.direction === "east" || st.direction === "west" || wPx > dPx * 1.15;

        if (isHorizontalRun) {
          for (let i = 1; i < numSteps; i++) {
            const sx = -wPx / 2 + (wPx * i) / numSteps;
            stGroup.add(
              new Konva.Line({
                points: [sx, -dPx / 2, sx, dPx / 2],
                stroke: "#92400e",
                strokeWidth: 1.0,
              })
            );
          }
          // Center directional line
          stGroup.add(
            new Konva.Arrow({
              points: [-wPx * 0.35, 0, wPx * 0.35, 0],
              pointerLength: 5,
              pointerWidth: 5,
              stroke: "#78350f",
              fill: "#78350f",
              strokeWidth: 1.3,
            })
          );
        } else {
          for (let i = 1; i < numSteps; i++) {
            const sy = -dPx / 2 + (dPx * i) / numSteps;
            stGroup.add(
              new Konva.Line({
                points: [-wPx / 2, sy, wPx / 2, sy],
                stroke: "#92400e",
                strokeWidth: 1.0,
              })
            );
          }
          stGroup.add(
            new Konva.Arrow({
              points: [0, dPx * 0.35, 0, -dPx * 0.35],
              pointerLength: 5,
              pointerWidth: 5,
              stroke: "#78350f",
              fill: "#78350f",
              strokeWidth: 1.3,
            })
          );
        }

        stGroup.add(
          new Konva.Text({
            x: -wPx / 2,
            y: -dPx / 2 - 12,
            width: wPx + 30,
            text: st.name || "STAIRS",
            fontSize: 8.5,
            fontFamily: "IBM Plex Mono",
            fontStyle: "bold",
            fill: "#78350f",
            listening: false,
          })
        );

        stGroup.on("click", (ev) => {
          ev.cancelBubble = true;
          if (this.isDrawingTool()) return;
          this.store.selectObject("stair", st.id);
        });

        stGroup.on("dragend", () => {
          if (isParametricStair(st)) {
            const dx = stGroup.x();
            const dy = stGroup.y();
            stGroup.position({ x: 0, y: 0 });
            this.store.translateParametricStair(st.id, { dx, dy });
            this.renderAll();
            return;
          }
          this.store.pushHistorySnapshot();
          const dx = stGroup.x() - st.x_px;
          const dy = stGroup.y() - st.y_px;
          st.x_px = Math.round(stGroup.x() * 10) / 10;
          st.y_px = Math.round(stGroup.y() * 10) / 10;
          if (st.bbox_px && st.bbox_px.length === 4) {
            st.bbox_px = [
              Math.round((st.bbox_px[0] + dx) * 10) / 10,
              Math.round((st.bbox_px[1] + dy) * 10) / 10,
              Math.round((st.bbox_px[2] + dx) * 10) / 10,
              Math.round((st.bbox_px[3] + dy) * 10) / 10,
            ];
          }
          this.store.emit("geometryChanged", { source: "moveStair" });
        });

        this.cmeLayer.add(stGroup);
      }
    }

    // 3. Render Telco CME / MEP Equipments (Stage 5)
    if (layers.equipments) {
      const catColors = {
        rack: { fill: "rgba(30, 57, 50, 0.85)", stroke: "#00754A" },
        ups: { fill: "rgba(126, 34, 206, 0.72)", stroke: "#c084fc" },
        battery: { fill: "rgba(180, 83, 9, 0.75)", stroke: "#fbbf24" },
        rectifier: { fill: "rgba(3, 105, 161, 0.75)", stroke: "#38bdf8" },
        panel: { fill: "rgba(185, 28, 28, 0.78)", stroke: "#f87171" },
        pac: { fill: "rgba(4, 120, 87, 0.78)", stroke: "#34d399" },
      };

      for (const eq of this.store.project.equipments) {
        const isSelected = sel?.kind === "equipment" && sel?.id === eq.id;
        const wPx = Math.max(14, (eq.width_m || 1.2) * scale);
        const dPx = Math.max(12, (eq.depth_m || 0.9) * scale);
        const style = catColors[eq.category] || catColors.rack;

        const eqGroup = new Konva.Group({
          x: eq.x_px,
          y: eq.y_px,
          rotation: eq.rotation_deg || 0,
          draggable: true,
        });

        eqGroup.add(
          new Konva.Rect({
            x: -wPx / 2,
            y: -dPx / 2,
            width: wPx,
            height: dPx,
            fill: style.fill,
            stroke: isSelected ? "#cba258" : style.stroke,
            strokeWidth: isSelected ? 2.5 : 1.4,
            cornerRadius: 2,
          })
        );

        eqGroup.add(
          new Konva.Text({
            x: -wPx / 2 + 2,
            y: -5,
            width: wPx - 4,
            align: "center",
            text: eq.name,
            fontSize: 8,
            fontFamily: "IBM Plex Mono",
            fill: "#ffffff",
            wrap: "none",
            ellipsis: true,
          })
        );

        eqGroup.on("click", (ev) => {
          ev.cancelBubble = true;
          this.store.selectObject("equipment", eq.id);
        });

        eqGroup.on("dragend", () => {
          this.store.pushHistorySnapshot();
          eq.x_px = Math.round(eqGroup.x() * 10) / 10;
          eq.y_px = Math.round(eqGroup.y() * 10) / 10;
          this.store.emit("geometryChanged", { source: "moveEquipment" });
        });

        this.cmeLayer.add(eqGroup);
      }
    }

    this.cmeLayer.batchDraw();
  }

  // ==================== ROI CROP BOX (EXCLUDES KOP SURAT) ====================
  renderRoiOverlay() {
    this.roiLayer.destroyChildren();
    if (!this.store.ui.layers.roi) {
      this.roiLayer.batchDraw();
      return;
    }

    const roi = this.store.project.metadata.roi_px;
    if (!roi) return;

    const isRoiTool = this.store.ui.activeTool === "roi";

    const roiRect = new Konva.Rect({
      x: roi.x,
      y: roi.y,
      width: roi.width,
      height: roi.height,
      stroke: "#00754A",
      strokeWidth: isRoiTool ? 2.4 : 1.5,
      dash: [10, 6],
      fill: isRoiTool ? "rgba(0, 117, 74, 0.04)" : "transparent",
      draggable: isRoiTool,
      listening: isRoiTool,
    });

    const badge = new Konva.Text({
      x: roi.x + 8,
      y: Math.max(4, roi.y - 18),
      text: `ACTIVE EXTRACTION ROI (${Math.round(roi.width)} x ${Math.round(roi.height)} px — Excludes Kop Surat)`,
      fontSize: 10.5,
      fontFamily: "IBM Plex Mono",
      fontStyle: "bold",
      fill: "#006241",
      listening: false,
    });

    roiRect.on("dragend", () => {
      this.store.setRoi({
        x: roiRect.x(),
        y: roiRect.y(),
        width: roi.width,
        height: roi.height,
      });
    });

    this.roiLayer.add(roiRect);
    this.roiLayer.add(badge);

    if (isRoiTool) {
      const handleSE = new Konva.Circle({
        x: roi.x + roi.width,
        y: roi.y + roi.height,
        radius: 8,
        fill: "#00754A",
        stroke: "#ffffff",
        strokeWidth: 2,
        draggable: true,
      });

      handleSE.on("dragmove", () => {
        const newW = Math.max(120, handleSE.x() - roi.x);
        const newH = Math.max(120, handleSE.y() - roi.y);
        roiRect.width(newW);
        roiRect.height(newH);
      });

      handleSE.on("dragend", () => {
        this.store.setRoi({
          x: roi.x,
          y: roi.y,
          width: roiRect.width(),
          height: roiRect.height(),
        });
      });

      this.roiLayer.add(handleSE);
    }

    this.roiLayer.batchDraw();
  }

  // ==================== INTERACTIVE GHOST PREVIEW LAYER ====================
  renderTempOverlay(cursorPt) {
    this.overlayLayer.destroyChildren();
    const tool = this.store.ui.activeTool;

    if (tool === "wall" && this.wallDrag) {
      const preview = this.buildWallPreview({ x_px: cursorPt.x, y_px: cursorPt.y });
      if (preview.guideId) {
        const guide = (this.store.guideCandidates || []).find((g) => g.id === preview.guideId);
        const ga = guide ? (guide.start_px.x_px ?? guide.start_px.x) : null;
        const gb = guide ? (guide.end_px.x_px ?? guide.end_px.x) : null;
        if (guide && Number.isFinite(ga)) {
          this.overlayLayer.add(
            new Konva.Line({
              points: [ga, guide.start_px.y_px ?? guide.start_px.y, gb, guide.end_px.y_px ?? guide.end_px.y],
              stroke: "#cba258",
              strokeWidth: 2,
              dash: [9, 5],
              opacity: 0.9,
            })
          );
        }
      }
      this.overlayLayer.add(
        new Konva.Line({
          points: [
            preview.startPx.x_px,
            preview.startPx.y_px,
            preview.endPx.x_px,
            preview.endPx.y_px,
          ],
          stroke: preview.valid ? "#00754A" : "#d62b1f",
          strokeWidth: 4,
          dash: [6, 4],
          lineCap: "round",
        })
      );
      for (const point of [preview.startPx, preview.endPx]) {
        this.overlayLayer.add(
          new Konva.Circle({
            x: point.x_px,
            y: point.y_px,
            radius: 5 / Math.max(0.15, this.stage.scaleX()),
            fill: preview.valid ? "#cba258" : "#d62b1f",
            stroke: "#006241",
            strokeWidth: 1.4,
          })
        );
      }
      this.overlayLayer.add(
        new Konva.Text({
          x: preview.endPx.x_px + 10,
          y: preview.endPx.y_px - 14,
          text: preview.feedback,
          fontSize: 10 / Math.max(0.3, this.stage.scaleX()),
          fontFamily: "IBM Plex Mono",
          fontStyle: "bold",
          fill: preview.valid ? "#006241" : "#b91c1c",
          listening: false,
        })
      );
    } else if (tool === "stair" && this.stairDraft) {
      const defaults = this.store.ui.stairDefaults || {};
      const preview = this.store.previewParametricStair({
        ...defaults,
        start_px: this.stairDraft.startPx,
        end_px: { x_px: cursorPt.x, y_px: cursorPt.y },
      });
      if (!preview.ok) {
        this.overlayLayer.add(
          new Konva.Line({
            points: [
              this.stairDraft.startPx.x_px,
              this.stairDraft.startPx.y_px,
              cursorPt.x,
              cursorPt.y,
            ],
            stroke: "#d62b1f",
            strokeWidth: 2,
            dash: [6, 4],
          })
        );
        this.overlayLayer.add(
          new Konva.Text({
            x: cursorPt.x + 10,
            y: cursorPt.y - 14,
            text: preview.error?.message || "Konfigurasi tangga tidak feasible.",
            fontSize: 10 / Math.max(0.3, this.stage.scaleX()),
            fontFamily: "IBM Plex Mono",
            fill: "#b91c1c",
          })
        );
      } else {
        this.drawStairGeometry(preview.geometry, this.overlayLayer, { preview: true });
        this.overlayLayer.add(
          new Konva.Text({
            x: preview.geometry.bounds_px.x_min,
            y: preview.geometry.bounds_px.y_min - 16,
            text: `${preview.stair.shape.toUpperCase()} · ${preview.stair.steps} risers · ${preview.stair.width_m.toFixed(2)} m`,
            fontSize: 10 / Math.max(0.3, this.stage.scaleX()),
            fontFamily: "IBM Plex Mono",
            fontStyle: "bold",
            fill: "#006241",
          })
        );
      }
    } else if (tool === "ruler" && this.rulerPoints.length === 1) {
      const p1 = this.rulerPoints[0];
      const distPx = Math.hypot(cursorPt.x - p1.x, cursorPt.y - p1.y);
      this.overlayLayer.add(
        new Konva.Line({
          points: [p1.x, p1.y, cursorPt.x, cursorPt.y],
          stroke: "#cba258",
          strokeWidth: 2.5,
          dash: [5, 3],
        })
      );
      this.overlayLayer.add(
        new Konva.Text({
          x: (p1.x + cursorPt.x) / 2 + 8,
          y: (p1.y + cursorPt.y) / 2 - 14,
          text: `${distPx.toFixed(1)} px`,
          fontSize: 12,
          fontFamily: "IBM Plex Mono",
          fontStyle: "bold",
          fill: "#006241",
        })
      );
    } else if (tool === "room" && this.roomDragStart) {
      const x = Math.min(this.roomDragStart.x, cursorPt.x);
      const y = Math.min(this.roomDragStart.y, cursorPt.y);
      const w = Math.abs(cursorPt.x - this.roomDragStart.x);
      const h = Math.abs(cursorPt.y - this.roomDragStart.y);
      this.overlayLayer.add(
        new Konva.Rect({
          x,
          y,
          width: w,
          height: h,
          fill: "rgba(0, 117, 74, 0.14)",
          stroke: "#00754A",
          strokeWidth: 2,
          dash: [6, 4],
        })
      );
    } else if (tool === "tray" && this.trayDraftPoints.length > 0) {
      const pts = [...this.trayDraftPoints.flat(), cursorPt.x, cursorPt.y];
      this.overlayLayer.add(
        new Konva.Line({
          points: pts,
          stroke: "#cba258",
          strokeWidth: 6,
          opacity: 0.75,
          dash: [8, 4],
        })
      );
    }

    this.overlayLayer.batchDraw();
  }
}
