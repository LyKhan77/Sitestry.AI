/**
 * Sitestry.AI — v4 UI (Dock + Wizard) helpers.
 * Every v4 rule is gated by `body[data-ui="v4"]`; with the flag off the legacy UI is untouched.
 */

import { store } from "./store.js";

const FLAG_KEY = "sitestry.ui";
const LAST_STEP = 5;

/**
 * v4 is the default. `?ui=v3` switches to the legacy UI and persists that choice (escape hatch);
 * `?ui=v4` switches back. Always sets `document.body.dataset.ui` to "v3" or "v4".
 */
export function initUiFlag(search = window.location.search, storage = window.localStorage) {
  document.body.dataset.extract = "idle";
  const param = new URLSearchParams(search).get("ui");
  let flag = param === "v3" ? "v3" : "v4";
  try {
    if (param === "v3" || param === "v4") storage.setItem(FLAG_KEY, param);
    else flag = storage.getItem(FLAG_KEY) === "v3" ? "v3" : "v4";
  } catch {
    // Storage can be blocked; the URL param still applies for this load.
  }
  document.body.dataset.ui = flag;
  return flag;
}

export function isV4() {
  return document.body.dataset.ui === "v4";
}

/** Reflect the current stage on the bottom timeline (state, aria-current, Back/Next limits). */
export function syncTimeline(step) {
  document.querySelectorAll("#stageTimeline .tl-step").forEach((btn) => {
    const s = Number(btn.dataset.step);
    btn.classList.toggle("active", s === step);
    btn.classList.toggle("done", s < step);
    if (s === step) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
  });
  const back = document.getElementById("tlBack");
  const next = document.getElementById("tlNext");
  if (back) back.disabled = step <= 1;
  if (next) next.disabled = step >= LAST_STEP;
}

