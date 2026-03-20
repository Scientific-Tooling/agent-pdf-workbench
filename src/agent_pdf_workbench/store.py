from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 1000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_limit(limit: int) -> int:
    if limit < 1:
        raise ValueError("limit must be >= 1")
    if limit > MAX_LIST_LIMIT:
        raise ValueError(f"limit must be <= {MAX_LIST_LIMIT}")
    return limit


@dataclass(frozen=True)
class PaperSession:
    id: str
    paper_ref: str
    pdf_uri: str
    agent_id: str
    user_id: str
    metadata: dict[str, Any]
    opened_at: str
    closed_at: str | None


@dataclass(frozen=True)
class ActionEvent:
    id: int
    session_id: str
    event_type: str
    page: int | None
    selection_text: str | None
    payload: dict[str, Any]
    source: str
    created_at: str


@dataclass(frozen=True)
class AnnotationRecord:
    id: str
    session_id: str
    annotation: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class NoteRecord:
    id: str
    session_id: str
    note: dict[str, Any]
    created_at: str
    updated_at: str


class EventStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS paper_sessions (
                    id TEXT PRIMARY KEY,
                    paper_ref TEXT NOT NULL,
                    pdf_uri TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    opened_at TEXT NOT NULL,
                    closed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS action_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    page INTEGER,
                    selection_text TEXT,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    source TEXT NOT NULL DEFAULT 'viewer',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES paper_sessions(id)
                );

                CREATE INDEX IF NOT EXISTS idx_action_events_session_id_id
                    ON action_events(session_id, id);

                CREATE TABLE IF NOT EXISTS annotations (
                    session_id TEXT NOT NULL,
                    annotation_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, annotation_id),
                    FOREIGN KEY (session_id) REFERENCES paper_sessions(id)
                );

                CREATE INDEX IF NOT EXISTS idx_annotations_session_updated_at
                    ON annotations(session_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS notes (
                    session_id TEXT NOT NULL,
                    note_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, note_id),
                    FOREIGN KEY (session_id) REFERENCES paper_sessions(id)
                );

                CREATE INDEX IF NOT EXISTS idx_notes_session_updated_at
                    ON notes(session_id, updated_at DESC);
                """
            )

    def open_session(
        self,
        *,
        session_id: str,
        paper_ref: str,
        pdf_uri: str,
        agent_id: str,
        user_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> PaperSession:
        now = _utc_now()
        payload = json.dumps(metadata or {}, ensure_ascii=True)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO paper_sessions (
                    id, paper_ref, pdf_uri, agent_id, user_id, metadata_json, opened_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, paper_ref, pdf_uri, agent_id, user_id, payload, now),
            )
            row = conn.execute(
                "SELECT * FROM paper_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to create paper session.")
        return self._session_from_row(row)

    def get_session(self, session_id: str) -> PaperSession:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM paper_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        if row is None:
            raise ValueError(f"Unknown session_id: {session_id}")
        return self._session_from_row(row)

    def close_session(self, session_id: str) -> PaperSession:
        now = _utc_now()
        with self._connect() as conn:
            conn.execute(
                "UPDATE paper_sessions SET closed_at = ? WHERE id = ?",
                (now, session_id),
            )
        return self.get_session(session_id)

    def append_event(
        self,
        *,
        session_id: str,
        event_type: str,
        page: int | None = None,
        selection_text: str | None = None,
        payload: dict[str, Any] | None = None,
        source: str = "viewer",
    ) -> ActionEvent:
        session = self.get_session(session_id)
        if session.closed_at is not None:
            raise ValueError(f"Session is closed: {session_id}")
        now = _utc_now()
        payload_json = json.dumps(payload or {}, ensure_ascii=True)
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO action_events (
                    session_id, event_type, page, selection_text, payload_json, source, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, event_type, page, selection_text, payload_json, source, now),
            )
            event_id = int(cur.lastrowid)
            row = conn.execute(
                "SELECT * FROM action_events WHERE id = ?",
                (event_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to append action event.")
        return self._event_from_row(row)

    def list_events(
        self,
        *,
        session_id: str,
        after_id: int | None = None,
        limit: int = DEFAULT_LIST_LIMIT,
    ) -> list[ActionEvent]:
        self.get_session(session_id)
        validated_limit = _validate_limit(limit)
        if after_id is not None and after_id < 0:
            raise ValueError("after_id must be >= 0")
        with self._connect() as conn:
            if after_id is None:
                rows = conn.execute(
                    """
                    SELECT * FROM action_events
                    WHERE session_id = ?
                    ORDER BY id ASC
                    LIMIT ?
                    """,
                    (session_id, validated_limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM action_events
                    WHERE session_id = ? AND id > ?
                    ORDER BY id ASC
                    LIMIT ?
                    """,
                    (session_id, after_id, validated_limit),
                ).fetchall()
        return [self._event_from_row(row) for row in rows]

    def upsert_annotation(self, *, session_id: str, annotation: dict[str, Any]) -> AnnotationRecord:
        session = self.get_session(session_id)
        if session.closed_at is not None:
            raise ValueError(f"Session is closed: {session_id}")

        annotation_id = annotation.get("id")
        if not isinstance(annotation_id, str) or not annotation_id.strip():
            raise ValueError("annotation.id must be a non-empty string")

        now = _utc_now()
        payload_json = json.dumps(annotation, ensure_ascii=True)
        with self._connect() as conn:
            existing = conn.execute(
                """
                SELECT created_at
                FROM annotations
                WHERE session_id = ? AND annotation_id = ?
                """,
                (session_id, annotation_id),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO annotations (
                        session_id, annotation_id, payload_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (session_id, annotation_id, payload_json, now, now),
                )
            else:
                conn.execute(
                    """
                    UPDATE annotations
                    SET payload_json = ?, updated_at = ?
                    WHERE session_id = ? AND annotation_id = ?
                    """,
                    (payload_json, now, session_id, annotation_id),
                )
            row = conn.execute(
                """
                SELECT * FROM annotations
                WHERE session_id = ? AND annotation_id = ?
                """,
                (session_id, annotation_id),
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to upsert annotation.")
        return self._annotation_from_row(row)

    def list_annotations(
        self,
        *,
        session_id: str,
        limit: int = DEFAULT_LIST_LIMIT,
    ) -> list[AnnotationRecord]:
        self.get_session(session_id)
        validated_limit = _validate_limit(limit)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM annotations
                WHERE session_id = ?
                ORDER BY updated_at DESC, annotation_id ASC
                LIMIT ?
                """,
                (session_id, validated_limit),
            ).fetchall()
        return [self._annotation_from_row(row) for row in rows]

    def delete_annotation(self, *, session_id: str, annotation_id: str) -> bool:
        session = self.get_session(session_id)
        if session.closed_at is not None:
            raise ValueError(f"Session is closed: {session_id}")
        if not annotation_id.strip():
            raise ValueError("annotation_id must be a non-empty string")
        with self._connect() as conn:
            cur = conn.execute(
                """
                DELETE FROM annotations
                WHERE session_id = ? AND annotation_id = ?
                """,
                (session_id, annotation_id),
            )
        return cur.rowcount > 0

    def upsert_note(self, *, session_id: str, note: dict[str, Any]) -> NoteRecord:
        session = self.get_session(session_id)
        if session.closed_at is not None:
            raise ValueError(f"Session is closed: {session_id}")

        note_id = note.get("id")
        if not isinstance(note_id, str) or not note_id.strip():
            raise ValueError("note.id must be a non-empty string")

        now = _utc_now()
        payload_json = json.dumps(note, ensure_ascii=True)
        with self._connect() as conn:
            existing = conn.execute(
                """
                SELECT created_at
                FROM notes
                WHERE session_id = ? AND note_id = ?
                """,
                (session_id, note_id),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO notes (
                        session_id, note_id, payload_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (session_id, note_id, payload_json, now, now),
                )
            else:
                conn.execute(
                    """
                    UPDATE notes
                    SET payload_json = ?, updated_at = ?
                    WHERE session_id = ? AND note_id = ?
                    """,
                    (payload_json, now, session_id, note_id),
                )
            row = conn.execute(
                """
                SELECT * FROM notes
                WHERE session_id = ? AND note_id = ?
                """,
                (session_id, note_id),
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to upsert note.")
        return self._note_from_row(row)

    def list_notes(
        self,
        *,
        session_id: str,
        limit: int = DEFAULT_LIST_LIMIT,
    ) -> list[NoteRecord]:
        self.get_session(session_id)
        validated_limit = _validate_limit(limit)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM notes
                WHERE session_id = ?
                ORDER BY updated_at DESC, note_id ASC
                LIMIT ?
                """,
                (session_id, validated_limit),
            ).fetchall()
        return [self._note_from_row(row) for row in rows]

    def delete_note(self, *, session_id: str, note_id: str) -> bool:
        session = self.get_session(session_id)
        if session.closed_at is not None:
            raise ValueError(f"Session is closed: {session_id}")
        if not note_id.strip():
            raise ValueError("note_id must be a non-empty string")
        with self._connect() as conn:
            cur = conn.execute(
                """
                DELETE FROM notes
                WHERE session_id = ? AND note_id = ?
                """,
                (session_id, note_id),
            )
        return cur.rowcount > 0

    @staticmethod
    def _session_from_row(row: sqlite3.Row) -> PaperSession:
        return PaperSession(
            id=row["id"],
            paper_ref=row["paper_ref"],
            pdf_uri=row["pdf_uri"],
            agent_id=row["agent_id"],
            user_id=row["user_id"],
            metadata=json.loads(row["metadata_json"] or "{}"),
            opened_at=row["opened_at"],
            closed_at=row["closed_at"],
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> ActionEvent:
        return ActionEvent(
            id=row["id"],
            session_id=row["session_id"],
            event_type=row["event_type"],
            page=row["page"],
            selection_text=row["selection_text"],
            payload=json.loads(row["payload_json"] or "{}"),
            source=row["source"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _annotation_from_row(row: sqlite3.Row) -> AnnotationRecord:
        return AnnotationRecord(
            id=row["annotation_id"],
            session_id=row["session_id"],
            annotation=json.loads(row["payload_json"] or "{}"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _note_from_row(row: sqlite3.Row) -> NoteRecord:
        return NoteRecord(
            id=row["note_id"],
            session_id=row["session_id"],
            note=json.loads(row["payload_json"] or "{}"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
