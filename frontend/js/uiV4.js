/**
 * Sitestry.AI — v4 UI (Dock + Wizard) helpers.
 * Every v4 rule is gated by `body[data-ui="v4"]`; with the flag off the legacy UI is untouched.
 */

import { store } from "./store.js";

const FLAG_KEY = "sitestry.ui";
const LAST_STEP = 5;

/**
 * `?ui=v4` enables and persists the flag, `?ui=v3` clears it, otherwise the stored value wins.
 * Always sets `document.body.dataset.ui` to "v3" or "v4".
 */
export function initUiFlag(search = window.location.search, storage = window.localStorage) {
  const param = new URLSearchParams(search).get("ui");
  let flag = param === "v4" ? "v4" : "v3";
  try {
    if (param === "v4") storage.setItem(FLAG_KEY, "v4");
    else if (param === "v3") storage.removeItem(FLAG_KEY);
    else flag = storage.getItem(FLAG_KEY) === "v4" ? "v4" : "v3";
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

const DOCK_MIN_WIDTH = "(min-width: 1101px)";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Place #rightInspector beside the selected object, flipped/clamped to stay inside #pane2D. */
export function positionFloatingInspector(app) {
  const insp = document.getElementById("rightInspector");
  const pane = document.getElementById("pane2D");
  const host = document.getElementById("studioBody");
  if (!insp || !pane || !host) return;
  const active = isV4() && store.ui.step === 3 && window.matchMedia(DOCK_MIN_WIDTH).matches;
  if (!active) {
    ["left", "top", "right", "maxHeight"].forEach((p) => (insp.style[p] = ""));
    return;
  }
  if (document.body.dataset.inspector !== "open") return;
  const GAP = 12;
  const MARGIN = 8;
  const TOP = 52; // keep the floating view/hint row visible
  const BOTTOM = 72; // keep the bottom timeline visible
  const p = pane.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  insp.style.maxHeight = `${Math.max(160, p.height - TOP - BOTTOM)}px`;
  const w = insp.offsetWidth;
  const ht = insp.offsetHeight;
  const rect = app.canvas2d.selectedScreenRect();
  let x = rect ? rect.x + rect.width + GAP : p.width - w - MARGIN;
  const y = rect ? rect.y : TOP;
  if (rect && x + w > p.width - MARGIN) x = rect.x - GAP - w;
  x = clamp(x, MARGIN, p.width - w - MARGIN);
  const yy = clamp(y, TOP, p.height - ht - BOTTOM);
  insp.style.right = "auto";
  insp.style.left = `${p.left - h.left + x}px`;
  insp.style.top = `${p.top - h.top + yy}px`;
}

/** Collapse the dock flyout and refresh its toggle for the stage that just became active. */
export function syncDock(step) {
  document.body.dataset.dock = "closed";
  const btn = document.getElementById("btnDockPanel");
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
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
  panel.appendChild(flyout);
}

/** Wire the v4 dock: icons, flyout toggle, Escape, and floating-inspector tracking. */
export function initV4Dock(app) {
  if (!isV4()) return;
  decorateToolButtons();
  buildDockFlyout(3, [".wall-assist-bar", "#stairSettingsCard", ".layer-card"]);
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
    if (document.body.dataset.dock === "open") {
      syncDock(store.ui.step);
      toggle?.focus();
    } else if (store.ui.selected) {
      store.selectObject(null, null);
    }
  });

  // ponytail: per-frame check while the inspector is open; swap for stage/store events if it ever shows in profiles.
  let last = "";
  const tick = () => {
    if (isV4() && document.body.dataset.inspector === "open") {
      const st = app.canvas2d.stage;
      const insp = document.getElementById("rightInspector");
      const r = app.canvas2d.selectedScreenRect();
      const key = [
        store.ui.step,
        st.x(),
        st.y(),
        st.scaleX(),
        insp?.offsetWidth,
        insp?.offsetHeight,
        window.innerWidth,
        window.innerHeight,
        r ? `${r.x},${r.y},${r.width},${r.height}` : "none",
      ].join("|");
      if (key !== last) {
        last = key;
        positionFloatingInspector(app);
      }
    } else last = "";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
