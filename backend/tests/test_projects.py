from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
import workspace  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "projects_store", workspace.ProjectsStore(tmp_path / "ws"))
    monkeypatch.delenv("SITESTRY_WORKSPACE_DIR", raising=False)
    return TestClient(main.app)


def upload(client, name="plan.png", data=PNG, meta=None):
    return client.post(
        "/api/projects",
        files={"file": (name, data, "application/octet-stream")},
        data={"meta_json": json.dumps(meta or {})},
    )


def new_project(client, **kwargs) -> str:
    res = upload(client, **kwargs)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def listing(client):
    return client.get("/api/projects").json()


def test_empty_list_and_test_dir_flag(client, monkeypatch):
    body = listing(client)
    assert body["projects"] == [] and body["test_dir"] is False
    monkeypatch.setenv("SITESTRY_WORKSPACE_DIR", "/tmp/anything")
    assert listing(client)["test_dir"] is True


def test_create_reports_source_and_defaults(client):
    pid = new_project(client, meta={"title": "Lantai 1", "page_number": 4, "total_pages": 11})
    assert len(pid) == 8
    body = client.get(f"/api/projects/{pid}").json()
    assert body["id"] == pid and body["exists"] is True and body["has_project"] is False
    meta = body["meta"]
    assert meta["source"]["kind"] == "image" and meta["source"]["filename"] == "plan.png"
    assert meta["title"] == "Lantai 1" and meta["page_number"] == 4 and meta["total_pages"] == 11
    assert meta["stage_reached"] == 1 and meta["extracted"] is False
    assert meta["saved_hash"] is None and meta["built_hash"] is None and meta["saved_at"] is None
    assert client.get(f"/api/projects/{pid}/source").content == PNG


def test_two_uploads_create_two_projects_and_the_first_survives(client):
    first = new_project(client, name="a.png")
    client.put(f"/api/projects/{first}/project", json={"project": {"a": 1}, "meta": {}})
    second = new_project(client, name="b.png")
    assert first != second
    ids = {p["id"] for p in listing(client)["projects"]}
    assert ids == {first, second}
    assert client.get(f"/api/projects/{first}/project").json() == {"a": 1}


def test_list_is_newest_first_and_includes_broken_folders(client, tmp_path):
    a = new_project(client, name="a.png")
    b = new_project(client, name="b.png")
    client.put(f"/api/projects/{a}/project", json={"project": {}, "meta": {}})
    assert [p["id"] for p in listing(client)["projects"]][0] == a
    (tmp_path / "ws" / "projects" / b / "meta.json").write_text("nope")
    entries = {p["id"]: p for p in listing(client)["projects"]}
    assert entries[b]["error"] and entries[b]["meta"] is None
    assert "error" not in entries[a]


def test_put_project_round_trips_and_sets_saved_at(client):
    pid = new_project(client)
    project = {"nodes": [{"id": "n1"}], "walls": []}
    res = client.put(
        f"/api/projects/{pid}/project",
        json={"project": project, "meta": {"saved_hash": "abc", "extracted": True, "stage_reached": 3}},
    )
    assert res.status_code == 200
    assert client.get(f"/api/projects/{pid}/project").json() == project
    body = client.get(f"/api/projects/{pid}").json()
    assert body["has_project"] is True
    assert body["meta"]["saved_hash"] == "abc" and body["meta"]["extracted"] is True
    assert body["meta"]["stage_reached"] == 3 and body["meta"]["saved_at"]


def test_unknown_project_returns_404(client):
    assert client.put("/api/projects/00000000/project", json={"project": {}, "meta": {}}).status_code == 404
    assert client.patch("/api/projects/00000000/meta", json={"built_hash": "x"}).status_code == 404
    assert client.get("/api/projects/00000000").status_code == 404
    assert client.get("/api/projects/00000000/source").status_code == 404


