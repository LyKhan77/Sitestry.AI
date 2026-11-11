/**
 * Sitestry.AI — 5-Stage Segmented Studio Application Controller (v3.0)
 * Coordinates the 5-Stage Workflow:
 *   1. Input (Sample Selection, PDF Page Picker, ROI Crop Box, Metric Scale Calibration)
 *   2. Process Extraction (Procedural Vision & CAD Vector Extraction Pipeline)
 *   3. Review Annotation (Human-in-the-Loop 2D CAD Editor for Walls, Doors+Tags, Windows, Pillars, Stairs, Rooms)
 *   4. Build 3D (Real-Time CSG 3D Structural Digital Twin)
 *   5. Installation Equipment (Manual Telco CME & Cable Ladder Placement + BoQ & GLB Export)
 */

import { store } from "./store.js";
import { api } from "./api.js";
import { Canvas2DEngine } from "./canvas2d.js";
import { Viewer3DEngine } from "./viewer3d.js";

const TOOL_HINTS = {
  select:
    "Mode: <strong>Select / Move Vertex [V]</strong> — Geser titik sudut dinding, geser pintu di sepanjang dinding, atau klik elemen untuk edit properti.",
  roi: "Mode: <strong>ROI Crop Box [C]</strong> — Geser sudut kanan-bawah kotak hijau untuk mengecualikan Kop Surat / Title Block.",
  ruler:
    "Mode: <strong>2-Point Ruler [R]</strong> — Klik Titik A dan Titik B pada jarak yang diketahui (misal Grid Kolom 6000mm atau Tile 600mm).",
  wall: "Mode: <strong>Draw Wall [W]</strong> — Klik titik awal dan akhir untuk menggambar dinding berantai. Double-click atau Esc untuk selesai.",
  door: "Mode: <strong>Single Door [D]</strong> — Klik tepat pada segmen garis dinding untuk memasang Pintu Single beserta Swing Arc & Door Tag.",
  double_door:
    "Mode: <strong>Double Door [B]</strong> — Klik tepat pada segmen garis dinding untuk memasang Pintu Double (DD-xx).",
  window:
    "Mode: <strong>Add Window [N]</strong> — Klik tepat pada segmen garis dinding untuk memasang Jendela Kaca (W-xx).",
  column:
    "Mode: <strong>Add Pillar [P]</strong> — Klik pada denah untuk menempatkan Kolom Struktur H-Beam atau Beton.",
  stair:
    "Mode: <strong>Add Stairs [S]</strong> — Klik pada denah untuk menempatkan Tangga Arsitektural.",
  room: "Mode: <strong>Room Zone [Z]</strong> — Klik dua sudut berlawanan untuk membuat Zona Ruangan & Label 3D.",
  equipment:
    "Mode: <strong>Place CME Equipment [E]</strong> — Klik pada denah untuk memasang Rak Server 42U, UPS, Battery, Rectifier, Panel, atau PAC.",
  tray: "Mode: <strong>Draw 3D Cable Ladder [T]</strong> — Klik titik-titik jalur kabel; tekan Enter atau Double-Click untuk membangun 3D Ladder.",
};

const TELCO_ROOM_PRESETS = [
  "BATTERY ROOM",
  "UPS ROOM",
  "RECTIFIER ROOM",
  "CORE ROOM",
  "BSS / TRANSMISI ROOM",
  "GENSET ROOM",
  "TRAFO ROOM",
  "PANEL / LVMDP ROOM",
  "CAPACITOR ROOM",
  "CONTROL / NOC ROOM",
  "R. NAVA / DATA HALL",
  "KORIDOR / LOBBY",
  "TOILET / PANTRY",
];

class SitestryStudioApp {
  constructor() {
    this.canvas2d = new Canvas2DEngine("konvaContainer", store);
    this.viewer3d = new Viewer3DEngine("threeContainer", "labels3DOverlay", store);
    this.lastRulerPx = 184.1;

    this.initStageNavigation();
    this.initStage1InputControls();
    this.initStage2ExtractionControls();
    this.initStage3AnnotationControls();
    this.initStage4Build3DControls();
    this.initStage5EquipmentControls();
    this.initWorkspaceControls();
    this.initRulerPopover();
    this.initPdfModal();
    this.initKeyboardShortcuts();
    this.initSplitResizer();

    store.addEventListener("geometryChanged", () => {
      this.updateTelemetryAndStageMetrics();
      this.renderInspector();
    });
    store.addEventListener("selectionChanged", () => {
      this.renderInspector();
    });
    store.addEventListener("toolChanged", (e) => {
      this.syncActiveToolUI(e.detail.tool);
    });
    store.addEventListener("rulerCompleted", (e) => {
      this.openRulerPopover(e.detail.pxDist);
    });
    store.addEventListener("toast", (e) => {
      this.showToast(e.detail.message);
    });

    // Boot initial Gatsu Page 4 sample and extract structural layout
    this.bootInitialSample();
  }

  async bootInitialSample() {
    await this.loadSamplePreset("gatsu_p4", true);
    this.setWorkflowStage(1);
  }

