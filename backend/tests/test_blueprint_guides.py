from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path
from unittest import mock

import cv2
import fitz
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import blueprint_guides as bg  # noqa: E402


def make_pdf(lines, filled=None, text=None) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=400, height=300)
    for p1, p2, width in lines:
        page.draw_line(p1, p2, color=(0, 0, 0), width=width)
    if filled:
        page.draw_rect(filled, color=(0, 0, 0), fill=(0, 0, 0))
    if text:
        page.insert_text((20, 280), text, fontsize=8)
    data = doc.tobytes()
    doc.close()
    return data


def make_raster(draw_fn, width=400, height=300) -> bytes:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    draw_fn(image)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


class BlueprintGuideDetectorTest(unittest.TestCase):
    def setUp(self):
        bg.clear_cache()

    def test_parallel_vector_lines_produce_centerline(self):
        pdf = make_pdf([((50, 50), (250, 50), 1), ((50, 54), (250, 54), 1)])
        result = bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, 10.0)
        self.assertEqual(result["source_kind"], "pdf_vector")
        candidates = [c for c in result["candidates"] if c["evidence"] == "parallel_edges"]
        self.assertTrue(candidates)
        best = max(candidates, key=lambda c: c["confidence"])
        self.assertAlmostEqual(best["start_px"]["y_px"], 104.0, delta=2.5)
        self.assertAlmostEqual(best["end_px"]["y_px"], 104.0, delta=2.5)
        self.assertGreater(best["confidence"], 0.6)

    def test_filled_strip_produces_centerline(self):
        pdf = make_pdf([], filled=fitz.Rect(50, 100, 250, 110))
        result = bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, 10.0)
        strips = [c for c in result["candidates"] if c["evidence"] == "filled_strip"]
        self.assertTrue(strips)
        self.assertAlmostEqual(strips[0]["width_px"], 20.0, delta=3.0)

    def test_diagonal_vector_pair_is_not_forced_orthogonal(self):
        pdf = make_pdf([((40, 40), (200, 200), 1), ((40, 44), (200, 204), 1)])
        result = bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, 10.0)
        diagonal = [
            c
            for c in result["candidates"]
            if c["evidence"] == "parallel_edges"
            and abs(c["end_px"]["x_px"] - c["start_px"]["x_px"]) > 20
            and abs(c["end_px"]["y_px"] - c["start_px"]["y_px"]) > 20
        ]
        self.assertTrue(diagonal)

    def test_blank_and_text_only_pages_have_no_confident_candidates(self):
        blank = make_pdf([], text="TITLE BLOCK LEGEND NOTES 1234")
        result = bg.extract_blueprint_guides(blank, "pdf_vector", 1, None, 10.0)
        confident = [c for c in result["candidates"] if c["confidence"] >= 0.65]
        self.assertEqual(confident, [])
        self.assertIn("no_confident_centerline_candidates", result["warnings"])

    def test_raster_parallel_lines_and_roi_offset(self):
        def draw(image):
            cv2.line(image, (210, 150), (350, 150), (0, 0, 0), 2)
            cv2.line(image, (210, 158), (350, 158), (0, 0, 0), 2)

        raster = make_raster(draw)
        roi = {"x": 190, "y": 130, "width": 180, "height": 60}
        result = bg.extract_blueprint_guides(raster, "raster_image", 1, roi, 10.0)
        self.assertEqual(result["source_kind"], "raster_image")
        candidates = [c for c in result["candidates"] if c["confidence"] >= 0.65]
        self.assertTrue(candidates)
        self.assertTrue(all(c["start_px"]["x_px"] >= 190 for c in candidates))
        self.assertTrue(all(140 <= c["start_px"]["y_px"] <= 170 for c in candidates))

    def test_raster_filled_strip(self):
        def draw(image):
            cv2.rectangle(image, (60, 100), (300, 112), (0, 0, 0), -1)

        raster = make_raster(draw)
        result = bg.extract_blueprint_guides(raster, "raster_image", 1, None, 10.0)
        strips = [c for c in result["candidates"] if c["evidence"] == "filled_strip"]
        self.assertTrue(strips)

    def test_page_out_of_range_and_corrupt_file(self):
        pdf = make_pdf([((20, 20), (100, 20), 1)])
        with self.assertRaises(bg.GuideError) as ctx:
            bg.extract_blueprint_guides(pdf, "pdf_vector", 9, None, 10.0)
        self.assertEqual(ctx.exception.status_code, 422)
        with self.assertRaises(bg.GuideError) as ctx:
            bg.extract_blueprint_guides(b"not a pdf", "pdf_vector", 1, None, 10.0)
        self.assertEqual(ctx.exception.status_code, 415)
        with self.assertRaises(bg.GuideError) as ctx:
            bg.extract_blueprint_guides(b"not an image", "raster_image", 1, None, 10.0)
        self.assertEqual(ctx.exception.status_code, 415)

    def test_nonfinite_scale_and_roi_are_rejected(self):
        pdf = make_pdf([((20, 20), (100, 20), 1)])
        for scale in (float("nan"), float("inf"), 0, -2):
            with self.assertRaises(bg.GuideError) as ctx:
                bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, scale)
            self.assertEqual(ctx.exception.status_code, 422)
        roi = {"x": float("nan"), "y": 0, "width": 100, "height": 100}
        with self.assertRaises(bg.GuideError) as ctx:
            bg.extract_blueprint_guides(pdf, "pdf_vector", 1, roi, 10.0)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_roi_outside_image_is_rejected(self):
        pdf = make_pdf([((20, 20), (100, 20), 1)])
        roi = {"x": 750, "y": 0, "width": 100, "height": 100}
        with self.assertRaises(bg.GuideError) as ctx:
            bg.extract_blueprint_guides(pdf, "pdf_vector", 1, roi, 10.0)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_file_and_pixel_limits(self):
        pdf = make_pdf([((20, 20), (100, 20), 1)])
        with mock.patch.object(bg, "MAX_FILE_BYTES", 10):
            with self.assertRaises(bg.GuideError) as ctx:
                bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, 10.0)
            self.assertEqual(ctx.exception.status_code, 413)
        raster = make_raster(lambda image: None)
        with mock.patch.object(bg, "MAX_RENDER_PIXELS", 100):
            with self.assertRaises(bg.GuideError) as ctx:
                bg.extract_blueprint_guides(raster, "raster_image", 1, None, 10.0)
            self.assertEqual(ctx.exception.status_code, 413)

    def test_segment_limit_is_rejected(self):
        pdf = make_pdf([((20, 20), (300, 20), 1), ((20, 40), (300, 40), 1)])
        with mock.patch.object(bg, "MAX_RAW_SEGMENTS", 0):
            with self.assertRaises(bg.GuideError) as ctx:
                bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, 10.0)
            self.assertEqual(ctx.exception.status_code, 422)

    def test_missing_or_zero_roi_is_rejected_before_cache_lookup(self):
        pdf = make_pdf([((50, 50), (250, 50), 1), ((50, 54), (250, 54), 1)])
        bg.extract_blueprint_guides_cached(pdf, "pdf_vector", 1, None, 10.0)
        for bad_roi in (
            {"x": 1},
            {"x": 0, "y": 0, "width": 0, "height": 0},
            {"x": 0, "y": 0, "width": 100, "height": float("inf")},
        ):
            with self.assertRaises(bg.GuideError) as ctx:
                bg.extract_blueprint_guides_cached(pdf, "pdf_vector", 1, bad_roi, 10.0)
            self.assertEqual(ctx.exception.status_code, 422)

    def test_cache_key_changes_with_page_roi_and_scale(self):
        roi = {"x": 10, "y": 10, "width": 100, "height": 100}
        base = bg.cache_key("digest", 1, roi, 10.0)
        self.assertNotEqual(base, bg.cache_key("digest", 2, roi, 10.0))
        self.assertNotEqual(base, bg.cache_key("digest", 1, {**roi, "x": 12}, 10.0))
        self.assertNotEqual(base, bg.cache_key("digest", 1, roi, 20.0))
        self.assertNotEqual(base, bg.cache_key("other", 1, roi, 10.0))

    def test_cached_result_is_reused_and_lru_is_bounded(self):
        pdf = make_pdf([((50, 50), (250, 50), 1), ((50, 54), (250, 54), 1)])
        first = bg.extract_blueprint_guides_cached(pdf, "pdf_vector", 1, None, 10.0)
        second = bg.extract_blueprint_guides_cached(pdf, "pdf_vector", 1, None, 10.0)
        self.assertIs(first, second)
        for index in range(12):
            roi = {"x": 0, "y": 0, "width": 300 + index, "height": 300}
            bg.extract_blueprint_guides_cached(pdf, "pdf_vector", 1, roi, 10.0)
        self.assertLessEqual(len(bg._CACHE), bg.MAX_CACHE_ENTRIES)

    def test_finite_positions_and_bounded_candidates(self):
        pdf = make_pdf([((50, 50), (350, 50), 1), ((50, 54), (350, 54), 1)])
        result = bg.extract_blueprint_guides(pdf, "pdf_vector", 1, None, 10.0)
        self.assertLessEqual(len(result["candidates"]), bg.MAX_CANDIDATES)
        for candidate in result["candidates"]:
            for point in (candidate["start_px"], candidate["end_px"]):
                self.assertTrue(math.isfinite(point["x_px"]))
                self.assertTrue(math.isfinite(point["y_px"]))
            self.assertTrue(math.isfinite(candidate["confidence"]))
            self.assertGreater(candidate["width_px"], 0)


if __name__ == "__main__":
    unittest.main()