// ==================== DOCK: tool icons, flyout, floating property panel ====================
const ICONS = {
  select: '<path d="M5 3l12 7-5.5 1.5L9 17z" fill="currentColor"/>',
  pan: '<path d="M9 11V4.5a1 1 0 1 1 2 0V10m0-4.5a1 1 0 1 1 2 0V10m0-3.5a1 1 0 1 1 2 0V12a4.5 4.5 0 0 1-9 0V8.5a1 1 0 1 1 2 0V11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  wall: '<path d="M3 15L15 4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  door: '<path d="M4 16V4M4 16h12M4 4a12 12 0 0 1 12 12" fill="none" stroke="currentColor" stroke-width="2"/>',
  double_door:
    '<path d="M2 16V6M18 16V6M2 16h16M2 6a8 8 0 0 1 8 8M18 6a8 8 0 0 0-8 8" fill="none" stroke="currentColor" stroke-width="2"/>',
  window:
    '<rect x="3" y="7" width="14" height="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 7v6" stroke="currentColor" stroke-width="2"/>',
  column: '<rect x="6" y="6" width="8" height="8" fill="currentColor"/>',
  stair: '<path d="M3 16h4v-4h4V8h4V4h2" fill="none" stroke="currentColor" stroke-width="2"/>',
  room: '<path d="M4 5h12v10H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>',
  roi: '<path d="M4 4h12v12H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/><circle cx="16" cy="16" r="2" fill="currentColor"/>',
  ruler:
    '<path d="M2 14L14 2l4 4L6 18z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10l2 2M9 7l2 2" stroke="currentColor" stroke-width="2"/>',
  equipment:
    '<rect x="4" y="3" width="12" height="14" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 8h12M4 13h12" stroke="currentColor" stroke-width="2"/>',
  tray: '<path d="M3 5h14M3 15h14M6 5v10M10 5v10M14 5v10" fill="none" stroke="currentColor" stroke-width="2"/>',
  pipe: '<path d="M3 8h9v4H3zM12 10h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="3" cy="10" r="1.5" fill="currentColor"/><circle cx="17" cy="15.5" r="1.5" fill="currentColor"/>',
  cable:
    '<circle cx="4.5" cy="5.5" r="2" fill="currentColor"/><circle cx="15.5" cy="14.5" r="2" fill="currentColor"/><path d="M6.5 5.5c5 0 2 9 7 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

/** Add an inline icon and an accessible name (label + shortcut) to every tool button under `root`. */
export function decorateToolButtons(root = document) {
  root.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    if (btn.querySelector(".tool-ico")) return;
    const label = btn.querySelector("span:not(.kbd)")?.textContent.trim() || btn.dataset.tool;
    const key = btn.querySelector(".kbd")?.textContent.trim();
    btn.setAttribute("aria-label", key ? `${label} (${key})` : label);
    const body = ICONS[btn.dataset.tool];
    if (!body) return;
    btn.insertAdjacentHTML(
      "afterbegin",
      `<svg class="tool-ico" aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">${body}</svg>`
    );
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Collapse the dock flyout and refresh its toggle for the stage that just became active. */
export function syncDock(step) {
  // Stages 4-5 carry their main controls in the flyout, so it starts open there.
  const open = step >= 4;
  document.body.dataset.dock = open ? "open" : "closed";
  const btn = document.getElementById("btnDockPanel");
  if (btn) {
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-controls", `dockFlyout${step}`);
  }
}

function buildDockFlyout(stage, selectors) {
  const panel = document.getElementById(`stagePanel${stage}`);
  if (!panel || panel.querySelector(`#dockFlyout${stage}`)) return;
  const flyout = document.createElement("div");
  flyout.id = `dockFlyout${stage}`;
  flyout.className = "dock-flyout";
  selectors.forEach((sel) => {
    const el = panel.querySelector(sel);
    if (el) flyout.appendChild(el);
  });
  // Before the CTA footer so narrow drawers keep the legacy order (controls, then the primary button).
  panel.insertBefore(flyout, panel.querySelector(".stage-cta-footer"));
}

// ==================== EXPORT MENU & BoQ ====================
/** Single Export menu (Stage 4-5). Items click the legacy buttons so export logic stays in one place. */
function initExportMenu() {
  const trigger = document.getElementById("btnExportMenu");
  const list = document.getElementById("exportMenuList");
  if (!trigger || !list) return;
  const items = Array.from(list.querySelectorAll('[role="menuitem"]'));
  const setOpen = (open, focusTarget) => {
    list.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) items[0]?.focus();
    else if (focusTarget) trigger.focus();
  };
  trigger.addEventListener("click", () => setOpen(list.hidden));
  list.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
    else if (e.key === "Escape") setOpen(false, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener("click", (e) => {
    if (!list.hidden && !e.target.closest("#exportMenu")) setOpen(false);
  });
  document.getElementById("miExportJson")?.addEventListener("click", () => {
    document.getElementById("btnExportJson")?.click();
    setOpen(false, true);
  });
  document.getElementById("miExportGlb")?.addEventListener("click", () => {
    document.getElementById("btnExportGlb")?.click();
    setOpen(false, true);
  });
}

import { EQUIPMENT_SUBTYPES } from "./equipmentCatalog.js";

const EQUIPMENT_LABELS = Object.fromEntries(
  Object.entries(EQUIPMENT_SUBTYPES).map(([k, v]) => [k, v.label])
);

/** Count equipments per `category`, in first-seen order. */
export function equipmentTotals(equipments) {
  const counts = new Map();
  for (const eq of equipments) counts.set(eq.category, (counts.get(eq.category) || 0) + 1);
  return Array.from(counts, ([category, count]) => ({ category, count }));
}

/** Structural summary boxes (shared by the Stage 4 flyout grid and the Stage 5 BoQ panel). */
export function renderBoqGrid(boq) {
  const box = (val, lbl) => `<div class="boq-box"><div class="boq-val">${val}</div><div class="boq-lbl">${lbl}</div></div>`;
  return (
    box(`${boq.solidWallMeters} m`, "Panjang Dinding") +
    box(`${boq.doorsCount} / ${boq.windowsCount}`, "Pintu / Jendela") +
    box(`${boq.columnsCount} unit`, "Pilar Struktur") +
    box(`${boq.stairsCount} unit`, "Tangga (Stairs)")
  );
}

/** Stage 5 BoQ panel: structural summary, tray service breakdown, plus equipment counts. */
export function renderBoqPanel(boq, equipments, collapsed = false) {
  const totals = equipmentTotals(equipments);
  const directDrops = Math.max(0, Number(boq.waterfallCount || 0) - Number(boq.trayWaterfallCount || 0));
  const trayRows = [
    Number(boq.powerTrayMeters) > 0
      ? `<div class="boq-eq-row"><span>Tray Power</span><strong>${boq.powerTrayMeters} m</strong></div>`
      : "",
    Number(boq.dataTrayMeters) > 0
      ? `<div class="boq-eq-row"><span>Tray Data</span><strong>${boq.dataTrayMeters} m</strong></div>`
      : "",
    Number(boq.unifiedTrayMeters) > 0
      ? `<div class="boq-eq-row"><span>Tray Unified</span><strong>${boq.unifiedTrayMeters} m</strong></div>`
      : "",
    Number(boq.pipeLengthMeters) > 0
      ? `<div class="boq-eq-row"><span>Cooling Pipe</span><strong>${boq.pipeLengthMeters} m</strong></div>`
      : "",
    Number(boq.powerCableMeters) > 0
      ? `<div class="boq-eq-row"><span>Kabel Power</span><strong>${boq.powerCableMeters} m</strong></div>`
      : "",
    Number(boq.groundingCableMeters) > 0
      ? `<div class="boq-eq-row"><span>Kabel Grounding</span><strong>${boq.groundingCableMeters} m</strong></div>`
      : "",
    Number(boq.linkCableMeters) > 0
      ? `<div class="boq-eq-row"><span>Kabel Link</span><strong>${boq.linkCableMeters} m</strong></div>`
      : "",
    Number(boq.coolingRouteMeters) > 0
      ? `<div class="boq-eq-row"><span>Aliran Cooling</span><strong>${boq.coolingRouteMeters} m</strong></div>`
      : "",
    Number(boq.securityCableMeters) > 0
      ? `<div class="boq-eq-row"><span>Kabel Security</span><strong>${boq.securityCableMeters} m</strong></div>`
      : "",
    Number(boq.trayWaterfallCount) > 0
      ? `<div class="boq-eq-row"><span>Tray Waterfall Drop</span><strong>${boq.trayWaterfallCount} pcs</strong></div>`
      : "",
    directDrops > 0
      ? `<div class="boq-eq-row"><span>Direct Waterfall Drop</span><strong>${directDrops} pcs</strong></div>`
      : "",
  ].join("");
  const rows = totals.length
    ? totals
        .map(
          (t) =>
            `<div class="boq-eq-row"><span>${EQUIPMENT_LABELS[t.category] || t.category}</span><strong>${t.count}</strong></div>`
        )
        .join("")
    : '<div class="boq-eq-empty">Belum ada perangkat terpasang.</div>';
  const toggleLabel = collapsed ? "Tampilkan" : "Sembunyikan";
  return (
    `<div class="boq-panel-header">` +
    `<div class="boq-panel-title">BoQ live</div>` +
    `<button type="button" id="btnToggleBoq" class="boq-toggle-btn" aria-expanded="${!collapsed}">${toggleLabel}</button>` +
    `</div>` +
    `<div class="boq-panel-body">${`<div class="struct-summary-grid">${renderBoqGrid(boq)}</div>${trayRows}${rows}`}</div>`
  );
}

// ==================== COMMAND PALETTE ====================
const STAGE_NAMES = ["Input", "Process Extraction", "Room Layout", "Installation", "Result"];
const LAYER_ACTIONS = [
  ["chkLayerBlueprint", "Blueprint asli"],
  ["chkLayerRoi", "Batas ROI"],
  ["chkLayerWalls", "Dinding, pintu & jendela"],
  ["chkLayerColumns", "Pilar / kolom"],
  ["chkLayerTrays", "Tangga & jalur tray"],
  ["chkLayerRooms", "Label & poligon ruangan"],
  ["chkLayerGrid", "Grid raised floor"],
  ["chkLayerEquipments", "Perangkat CME"],
];

export const PALETTE_ACTIONS = [
  ...STAGE_NAMES.map((name, i) => ({
    id: `stage-${i + 1}`,
    label: `Pindah ke Stage ${i + 1}: ${name}`,
    keywords: "stage step langkah pindah",
    run: (app) => app.setWorkflowStage(i + 1),
  })),
  ...[
    ["2d", "2D Blueprint & CAD"],
    ["split", "Split 2D | 3D"],
    ["3d", "3D Digital Twin"],
  ].map(([mode, name]) => ({
    id: `view-${mode}`,
    label: `Tampilan: ${name}`,
    keywords: "view tampilan",
    when: () => store.ui.step === 5,
    run: (app) => app.setViewMode(mode),
  })),
  {
    id: "workspace",
    label: "Buka Workspace",
    keywords: "workspace home beranda project",
    when: () => isV4(),
    run: (app) => app.showHome(),
  },
  {
    id: "save",
    label: "Simpan project",
    keywords: "save simpan",
    when: () => ["clean", "dirty", "error"].includes(document.body.dataset.save),
    run: (app) => app.saveWorkspace(),
  },
  {
    id: "run-extraction",
    label: "Jalankan ulang ekstraksi",
    keywords: "extract ekstraksi run",
    when: () => store.ui.step <= 2,
    run: (app) => app.startExtractionV4(),
  },
  {
    id: "undo",
    label: "Undo",
    keywords: "batal",
    when: () => store.undoStack.length > 0,
    run: () => store.undo(),
  },
  {
    id: "redo",
    label: "Redo",
    keywords: "ulang",
    when: () => store.redoStack.length > 0,
    run: () => store.redo(),
  },
  {
    id: "export-json",
    label: "Export JSON",
    keywords: "download simpan",
    when: () => store.ui.step === 5,
    run: () => document.getElementById("btnExportJson")?.click(),
  },
  {
    id: "export-glb",
    label: "Export .GLB",
    keywords: "download 3d model",
    when: () => store.ui.step === 5,
    run: () => document.getElementById("btnExportGlb")?.click(),
  },
  ...LAYER_ACTIONS.map(([checkboxId, name]) => ({
    id: `layer-${checkboxId}`,
    label: `Layer: ${name}`,
    keywords: "layer toggle tampil sembunyi",
    when: () => store.ui.step >= 3,
    run: () => document.getElementById(checkboxId)?.click(),
  })),
];

/** Case-insensitive substring match over label + keywords; keeps the original order. */
export function filterActions(query, actions) {
  const q = query.trim().toLowerCase();
  if (!q) return actions.slice();
  return actions.filter((a) => `${a.label} ${a.keywords || ""}`.toLowerCase().includes(q));
}

let paletteApp = null;
let paletteFocus = null;
let paletteMatches = [];
let paletteIndex = 0;

function renderPalette() {
  const input = document.getElementById("cmdInput");
  const list = document.getElementById("cmdList");
  const available = PALETTE_ACTIONS.filter((a) => !a.when || a.when(paletteApp));
  paletteMatches = filterActions(input.value, available);
  paletteIndex = clamp(paletteIndex, 0, Math.max(0, paletteMatches.length - 1));
  list.innerHTML = paletteMatches
    .map(
      (a, i) =>
        `<li role="option" id="cmdOpt-${i}" data-index="${i}" aria-selected="${i === paletteIndex}">${a.label}</li>`
    )
    .join("");
  input.setAttribute("aria-activedescendant", paletteMatches.length ? `cmdOpt-${paletteIndex}` : "");
}

export function closePalette() {
  const dialog = document.getElementById("cmdPalette");
  if (!dialog || dialog.hidden) return;
  dialog.hidden = true;
  const back = paletteFocus;
  paletteFocus = null;
  if (back && back !== document.body && document.contains(back)) back.focus();
}

export function openPalette(app) {
  const dialog = document.getElementById("cmdPalette");
  const input = document.getElementById("cmdInput");
  if (!dialog || !input) return;
  paletteApp = app;
  paletteFocus = document.activeElement;
  paletteIndex = 0;
  input.value = "";
  dialog.hidden = false;
  renderPalette();
  input.focus();
}

function runPaletteAction(index) {
  const action = paletteMatches[index];
  if (!action) return;
  closePalette();
  action.run(paletteApp);
}

function initPalette(app) {
  const dialog = document.getElementById("cmdPalette");
  const input = document.getElementById("cmdInput");
  const list = document.getElementById("cmdList");
  if (!dialog || !input || !list) return;

  window.addEventListener("keydown", (e) => {
    if (!isV4() || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
    e.preventDefault();
    if (dialog.hidden) openPalette(app);
    else closePalette();
  });

  input.addEventListener("input", () => {
    paletteIndex = 0;
    renderPalette();
  });
  input.addEventListener("keydown", (e) => {
    const n = paletteMatches.length;
    if (e.key === "ArrowDown" && n) paletteIndex = (paletteIndex + 1) % n;
    else if (e.key === "ArrowUp" && n) paletteIndex = (paletteIndex - 1 + n) % n;
    else if (e.key === "Enter") {
      e.preventDefault();
      runPaletteAction(paletteIndex);
      return;
    } else if (e.key === "Escape") {
      closePalette();
    } else if (e.key !== "Tab") return;
    // Arrows re-render the highlight; Escape/Tab are handled here so nothing leaks to global shortcuts.
    e.preventDefault();
    e.stopPropagation();
    if (!dialog.hidden) renderPalette();
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[data-index]");
    if (li) runPaletteAction(Number(li.dataset.index));
  });
  dialog.addEventListener("mousedown", (e) => {
    if (e.target === dialog) closePalette();
  });
}

// ==================== STAGE 2 WIZARD: honest extraction status + progressive reveal ====================
const REVEAL_STEP_MS = 350;
const EXTRACT_COPY = {
  idle: ["Ekstraksi", "Gunakan Next atau Jalankan ulang untuk mengekstrak denah."],
  running: ["Mengekstrak denah…", "Membaca dinding, pintu, jendela, tangga, dan pilar dari berkas."],
  done: ["Ekstraksi selesai", "Periksa hasilnya di editor, lalu lanjut ke Review."],
  fallback: [
    "Memakai denah cadangan",
    "Server ekstraksi tidak terjangkau. Yang tampil adalah denah cadangan dari browser, bukan hasil ekstraksi asli. Coba lagi setelah server aktif.",
  ],
  error: ["Ekstraksi gagal", "Ekstraksi gagal."],
};

/** Reflect the extraction state on <body data-extract> and the Stage 2 card. */
export function setExtractState(state, detail = "") {
  document.body.dataset.extract = state;
  const [title, status] = EXTRACT_COPY[state];
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("wizTitle", title);
  set("wizStatus", state === "error" && detail ? `Ekstraksi gagal: ${detail}` : status);
  const bar = document.getElementById("wizProgress");
  if (bar) bar.hidden = state !== "running";
  const retry = document.getElementById("btnRetryExtract");
  if (retry) retry.hidden = !(state === "fallback" || state === "error");
}

function projectCounts(project) {
  const windows = project.openings.filter((o) => o.type === "window").length;
  return {
    walls: project.walls.length,
    doors: project.openings.length - windows,
    windows,
    columns: project.columns.length,
    stairs: project.stairs.length,
    rooms: project.rooms.length,
  };
}

function setWizCounts(counts) {
  for (const [key, value] of Object.entries(counts)) {
    const el = document.querySelector(`#wizCounts [data-count="${key}"]`);
    if (el) el.textContent = String(value);
  }
}

export function resetWizCounts() {
  setWizCounts({ walls: 0, doors: 0, windows: 0, columns: 0, stairs: 0, rooms: 0 });
}

/** Show the project's real counts on the card unless an extraction is mid-flight. */
export function syncWizardCounts() {
  if (document.body.dataset.extract === "running") return;
  setWizCounts(projectCounts(store.project));
}

/** Hide the layers the reveal will bring back one by one. */
export function hideExtractionLayers() {
  ["walls", "columns", "trays", "rooms"].forEach((k) => (store.ui.layers[k] = false));
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });

function countUp(el, to, signal, instant) {
  if (!el) return;
  if (instant || to <= 0) {
    el.textContent = String(to);
    return;
  }
  let n = 0;
  const inc = Math.max(1, Math.ceil(to / 12));
  const timer = setInterval(() => {
    n = Math.min(to, n + inc);
    el.textContent = String(n);
    if (n >= to) clearInterval(timer);
  }, 30);
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });
}

