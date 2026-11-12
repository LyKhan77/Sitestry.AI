"""
Sitestry.AI — single-workspace storage.

One workspace = one project. The folder holds the original source file
(`source.<ext>`), the saved project (`project.json`) and `meta.json`.
Every write goes through a temp file and `os.replace`, so a failed write never
leaves a half-written file behind.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

THUMBNAIL_MAX_CHARS = 300 * 1024
SOURCE_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}

# Keys the client may set. `saved_at`, `created_at` and `source` are server-owned.
META_KEYS = {
    "title",
    "page_number",
    "total_pages",
    "roi_px",
    "scale_px_per_meter",
    "image_width_px",
    "image_height_px",
    "stage_reached",
    "extracted",
    "saved_hash",
    "built_hash",
    "thumbnail",
    "counts",
}


class WorkspaceError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _clean_meta(meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    clean = {k: v for k, v in (meta or {}).items() if k in META_KEYS}
    thumb = clean.get("thumbnail")
    if isinstance(thumb, str) and len(thumb) > THUMBNAIL_MAX_CHARS:
        raise WorkspaceError(413, "Thumbnail exceeds the 300 KB limit.")
    return clean


class WorkspaceStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self._lock = threading.Lock()

    # ---------- reads ----------
    def _meta_path(self) -> Path:
        return self.root / "meta.json"

    def _project_path(self) -> Path:
        return self.root / "project.json"

    def _read_meta(self) -> Dict[str, Any]:
        return json.loads(self._meta_path().read_text())

    def summary(self) -> Dict[str, Any]:
        if not self.root.exists():
            return {"exists": False}
        try:
            meta = self._read_meta()
        except (OSError, ValueError) as exc:
            return {"exists": True, "error": f"meta.json unreadable: {exc}", "meta": None, "has_project": False}
        has_project = self._project_path().exists()
        if has_project:
            try:
                json.loads(self._project_path().read_text())
            except (OSError, ValueError) as exc:
                return {"exists": True, "error": f"project.json unreadable: {exc}", "meta": None, "has_project": False}
        return {"exists": True, "meta": meta, "has_project": has_project}

    def read_source(self) -> Tuple[bytes, str]:
        try:
            meta = self._read_meta()
            filename = meta["source"]["filename"]
            ext = Path(filename).suffix.lower()
            return (self.root / f"source{ext}").read_bytes(), filename
        except (OSError, ValueError, KeyError):
            raise WorkspaceError(404, "No source in the workspace.")

    def read_project(self) -> Dict[str, Any]:
        try:
            return json.loads(self._project_path().read_text())
        except (OSError, ValueError):
            raise WorkspaceError(404, "No saved project in the workspace.")

    # ---------- writes ----------
    def create(
        self,
        source_bytes: bytes,
        filename: str,
        kind: str,
        sample_id: Optional[str],
        meta: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        ext = Path(filename).suffix.lower()
        if ext not in SOURCE_EXTENSIONS:
            raise WorkspaceError(400, f"Unsupported file type: {ext or 'none'}")
        clean = _clean_meta(meta)
        with self._lock:
            shutil.rmtree(self.root, ignore_errors=True)
            self.root.mkdir(parents=True, exist_ok=True)
            _atomic_write(self.root / f"source{ext}", source_bytes)
            full = {
                "source": {"filename": filename, "kind": kind, "sample_id": sample_id},
                "title": filename,
                "page_number": 1,
                "total_pages": 1,
                "roi_px": None,
                "scale_px_per_meter": None,
                "image_width_px": None,
                "image_height_px": None,
                "stage_reached": 1,
                "extracted": False,
                "saved_hash": None,
                "built_hash": None,
                "saved_at": None,
                "created_at": _now(),
                "thumbnail": None,
                "counts": {"walls": 0, "openings": 0, "columns": 0, "stairs": 0, "rooms": 0},
            }
            full.update(clean)
            _atomic_write(self._meta_path(), json.dumps(full).encode())
        return self.summary()

    def save_project(self, project: Dict[str, Any], meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        clean = _clean_meta(meta)
        with self._lock:
            if not self._meta_path().exists():
                raise WorkspaceError(409, "No workspace. Upload a floorplan first.")
            current = self._read_meta()
            _atomic_write(self._project_path(), json.dumps(project).encode())
            current.update(clean)
            current["saved_at"] = _now()
            _atomic_write(self._meta_path(), json.dumps(current).encode())
        return self.summary()

    def patch_meta(self, meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        clean = _clean_meta(meta)
        with self._lock:
            if not self._meta_path().exists():
                raise WorkspaceError(409, "No workspace. Upload a floorplan first.")
            current = self._read_meta()
            current.update(clean)
            _atomic_write(self._meta_path(), json.dumps(current).encode())
        return self.summary()

    def delete(self) -> None:
        with self._lock:
            shutil.rmtree(self.root, ignore_errors=True)
