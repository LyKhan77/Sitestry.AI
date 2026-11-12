import test from "node:test";
import assert from "node:assert/strict";
import { suggestRoomName } from "../../frontend/js/roomNames.js";

const ROOM = [[0, 0], [400, 0], [400, 300], [0, 300]];
const t = (text, cx, cy, height = 14, confidence = 0.95) => ({ text, confidence, cx, cy, height });

test("picks the single room label", () => {
  assert.equal(suggestRoomName(ROOM, [t("Pantry", 200, 150)]), "Pantry");
});

test("joins neighbouring lines of similar height", () => {
  assert.equal(suggestRoomName(ROOM, [t("Room", 200, 165), t("MDF", 200, 145)]), "MDF Room");
});

test("drops elevation, area and number noise", () => {
  const texts = [t("BATTERY ROOM", 200, 150), t("FFL+4.500", 200, 200, 9), t("LUAS 18 M2", 200, 215, 9), t("12.5", 100, 100)];
  assert.equal(suggestRoomName(ROOM, texts), "BATTERY ROOM");
});

test("drops equipment tags with digits and parenthetical notes", () => {
  const texts = [
    t("47 NEW RACK", 100, 60),
    t("SMW-347 NEWRACK", 300, 60),
    t("(RAISE FLOOR)", 200, 250, 9),
    t("RUANG PERANGKAT", 200, 150, 16),
  ];
  assert.equal(suggestRoomName(ROOM, texts), "RUANG PERANGKAT");
});

test("keeps a room name that contains a digit", () => {
  assert.equal(suggestRoomName(ROOM, [t("SG-1 ROOM", 200, 150)]), "SG-1 ROOM");
});

test("drops grid letters and door tags", () => {
  const texts = [t("E", 50, 50), t("F", 350, 50), t("D-01", 200, 100), t("W-02", 200, 200), t("8-2", 100, 250)];
  assert.equal(suggestRoomName(ROOM, texts), null);
});

test("ignores low confidence", () => {
  assert.equal(suggestRoomName(ROOM, [t("Pantry", 200, 150, 14, 0.4)]), null);
});

test("ignores text outside the polygon", () => {
  assert.equal(suggestRoomName(ROOM, [t("Pantry", 700, 150)]), null);
});

test("returns null when nothing remains", () => {
  assert.equal(suggestRoomName(ROOM, []), null);
  assert.equal(suggestRoomName(ROOM, null), null);
  assert.equal(suggestRoomName([[0, 0], [10, 0]], [t("Pantry", 5, 0)]), null);
});

test("prefers the larger text when labels are far apart", () => {
  const texts = [t("RUANG A", 200, 100, 20), t("CATATAN KECIL", 200, 250, 8)];
  assert.equal(suggestRoomName(ROOM, texts), "RUANG A");
});

test("does not join a distant line of the same height", () => {
  const texts = [t("GUDANG", 200, 60, 14), t("PANEL", 200, 260, 14)];
  assert.equal(suggestRoomName(ROOM, texts), "GUDANG");
});

test("collapses whitespace in the result", () => {
  assert.equal(suggestRoomName(ROOM, [t("  R.   Meeting ", 200, 150)]), "R. Meeting");
});

test("strips elevation tokens glued to the label", () => {
  assert.equal(suggestRoomName(ROOM, [t("NSC IM-3 R0C FFL4.850", 200, 150)]), "NSC IM-3 R0C");
  assert.equal(suggestRoomName(ROOM, [t("MARCONY ROOM FFL +4.500", 200, 150)]), "MARCONY ROOM");
});

test("strips an area note glued to the label", () => {
  assert.equal(suggestRoomName(ROOM, [t("R. STAFF OPERAS & LUASTSSN2", 200, 150)]), "R. STAFF OPERAS");
  assert.equal(suggestRoomName(ROOM, [t("RUANG GUDANG LUAS 60 M2", 200, 150)]), "RUANG GUDANG");
});

test("strips a trailing parenthetical note", () => {
  assert.equal(suggestRoomName(ROOM, [t("SEAME WE ROOM (RAISE FLOOR)", 200, 150)]), "SEAME WE ROOM");
});

test("a label that is only noise after cleaning is dropped", () => {
  assert.equal(suggestRoomName(ROOM, [t("FFL4.850", 200, 150), t("LUAS 18 M2", 200, 200)]), null);
});