/**
 * Bring the extracted layers back one step at a time (walls+openings, columns, stairs/trays, rooms)
 * while the card counters count up. Aborting stops at once and leaves layer cleanup to the caller.
 * Resolves true only when the whole reveal finished.
 */
export async function revealExtraction(app, layout, { signal }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const c = projectCounts(layout);
  const steps = [
    { layers: ["walls"], counts: { walls: c.walls, doors: c.doors, windows: c.windows } },
    { layers: ["columns"], counts: { columns: c.columns } },
    { layers: ["trays"], counts: { stairs: c.stairs } },
    { layers: ["rooms"], counts: { rooms: c.rooms } },
  ];
  for (let i = 0; i < steps.length; i += 1) {
    if (signal.aborted) return false;
    steps[i].layers.forEach((k) => (store.ui.layers[k] = true));
    app.syncLayerCheckboxes();
    app.canvas2d.renderAll();
    for (const [key, value] of Object.entries(steps[i].counts)) {
      countUp(document.querySelector(`#wizCounts [data-count="${key}"]`), value, signal, reduced);
    }
    if (!reduced && i < steps.length - 1) await sleep(REVEAL_STEP_MS, signal);
  }
  return !signal.aborted;
}

/** Wire the v4 dock: icons, flyout toggle, Escape, and floating-inspector tracking. */
export function initV4Dock(app) {
  if (!isV4()) return;
  decorateToolButtons();
  buildDockFlyout(3, [".wall-assist-bar", "#stairSettingsCard", "#roomSettingsCard", ".layer-card"]);
  buildDockFlyout(4, [
    "#traySettingsCard",
    "#pipeSettingsCard",
    "#cableSettingsCard",
    ".eq-catalog-grid",
    ".eq-subtype-row",
    ".preset-cme-row",
    "label.layer-check-row",
  ]);
  buildDockFlyout(5, [".cam-toggles-row", "#rowTransparentFloor", ".surface-card:has(#stage4SummaryGrid)"]);
  initExportMenu();
  initPalette(app);
  document.getElementById("btnRetryExtract")?.addEventListener("click", () => app.startExtractionV4());
  const rerun = document.getElementById("btnRunExtract");
  if (rerun) rerun.textContent = "Jalankan ulang";
  syncDock(store.ui.step);

  const toggle = document.getElementById("btnDockPanel");
  toggle?.addEventListener("click", () => {
    const open = document.body.dataset.dock !== "open";
    document.body.dataset.dock = open ? "open" : "closed";
    toggle.setAttribute("aria-expanded", String(open));
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (document.body.dataset.tools === "open") {
      // Narrow layouts: the open drawer covers its own toggle, so Escape must dismiss it.
      document.body.dataset.tools = "closed";
      app.syncStageSidebarA11y();
    } else if (document.body.dataset.dock === "open") {
      document.body.dataset.dock = "closed";
      toggle?.setAttribute("aria-expanded", "false");
      toggle?.focus();
    } else if (store.ui.selected) {
      store.selectObject(null, null);
    }
  });

}
