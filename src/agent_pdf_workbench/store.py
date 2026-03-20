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
