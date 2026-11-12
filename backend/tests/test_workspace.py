from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
import workspace  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "workspace_store", workspace.WorkspaceStore(tmp_path / "ws"))
    monkeypatch.delenv("SITESTRY_WORKSPACE_DIR", raising=False)
    return TestClient(main.app)


def upload(client, name="plan.png", data=PNG, meta=None):
    return client.post(
        "/api/workspace/source",
        files={"file": (name, data, "application/octet-stream")},
        data={"meta_json": json.dumps(meta or {})},
    )


def test_empty_workspace_reports_exists_false(client):
    body = client.get("/api/workspace").json()
    assert body["exists"] is False
    assert body["test_dir"] is False


def test_test_dir_flag_follows_env(client, monkeypatch):
    monkeypatch.setenv("SITESTRY_WORKSPACE_DIR", "/tmp/anything")
    assert client.get("/api/workspace").json()["test_dir"] is True


def test_upload_then_summary_reports_source_and_defaults(client):
    res = upload(client, meta={"title": "Lantai 1", "page_number": 4, "total_pages": 11})
    assert res.status_code == 200
    body = client.get("/api/workspace").json()
    assert body["exists"] is True and body["has_project"] is False
    meta = body["meta"]
    assert meta["source"]["kind"] == "image" and meta["source"]["filename"] == "plan.png"
    assert meta["title"] == "Lantai 1" and meta["page_number"] == 4 and meta["total_pages"] == 11
    assert meta["stage_reached"] == 1 and meta["extracted"] is False
    assert meta["saved_hash"] is None and meta["built_hash"] is None and meta["saved_at"] is None
    assert client.get("/api/workspace/source").content == PNG


def test_put_project_round_trips_and_sets_saved_at(client):
    upload(client)
    project = {"nodes": [{"id": "n1"}], "walls": []}
    res = client.put(
        "/api/workspace/project",
        json={"project": project, "meta": {"saved_hash": "abc", "extracted": True, "stage_reached": 3}},
    )
    assert res.status_code == 200
    assert client.get("/api/workspace/project").json() == project
    meta = client.get("/api/workspace").json()["meta"]
    assert meta["saved_hash"] == "abc" and meta["extracted"] is True and meta["stage_reached"] == 3
    assert meta["saved_at"]
    assert client.get("/api/workspace").json()["has_project"] is True


def test_put_without_workspace_returns_409(client):
    res = client.put("/api/workspace/project", json={"project": {}, "meta": {}})
    assert res.status_code == 409


def test_patch_only_accepts_whitelisted_keys(client):
    upload(client)
    res = client.patch("/api/workspace/meta", json={"built_hash": "h1", "evil": "x", "saved_at": "forged"})
    assert res.status_code == 200
    meta = client.get("/api/workspace").json()["meta"]
    assert meta["built_hash"] == "h1"
    assert "evil" not in meta
    assert meta["saved_at"] is None


def test_patch_without_workspace_returns_409(client):
    assert client.patch("/api/workspace/meta", json={"built_hash": "x"}).status_code == 409


def test_replacing_the_source_deletes_the_previous_project(client):
    upload(client)
    client.put("/api/workspace/project", json={"project": {"a": 1}, "meta": {}})
    upload(client, name="other.jpg")
    body = client.get("/api/workspace").json()
    assert body["has_project"] is False
    assert body["meta"]["source"]["filename"] == "other.jpg"
    assert client.get("/api/workspace/project").status_code == 404


def test_delete_is_idempotent(client):
    upload(client)
    assert client.delete("/api/workspace").status_code == 200
    assert client.delete("/api/workspace").status_code == 200
    assert client.get("/api/workspace").json()["exists"] is False
    assert client.get("/api/workspace/source").status_code == 404


def test_corrupt_project_reports_error_and_delete_still_works(client, tmp_path):
    upload(client)
    client.put("/api/workspace/project", json={"project": {"a": 1}, "meta": {}})
    (tmp_path / "ws" / "project.json").write_text("{not json")
    body = client.get("/api/workspace").json()
    assert body["exists"] is True and body["meta"] is None and body["error"]
    assert client.delete("/api/workspace").status_code == 200
    assert client.get("/api/workspace").json()["exists"] is False


def test_corrupt_meta_reports_error(client, tmp_path):
    upload(client)
    (tmp_path / "ws" / "meta.json").write_text("nope")
    body = client.get("/api/workspace").json()
    assert body["exists"] is True and body["error"]


def test_oversized_thumbnail_returns_413(client):
    upload(client)
    big = "x" * (400 * 1024)
    assert client.patch("/api/workspace/meta", json={"thumbnail": big}).status_code == 413
    res = client.put("/api/workspace/project", json={"project": {}, "meta": {"thumbnail": big}})
    assert res.status_code == 413


def test_oversized_upload_returns_413(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_FILE_BYTES", 32)
    assert upload(client, data=PNG).status_code == 413
    assert client.get("/api/workspace").json()["exists"] is False


def test_unsupported_extension_returns_400(client):
    assert upload(client, name="notes.txt", data=b"hello").status_code == 400


def test_exactly_one_of_file_or_sample_id(client):
    res = client.post("/api/workspace/source", data={"meta_json": "{}"})
    assert res.status_code == 400


def test_atomic_write_failure_keeps_previous_project(client, tmp_path, monkeypatch):
    upload(client)
    client.put("/api/workspace/project", json={"project": {"v": 1}, "meta": {}})
    original = (tmp_path / "ws" / "project.json").read_text()

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(workspace.os, "replace", boom)
    with pytest.raises(OSError):
        TestClient(main.app, raise_server_exceptions=True).put(
            "/api/workspace/project", json={"project": {"v": 2}, "meta": {}}
        )
    assert (tmp_path / "ws" / "project.json").read_text() == original
    assert not list((tmp_path / "ws").glob("*.tmp"))


def test_sample_source_copies_the_sample_file(client):
    sample = main.SAMPLES_CATALOG["gatsu_jpeg"]
    if not (main.FLOORPLAN_DIR / sample["filename"]).exists():
        pytest.skip("private sample not present")
    res = client.post("/api/workspace/source", data={"sample_id": "gatsu_jpeg", "meta_json": "{}"})
    assert res.status_code == 200
    meta = client.get("/api/workspace").json()["meta"]
    assert meta["source"]["kind"] == "sample" and meta["source"]["sample_id"] == "gatsu_jpeg"
    assert client.get("/api/workspace/source").content == (main.FLOORPLAN_DIR / sample["filename"]).read_bytes()