  showToast(message) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = message;
    container.appendChild(div);
    setTimeout(() => {
      div.remove();
    }, 3600);
  }

  // ==================== 5-STAGE SEGMENTED NAVIGATION ====================
  initStageNavigation() {
    document.querySelectorAll(".step-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = Number(btn.dataset.step);
        this.setWorkflowStage(step);
      });
    });

    document.getElementById("btnNextToStage2")?.addEventListener("click", async () => {
      await this.runExtractionPipeline();
      this.setWorkflowStage(2);
    });

    document.getElementById("btnNextToStage3")?.addEventListener("click", () => {
      this.setWorkflowStage(3);
    });

    document.getElementById("btnNextToStage4")?.addEventListener("click", () => {
      this.setWorkflowStage(4);
    });

    document.getElementById("btnNextToStage5")?.addEventListener("click", () => {
      this.setWorkflowStage(5);
    });

    document.getElementById("btnExportJson")?.addEventListener("click", () => {
      this.exportProjectJson();
    });
    document.getElementById("btnExportGlb")?.addEventListener("click", () => {
      this.viewer3d.exportGLB(`${store.project.project_id || "sitestry_3d"}.glb`);
      this.showToast("Mengekspor 3D Digital Twin ke format .GLB...");
    });
  }

  setWorkflowStage(step) {
    store.ui.step = step;
    document.body.dataset.stage = String(step);

    // Update top stepper buttons
    document.querySelectorAll(".step-item").forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle("active", s === step);
      el.classList.toggle("completed", s < step);
    });

    // Switch Left Sidebar Stage Panel
    for (let i = 1; i <= 5; i++) {
      const panel = document.getElementById(`stagePanel${i}`);
      if (panel) panel.classList.toggle("active", i === step);
    }

    const badge2D = document.getElementById("lblPane2DBadge");

    if (step === 1) {
      // Stage 1: Input & Calibration -> Clean 2D view focused on Blueprint & ROI
      store.ui.layers.walls = false;
      store.ui.layers.columns = false;
      store.ui.layers.rooms = false;
      store.ui.layers.trays = false;
      store.ui.layers.equipments = false;
      store.ui.layers.roi = true;
      if (badge2D) badge2D.textContent = "STAGE 1: 2D BLUEPRINT & ROI CALIBRATION";
      this.setViewMode("2d");
      store.setActiveTool("roi");
    } else if (step === 2) {
      // Stage 2: Process Extraction -> Show extracted structural overlay in 2D
      store.ui.layers.walls = true;
      store.ui.layers.columns = true;
      store.ui.layers.rooms = true;
      store.ui.layers.trays = true;
      store.ui.layers.equipments = false;
      store.ui.layers.roi = true;
      if (badge2D) badge2D.textContent = "STAGE 2: PROCEDURAL VISION & CAD EXTRACTION PREVIEW";
      this.setViewMode("2d");
      store.setActiveTool("select");
    } else if (step === 3) {
      // Stage 3: Review Annotation -> Full 2D Structural CAD Editor + Right Inspector
      store.ui.layers.walls = true;
      store.ui.layers.columns = true;
      store.ui.layers.rooms = true;
      store.ui.layers.trays = true;
      store.ui.layers.equipments = false;
      store.ui.layers.roi = false;
      if (badge2D) badge2D.textContent = "STAGE 3: REVIEW ANNOTATION (2D CAD STRUCTURAL EDITOR)";
      this.setViewMode("2d");
      store.setActiveTool("select");
    } else if (step === 4) {
      // Stage 4: Build 3D -> 3D Structural Digital Twin Viewport
      store.ui.layers.walls = true;
      store.ui.layers.columns = true;
      store.ui.layers.rooms = true;
      store.ui.layers.trays = true;
      store.ui.layers.equipments = store.project.equipments.length > 0;
      if (badge2D) badge2D.textContent = "STAGE 4: 2D / 3D STRUCTURAL SYNC";
      this.setViewMode("3d");
      store.setActiveTool("select");
      this.viewer3d.rebuildScene();
    } else if (step === 5) {
      // Stage 5: Installation Equipment -> Split 2D | 3D Sync for Manual Equipment Placement
      store.ui.layers.walls = true;
      store.ui.layers.columns = true;
      store.ui.layers.rooms = true;
      store.ui.layers.trays = true;
      store.ui.layers.equipments = true;
      if (badge2D) badge2D.textContent = "STAGE 5: MANUAL CME & CABLE LADDER INSTALLATION";
      this.setViewMode("split");
      store.setActiveTool("equipment");
      this.viewer3d.rebuildScene();
    }

    this.syncLayerCheckboxes();
    this.canvas2d.renderAll();
    this.updateTelemetryAndStageMetrics();
    this.renderInspector();

    setTimeout(() => {
      this.canvas2d.resize();
      this.canvas2d.zoomToFit();
      this.viewer3d.resize();
    }, 60);
  }

  // ==================== STAGE 1: INPUT & CALIBRATION ====================
  initStage1InputControls() {
    const btnGatsuPdf = document.getElementById("btnSampleGatsuPdf");
    const btnAncolPdf = document.getElementById("btnSampleAncolPdf");
    const btnGatsuJpg = document.getElementById("btnSampleGatsuJpg");
    const fileInput = document.getElementById("fileUploadInput");

    const setSampleCardActive = (btn) => {
      [btnGatsuPdf, btnAncolPdf, btnGatsuJpg].forEach((b) => b?.classList.remove("active"));
      if (btn) btn.classList.add("active");
    };

    btnGatsuPdf?.addEventListener("click", async () => {
      setSampleCardActive(btnGatsuPdf);
      await this.loadSamplePreset("gatsu_p4", true);
    });

    btnAncolPdf?.addEventListener("click", async () => {
      setSampleCardActive(btnAncolPdf);
      await this.loadSamplePreset("ancol_p13", true);
    });

    btnGatsuJpg?.addEventListener("click", async () => {
      setSampleCardActive(btnGatsuJpg);
      await this.loadSamplePreset("gatsu_jpeg", true);
    });

    fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSampleCardActive(null);
      store.uploadedFile = file;
      store.activeSampleId = null;

      if (file.name.toLowerCase().endsWith(".pdf")) {
        this.showToast(`Memeriksa halaman PDF "${file.name}"...`);
        try {
          const info = await api.inspectPdf(file);
          this.openPdfModalWithPages(file.name, info.pages, async (chosenPage) => {
            await this.loadUploadedPdfPage(file, chosenPage);
          });
        } catch (err) {
          this.showToast("Merender Halaman 1...");
          await this.loadUploadedPdfPage(file, 1);
        }
      } else {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const img = new Image();
          img.onload = async () => {
            store.setBlueprint(ev.target.result, {
              title: file.name,
              image_width_px: img.width,
              image_height_px: img.height,
              page_number: 1,
              total_pages: 1,
              roi_px: {
                x: Math.round(img.width * 0.04),
                y: Math.round(img.height * 0.04),
                width: Math.round(img.width * 0.92),
                height: Math.round(img.height * 0.86),
              },
            });
            document.getElementById("lblCurrentPage").textContent = "1/1";
            this.showToast(`Gambar "${file.name}" (${img.width}x${img.height}px) berhasil dimuat.`);
            await this.runExtractionPipeline();
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    document.getElementById("btnAutoScale")?.addEventListener("click", async () => {
      const res = await api.detectGridScale({
        file: store.uploadedFile,
        sampleId: store.activeSampleId,
        pageNumber: store.project.metadata.page_number,
        roiPx: store.project.metadata.roi_px,
      });
      store.setScale(res.scale_px_per_meter);
      this.showToast(
        `Skala terkalibrasi otomatis: ${res.scale_px_per_meter} px/m (${res.method})`
      );
    });
  }

  async loadSamplePreset(sampleId, autoExtract = true, pageOverride = null) {
    store.activeSampleId = sampleId;
    store.uploadedFile = null;
    this.showToast(`Memuat Floorplan Sample: ${sampleId}...`);

    const data = await api.loadSample(sampleId, pageOverride);
    store.setBlueprint(data.image_data_url, {
      title: data.title,
      image_width_px: data.image_width_px,
      image_height_px: data.image_height_px,
      scale_px_per_meter: data.scale_px_per_meter,
      page_number: data.page_number,
      total_pages: data.total_pages,
      roi_px: data.roi_px,
    });

    document.getElementById("lblCurrentPage").textContent = `${data.page_number}/${data.total_pages}`;

    if (autoExtract) {
      await this.runExtractionPipeline();
    }
  }

  async loadUploadedPdfPage(file, pageNumber) {
    this.showToast(`Merender PDF Halaman ${pageNumber}...`);
    const data = await api.renderPdfPage(file, pageNumber);
    store.setBlueprint(data.image_data_url, {
      title: `${file.name} (Hal. ${data.page_number})`,
      image_width_px: data.image_width_px,
      image_height_px: data.image_height_px,
      scale_px_per_meter: data.scale_px_per_meter,
      page_number: data.page_number,
      total_pages: data.total_pages,
      roi_px: data.roi_px,
    });
    document.getElementById("lblCurrentPage").textContent = `${data.page_number}/${data.total_pages}`;
    await this.runExtractionPipeline();
  }

  async runExtractionPipeline() {
    const layout = await api.extractLayout({
      file: store.uploadedFile,
      sampleId: store.activeSampleId,
      pageNumber: store.project.metadata.page_number,
      scalePxPerMeter: store.project.metadata.scale_px_per_meter,
      roiPx: store.project.metadata.roi_px,
    });
    store.loadProjectData(layout, true);
    const doors = layout.openings.filter((o) => o.type !== "window").length;
    const wins = layout.openings.filter((o) => o.type === "window").length;
    this.showToast(
      `Ekstraksi Selesai: ${layout.walls.length} Dinding, ${doors} Pintu, ${wins} Jendela, ${layout.columns.length} Pilar & ${layout.stairs.length} Tangga.`
    );
  }

  // ==================== STAGE 2: PROCESS EXTRACTION ====================
  initStage2ExtractionControls() {
    document.getElementById("btnRunExtract")?.addEventListener("click", async () => {
      await this.runExtractionPipeline();
    });

    const rng2 = document.getElementById("rngStage2Opacity");
    const lbl2 = document.getElementById("lblStage2Opacity");
    rng2?.addEventListener("input", () => {
      const v = Number(rng2.value);
      if (lbl2) lbl2.textContent = `${v}%`;
      store.ui.blueprintOpacity = v / 100;
      const rng3 = document.getElementById("rngBlueprintOpacity");
      const lbl3 = document.getElementById("lblBlueprintOpacity");
      if (rng3) rng3.value = String(v);
      if (lbl3) lbl3.textContent = `${v}%`;
      this.canvas2d.renderAll();
    });
  }

  // ==================== STAGE 3: REVIEW ANNOTATION (2D CAD EDITOR) ====================
  initStage3AnnotationControls() {
    document.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        store.setActiveTool(btn.dataset.tool);
      });
    });

    document.getElementById("btnUndo")?.addEventListener("click", () => {
      if (store.undo()) this.showToast("Undo diterapkan.");
    });
    document.getElementById("btnRedo")?.addEventListener("click", () => {
      if (store.redo()) this.showToast("Redo diterapkan.");
    });
    document.getElementById("btnDeleteSelected")?.addEventListener("click", () => {
      if (store.deleteSelected()) this.showToast("Elemen terpilih dihapus.");
    });

    const bindLayerCheck = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        store.ui.layers[key] = el.checked;
        this.canvas2d.renderAll();
        this.viewer3d.rebuildScene();
      });
    };

    bindLayerCheck("chkLayerBlueprint", "blueprint");
    bindLayerCheck("chkLayerRoi", "roi");
    bindLayerCheck("chkLayerWalls", "walls");
    bindLayerCheck("chkLayerColumns", "columns");
    bindLayerCheck("chkLayerRooms", "rooms");
    bindLayerCheck("chkLayerEquipments", "equipments");
    bindLayerCheck("chkLayerTrays", "trays");
    bindLayerCheck("chkLayerGrid", "grid");

    const rngOpacity = document.getElementById("rngBlueprintOpacity");
    const lblOpacity = document.getElementById("lblBlueprintOpacity");
    rngOpacity?.addEventListener("input", () => {
      const v = Number(rngOpacity.value);
      if (lblOpacity) lblOpacity.textContent = `${v}%`;
      store.ui.blueprintOpacity = v / 100;
      this.canvas2d.renderAll();
    });

    document.getElementById("chkOrthoSnap")?.addEventListener("change", (e) => {
      store.ui.orthoSnap = e.target.checked;
    });
  }

  syncLayerCheckboxes() {
    const map = {
      chkLayerBlueprint: "blueprint",
      chkLayerRoi: "roi",
      chkLayerWalls: "walls",
      chkLayerColumns: "columns",
      chkLayerRooms: "rooms",
      chkLayerEquipments: "equipments",
      chkLayerTrays: "trays",
      chkLayerGrid: "grid",
    };
    Object.entries(map).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(store.ui.layers[key]);
    });
  }

  syncActiveToolUI(tool) {
    document.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    const hintEl = document.getElementById("lblActiveToolHint");
    if (hintEl && TOOL_HINTS[tool]) {
      hintEl.innerHTML = TOOL_HINTS[tool];
    }
  }

  // ==================== STAGE 4: BUILD 3D CONTROLS ====================
  initStage4Build3DControls() {
    document.getElementById("btnStage4CamIso")?.addEventListener("click", () => {
      this.setViewMode("3d");
      this.viewer3d.setCameraPreset("perspective");
    });
    document.getElementById("btnStage4CamTop")?.addEventListener("click", () => {
      this.setViewMode("3d");
      this.viewer3d.setCameraPreset("top");
    });
    document.getElementById("btnStage4CamWalk")?.addEventListener("click", () => {
      this.setViewMode("3d");
      this.viewer3d.setCameraPreset("walk");
    });
    document.getElementById("btnStage4SplitSync")?.addEventListener("click", () => {
      this.setViewMode("split");
    });

    const btnLabels = document.getElementById("btnToggle3DLabels");
    btnLabels?.addEventListener("click", () => {
      store.ui.show3DLabels = !store.ui.show3DLabels;
      btnLabels.classList.toggle("active", store.ui.show3DLabels);
      this.viewer3d.update3DLabelsOverlay();
    });

    const btnXray = document.getElementById("btnToggleXray");
    btnXray?.addEventListener("click", () => {
      store.ui.xrayWalls = !store.ui.xrayWalls;
      btnXray.classList.toggle("active", store.ui.xrayWalls);
      this.viewer3d.rebuildScene();
    });
  }

  // ==================== STAGE 5: MANUAL INSTALLATION EQUIPMENT ====================
  initStage5EquipmentControls() {
    document.querySelectorAll(".eq-catalog-card").forEach((card) => {
      card.addEventListener("click", () => {
        document.querySelectorAll(".eq-catalog-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        store.ui.pendingEquipmentCategory = card.dataset.eqCat;
        store.setActiveTool("equipment");
        this.showToast(`Katalog aktif: ${card.querySelector("strong")?.textContent}. Klik pada denah 2D untuk memasang.`);
      });
    });

    document.getElementById("btnLoadPresetCme")?.addEventListener("click", () => {
      store.loadPresetTelcoEquipment();
      this.showToast("Contoh perangkat Telco CME & Cable Ladder berhasil dimuat.");
    });

    document.getElementById("btnStage5ExportGlb")?.addEventListener("click", () => {
      this.viewer3d.exportGLB(`${store.project.project_id || "sitestry_3d"}.glb`);
      this.showToast("Mengekspor 3D Digital Twin (.GLB)...");
    });
  }

  exportProjectJson() {
    const dataStr = JSON.stringify(store.project, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${store.project.project_id || "sitestry_layout"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast("File JSON Schema Sitestry.AI v3.0 berhasil diunduh.");
  }

  // ==================== WORKSPACE VIEW SWITCHER & SPLIT RESIZER ====================
  initWorkspaceControls() {
    document.querySelectorAll(".view-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setViewMode(btn.dataset.view);
      });
    });

    document.getElementById("btnZoomFit2D")?.addEventListener("click", () => {
      this.canvas2d.zoomToFit();
    });
    document.getElementById("btnCamPerspective")?.addEventListener("click", () => {
      this.viewer3d.setCameraPreset("perspective");
    });
    document.getElementById("btnCamTop")?.addEventListener("click", () => {
      this.viewer3d.setCameraPreset("top");
    });
    document.getElementById("btnCamWalk")?.addEventListener("click", () => {
      this.viewer3d.setCameraPreset("walk");
    });
  }

  setViewMode(mode) {
    store.ui.viewMode = mode;
    const container = document.getElementById("splitContainer");
    if (container) container.dataset.mode = mode;

    document.querySelectorAll(".view-mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === mode);
    });

    setTimeout(() => {
      this.canvas2d.resize();
      this.viewer3d.resize();
    }, 35);
  }

  initSplitResizer() {
    const divider = document.getElementById("splitDivider");
    const pane2D = document.getElementById("pane2D");
    const container = document.getElementById("splitContainer");
    if (!divider || !pane2D || !container) return;

    let dragging = false;
    divider.addEventListener("mousedown", () => {
      dragging = true;
      document.body.style.cursor = "col-resize";
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const pct = Math.max(24, Math.min(76, (relX / rect.width) * 100));
      pane2D.style.width = `${pct}%`;
      this.canvas2d.resize();
      this.viewer3d.resize();
    });

    window.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = "default";
      }
    });

    window.addEventListener("resize", () => {
      this.canvas2d.resize();
      this.viewer3d.resize();
    });
  }

  // ==================== 2-POINT RULER POPOVER ====================
  initRulerPopover() {
    const popover = document.getElementById("rulerPopover");
    const inpVal = document.getElementById("inpRulerValue");
    const selUnit = document.getElementById("selRulerUnit");

    document.querySelectorAll(".chip-btn").forEach((chip) => {
      chip.addEventListener("click", () => {
        inpVal.value = chip.dataset.val;
        selUnit.value = chip.dataset.unit;
      });
    });

    document.getElementById("btnCancelRuler")?.addEventListener("click", () => {
      popover.classList.add("hidden");
      this.canvas2d.clearTempDrawing();
    });

    document.getElementById("btnApplyRuler")?.addEventListener("click", () => {
      const rawVal = parseFloat(inpVal.value);
      if (!rawVal || rawVal <= 0) return;
      const meters = selUnit.value === "mm" ? rawVal / 1000.0 : rawVal;
      const newScale = this.lastRulerPx / meters;
      store.setScale(newScale);
      popover.classList.add("hidden");
      this.canvas2d.clearTempDrawing();
      store.setActiveTool("select");
      this.showToast(`Skala metrik diperbarui: ${newScale.toFixed(2)} px/meter.`);
    });
  }

  openRulerPopover(pxDist) {
    this.lastRulerPx = pxDist;
    document.getElementById("lblRulerPx").textContent = `${pxDist.toFixed(1)} px`;
    document.getElementById("rulerPopover").classList.remove("hidden");
  }

  // ==================== PDF PAGE PICKER MODAL ====================
  initPdfModal() {
    const modal = document.getElementById("pdfPageModal");
    document.getElementById("btnClosePdfModal")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    document.getElementById("btnPagePicker")?.addEventListener("click", () => {
      const total = store.project.metadata.total_pages || 1;
      const current = store.project.metadata.page_number || 1;
      const pages = Array.from({ length: total }, (_, i) => ({
        page_number: i + 1,
        thumbnail_url: null,
      }));
      this.openPdfModalWithPages(
        store.project.project_name,
        pages,
        async (chosenPage) => {
          if (store.uploadedFile) {
            await this.loadUploadedPdfPage(store.uploadedFile, chosenPage);
          } else if (store.activeSampleId) {
            await this.loadSamplePreset(store.activeSampleId, true, chosenPage);
          }
        },
        current
      );
    });
  }

  openPdfModalWithPages(filename, pages, onSelectPage, currentPage = 1) {
    const modal = document.getElementById("pdfPageModal");
    const grid = document.getElementById("pdfThumbnailsGrid");
    const inpQuick = document.getElementById("inpQuickPageNum");
    document.getElementById("lblModalPdfFilename").textContent = filename;
    inpQuick.value = currentPage;
    inpQuick.max = pages.length;

    grid.innerHTML = "";
    pages.forEach((p) => {
      const isRec = p.page_number === 4 || p.page_number === 13 || p.page_number === currentPage;
      const card = document.createElement("div");
      card.className = `pdf-thumb-card ${isRec ? "recommended" : ""}`;
      card.innerHTML = `
        ${
          p.thumbnail_url
            ? `<img src="${p.thumbnail_url}" alt="Page ${p.page_number}" />`
            : `<div style="height:75px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);color:#006241;font-size:16px;font-weight:700;">HAL ${p.page_number}</div>`
        }
        <div class="pdf-thumb-title">Hal. ${p.page_number} ${
          p.page_number === 13 ? "★ Ancol" : p.page_number === 4 ? "★ Gatsu" : ""
        }</div>
      `;
      card.addEventListener("click", () => {
        modal.classList.add("hidden");
        onSelectPage(p.page_number);
      });
      grid.appendChild(card);
    });

    const btnConfirm = document.getElementById("btnConfirmPageNum");
    btnConfirm.onclick = () => {
      const pNum = Math.max(1, Math.min(pages.length, parseInt(inpQuick.value, 10) || 1));
      modal.classList.add("hidden");
      onSelectPage(pNum);
    };

    modal.classList.remove("hidden");
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  initKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        store.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "y") {
        e.preventDefault();
        store.redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (store.deleteSelected()) {
          this.showToast("Elemen terpilih dihapus.");
        }
        return;
      }

      const map = {
        v: "select",
        c: "roi",
        r: "ruler",
        w: "wall",
        d: "door",
        b: "double_door",
        n: "window",
        p: "column",
        s: "stair",
        z: "room",
        e: "equipment",
        t: "tray",
      };
      if (map[key]) {
        store.setActiveTool(map[key]);
      }
    });
  }

  // ==================== TELEMETRY & STAGE METRICS ====================
  updateTelemetryAndStageMetrics() {
    const p = store.project;
    const boq = store.computeBoQSummary();

    const lblProj = document.getElementById("lblStatusProject");
    const lblScale = document.getElementById("lblStatusScale");
    const lblStage1Scale = document.getElementById("lblStage1Scale");
    const lblCounts = document.getElementById("lblStatusCounts");

    if (lblProj) lblProj.textContent = p.project_name;
    if (lblScale) lblScale.textContent = `${p.metadata.scale_px_per_meter} px/m`;
    if (lblStage1Scale) lblStage1Scale.textContent = `${p.metadata.scale_px_per_meter} px/m`;
    if (lblCounts) {
      lblCounts.textContent = `${p.walls.length} Walls | ${boq.doorsCount} Doors | ${boq.windowsCount} Windows | ${p.columns.length} Pillars | ${p.stairs.length} Stairs`;
    }

    // Update Stage 2 Pipeline Counters
    const sWalls = document.getElementById("statPipeWalls");
    const sDoors = document.getElementById("statPipeDoors");
    const sWins = document.getElementById("statPipeWindows");
    const sStairsCols = document.getElementById("statPipeStairsCols");
    if (sWalls) sWalls.textContent = `${p.walls.length} Walls • ${p.rooms.length} Rooms`;
    if (sDoors) sDoors.textContent = `${boq.doorsCount} Doors`;
    if (sWins) sWins.textContent = `${boq.windowsCount} Windows`;
    if (sStairsCols) sStairsCols.textContent = `${p.columns.length} Pillars • ${p.stairs.length} Stairs`;

    // Update Stage 4 Structural Summary Grid
    const s4Grid = document.getElementById("stage4SummaryGrid");
    if (s4Grid) {
      s4Grid.innerHTML = `
        <div class="boq-box">
          <div class="boq-val">${boq.solidWallMeters} m</div>
          <div class="boq-lbl">Panjang Dinding</div>
        </div>
        <div class="boq-box">
          <div class="boq-val">${boq.doorsCount} / ${boq.windowsCount}</div>
          <div class="boq-lbl">Pintu / Jendela</div>
        </div>
        <div class="boq-box">
          <div class="boq-val">${boq.columnsCount} unit</div>
          <div class="boq-lbl">Pilar Struktur</div>
        </div>
        <div class="boq-box">
          <div class="boq-val">${boq.stairsCount} unit</div>
          <div class="boq-lbl">Tangga (Stairs)</div>
        </div>
      `;
    }
  }

  // ==================== CONTEXTUAL PROPERTY INSPECTOR ====================
  renderInspector() {
    const container = document.getElementById("inspectorContent");
    const badge = document.getElementById("lblSelectedBadge");
    if (!container || !badge) return;

    const sel = store.ui.selected;
    const obj = store.getSelectedObject();

    if (!sel || !obj) {
      badge.textContent = "PROJECT BOQ SUMMARY";
      const boq = store.computeBoQSummary();
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Ringkasan Struktur &amp; BoQ</div>
          <div class="boq-stat-grid">
            <div class="boq-box">
              <div class="boq-val">${boq.solidWallMeters} m</div>
              <div class="boq-lbl">Dinding Beton/Bata</div>
            </div>
            <div class="boq-box">
              <div class="boq-val">${boq.doorsCount} unit</div>
              <div class="boq-lbl">Pintu (Single/Double)</div>
            </div>
            <div class="boq-box">
              <div class="boq-val">${boq.windowsCount} unit</div>
              <div class="boq-lbl">Jendela (Glazing)</div>
            </div>
            <div class="boq-box">
              <div class="boq-val">${boq.columnsCount} / ${boq.stairsCount}</div>
              <div class="boq-lbl">Pilar / Tangga</div>
            </div>
            <div class="boq-box">
              <div class="boq-val">${boq.raisedFloorAreaM2} m&sup2;</div>
              <div class="boq-lbl">Raised Floor (${boq.raisedFloorTiles} tile)</div>
            </div>
            <div class="boq-box">
              <div class="boq-val">${boq.equipmentsCount} unit</div>
              <div class="boq-lbl">Perangkat CME (Stage 5)</div>
            </div>
          </div>
        </div>

        <div class="insp-card">
          <div class="insp-title">Parameter Global Proyek</div>
          <div class="insp-field">
            <label>Nama Proyek</label>
            <input type="text" id="inpGlobalProjName" value="${store.project.project_name}" />
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Skala (px / meter)</label>
              <input type="number" id="inpGlobalScale" step="0.1" value="${store.project.metadata.scale_px_per_meter}" />
            </div>
            <div class="insp-field">
              <label>Tinggi Dinding (m)</label>
              <input type="number" id="inpGlobalWallH" step="0.1" value="${store.project.metadata.default_wall_height_m}" />
            </div>
          </div>
        </div>
      `;

      document.getElementById("inpGlobalProjName")?.addEventListener("change", (e) => {
        store.project.project_name = e.target.value;
        this.updateTelemetryAndStageMetrics();
      });
      document.getElementById("inpGlobalScale")?.addEventListener("change", (e) => {
        store.setScale(parseFloat(e.target.value));
      });
      document.getElementById("inpGlobalWallH")?.addEventListener("change", (e) => {
        store.project.metadata.default_wall_height_m = parseFloat(e.target.value) || 3.8;
      });
      return;
    }

    badge.textContent = `${sel.kind.toUpperCase()} #${obj.id}`;

    if (sel.kind === "wall") {
      const n1 = store.getNodeById(obj.start_node);
      const n2 = store.getNodeById(obj.end_node);
      const scale = store.project.metadata.scale_px_per_meter || 30.68;
      const lenM = n1 && n2 ? (Math.hypot(n2.x_px - n1.x_px, n2.y_px - n1.y_px) / scale).toFixed(2) : "0.00";

      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Properti Segmen Dinding</div>
          <div class="insp-field">
            <label>Label Dinding</label>
            <input type="text" id="inpWallLabel" value="${obj.label || "Concrete Wall"}" />
          </div>
          <div class="insp-field">
            <label>Tipe Material Dinding</label>
            <select id="selWallType">
              <option value="solid" ${obj.type === "solid" ? "selected" : ""}>Dinding Beton / Bata Solid</option>
              <option value="cage_mesh" ${obj.type === "cage_mesh" ? "selected" : ""}>Partisi Wiremesh Cage</option>
              <option value="glass" ${obj.type === "glass" ? "selected" : ""}>Partisi Kaca (NOC / Lobby)</option>
            </select>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Tinggi (m)</label>
              <input type="number" id="inpWallH" step="0.1" value="${obj.height_m}" />
            </div>
            <div class="insp-field">
              <label>Tebal (m)</label>
              <input type="number" id="inpWallT" step="0.02" value="${obj.thickness_m}" />
            </div>
          </div>
          <div class="insp-field">
            <label>Panjang Metrik</label>
            <input type="text" value="${lenM} meter" disabled />
          </div>
          <div class="insp-btn-group">
            <button id="btnSplitWall" class="insp-action-btn">&#9986; Bagi Dinding Menjadi 2 Segmen</button>
            <button id="btnAddSingleDoorWall" class="insp-action-btn">+ Pasang Pintu Single di Dinding Ini</button>
            <button id="btnAddDoubleDoorWall" class="insp-action-btn">+ Pasang Pintu Double di Dinding Ini</button>
            <button id="btnAddWindowWall" class="insp-action-btn">+ Pasang Jendela di Dinding Ini</button>
            <button id="btnDelObj" class="insp-action-btn danger">Hapus Segmen Dinding</button>
          </div>
        </div>
      `;

      document.getElementById("inpWallLabel").onchange = (e) => store.updateSelectedProperty({ label: e.target.value });
      document.getElementById("selWallType").onchange = (e) =>
        store.updateSelectedProperty({
          type: e.target.value,
          thickness_m: e.target.value === "cage_mesh" ? 0.08 : 0.2,
        });
      document.getElementById("inpWallH").onchange = (e) =>
        store.updateSelectedProperty({ height_m: parseFloat(e.target.value) || 3.8 });
      document.getElementById("inpWallT").onchange = (e) =>
        store.updateSelectedProperty({ thickness_m: parseFloat(e.target.value) || 0.2 });
      document.getElementById("btnSplitWall").onclick = () => store.splitWall(obj.id);
      document.getElementById("btnAddSingleDoorWall").onclick = () => {
        if (n1 && n2) store.addOpeningOnNearestWall((n1.x_px + n2.x_px) / 2, (n1.y_px + n2.y_px) / 2, "single_door");
      };
      document.getElementById("btnAddDoubleDoorWall").onclick = () => {
        if (n1 && n2) store.addOpeningOnNearestWall((n1.x_px + n2.x_px) / 2, (n1.y_px + n2.y_px) / 2, "double_door");
      };
      document.getElementById("btnAddWindowWall").onclick = () => {
        if (n1 && n2) store.addOpeningOnNearestWall((n1.x_px + n2.x_px) / 2, (n1.y_px + n2.y_px) / 2, "window");
      };
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else if (sel.kind === "opening") {
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Properti Pintu / Jendela (${obj.tag || obj.id})</div>
          <div class="insp-field">
            <label>Door / Window Tag (Sesuai Drawing)</label>
            <input type="text" id="inpOpTag" value="${obj.tag || "D-01"}" />
          </div>
          <div class="insp-field">
            <label>Tipe Bukaan</label>
            <select id="selOpType">
              <option value="single_door" ${obj.type === "single_door" ? "selected" : ""}>Single Swing Door (D-xx / TD-xx)</option>
              <option value="double_door" ${obj.type === "double_door" ? "selected" : ""}>Double Swing Door (DD-xx)</option>
              <option value="window" ${obj.type === "window" ? "selected" : ""}>Window Mullion / Glazing (W-xx)</option>
              <option value="ramp" ${obj.type === "ramp" ? "selected" : ""}>Raised Floor Access Ramp</option>
            </select>
          </div>
          <div class="insp-field">
            <label>Arah Bukaan Daun Pintu (Swing Direction)</label>
            <select id="selOpSwing">
              <option value="in-left" ${(obj.swing_dir || "in-left") === "in-left" ? "selected" : ""}>Ayun Dalam - Engsel Kiri</option>
              <option value="in-right" ${obj.swing_dir === "in-right" ? "selected" : ""}>Ayun Dalam - Engsel Kanan</option>
              <option value="out-left" ${obj.swing_dir === "out-left" ? "selected" : ""}>Ayun Luar - Engsel Kiri</option>
              <option value="out-right" ${obj.swing_dir === "out-right" ? "selected" : ""}>Ayun Luar - Engsel Kanan</option>
            </select>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Lebar (m)</label>
              <input type="number" id="inpOpW" step="0.05" value="${obj.width_m}" />
            </div>
            <div class="insp-field">
              <label>Tinggi (m)</label>
              <input type="number" id="inpOpH" step="0.05" value="${obj.height_m || 2.15}" />
            </div>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Rasio Posisi (0.1–0.9)</label>
              <input type="number" id="inpOpRatio" step="0.02" min="0.08" max="0.92" value="${obj.offset_ratio}" />
            </div>
            <div class="insp-field">
              <label>Elevasi Ambang (m)</label>
              <input type="number" id="inpOpElev" step="0.05" value="${obj.elevation_m || 0}" />
            </div>
          </div>
          <button id="btnDelObj" class="insp-action-btn danger">Hapus Pintu / Jendela</button>
        </div>
      `;

      document.getElementById("inpOpTag").onchange = (e) =>
        store.updateSelectedProperty({ tag: e.target.value, label: `${obj.type} (${e.target.value})` });
      document.getElementById("selOpType").onchange = (e) => {
        const t = e.target.value;
        store.updateSelectedProperty({
          type: t,
          elevation_m: t === "window" ? 0.95 : 0.0,
          height_m: t === "window" ? 1.25 : 2.15,
        });
        this.renderInspector();
      };
      document.getElementById("selOpSwing").onchange = (e) =>
        store.updateSelectedProperty({ swing_dir: e.target.value });
      document.getElementById("inpOpW").onchange = (e) =>
        store.updateSelectedProperty({ width_m: parseFloat(e.target.value) || 0.9 });
      document.getElementById("inpOpH").onchange = (e) =>
        store.updateSelectedProperty({ height_m: parseFloat(e.target.value) || 2.15 });
      document.getElementById("inpOpRatio").onchange = (e) =>
        store.updateSelectedProperty({ offset_ratio: parseFloat(e.target.value) || 0.5 });
      document.getElementById("inpOpElev").onchange = (e) =>
        store.updateSelectedProperty({ elevation_m: parseFloat(e.target.value) || 0.0 });
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else if (sel.kind === "column") {
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Pilar / Kolom Struktur (${obj.grid_label || obj.id})</div>
          <div class="insp-field">
            <label>Label Grid Kolom</label>
            <input type="text" id="inpColLbl" value="${obj.grid_label || ""}" />
          </div>
          <div class="insp-field">
            <label>Profil Struktur</label>
            <select id="selColType">
              <option value="h_beam" ${obj.type === "h_beam" ? "selected" : ""}>Steel H-Beam Column</option>
              <option value="concrete" ${obj.type === "concrete" ? "selected" : ""}>Reinforced Concrete Pillar</option>
            </select>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Lebar (m)</label>
              <input type="number" id="inpColW" step="0.05" value="${obj.width_m}" />
            </div>
            <div class="insp-field">
              <label>Tebal (m)</label>
              <input type="number" id="inpColD" step="0.05" value="${obj.depth_m}" />
            </div>
          </div>
          <button id="btnDelObj" class="insp-action-btn danger">Hapus Pilar</button>
        </div>
      `;
      document.getElementById("inpColLbl").onchange = (e) =>
        store.updateSelectedProperty({ grid_label: e.target.value });
      document.getElementById("selColType").onchange = (e) => store.updateSelectedProperty({ type: e.target.value });
      document.getElementById("inpColW").onchange = (e) =>
        store.updateSelectedProperty({ width_m: parseFloat(e.target.value) || 0.55 });
      document.getElementById("inpColD").onchange = (e) =>
        store.updateSelectedProperty({ depth_m: parseFloat(e.target.value) || 0.55 });
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else if (sel.kind === "stair") {
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Properti Tangga (Staircase)</div>
          <div class="insp-field">
            <label>Nama Tangga</label>
            <input type="text" id="inpStairName" value="${obj.name || "Staircase"}" />
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Jumlah Anak Tangga</label>
              <input type="number" id="inpStairSteps" min="4" max="28" value="${obj.steps || 12}" />
            </div>
            <div class="insp-field">
              <label>Arah Tanjakan</label>
              <select id="selStairDir">
                <option value="north" ${obj.direction === "north" ? "selected" : ""}>North (Vertikal)</option>
                <option value="east" ${obj.direction === "east" ? "selected" : ""}>East (Horizontal)</option>
              </select>
            </div>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Lebar (m)</label>
              <input type="number" id="inpStairW" step="0.1" value="${obj.width_m || 2.4}" />
            </div>
            <div class="insp-field">
              <label>Panjang (m)</label>
              <input type="number" id="inpStairD" step="0.1" value="${obj.depth_m || 3.2}" />
            </div>
          </div>
          <button id="btnDelObj" class="insp-action-btn danger">Hapus Tangga</button>
        </div>
      `;
      document.getElementById("inpStairName").onchange = (e) =>
        store.updateSelectedProperty({ name: e.target.value });
      document.getElementById("inpStairSteps").onchange = (e) =>
        store.updateSelectedProperty({ steps: parseInt(e.target.value, 10) || 12 });
      document.getElementById("selStairDir").onchange = (e) =>
        store.updateSelectedProperty({ direction: e.target.value });
      document.getElementById("inpStairW").onchange = (e) =>
        store.updateSelectedProperty({ width_m: parseFloat(e.target.value) || 2.4, bbox_px: null });
      document.getElementById("inpStairD").onchange = (e) =>
        store.updateSelectedProperty({ depth_m: parseFloat(e.target.value) || 3.2, bbox_px: null });
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else if (sel.kind === "room") {
      const presetOpts = TELCO_ROOM_PRESETS.map(
        (r) => `<option value="${r}" ${obj.name === r ? "selected" : ""}>${r}</option>`
      ).join("");

      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Zona Ruangan &amp; Raised Floor</div>
          <div class="insp-field">
            <label>Preset Nama Ruangan</label>
            <select id="selRoomPreset">
              <option value="">-- Pilih Preset Ruangan --</option>
              ${presetOpts}
            </select>
          </div>
          <div class="insp-field">
            <label>Nama Ruangan (Label 3D)</label>
            <input type="text" id="inpRoomName" value="${obj.name}" />
          </div>
          <div class="insp-field">
            <label>Tipe Lantai</label>
            <select id="selRoomFloor">
              <option value="raised_floor_60cm" ${obj.floor_type === "raised_floor_60cm" ? "selected" : ""}>Raised Floor 60&times;60cm</option>
              <option value="concrete" ${obj.floor_type === "concrete" ? "selected" : ""}>Beton Epoxy</option>
              <option value="ceramic" ${obj.floor_type === "ceramic" ? "selected" : ""}>Keramik Standar</option>
            </select>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Elevasi Lantai (m)</label>
              <input type="number" id="inpRoomElev" step="0.05" value="${obj.elevation_m || 0}" />
            </div>
            <div class="insp-field">
              <label>Warna Zona</label>
              <input type="color" id="inpRoomColor" value="${obj.color || "#00754A"}" />
            </div>
          </div>
          <button id="btnDelObj" class="insp-action-btn danger">Hapus Zona Ruangan</button>
        </div>
      `;
      document.getElementById("selRoomPreset").onchange = (e) => {
        if (e.target.value) {
          store.updateSelectedProperty({ name: e.target.value });
          this.renderInspector();
        }
      };
      document.getElementById("inpRoomName").onchange = (e) => store.updateSelectedProperty({ name: e.target.value });
      document.getElementById("selRoomFloor").onchange = (e) =>
        store.updateSelectedProperty({ floor_type: e.target.value });
      document.getElementById("inpRoomElev").onchange = (e) =>
        store.updateSelectedProperty({ elevation_m: parseFloat(e.target.value) || 0 });
      document.getElementById("inpRoomColor").onchange = (e) => store.updateSelectedProperty({ color: e.target.value });
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else if (sel.kind === "equipment") {
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Perangkat Telco CME / MEP</div>
          <div class="insp-field">
            <label>Nama / Tag Perangkat</label>
            <input type="text" id="inpEqName" value="${obj.name}" />
          </div>
          <div class="insp-field">
            <label>Kategori 3D Mesh</label>
            <select id="selEqCat">
              <option value="rack" ${obj.category === "rack" ? "selected" : ""}>42U Server Rack Cabinet</option>
              <option value="ups" ${obj.category === "ups" ? "selected" : ""}>UPS System (250kVA)</option>
              <option value="battery" ${obj.category === "battery" ? "selected" : ""}>Lithium / VRLA Battery Bank</option>
              <option value="rectifier" ${obj.category === "rectifier" ? "selected" : ""}>DC Rectifier / Capacitor</option>
              <option value="panel" ${obj.category === "panel" ? "selected" : ""}>ACPDB / SDP / LVMDP Panel</option>
              <option value="pac" ${obj.category === "pac" ? "selected" : ""}>PAC Precision Cooling</option>
            </select>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Lebar (m)</label>
              <input type="number" id="inpEqW" step="0.1" value="${obj.width_m}" />
            </div>
            <div class="insp-field">
              <label>Kedalaman (m)</label>
              <input type="number" id="inpEqD" step="0.1" value="${obj.depth_m}" />
            </div>
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Tinggi (m)</label>
              <input type="number" id="inpEqH" step="0.1" value="${obj.height_m}" />
            </div>
            <div class="insp-field">
              <label>Rotasi (derajat)</label>
              <input type="number" id="inpEqRot" step="15" value="${obj.rotation_deg || 0}" />
            </div>
          </div>
          <div class="insp-btn-group">
            <button id="btnRotEq90" class="insp-action-btn">&#8635; Putar Perangkat 90&deg;</button>
            <button id="btnDelObj" class="insp-action-btn danger">Hapus Perangkat</button>
          </div>
        </div>
      `;
      document.getElementById("inpEqName").onchange = (e) => store.updateSelectedProperty({ name: e.target.value });
      document.getElementById("selEqCat").onchange = (e) => store.updateSelectedProperty({ category: e.target.value });
      document.getElementById("inpEqW").onchange = (e) =>
        store.updateSelectedProperty({ width_m: parseFloat(e.target.value) || 1.0 });
      document.getElementById("inpEqD").onchange = (e) =>
        store.updateSelectedProperty({ depth_m: parseFloat(e.target.value) || 0.9 });
      document.getElementById("inpEqH").onchange = (e) =>
        store.updateSelectedProperty({ height_m: parseFloat(e.target.value) || 2.0 });
      document.getElementById("inpEqRot").onchange = (e) =>
        store.updateSelectedProperty({ rotation_deg: parseFloat(e.target.value) || 0 });
      document.getElementById("btnRotEq90").onclick = () => {
        store.updateSelectedProperty({ rotation_deg: ((obj.rotation_deg || 0) + 90) % 360 });
        this.renderInspector();
      };
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else if (sel.kind === "tray") {
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Jalur 3D Cable Ladder</div>
          <div class="insp-field">
            <label>Nama Jalur</label>
            <input type="text" id="inpTrayName" value="${obj.name}" />
          </div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>Lebar (m)</label>
              <input type="number" id="inpTrayW" step="0.05" value="${obj.width_m}" />
            </div>
            <div class="insp-field">
              <label>Elevasi (m)</label>
              <input type="number" id="inpTrayElev" step="0.1" value="${obj.elevation_m}" />
            </div>
          </div>
          <button id="btnDelObj" class="insp-action-btn danger">Hapus Cable Ladder</button>
        </div>
      `;
      document.getElementById("inpTrayName").onchange = (e) => store.updateSelectedProperty({ name: e.target.value });
      document.getElementById("inpTrayW").onchange = (e) =>
        store.updateSelectedProperty({ width_m: parseFloat(e.target.value) || 0.45 });
      document.getElementById("inpTrayElev").onchange = (e) =>
        store.updateSelectedProperty({ elevation_m: parseFloat(e.target.value) || 2.65 });
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    } else {
      container.innerHTML = `
        <div class="insp-card">
          <div class="insp-title">Titik Sudut (${obj.id})</div>
          <div class="insp-row-2">
            <div class="insp-field">
              <label>X (px)</label>
              <input type="number" value="${obj.x_px}" disabled />
            </div>
            <div class="insp-field">
              <label>Y (px)</label>
              <input type="number" value="${obj.y_px}" disabled />
            </div>
          </div>
          <button id="btnDelObj" class="insp-action-btn danger">Hapus Titik Sudut</button>
        </div>
      `;
      document.getElementById("btnDelObj").onclick = () => store.deleteSelected();
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.sitestryApp = new SitestryStudioApp();
});
