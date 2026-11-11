"""
Sitestry.AI — Blueprint centerline guide detector.

Derives advisory wall-centerline candidates from the actual drawing source:
vector PDFs are read page-by-page with PyMuPDF, rasters with OpenCV. The
detector never reuses the extraction result and never mutates the editable
project. Coordinates are canonical source pixels (2.0x PDF render or native
raster pixels).
"""

from __future__ import annotations

import hashlib
import io
import math
from collections import OrderedDict
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import fitz
import numpy as np
from PIL import Image

DETECTOR_VERSION = "blueprint-guides-v1"
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_RENDER_PIXELS = 16_000_000
MAX_RAW_SEGMENTS = 20_000
MAX_PAIRING_SEGMENTS = 8_000
MAX_CANDIDATES = 5_000
MAX_CACHE_ENTRIES = 8
PDF_RENDER_FACTOR = 2.0


class GuideError(Exception):
    """Structured validation failure surfaced by the API as 4xx."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message

    def detail(self) -> Dict[str, str]:
        return {"error": self.code, "message": self.message}


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _validate_roi(roi_px: Optional[Dict[str, Any]], width: int, height: int) -> Dict[str, float]:
    if roi_px is None:
        return {"x": 0.0, "y": 0.0, "width": float(width), "height": float(height)}
    for key in ("x", "y", "width", "height"):
        if key not in roi_px or not _finite(roi_px[key]):
            raise GuideError(422, "invalid_roi", f"roi_px.{key} must be a finite number.")
    x = float(roi_px["x"])
    y = float(roi_px["y"])
    w = float(roi_px["width"])
    h = float(roi_px["height"])
    if w <= 1 or h <= 1:
        raise GuideError(422, "invalid_roi", "roi_px width and height must be greater than 1 px.")
    if x < -0.5 or y < -0.5 or x + w > width + 0.5 or y + h > height + 0.5:
        raise GuideError(422, "roi_out_of_bounds", "roi_px must lie inside the rendered image.")
    x = max(0.0, x)
    y = max(0.0, y)
    w = min(w, width - x)
    h = min(h, height - y)
    return {"x": x, "y": y, "width": w, "height": h}


def _segment(a: Tuple[float, float], b: Tuple[float, float]) -> Optional[Dict[str, Any]]:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length < 4 or not math.isfinite(length):
        return None
    angle = math.atan2(b[1] - a[1], b[0] - a[0])
    return {
        "a": (float(a[0]), float(a[1])),
        "b": (float(b[0]), float(b[1])),
        "length": length,
        "angle": angle,
    }


def _inside_roi(seg: Dict[str, Any], roi: Dict[str, float]) -> bool:
    x1, y1 = seg["a"]
    x2, y2 = seg["b"]
    xmin, ymin = roi["x"], roi["y"]
    xmax, ymax = xmin + roi["width"], ymin + roi["height"]
    return (
        xmin - 2 <= (x1 + x2) / 2 <= xmax + 2
        and ymin - 2 <= (y1 + y2) / 2 <= ymax + 2
    )


def _clip_segment(seg: Dict[str, Any], roi: Dict[str, float]) -> Optional[Dict[str, Any]]:
    from shapely.geometry import LineString, box  # local import keeps module import light

    line = LineString([seg["a"], seg["b"]])
    clipped = line.intersection(box(roi["x"], roi["y"], roi["x"] + roi["width"], roi["y"] + roi["height"]))
    if clipped.is_empty or clipped.geom_type != "LineString":
        return None
    coords = list(clipped.coords)
    if len(coords) < 2:
        return None
    return _segment(coords[0], coords[-1])


def _angle_diff(a: float, b: float) -> float:
    diff = abs(math.degrees(a - b)) % 180
    if diff > 90:
        diff = 180 - diff
    return diff


def _candidate_id(index: int) -> str:
    return f"g_{index}"


def _pair_segments(segments: Iterable[Dict[str, Any]], warnings: List[str]) -> List[Dict[str, Any]]:
    segs = [s for s in segments if s and s["length"] >= 8]
    if len(segs) > MAX_PAIRING_SEGMENTS:
        segs = segs[:MAX_PAIRING_SEGMENTS]
        warnings.append(f"pairing_limited_to_{MAX_PAIRING_SEGMENTS}_segments")
    if len(segs) > MAX_RAW_SEGMENTS:
        raise GuideError(422, "too_many_segments", "Too many raw drawing segments in ROI.")

    buckets: Dict[int, List[Dict[str, Any]]] = {}
    for seg in segs:
        bucket = int(round(math.degrees(seg["angle"]) / 3.0)) % 60
        buckets.setdefault(bucket, []).append(seg)

    candidates: List[Dict[str, Any]] = []
    pair_budget = MAX_CANDIDATES * 4
    for group in buckets.values():
        if len(group) < 2:
            continue
        # Sort by perpendicular offset so parallel neighbours are adjacent.
        ref_angle = group[0]["angle"]
        nx, ny = -math.sin(ref_angle), math.cos(ref_angle)
        group.sort(key=lambda s: (s["a"][0] + s["b"][0]) * nx + (s["a"][1] + s["b"][1]) * ny)
        for i in range(len(group)):
            for j in range(i + 1, min(i + 10, len(group))):
                a, b = group[i], group[j]
                if _angle_diff(a["angle"], b["angle"]) > 3.0:
                    continue
                ux, uy = math.cos(a["angle"]), math.sin(a["angle"])
                normal_x, normal_y = -uy, ux
                mx = (b["a"][0] + b["b"][0] - a["a"][0] - a["b"][0]) / 2
                my = (b["a"][1] + b["b"][1] - a["a"][1] - a["b"][1]) / 2
                separation = abs(mx * normal_x + my * normal_y)
                if separation < 1.5 or separation > 30:
                    continue

                def proj(point: Tuple[float, float]) -> float:
                    return point[0] * ux + point[1] * uy

                a0, a1 = sorted((proj(a["a"]), proj(a["b"])))
                b0, b1 = sorted((proj(b["a"]), proj(b["b"])))
                start = max(a0, b0)
                end = min(a1, b1)
                overlap = end - start
                if overlap < max(8.0, 0.5 * min(a["length"], b["length"])):
                    continue
                overlap_ratio = overlap / max(1.0, min(a["length"], b["length"]))

                def point_at(seg: Dict[str, Any], t: float) -> Tuple[float, float]:
                    p0 = proj(seg["a"])
                    return (
                        seg["a"][0] + ux * (t - p0),
                        seg["a"][1] + uy * (t - p0),
                    )

                c1 = point_at(a, start)
                c2 = point_at(b, start)
                c3 = point_at(a, end)
                c4 = point_at(b, end)
                center_a = ((c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2)
                center_b = ((c3[0] + c4[0]) / 2, (c3[1] + c4[1]) / 2)
                center = _segment(center_a, center_b)
                if not center:
                    continue
                width_score = max(0.0, 1.0 - abs(separation - 8.0) / 22.0)
                confidence = min(0.97, 0.55 + 0.25 * overlap_ratio + 0.15 * width_score)
                if confidence < 0.5:
                    continue
                candidates.append(
                    {
                        "start_px": {"x_px": round(center["a"][0], 2), "y_px": round(center["a"][1], 2)},
                        "end_px": {"x_px": round(center["b"][0], 2), "y_px": round(center["b"][1], 2)},
                        "width_px": round(separation, 2),
                        "confidence": round(confidence, 3),
                        "evidence": "parallel_edges",
                    }
                )
                if len(candidates) >= pair_budget:
                    return candidates
    return candidates


def _strip_candidate(rect: Tuple[Tuple[float, float], Tuple[float, float], Tuple[float, float], Tuple[float, float]]):
    """Build a filled-strip centerline from a rectangle/quad in reading order."""
    pts = [np.array(p, dtype=float) for p in rect]
    edges = []
    for i in range(4):
        a = pts[i]
        b = pts[(i + 1) % 4]
        length = float(np.hypot(*(b - a)))
        edges.append((length, a, b))
    edges.sort(key=lambda e: e[0])
    short1, short2 = edges[0][0], edges[1][0]
    long1, long2 = edges[2][0], edges[3][0]
    if short1 < 1.5 or short2 < 1.5 or long1 < 20:
        return None
    width = (short1 + short2) / 2
    if width > 40:
        return None
    # Centreline spans the midpoints of the two long edges.
    long_edges = edges[2:]
    mids = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for _, a, b in long_edges]
    center = _segment(mids[0], mids[1])
    if not center:
        return None
    aspect = min(long1, long2) / max(width, 0.001)
    if aspect < 2.5:
        return None
    return {
        "start_px": {"x_px": round(center["a"][0], 2), "y_px": round(center["a"][1], 2)},
        "end_px": {"x_px": round(center["b"][0], 2), "y_px": round(center["b"][1], 2)},
        "width_px": round(width, 2),
        "confidence": round(min(0.95, 0.72 + min(0.2, aspect / 60.0)), 3),
        "evidence": "filled_strip",
    }


def _vector_segments(pdf_bytes: bytes, page_number: int) -> Tuple[int, int, List[Dict[str, Any]], List[Dict[str, Any]]]:
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        raise GuideError(415, "unsupported_source", "The uploaded PDF could not be opened.")
    if page_number < 1 or page_number > len(doc):
        raise GuideError(422, "page_out_of_range", f"page_number must be 1..{len(doc)}.")
    page = doc[page_number - 1]
    projected_pixels = int(page.rect.width * PDF_RENDER_FACTOR) * int(page.rect.height * PDF_RENDER_FACTOR)
    if projected_pixels > MAX_RENDER_PIXELS:
        raise GuideError(
            413,
            "image_too_large",
            f"Rendered page has {projected_pixels} pixels; limit is {MAX_RENDER_PIXELS}.",
        )
    matrix = fitz.Matrix(PDF_RENDER_FACTOR, PDF_RENDER_FACTOR)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    width, height = pix.width, pix.height

    segments: List[Dict[str, Any]] = []
    strips: List[Dict[str, Any]] = []
    for drawing in page.get_drawings():
        for item in drawing.get("items", []):
            kind = item[0]
            if kind == "l":
                p1, p2 = item[1], item[2]
                seg = _segment(
                    (p1.x * PDF_RENDER_FACTOR, p1.y * PDF_RENDER_FACTOR),
                    (p2.x * PDF_RENDER_FACTOR, p2.y * PDF_RENDER_FACTOR),
                )
                if seg:
                    segments.append(seg)
            elif kind == "re":
                rect = item[1]
                quad = (
                    (rect.x0 * PDF_RENDER_FACTOR, rect.y0 * PDF_RENDER_FACTOR),
                    (rect.x1 * PDF_RENDER_FACTOR, rect.y0 * PDF_RENDER_FACTOR),
                    (rect.x1 * PDF_RENDER_FACTOR, rect.y1 * PDF_RENDER_FACTOR),
                    (rect.x0 * PDF_RENDER_FACTOR, rect.y1 * PDF_RENDER_FACTOR),
                )
                if drawing.get("fill") is not None:
                    cand = _strip_candidate(quad)
                    if cand:
                        strips.append(cand)
                for i in range(4):
                    seg = _segment(quad[i], quad[(i + 1) % 4])
                    if seg:
                        segments.append(seg)
            elif kind == "qu":
                quad = item[1]
                pts = (
                    (quad.ul.x * PDF_RENDER_FACTOR, quad.ul.y * PDF_RENDER_FACTOR),
                    (quad.ur.x * PDF_RENDER_FACTOR, quad.ur.y * PDF_RENDER_FACTOR),
                    (quad.lr.x * PDF_RENDER_FACTOR, quad.lr.y * PDF_RENDER_FACTOR),
                    (quad.ll.x * PDF_RENDER_FACTOR, quad.ll.y * PDF_RENDER_FACTOR),
                )
                if drawing.get("fill") is not None:
                    cand = _strip_candidate(pts)
                    if cand:
                        strips.append(cand)
                for i in range(4):
                    seg = _segment(pts[i], pts[(i + 1) % 4])
                    if seg:
                        segments.append(seg)
    if len(segments) > MAX_RAW_SEGMENTS:
        raise GuideError(422, "too_many_segments", "Raw drawing segment limit exceeded.")
    return width, height, segments, strips


def _precheck_raster_dimensions(source_bytes: bytes) -> None:
    """Read compressed header dimensions before allocating the decoded bitmap."""
    try:
        with Image.open(io.BytesIO(source_bytes)) as probe:
            width, height = probe.size
    except Exception:
        return  # cv2.imdecode below produces the structured 415.
    if width * height > MAX_RENDER_PIXELS:
        raise GuideError(
            413,
            "image_too_large",
            f"Image has {width * height} pixels; limit is {MAX_RENDER_PIXELS}.",
        )


def _decode_raster(source_bytes: bytes) -> np.ndarray:
    _precheck_raster_dimensions(source_bytes)
    arr = np.frombuffer(source_bytes, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise GuideError(415, "unsupported_source", "The uploaded image could not be decoded.")
    return image


def _raster_segments(image: np.ndarray, roi: Dict[str, float]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    x, y, w, h = (int(round(roi["x"])), int(round(roi["y"])), int(round(roi["width"])), int(round(roi["height"])))
    crop = image[y : y + h, x : x + w]
    if crop.size == 0:
        return [], []
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    edges = cv2.Canny(gray, 60, 160, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 360,
        threshold=30,
        minLineLength=20,
        maxLineGap=4,
    )
    segments: List[Dict[str, Any]] = []
    if lines is not None:
        if len(lines) > MAX_RAW_SEGMENTS:
            raise GuideError(422, "too_many_segments", "Raw raster segment limit exceeded.")
        for line in lines:
            x1, y1, x2, y2 = [int(v) for v in np.ravel(line)[:4]]
            seg = _segment((x1 + x, y1 + y), (x2 + x, y2 + y))
            if seg:
                segments.append(seg)

    strips: List[Dict[str, Any]] = []
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours[:MAX_RAW_SEGMENTS]:
        area = cv2.contourArea(contour)
        if area < 120:
            continue
        rect = cv2.minAreaRect(contour)
        (cx, cy), (rw, rh), angle = rect
        long_side, short_side = max(rw, rh), min(rw, rh)
        if short_side < 1.5 or short_side > 40 or long_side < 20:
            continue
        if area / max(1.0, rw * rh) < 0.55:
            continue
        axis_angle = angle if rw >= rh else angle + 90.0
        theta = math.radians(axis_angle)
        ux, uy = math.cos(theta), math.sin(theta)
        half = long_side / 2
        center = {
            "start_px": {
                "x_px": round(cx + x - ux * half, 2),
                "y_px": round(cy + y - uy * half, 2),
            },
            "end_px": {
                "x_px": round(cx + x + ux * half, 2),
                "y_px": round(cy + y + uy * half, 2),
            },
            "width_px": round(short_side, 2),
            "confidence": round(min(0.95, 0.7 + min(0.2, long_side / 400.0)), 3),
            "evidence": "filled_strip",
        }
        strips.append(center)
    return segments, strips


def _deduplicate(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    best: Dict[Tuple[int, int, int], Dict[str, Any]] = {}
    for cand in candidates:
        sx, sy = cand["start_px"]["x_px"], cand["start_px"]["y_px"]
        ex, ey = cand["end_px"]["x_px"], cand["end_px"]["y_px"]
        angle = math.atan2(ey - sy, ex - sx)
        key = (
            int(round((sx + ex) / 2 / 8)),
            int(round((sy + ey) / 2 / 8)),
            int(round(math.degrees(angle) / 4)) % 45,
        )
        existing = best.get(key)
        cand_score = cand["confidence"] + (0.06 if cand["evidence"] == "filled_strip" else 0.0)
        existing_score = (
            existing["confidence"] + (0.06 if existing["evidence"] == "filled_strip" else 0.0)
            if existing
            else -1.0
        )
        if cand_score > existing_score:
            best[key] = cand
    ordered = sorted(best.values(), key=lambda c: c["confidence"], reverse=True)[:MAX_CANDIDATES]
    for index, cand in enumerate(ordered):
        cand["id"] = _candidate_id(index + 1)
    return ordered


def extract_blueprint_guides(
    source_bytes: bytes,
    source_kind: str,
    page_number: int = 1,
    roi_px: Optional[Dict[str, Any]] = None,
    scale_px_per_meter: Optional[float] = None,
) -> Dict[str, Any]:
    """Detect advisory wall-centerline candidates from the actual drawing."""
    if not isinstance(source_bytes, (bytes, bytearray)) or len(source_bytes) == 0:
        raise GuideError(400, "empty_source", "Source bytes are required.")
    if len(source_bytes) > MAX_FILE_BYTES:
        raise GuideError(413, "file_too_large", f"Source exceeds {MAX_FILE_BYTES} bytes.")
    kind = (source_kind or "").lower()
    if kind not in ("pdf_vector", "pdf", "raster", "raster_image"):
        raise GuideError(415, "unsupported_source", "source_kind must be pdf_vector or raster_image.")
    if not _finite(page_number) or int(page_number) < 1:
        raise GuideError(422, "page_out_of_range", "page_number must be a positive integer.")
    if scale_px_per_meter is not None and (not _finite(scale_px_per_meter) or float(scale_px_per_meter) <= 0):
        raise GuideError(422, "invalid_scale", "scale_px_per_meter must be a positive finite number.")

    warnings: List[str] = []
    strips: List[Dict[str, Any]] = []
    if kind in ("pdf_vector", "pdf"):
        width, height, segments, vector_strips = _vector_segments(source_bytes, int(page_number))
        strips.extend(vector_strips)
        rendered_kind = "pdf_vector"
    else:
        image = _decode_raster(source_bytes)
        height, width = image.shape[:2]
        rendered_kind = "raster_image"
        if width * height > MAX_RENDER_PIXELS:
            raise GuideError(
                413,
                "image_too_large",
                f"Image has {width * height} pixels; limit is {MAX_RENDER_PIXELS}.",
            )

    if width * height > MAX_RENDER_PIXELS:
        raise GuideError(
            413,
            "image_too_large",
            f"Rendered drawing has {width * height} pixels; limit is {MAX_RENDER_PIXELS}.",
        )

    roi = _validate_roi(roi_px, width, height)

    if rendered_kind == "raster_image":
        segments, raster_strips = _raster_segments(image, roi)
        strips.extend(raster_strips)
    else:
        segments = [
            clipped
            for seg in segments
            if _inside_roi(seg, roi)
            for clipped in [_clip_segment(seg, roi)]
            if clipped is not None
        ]

    candidates = _pair_segments(segments, warnings)
    candidates.extend(strips)
    candidates = _deduplicate(candidates)
    if len(candidates) > MAX_CANDIDATES:
        candidates = candidates[:MAX_CANDIDATES]
    if not candidates:
        warnings.append("no_confident_centerline_candidates")

    return {
        "source_digest": hashlib.sha256(bytes(source_bytes)).hexdigest(),
        "detector_version": DETECTOR_VERSION,
        "source_kind": rendered_kind,
        "image_width_px": width,
        "image_height_px": height,
        "roi_px": roi,
        "candidates": candidates,
        "warnings": warnings,
    }


_CACHE: "OrderedDict[Tuple[Any, ...], Dict[str, Any]]" = OrderedDict()


def _prevalidate_roi(roi_px: Optional[Dict[str, Any]]) -> Optional[Dict[str, float]]:
    if roi_px is None:
        return None
    if not isinstance(roi_px, dict):
        raise GuideError(422, "invalid_roi", "roi_px must be an object.")
    for key in ("x", "y", "width", "height"):
        if key not in roi_px or not _finite(roi_px[key]):
            raise GuideError(422, "invalid_roi", f"roi_px.{key} must be a finite number.")
    width = float(roi_px["width"])
    height = float(roi_px["height"])
    if width <= 1 or height <= 1:
        raise GuideError(422, "invalid_roi", "roi_px width and height must be greater than 1 px.")
    return {
        "x": float(roi_px["x"]),
        "y": float(roi_px["y"]),
        "width": width,
        "height": height,
    }


def cache_key(
    source_digest: str,
    page_number: int,
    roi: Optional[Dict[str, float]],
    scale: Optional[float],
) -> Tuple[Any, ...]:
    roi_key = (
        None
        if roi is None
        else (
            round(float(roi["x"]), 2),
            round(float(roi["y"]), 2),
            round(float(roi["width"]), 2),
            round(float(roi["height"]), 2),
        )
    )
    return (
        DETECTOR_VERSION,
        source_digest,
        int(page_number),
        roi_key,
        None if scale is None else round(float(scale), 4),
        PDF_RENDER_FACTOR,
    )


def extract_blueprint_guides_cached(
    source_bytes: bytes,
    source_kind: str,
    page_number: int = 1,
    roi_px: Optional[Dict[str, Any]] = None,
    scale_px_per_meter: Optional[float] = None,
) -> Dict[str, Any]:
    digest = hashlib.sha256(bytes(source_bytes)).hexdigest()
    prevalidated_roi = _prevalidate_roi(roi_px)
    key = cache_key(digest, page_number, prevalidated_roi, scale_px_per_meter)
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    result = extract_blueprint_guides(
        source_bytes,
        source_kind,
        page_number=page_number,
        roi_px=roi_px,
        scale_px_per_meter=scale_px_per_meter,
    )
    final_key = cache_key(result["source_digest"], page_number, result["roi_px"], scale_px_per_meter)
    _CACHE[final_key] = result
    _CACHE.move_to_end(final_key)
    if key != final_key:
        _CACHE[key] = result
        _CACHE.move_to_end(key)
    while len(_CACHE) > MAX_CACHE_ENTRIES:
        _CACHE.popitem(last=False)
    return result


def clear_cache() -> None:
    _CACHE.clear()
