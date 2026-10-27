"""Read-only, selected evidence export for the Scientific Tooling contract."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from .store import validate_annotation_payload, validate_note_payload

SCHEMA = "scientific-tooling.selected-evidence.v1"
NAME = r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
REFERENCE = re.compile(rf"rks:({NAME}):(p_[0-9]+):sha256:([0-9a-f]{{64}})")


def digest(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def timestamp(value: object) -> None:
    if not isinstance(value, str):
        raise ValueError("Timestamps must be ISO 8601 strings with a timezone")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("Timestamps must include a timezone")


def validate_review(review: dict, content_revision: str) -> None:
    if review == {"status": "unreviewed"}:
        return
    if not isinstance(review, dict) or set(review) != {
        "status", "reviewer", "reviewed_at", "method", "content_revision", "statement"
    }:
        raise ValueError("A review must record status, reviewer, reviewed_at, method, content_revision, and statement")
    if review["status"] != "reviewed" or review["method"] != "human":
        raise ValueError("Only an explicit human review can mark evidence reviewed")
    if review["content_revision"] != content_revision:
        raise ValueError("Review is stale: inspect the current content revision before reviewing again")
    for field in ("reviewer", "statement"):
        if not isinstance(review[field], str) or not review[field].strip():
            raise ValueError(f"Review {field} must be non-empty")
    timestamp(review["reviewed_at"])


def export_evidence(
    db_path: Path, *, session_id: str, source_id: str,
    annotation_ids: list[str], note_ids: list[str], reviews: dict | None = None,
) -> dict:
    """Read selected records and their linked passages from one SQLite snapshot.

    No EventStore construction: inspection must not initialize or migrate a DB.
    Source IDs are caller-managed identities for independent APW databases.
    """
    if not re.fullmatch(NAME, source_id):
        raise ValueError("source_id must be a stable 1-64 character workspace name")
    selected = [("annotation", key) for key in annotation_ids] + [("note", key) for key in note_ids]
    if not selected or len(set(selected)) != len(selected):
        raise ValueError("Select at least one annotation or note, without duplicate IDs")
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN")
        version = conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
        if version != 2:
            raise ValueError("Selected export requires APW schema 2; upgrade the workspace explicitly")
        session = conn.execute("SELECT * FROM paper_sessions WHERE id = ?", (session_id,)).fetchone()
        if session is None:
            raise ValueError(f"Session not found: {session_id}")
        match = REFERENCE.fullmatch(session["paper_ref"])
        if match is None:
            raise ValueError("Session must use an RKS source-reading paper reference")
        workspace_id, paper_id, document_sha256 = match.groups()
        path = Path(session["pdf_uri"])
        if not path.is_absolute():
            raise ValueError("Session PDF must be an absolute local path")
        sha = hashlib.sha256()
        size = 0
        with path.open("rb") as pdf:
            for block in iter(lambda: pdf.read(1024 * 1024), b""):
                sha.update(block)
                size += len(block)
        if not size or sha.hexdigest() != document_sha256:
            raise ValueError("Session PDF has changed; restore the exact reading snapshot before export")
        if reviews is not None and (
            not isinstance(reviews, dict)
            or reviews.get("schema") != "scientific-tooling.evidence-reviews.v1"
            or reviews.get("source_id") != source_id
            or reviews.get("paper_ref") != session["paper_ref"]
            or not isinstance(reviews.get("reviews"), dict)
        ):
            raise ValueError("Review manifest must match this source_id and paper_ref")
        review_map = reviews["reviews"] if reviews is not None else {}
        if set(review_map) - {f"{kind}:{key}" for kind, key in selected}:
            raise ValueError("Review manifest contains unselected evidence")

        def read(kind: str, key: str):
            # Table/column names come only from these internal fixed choices.
            table, column = ("annotations", "annotation_id") if kind == "annotation" else ("notes", "note_id")
            row = conn.execute(
                f"SELECT * FROM {table} WHERE paper_ref = ? AND {column} = ?",
                (session["paper_ref"], key),
            ).fetchone()
            if row is None:
                raise ValueError(f"Selected or linked {kind} {key!r} is missing; refresh the selection")
            payload = json.loads(row["payload_json"])
            payload = validate_annotation_payload(payload) if kind == "annotation" else validate_note_payload(payload)
            if payload["id"] != key:
                raise ValueError("Stored object ID disagrees with its payload")
            for value in (payload["createdAt"], payload["updatedAt"], row["created_at"], row["updated_at"]):
                timestamp(value)
            if (kind == "annotation" and payload["anchor"] is not None
                    and payload["anchor"]["quote"] != payload["quote"]):
                raise ValueError(f"Annotation {key!r} quote and anchor disagree; repair it before export")
            return row, payload

        items = []
        for kind, key in sorted(selected):
            row, content = read(kind, key)
            annotations = [content] if kind == "annotation" else [
                read("annotation", linked)[1] for linked in content["linkedAnnotationIds"]
            ]
            passages = [{
                "annotation_id": ann["id"], "page": ann["page"], "quote": ann["quote"],
                "anchor": ann["anchor"], "rects": ann["rects"],
            } for ann in annotations]
            basis = {"source_id": source_id, "paper_ref": session["paper_ref"],
                     "kind": kind, "id": key, "content": content, "passages": passages}
            content_revision = digest(basis)
            review = review_map.get(f"{kind}:{key}", {"status": "unreviewed"})
            validate_review(review, content_revision)
            item = {
                "kind": kind, "id": key, "content": content, "passages": passages,
                "content_revision": content_revision, "review": review,
                "provenance": {"session_id": row["session_id"], "created_at": row["created_at"],
                               "updated_at": row["updated_at"]},
            }
            item["revision"] = digest(item)
            items.append(item)
    return {
        "schema": SCHEMA, "workspace_id": workspace_id, "paper_id": paper_id,
        "source": {"system": "apw", "source_id": source_id,
                   "paper_ref": session["paper_ref"], "session_id": session_id},
        "document": {"path": str(path.resolve()), "sha256": document_sha256, "size_bytes": size},
        "exported_at": datetime.now(UTC).isoformat(), "items": items,
    }
