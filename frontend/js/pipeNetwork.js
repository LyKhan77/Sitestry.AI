/**
 * Sitestry.AI — cooling pipe network helpers (pure, no DOM).
 *
 * Mirrors `trayNetwork.js` using `sharedGraph.js` for `pipe_nodes` and `pipe_runs`.
 */

import {
  graphRunLengthM,
  graphRunPoints,
  insertGraphRun,
  nearestGraphAnchor,
  pruneGraphNodes,
} from "./sharedGraph.js";

export const PIPE_MOUNTINGS = ["underfloor", "overhead"];
export const PIPE_DEFAULT_COLOR = "#06b6d4";

export function normalizePipeMounting(mounting) {
  return PIPE_MOUNTINGS.includes(mounting) ? mounting : "underfloor";
}

export function defaultPipeElevation(project, mounting = "underfloor") {
  if (normalizePipeMounting(mounting) === "underfloor") return 0.15;
  const wallHeight = Number(project?.metadata?.default_wall_height_m) || 3.8;
  return Math.round((wallHeight - 0.7) * 100) / 100;
}

export function pipePoints(project, pipe) {
  return graphRunPoints(project.pipe_nodes, pipe);
}

export function pipeLengthM(project, pipe, scalePxPerMeter) {
  return graphRunLengthM(project.pipe_nodes, pipe, scalePxPerMeter);
}

export function prunePipeNodes(project) {
  project.pipe_nodes = pruneGraphNodes(project.pipe_nodes || [], project.pipe_runs || []);
}

export function insertPipeRun(project, pointsPx, props, snapPx) {
  if (!Array.isArray(project.pipe_nodes)) project.pipe_nodes = [];
  if (!Array.isArray(project.pipe_runs)) project.pipe_runs = [];
  const mounting = normalizePipeMounting(props?.mounting);
  const { run, prunedNodes } = insertGraphRun({
    nodes: project.pipe_nodes,
    runs: project.pipe_runs,
    prefix: "pn_",
    pointsPx,
    props: { ...props, mounting },
    snapPx,
  });
  project.pipe_nodes = prunedNodes;
  return run;
}

export function nearestPipeAnchor(project, pt, radiusPx) {
  return nearestGraphAnchor(project.pipe_nodes || [], project.pipe_runs || [], pt, radiusPx);
}