def test_patch_only_accepts_whitelisted_keys(client):
    pid = new_project(client)
    res = client.patch(f"/api/projects/{pid}/meta", json={"built_hash": "h1", "evil": "x", "saved_at": "forged"})
    assert res.status_code == 200
    meta = client.get(f"/api/projects/{pid}").json()["meta"]
    assert meta["built_hash"] == "h1" and "evil" not in meta and meta["saved_at"] is None


def test_delete_one_project_leaves_the_other_and_is_idempotent(client):
    a = new_project(client, name="a.png")
    b = new_project(client, name="b.png")
    assert client.delete(f"/api/projects/{a}").status_code == 200
    assert client.delete(f"/api/projects/{a}").status_code == 200
    assert [p["id"] for p in listing(client)["projects"]] == [b]
    assert client.get(f"/api/projects/{a}/source").status_code == 404


@pytest.mark.parametrize("bad", ["abc", "ABCDEF12", "zzzzzzzz", "..%2Fx", "12345678901"])
def test_malformed_ids_are_404(client, bad):
    for method, suffix, kwargs in [
        ("get", "", {}),
        ("get", "/source", {}),
        ("get", "/project", {}),
        ("put", "/project", {"json": {"project": {}, "meta": {}}}),
        ("patch", "/meta", {"json": {}}),
        ("delete", "", {}),
    ]:
        res = getattr(client, method)(f"/api/projects/{bad}{suffix}", **kwargs)
        assert res.status_code == 404, (method, suffix, bad)


def test_a_folder_that_is_not_a_project_is_never_read(client, tmp_path):
    new_project(client)
    notes = tmp_path / "ws" / "projects" / "notes"
    notes.mkdir()
    (notes / "meta.json").write_text("{}")
    assert client.get("/api/projects/notes").status_code == 404
    assert all(p["id"] != "notes" for p in listing(client)["projects"])


def test_delete_all_is_forbidden_without_the_env_var(client, monkeypatch):
    new_project(client)
    assert client.delete("/api/projects").status_code == 403
    assert len(listing(client)["projects"]) == 1
    monkeypatch.setenv("SITESTRY_WORKSPACE_DIR", "/tmp/anything")
    assert client.delete("/api/projects").status_code == 200
    assert listing(client)["projects"] == []


def test_corrupt_project_json_is_reported_and_delete_works(client, tmp_path):
    pid = new_project(client)
    client.put(f"/api/projects/{pid}/project", json={"project": {"a": 1}, "meta": {}})
    (tmp_path / "ws" / "projects" / pid / "project.json").write_text("{not json")
    entry = listing(client)["projects"][0]
    assert entry["id"] == pid and entry["error"] and entry["meta"] is None
    assert client.delete(f"/api/projects/{pid}").status_code == 200
    assert listing(client)["projects"] == []


def test_oversized_thumbnail_returns_413(client):
    pid = new_project(client)
    big = "x" * (400 * 1024)
    assert client.patch(f"/api/projects/{pid}/meta", json={"thumbnail": big}).status_code == 413
    res = client.put(f"/api/projects/{pid}/project", json={"project": {}, "meta": {"thumbnail": big}})
    assert res.status_code == 413


