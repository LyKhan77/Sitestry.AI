/**
 * Sitestry.AI — v4 UI (Dock + Wizard) helpers.
 * Every v4 rule is gated by `body[data-ui="v4"]`; with the flag off the legacy UI is untouched.
 */

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
