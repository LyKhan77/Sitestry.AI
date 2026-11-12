/**
 * Sitestry.AI — suggest a room name from OCR text boxes (pure, no DOM).
 *
 * OCR on a CAD drawing returns the room label together with elevations, areas, equipment tags and
 * grid letters. Boxes whose centre is inside the polygon are filtered, the tallest one is the label,
 * and neighbouring lines of similar height are joined to it ("MDF" + "Room").
 */

import { pointInPolygon } from "./roomFaces.js";

const MIN_CONFIDENCE = 0.6;
const MIN_LETTERS = 3;

const NOISE = [
  /^\(|\)$/, // "(RAISE FLOOR)"
  /^(FFL|EL\.?|ELEV)\b/i, // elevations
  /[+-]\s?\d+[.,]\d{2,3}/, // +4.500
  /\b(LUAS|L\s*=)\b/i, // area notes
  /\d+([.,]\d+)?\s*M\s?[2²]\b/i, // 18 M2
];

const letters = (text) => (text.match(/[A-Za-zÀ-ÿµμ]/g) || []).length;

function isNoise(text) {
  if (letters(text) < MIN_LETTERS) return true;
  if (NOISE.some((rule) => rule.test(text))) return true;
  return /\d/.test(text) && /(RACK|NEW\b|EXIST)/i.test(text); // "47 NEW RACK"
}

/** Drop elevation, area and note fragments that OCR glued onto the label itself. */
function clean(text) {
  return text
    .replace(/\bFFL\s*[+-]?\s*\d+([.,]\d+)?/gi, " ")
    .replace(/\bLUAS\w*.*$/i, " ")
    .replace(/\d+([.,]\d+)?\s*M\s?[2²]\b/gi, " ")
    .replace(/\(.*$/, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s&,;:-]+$/, "")
    .trim();
}

const widthOf = (box) => Math.max(10, 0.6 * box.height * box.text.length);

export function suggestRoomName(polygon, texts) {
  if (!Array.isArray(polygon) || polygon.length < 3 || !Array.isArray(texts)) return null;
  const candidates = texts
    .map((box) => ({ ...box, text: clean(String(box.text ?? "").replace(/\s+/g, " ").trim()) }))
    .filter(
      (box) =>
        box.text &&
        box.confidence >= MIN_CONFIDENCE &&
        pointInPolygon([box.cx, box.cy], polygon) &&
        !isNoise(box.text)
    );
  if (candidates.length === 0) return null;

  const main = candidates.reduce((best, box) =>
    box.height > best.height || (box.height === best.height && letters(box.text) > letters(best.text)) ? box : best
  );
  const group = candidates.filter((box) => {
    if (box === main) return true;
    const similar = Math.abs(box.height - main.height) <= 0.35 * main.height;
    const near = Math.abs(box.cy - main.cy) <= 2.2 * main.height;
    const overlaps = Math.abs(box.cx - main.cx) <= (widthOf(box) + widthOf(main)) / 2 + main.height;
    return similar && near && overlaps;
  });
  group.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return group.map((box) => box.text).join(" ");
}