def test_oversized_upload_returns_413(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_FILE_BYTES", 32)
    assert upload(client, data=PNG).status_code == 413
    assert listing(client)["projects"] == []


def test_unsupported_extension_returns_400_and_creates_nothing(client):
    assert upload(client, name="notes.txt", data=b"hello").status_code == 400
    assert listing(client)["projects"] == []


def test_exactly_one_of_file_or_sample_id(client):
    assert client.post("/api/projects", data={"meta_json": "{}"}).status_code == 400


def test_atomic_write_failure_keeps_previous_project(client, tmp_path, monkeypatch):
    pid = new_project(client)
    client.put(f"/api/projects/{pid}/project", json={"project": {"v": 1}, "meta": {}})
    path = tmp_path / "ws" / "projects" / pid / "project.json"
    original = path.read_text()

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(workspace.os, "replace", boom)
    with pytest.raises(OSError):
        TestClient(main.app, raise_server_exceptions=True).put(
            f"/api/projects/{pid}/project", json={"project": {"v": 2}, "meta": {}}
        )
    assert path.read_text() == original
    assert not list(path.parent.glob("*.tmp"))


def test_source_download_survives_a_non_latin1_filename(client):
    name = "Denah Lantai 1 – Gatsu.png"
    pid = new_project(client, name=name)
    res = client.get(f"/api/projects/{pid}/source")
    assert res.status_code == 200 and res.content == PNG
    assert unquote(res.headers["X-Source-Filename"]) == name


def test_sample_source_copies_the_sample_file(client):
    sample = main.SAMPLES_CATALOG["gatsu_jpeg"]
    if not (main.FLOORPLAN_DIR / sample["filename"]).exists():
        pytest.skip("private sample not present")
    res = client.post("/api/projects", data={"sample_id": "gatsu_jpeg", "meta_json": "{}"})
    assert res.status_code == 200
    pid = res.json()["id"]
    meta = client.get(f"/api/projects/{pid}").json()["meta"]
    assert meta["source"]["kind"] == "sample" and meta["source"]["sample_id"] == "gatsu_jpeg"
    assert client.get(f"/api/projects/{pid}/source").content == (main.FLOORPLAN_DIR / sample["filename"]).read_bytes()


# ---------- migration of the old single-workspace layout ----------
def write_legacy(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    meta = {"source": {"filename": "ancol.pdf", "kind": "pdf", "sample_id": None}, "title": "Ancol",
            "page_number": 13, "saved_at": "2026-11-12T05:14:45+00:00", "created_at": "2026-11-12T04:27:38+00:00",
            "counts": {"walls": 211}}
    (root / "meta.json").write_text(json.dumps(meta))
    (root / "project.json").write_text(json.dumps({"walls": [1, 2, 3]}))
    (root / "source.pdf").write_bytes(b"%PDF-" + b"1" * 100)
    return meta


def test_migrate_legacy_moves_the_single_layout_into_a_project(tmp_path):
    root = tmp_path / "ws"
    meta = write_legacy(root)
    store = workspace.ProjectsStore(root)
    new_id = store.migrate_legacy()
    assert new_id
    entries = store.list()
    assert [e["id"] for e in entries] == [new_id]
    assert entries[0]["meta"] == meta and entries[0]["has_project"] is True
    folder = root / "projects" / new_id
    assert (folder / "source.pdf").read_bytes() == b"%PDF-" + b"1" * 100
    assert json.loads((folder / "project.json").read_text()) == {"walls": [1, 2, 3]}
    assert not (root / "meta.json").exists()
    assert not (root / "project.json").exists()
    assert not list(root.glob("source.*"))


def test_migrate_legacy_is_idempotent(tmp_path):
    root = tmp_path / "ws"
    write_legacy(root)
    store = workspace.ProjectsStore(root)
    assert store.migrate_legacy()
    assert store.migrate_legacy() is None
    assert len(store.list()) == 1


def test_migrate_legacy_with_no_legacy_files_returns_none(tmp_path):
    store = workspace.ProjectsStore(tmp_path / "ws")
    assert store.migrate_legacy() is None
    assert store.list() == []


def test_migrate_legacy_keeps_the_legacy_files_when_the_copy_fails(tmp_path, monkeypatch):
    root = tmp_path / "ws"
    write_legacy(root)
    store = workspace.ProjectsStore(root)

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(workspace.shutil, "copy2", boom)
    assert store.migrate_legacy() is None
    assert (root / "meta.json").exists() and (root / "project.json").exists() and (root / "source.pdf").exists()
    assert store.list() == []
    assert not list((root / "projects").glob("*")) if (root / "projects").exists() else True


def test_migration_runs_on_server_startup_not_on_import(tmp_path, monkeypatch):
    root = tmp_path / "ws"
    write_legacy(root)
    monkeypatch.setattr(main, "projects_store", workspace.ProjectsStore(root))
    TestClient(main.app)  # building a client does not start the app
    assert (root / "meta.json").exists()
    with TestClient(main.app) as started:
        assert not (root / "meta.json").exists()
        assert len(started.get("/api/projects").json()["projects"]) == 1
