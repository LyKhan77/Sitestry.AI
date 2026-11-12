from __future__ import annotations

import re
import sys
from pathlib import Path

import cv2
import fitz
import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import blueprint_text as bt  # noqa: E402
import main  # noqa: E402


class FakeEngine:
    """Stands in for RapidOCR: returns canned boxes and records what it was given."""

    def __init__(self, result):
        self.result = result
        self.calls = 0
        self.last_shape = None

    def __call__(self, image):
        self.calls += 1
        self.last_shape = image.shape
        return self.result, None


@pytest.fixture(autouse=True)
def clean_cache():
    bt.clear_cache()
    yield
    bt.clear_cache()


def png_bytes(width=200, height=100, text=None):
    image = np.full((height, width, 3), 255, np.uint8)
    if text:
        cv2.putText(image, text, (20, height - 30), cv2.FONT_HERSHEY_SIMPLEX, 3, (0, 0, 0), 6)
    ok, buf = cv2.imencode(".png", image)
    assert ok
    return buf.tobytes()


def norm(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def test_reads_large_synthetic_text():
    pytest.importorskip("rapidocr_onnxruntime")
    data = png_bytes(width=700, height=260, text="PANTRY")
    result = bt.extract_text_boxes(data, "raster", 1)
    hits = [t for t in result["texts"] if "pantry" in norm(t["text"])]
    assert hits, result["texts"]
    assert 20 <= hits[0]["cx"] <= 680 and 40 <= hits[0]["cy"] <= 240
    assert result["image_width_px"] == 700 and result["image_height_px"] == 260


def test_second_call_is_served_from_the_cache(monkeypatch):
    engine = FakeEngine([([[0, 0], [10, 0], [10, 5], [0, 5]], "ROOM", 0.9)])
    monkeypatch.setattr(bt, "load_engine", lambda: engine)
    data = png_bytes()
    first = bt.extract_text_boxes(data, "raster", 1)
    second = bt.extract_text_boxes(data, "raster", 1)
    assert engine.calls == 1
    assert first == second
    bt.extract_text_boxes(data, "raster", 2)
    assert engine.calls == 2


def test_raster_is_upscaled_and_coordinates_are_mapped_back(monkeypatch):
    engine = FakeEngine([([[100, 40], [300, 40], [300, 80], [100, 80]], "Pantry", 0.95)])
    monkeypatch.setattr(bt, "load_engine", lambda: engine)
    result = bt.extract_text_boxes(png_bytes(200, 100), "raster", 1)
    assert engine.last_shape[:2] == (200, 400)
    text = result["texts"][0]
    assert text["box"] == [50.0, 20.0, 150.0, 40.0]
    assert (text["cx"], text["cy"], text["height"]) == (100.0, 30.0, 20.0)
    assert text["text"] == "Pantry" and text["confidence"] == 0.95
    assert (result["image_width_px"], result["image_height_px"]) == (200, 100)


def test_pdf_coordinates_use_the_extraction_pixel_scale(monkeypatch):
    doc = fitz.open()
    doc.new_page(width=400, height=300)
    data = doc.tobytes()
    doc.close()
    engine = FakeEngine([([[300, 150], [600, 150], [600, 210], [300, 210]], "GUDANG", 0.9)])
    monkeypatch.setattr(bt, "load_engine", lambda: engine)
    result = bt.extract_text_boxes(data, "pdf_vector", 1)
    assert (result["image_width_px"], result["image_height_px"]) == (800, 600)
    assert engine.last_shape[:2] == (900, 1200)
    text = result["texts"][0]
    assert text["box"] == [200.0, 100.0, 400.0, 140.0]
    assert (text["cx"], text["cy"]) == (300.0, 120.0)


def test_invalid_image_raises_value_error(monkeypatch):
    monkeypatch.setattr(bt, "load_engine", lambda: FakeEngine([]))
    with pytest.raises(ValueError):
        bt.extract_text_boxes(b"not an image", "raster", 1)


def test_missing_engine_raises_ocr_unavailable(monkeypatch):
    def boom():
        raise bt.OcrUnavailable("missing")

    monkeypatch.setattr(bt, "load_engine", boom)
    with pytest.raises(bt.OcrUnavailable):
        bt.extract_text_boxes(png_bytes(), "raster", 1)


client = TestClient(main.app)


def post(data=None, files=None):
    return client.post("/api/blueprint-text", data=data or {}, files=files)


def test_endpoint_returns_the_boxes(monkeypatch):
    engine = FakeEngine([([[0, 0], [20, 0], [20, 10], [0, 10]], "Pantry", 0.9)])
    monkeypatch.setattr(bt, "load_engine", lambda: engine)
    res = post(files={"file": ("plan.png", png_bytes(), "image/png")})
    assert res.status_code == 200
    assert res.json()["texts"][0]["text"] == "Pantry"


def test_endpoint_returns_503_when_ocr_is_unavailable(monkeypatch):
    def boom():
        raise bt.OcrUnavailable("missing")

    monkeypatch.setattr(bt, "load_engine", boom)
    res = post(files={"file": ("plan.png", png_bytes(), "image/png")})
    assert res.status_code == 503
    assert res.json()["detail"] == "OCR tidak tersedia"


def test_endpoint_needs_exactly_one_of_file_or_sample_id():
    assert post().status_code == 400
    both = post(data={"sample_id": "gatsu_p4"}, files={"file": ("plan.png", png_bytes(), "image/png")})
    assert both.status_code == 400


def test_endpoint_rejects_oversize_files(monkeypatch):
    monkeypatch.setattr(main, "MAX_FILE_BYTES", 10)
    assert post(files={"file": ("plan.png", png_bytes(), "image/png")}).status_code == 413


def test_endpoint_rejects_an_unreadable_image(monkeypatch):
    monkeypatch.setattr(bt, "load_engine", lambda: FakeEngine([]))
    res = post(files={"file": ("plan.png", b"garbage", "image/png")})
    assert res.status_code == 422
