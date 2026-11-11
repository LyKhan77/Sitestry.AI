from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from cad_parser import extract_from_pdf_vector  # noqa: E402
from vectorizer import extract_from_raster_image  # noqa: E402


class ExtractionBaselineTest(unittest.TestCase):
    """Locks the verified pre-redesign extraction baseline for the three samples."""

    def _pdf(self, sample_id, page, scale):
        sample = main.SAMPLES_CATALOG[sample_id]
        path = main.FLOORPLAN_DIR / sample["filename"]
        if not path.exists():
            self.skipTest(f"private sample missing: {path.name}")
        return extract_from_pdf_vector(path.read_bytes(), page, scale)

    def _raster(self):
        path = main.FLOORPLAN_DIR / "plan.jpeg"
        if not path.exists():
            self.skipTest("private sample missing: plan.jpeg")
        return extract_from_raster_image(path.read_bytes(), 38.70, filename="plan.jpeg")

    def test_gatsu_page4_baseline(self):
        data = self._pdf("gatsu_p4", 4, 30.68)
        self.assertEqual((len(data["walls"]), len(data["openings"]), len(data["columns"]), len(data["stairs"])), (86, 19, 18, 4))
        self.assertTrue(all("template_version" not in stair for stair in data["stairs"]))
        self.assertEqual([stair["bbox_px"] for stair in data["stairs"]][0], [1074.0, 486.5, 45.0, 55.2])

    def test_ancol_page13_baseline(self):
        data = self._pdf("ancol_p13", 13, 18.50)
        self.assertEqual((len(data["walls"]), len(data["openings"]), len(data["columns"]), len(data["stairs"])), (159, 55, 66, 2))
        self.assertTrue(all("template_version" not in stair for stair in data["stairs"]))

    def test_plan_jpeg_baseline(self):
        data = self._raster()
        self.assertEqual((len(data["walls"]), len(data["openings"]), len(data["columns"]), len(data["stairs"])), (90, 20, 18, 4))
        self.assertTrue(all("template_version" not in stair for stair in data["stairs"]))


if __name__ == "__main__":
    unittest.main()
