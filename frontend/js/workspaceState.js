/**
 * Sitestry.AI — workspace state helpers (pure, no DOM).
 *
 * `structureHash` fingerprints the geometry that Save and Build 3D care about,
 * so "unsaved" and "3D is stale" are content comparisons: undoing back to the
 * saved state is clean again. Equipment and cable trays are Stage 5 data and
 * are deliberately left out.
 */

const STRUCTURE_KEYS = ["nodes", "walls", "columns", "openings", "rooms", "stairs"];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** cyrb53: small non-cryptographic 53-bit hash, hex encoded. */
function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function structureHash(project) {
  const picked = { scale: project?.metadata?.scale_px_per_meter ?? null };
  for (const key of STRUCTURE_KEYS) picked[key] = project?.[key] ?? [];
  return hashString(canonical(picked));
}

export function workspaceFlags({ liveHash, savedHash, builtHash }) {
  const built = builtHash != null;
  return {
    dirty: savedHash !== liveHash,
    stale: built && builtHash !== savedHash,
    built,
  };
}

export function countsOf(project) {
  const len = (key) => (Array.isArray(project?.[key]) ? project[key].length : 0);
  return {
    walls: len("walls"),
    openings: len("openings"),
    columns: len("columns"),
    stairs: len("stairs"),
    rooms: len("rooms"),
  };
}
