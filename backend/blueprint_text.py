"""
Sitestry.AI — text on the blueprint through OCR.

The sample PDFs have no text layer (labels are plotted as vector outlines), so room names have to be
read from the rendered page. RapidOCR runs once per (source, page); the result is cached.
Coordinates come back in blueprint pixels: PDF points times 2.0 (the scale `cad_parser` uses) or the
source pixels of a raster image.
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from typing import Any, Dict

import cv2
import fitz  # PyMuPDF
import numpy as np

PDF_PX_PER_POINT = 2.0
PDF_RENDER_ZOOM = 3.0
RASTER_UPSCALE_BELOW_PX = 2400
CACHE_SIZE = 8


class OcrUnavailable(Exception):
    """The OCR engine package is not installed."""


_engine = None
_engine_lock = threading.Lock()
_cache: "OrderedDict[tuple, Dict[str, Any]]" = OrderedDict()
_cache_lock = threading.Lock()


def load_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
            except ImportError as exc:
                raise OcrUnavailable(str(exc))
            _engine = RapidOCR()
        return _engine


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _render_pdf(source_bytes: bytes, page_number: int):
    doc = fitz.open(stream=source_bytes, filetype="pdf")
    try:
        page = doc[max(0, min(len(doc) - 1, page_number - 1))]
        pix = page.get_pixmap(matrix=fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM), alpha=False)
        image = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3]
        image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        width = round(page.rect.width * PDF_PX_PER_POINT)
        height = round(page.rect.height * PDF_PX_PER_POINT)
        return image, PDF_PX_PER_POINT / PDF_RENDER_ZOOM, width, height
    finally:
        doc.close()


def _decode_raster(source_bytes: bytes):
    image = cv2.imdecode(np.frombuffer(source_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Source is not a readable image.")
    height, width = image.shape[:2]
    factor = 2.0 if max(height, width) < RASTER_UPSCALE_BELOW_PX else 1.0
    if factor != 1.0:
        image = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
    return image, 1.0 / factor, width, height


def extract_text_boxes(source_bytes: bytes, kind: str, page_number: int = 1) -> Dict[str, Any]:
    key = (hashlib.sha1(source_bytes).hexdigest(), kind, page_number)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]

    if kind == "pdf_vector":
        image, to_px, width, height = _render_pdf(source_bytes, page_number)
    else:
        image, to_px, width, height = _decode_raster(source_bytes)

    result, _ = load_engine()(image)
    texts = []
    for box, text, confidence in result or []:
        xs = [point[0] * to_px for point in box]
        ys = [point[1] * to_px for point in box]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        texts.append(
            {
                "text": str(text),
                "confidence": float(confidence),
                "box": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                "cx": round((x0 + x1) / 2, 1),
                "cy": round((y0 + y1) / 2, 1),
                "height": round(y1 - y0, 1),
            }
        )
    out = {"image_width_px": int(width), "image_height_px": int(height), "texts": texts}

    with _cache_lock:
        _cache[key] = out
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return out
