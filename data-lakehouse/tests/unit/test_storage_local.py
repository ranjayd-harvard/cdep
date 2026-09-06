from __future__ import annotations

import pytest

from lakehouse.storage.local_storage import LocalStorage


@pytest.fixture
def storage(tmp_path):
    s = LocalStorage(tmp_path)
    s.create_bucket("test-bucket")
    return s


def test_put_and_get_bytes_round_trip(storage):
    storage.put_bytes("test-bucket", "a/b.txt", b"hello world")
    assert storage.exists("test-bucket", "a/b.txt")
    with storage.open("test-bucket", "a/b.txt") as f:
        assert f.read() == b"hello world"


def test_metadata_reports_size(storage):
    storage.put_bytes("test-bucket", "f.txt", b"12345")
    meta = storage.metadata("test-bucket", "f.txt")
    assert meta.size_bytes == 5


def test_checksum_matches_sha256(storage):
    import hashlib

    data = b"checksum-me"
    storage.put_bytes("test-bucket", "f.txt", data)
    assert storage.checksum("test-bucket", "f.txt") == hashlib.sha256(data).hexdigest()


def test_exists_false_for_missing_object(storage):
    assert storage.exists("test-bucket", "does/not/exist.txt") is False


def test_list_returns_matching_prefix(storage):
    storage.put_bytes("test-bucket", "exchanges/exc-1/events.csv", b"x")
    storage.put_bytes("test-bucket", "exchanges/exc-1/manifest.json", b"{}")
    storage.put_bytes("test-bucket", "exchanges/exc-2/events.csv", b"y")
    keys = storage.list("test-bucket", "exchanges/exc-1/")
    assert sorted(keys) == ["exchanges/exc-1/events.csv", "exchanges/exc-1/manifest.json"]


def test_delete_removes_object(storage):
    storage.put_bytes("test-bucket", "f.txt", b"x")
    storage.delete("test-bucket", "f.txt")
    assert not storage.exists("test-bucket", "f.txt")
