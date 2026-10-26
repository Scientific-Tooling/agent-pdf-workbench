"""Resolve a citation against the exact document and selected passage revision."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path

from .evidence import REFERENCE, digest
from .store import validate_annotation_payload


class PassageError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def annotation_passage(annotation: dict) -> dict:
    return {"annotation_id": annotation["id"], **{
        key: annotation[key] for key in ("page", "quote", "anchor", "rects")
    }}


def resolve_passage(db_path: Path, *, session_id: str, document_sha256: str,
                    annotation_id: str, page: int, passage_sha256: str) -> dict:
    for value in (document_sha256, passage_sha256):
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise PassageError(
                "INVALID_CITATION", "Citation hashes must be lowercase SHA-256 values. Regenerate the link.",
            )
    if type(page) is not int or page < 1 or not session_id or not annotation_id:
        raise PassageError(
            "INVALID_CITATION", "Citation requires a session, annotation, and page >= 1. Regenerate the link.",
        )
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN")
        session = conn.execute("SELECT * FROM paper_sessions WHERE id = ?", (session_id,)).fetchone()
        if session is None:
            raise PassageError("SESSION_MISSING", "Citation session is missing. Restore its APW database backup.")
        identity = REFERENCE.fullmatch(session["paper_ref"])
        if identity is None or identity.group(3) != document_sha256:
            raise PassageError(
                "DOCUMENT_CHANGED", "Citation belongs to a different PDF revision. Use the original reading workspace.",
            )
        row = conn.execute(
            "SELECT payload_json FROM annotations WHERE paper_ref = ? AND annotation_id = ?",
            (session["paper_ref"], annotation_id),
        ).fetchone()
        if row is None:
            raise PassageError(
                "PASSAGE_MISSING", "Cited annotation is missing or deleted. "
                "Restore it from backup; imported RKS evidence is retained.",
            )
        annotation = validate_annotation_payload(json.loads(row["payload_json"]))
        passage = annotation_passage(annotation)
        if annotation["id"] != annotation_id or annotation["page"] != page or digest(passage) != passage_sha256:
            raise PassageError(
                "PASSAGE_CHANGED", "Cited passage has changed. Inspect the imported revision "
                "and review a fresh export before regenerating the brief.",
            )
        if not annotation["quote"].strip():
            raise PassageError(
                "ANCHOR_MISSING", "Cited annotation has no text quote. Capture a source text anchor before citing it.",
            )
        payload = dict(session)
        payload["metadata"] = json.loads(payload.pop("metadata_json"))
    return {"schema": "apw.passage.v1", "session": payload, "annotation": annotation,
            "document_sha256": document_sha256, "passage_sha256": passage_sha256}
