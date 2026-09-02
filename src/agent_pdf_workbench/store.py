from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 1000
EVENT_COALESCE_WINDOW_SECONDS = 0.75
COALESCIBLE_EVENT_TYPES = frozenset({"page_change", "zoom_change"})
ANNOTATION_TYPES = frozenset({"highlight", "underline"})

# Increment this when adding a new migration entry to _MIGRATIONS.
SCHEMA_VERSION = 2

# Each entry: (version: int, description: str, statements: list[str])
# Migrations are applied in version order and are forward-only.
_MIGRATIONS: list[tuple[int, str, list[str]]] = [
    (
        1,
        "initial schema",
        [
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
            )
            """,
            """
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
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_action_events_session_id_id
                ON action_events(session_id, id)
            """,
            """
            CREATE TABLE IF NOT EXISTS annotations (
                session_id TEXT NOT NULL,
                annotation_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (session_id, annotation_id),
                FOREIGN KEY (session_id) REFERENCES paper_sessions(id)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_annotations_session_updated_at
                ON annotations(session_id, updated_at DESC)
            """,
            """
            CREATE TABLE IF NOT EXISTS notes (
                session_id TEXT NOT NULL,
                note_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (session_id, note_id),
                FOREIGN KEY (session_id) REFERENCES paper_sessions(id)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_notes_session_updated_at
                ON notes(session_id, updated_at DESC)
            """,
        ],
    ),
    (
        2,
        "scope annotations and notes to paper_ref instead of session_id",
        [
            # Annotations and notes are durable reading output: they belong to the
            # paper, not to the session that happened to create them.  Sessions
            # remain the grain of the action event log, and are kept on each row as
            # last-writer provenance.  Rows are copied oldest-first so that
            # INSERT OR REPLACE leaves the most recently updated row per
            # (paper_ref, id) as the survivor when the same id existed in several
            # sessions of one paper.
            """
            CREATE TABLE annotations_v2 (
                paper_ref TEXT NOT NULL,
                annotation_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (paper_ref, annotation_id)
            )
            """,
            """
            INSERT OR REPLACE INTO annotations_v2 (
                paper_ref, annotation_id, session_id, payload_json, created_at, updated_at
            )
            SELECT s.paper_ref, a.annotation_id, a.session_id, a.payload_json, a.created_at, a.updated_at
            FROM annotations a
            JOIN paper_sessions s ON s.id = a.session_id
            ORDER BY a.updated_at ASC
            """,
            "DROP TABLE annotations",
            "ALTER TABLE annotations_v2 RENAME TO annotations",
            """
            CREATE INDEX IF NOT EXISTS idx_annotations_paper_updated_at
                ON annotations(paper_ref, updated_at DESC)
            """,
            """
            CREATE TABLE notes_v2 (
                paper_ref TEXT NOT NULL,
                note_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (paper_ref, note_id)
            )
            """,
            """
            INSERT OR REPLACE INTO notes_v2 (
                paper_ref, note_id, session_id, payload_json, created_at, updated_at
            )
            SELECT s.paper_ref, n.note_id, n.session_id, n.payload_json, n.created_at, n.updated_at
            FROM notes n
            JOIN paper_sessions s ON s.id = n.session_id
            ORDER BY n.updated_at ASC
            """,
            "DROP TABLE notes",
            "ALTER TABLE notes_v2 RENAME TO notes",
            """
            CREATE INDEX IF NOT EXISTS idx_notes_paper_updated_at
                ON notes(paper_ref, updated_at DESC)
            """,
        ],
    ),
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FieldValidationError(ValueError):
    """A validation failure that knows which request field caused it.

    The HTTP layer reports ``field`` in ``details.field`` instead of parsing it
    back out of the message text.
    """

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def _invalid(field: str, message: str) -> FieldValidationError:
    return FieldValidationError(field, message)


def _validate_limit(limit: int) -> int:
    if limit < 1:
        raise _invalid("limit", "limit must be >= 1")
    if limit > MAX_LIST_LIMIT:
        raise _invalid("limit", f"limit must be <= {MAX_LIST_LIMIT}")
    return limit


def _validate_offset(offset: int) -> int:
    if offset < 0:
        raise _invalid("offset", "offset must be >= 0")
    return offset


def _require_non_empty_string(payload: dict[str, Any], field: str, *, label: str | None = None) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise _invalid(label or field, f"{label or field} must be a non-empty string")
    return value


def _optional_string_value(
    payload: dict[str, Any],
    field: str,
    default: str = "",
    *,
    label: str | None = None,
) -> str:
    value = payload.get(field, default)
    if not isinstance(value, str):
        raise _invalid(label or field, f"{label or field} must be a string")
    return value


def _require_int(
    payload: dict[str, Any],
    field: str,
    *,
    minimum: int | None = None,
    label: str | None = None,
) -> int:
    value = payload.get(field)
    if type(value) is not int:
        raise _invalid(label or field, f"{label or field} must be an integer")
    if minimum is not None and value < minimum:
        raise _invalid(label or field, f"{label or field} must be >= {minimum}")
    return value


def _require_iso_string(payload: dict[str, Any], field: str, *, label: str | None = None) -> str:
    value = _require_non_empty_string(payload, field, label=label)
    if EventStore._parse_iso_datetime(value) is None:
        raise _invalid(label or field, f"{label or field} must be an ISO datetime string")
    return value


def _validate_string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list):
        raise _invalid(field, f"{field} must be an array")
    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str):
            raise _invalid(f"{field}[{index}]", f"{field}[{index}] must be a string")
        result.append(item)
    return result


def _validate_rects(value: Any) -> list[dict[str, float]]:
    if not isinstance(value, list):
        raise _invalid("rects", "rects must be an array")
    result: list[dict[str, float]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise _invalid(f"rects[{index}]", f"rects[{index}] must be an object")
        rect: dict[str, float] = {}
        for key in ("x", "y", "width", "height"):
            number = item.get(key)
            if type(number) not in (int, float):
                raise _invalid(f"rects[{index}].{key}", f"rects[{index}].{key} must be a number")
            if not isinstance(number, bool):
                rect[key] = float(number)
        if rect["width"] < 0:
            raise _invalid(f"rects[{index}].width", f"rects[{index}].width must be >= 0")
        if rect["height"] < 0:
            raise _invalid(f"rects[{index}].height", f"rects[{index}].height must be >= 0")
        result.append(rect)
    return result


def _validate_text_anchor(value: Any, fallback_quote: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise _invalid("anchor", "anchor must be an object")
    quote = value.get("quote", fallback_quote)
    if not isinstance(quote, str):
        raise _invalid("anchor.quote", "anchor.quote must be a string")
    start = value.get("start")
    end = value.get("end")
    if start is not None and type(start) is not int:
        raise _invalid("anchor.start", "anchor.start must be an integer or null")
    if end is not None and type(end) is not int:
        raise _invalid("anchor.end", "anchor.end must be an integer or null")
    if start is not None and start < 0:
        raise _invalid("anchor.start", "anchor.start must be >= 0")
    if end is not None and end < 0:
        raise _invalid("anchor.end", "anchor.end must be >= 0")
    if start is not None and end is not None and end < start:
        raise _invalid("anchor.end", "anchor.end must be >= anchor.start")
    prefix = value.get("prefix", "")
    suffix = value.get("suffix", "")
    if not isinstance(prefix, str):
        raise _invalid("anchor.prefix", "anchor.prefix must be a string")
    if not isinstance(suffix, str):
        raise _invalid("anchor.suffix", "anchor.suffix must be a string")
    return {
        "quote": quote,
        "start": start,
        "end": end,
        "prefix": prefix,
        "suffix": suffix,
    }


def validate_event_payload(
    *,
    event_type: str,
    page: int | None,
    selection_text: str | None,
    payload: dict[str, Any] | None,
    source: str,
) -> dict[str, Any]:
    if not isinstance(event_type, str) or not event_type.strip():
        raise _invalid("event_type", "event_type must be a non-empty string")
    if page is not None and (type(page) is not int or page < 1):
        raise _invalid("page", "page must be an integer >= 1")
    if selection_text is not None and not isinstance(selection_text, str):
        raise _invalid("selection_text", "selection_text must be a string or null")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise _invalid("payload", "payload must be an object")
    if not isinstance(source, str) or not source.strip():
        raise _invalid("source", "source must be a non-empty string")
    return payload


def validate_annotation_payload(annotation: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(annotation, dict):
        raise _invalid("annotation", "annotation must be an object")
    annotation_id = _require_non_empty_string(annotation, "id", label="annotation.id")
    page = _require_int(annotation, "page", minimum=1, label="annotation.page")
    annotation_type = _require_non_empty_string(annotation, "type", label="annotation.type")
    if annotation_type not in ANNOTATION_TYPES:
        raise _invalid("annotation.type", "annotation.type must be highlight or underline")
    quote = _optional_string_value(annotation, "quote", "", label="annotation.quote")
    comment = _optional_string_value(annotation, "comment", "", label="annotation.comment")
    tags = _validate_string_list(annotation.get("tags", []), "annotation.tags")
    rects = _validate_rects(annotation.get("rects", []))
    anchor = _validate_text_anchor(annotation.get("anchor"), quote)
    created_at = _require_iso_string(annotation, "createdAt", label="annotation.createdAt")
    updated_at = _require_iso_string(annotation, "updatedAt", label="annotation.updatedAt")
    return {
        "id": annotation_id,
        "page": page,
        "type": annotation_type,
        "quote": quote,
        "anchor": anchor,
        "comment": comment,
        "tags": tags,
        "rects": rects,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def validate_note_payload(note: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(note, dict):
        raise _invalid("note", "note must be an object")
    note_id = _require_non_empty_string(note, "id", label="note.id")
    title = _optional_string_value(note, "title", "", label="note.title")
    markdown = _optional_string_value(note, "markdown", "", label="note.markdown")
    linked_ids = _validate_string_list(
        note.get("linkedAnnotationIds", []),
        "note.linkedAnnotationIds",
    )
    created_at = _require_iso_string(note, "createdAt", label="note.createdAt")
    updated_at = _require_iso_string(note, "updatedAt", label="note.updatedAt")
    return {
        "id": note_id,
        "title": title,
        "markdown": markdown,
        "linkedAnnotationIds": linked_ids,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


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
    paper_ref: str
    session_id: str
    annotation: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class NoteRecord:
    id: str
    paper_ref: str
    session_id: str
    note: dict[str, Any]
    created_at: str
    updated_at: str


class EventStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_migrations()
        self.check_integrity()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        # WAL mode for better read/write concurrency and crash resilience.
        conn.execute("PRAGMA journal_mode=WAL")
        # NORMAL: fsync after each checkpoint (good balance for local use).
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _run_migrations(self) -> None:
        """Apply any pending forward-only migrations in version order."""
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    description TEXT NOT NULL DEFAULT '',
                    applied_at TEXT NOT NULL
                )
                """
            )
            applied = {
                row[0]
                for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
            }
            for version, description, statements in sorted(_MIGRATIONS, key=lambda m: m[0]):
                if version in applied:
                    continue
                for stmt in statements:
                    conn.execute(stmt)
                conn.execute(
                    "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
                    (version, description, _utc_now()),
                )

    def get_schema_version(self) -> int:
        """Return the highest applied migration version, or 0 if none."""
        with self._connect() as conn:
            try:
                row = conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()
                return int(row[0]) if row[0] is not None else 0
            except sqlite3.OperationalError:
                return 0

    def check_integrity(self) -> None:
        """Verify that the DB schema version matches the expected version.

        Raises RuntimeError if the version is out of range, indicating either
        an incomplete migration or a downgrade attempt.
        """
        version = self.get_schema_version()
        if version < SCHEMA_VERSION:
            raise RuntimeError(
                f"DB schema version {version} is behind expected {SCHEMA_VERSION}. "
                "This should not happen; _run_migrations() should have applied all pending migrations."
            )
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"DB schema version {version} is newer than supported {SCHEMA_VERSION}. "
                "Please upgrade the app to a version that supports this schema."
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
        payload = validate_event_payload(
            event_type=event_type,
            page=page,
            selection_text=selection_text,
            payload=payload,
            source=source,
        )
        now = _utc_now()
        payload_json = json.dumps(payload or {}, ensure_ascii=True)
        with self._connect() as conn:
            latest_row = conn.execute(
                """
                SELECT * FROM action_events
                WHERE session_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            if self._should_coalesce_with_latest_event(
                latest_row=latest_row,
                event_type=event_type,
                source=source,
                now=now,
            ):
                conn.execute(
                    """
                    UPDATE action_events
                    SET page = ?, selection_text = ?, payload_json = ?, created_at = ?
                    WHERE id = ?
                    """,
                    (page, selection_text, payload_json, now, latest_row["id"]),
                )
                row = conn.execute(
                    "SELECT * FROM action_events WHERE id = ?",
                    (latest_row["id"],),
                ).fetchone()
            else:
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

    def _resolve_paper_scope(self, *, session_id: str, for_write: bool) -> str:
        """Return the paper_ref a session writes into, rejecting closed sessions."""
        session = self.get_session(session_id)
        if for_write and session.closed_at is not None:
            raise ValueError(f"Session is closed: {session_id}")
        return session.paper_ref

    def _scope_from_arguments(self, *, session_id: str | None, paper_ref: str | None) -> str:
        """Resolve a read scope from either a session id or a paper_ref."""
        if (session_id is None) == (paper_ref is None):
            raise _invalid("session_id", "exactly one of session_id or paper_ref is required")
        if session_id is not None:
            return self._resolve_paper_scope(session_id=session_id, for_write=False)
        if not paper_ref.strip():
            raise _invalid("paper_ref", "paper_ref must be a non-empty string")
        return paper_ref

    def upsert_annotation(self, *, session_id: str, annotation: dict[str, Any]) -> AnnotationRecord:
        paper_ref = self._resolve_paper_scope(session_id=session_id, for_write=True)
        annotation = validate_annotation_payload(annotation)

        annotation_id = annotation["id"]

        now = _utc_now()
        payload_json = json.dumps(annotation, ensure_ascii=True)
        with self._connect() as conn:
            existing = conn.execute(
                """
                SELECT created_at
                FROM annotations
                WHERE paper_ref = ? AND annotation_id = ?
                """,
                (paper_ref, annotation_id),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO annotations (
                        paper_ref, annotation_id, session_id, payload_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (paper_ref, annotation_id, session_id, payload_json, now, now),
                )
            else:
                conn.execute(
                    """
                    UPDATE annotations
                    SET payload_json = ?, session_id = ?, updated_at = ?
                    WHERE paper_ref = ? AND annotation_id = ?
                    """,
                    (payload_json, session_id, now, paper_ref, annotation_id),
                )
            row = conn.execute(
                """
                SELECT * FROM annotations
                WHERE paper_ref = ? AND annotation_id = ?
                """,
                (paper_ref, annotation_id),
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to upsert annotation.")
        return self._annotation_from_row(row)

    def list_annotations(
        self,
        *,
        session_id: str | None = None,
        paper_ref: str | None = None,
        limit: int = DEFAULT_LIST_LIMIT,
        offset: int = 0,
    ) -> list[AnnotationRecord]:
        """List a paper's annotations, addressed by session or directly by paper.

        Ordering is by ``annotation_id`` so that paging stays stable while rows
        are being edited; each record carries ``updatedAt`` for display sorting.
        """
        scope = self._scope_from_arguments(session_id=session_id, paper_ref=paper_ref)
        validated_limit = _validate_limit(limit)
        validated_offset = _validate_offset(offset)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM annotations
                WHERE paper_ref = ?
                ORDER BY annotation_id ASC
                LIMIT ?
                OFFSET ?
                """,
                (scope, validated_limit, validated_offset),
            ).fetchall()
        return [self._annotation_from_row(row) for row in rows]

    def delete_annotation(self, *, session_id: str, annotation_id: str) -> bool:
        paper_ref = self._resolve_paper_scope(session_id=session_id, for_write=True)
        if not annotation_id.strip():
            raise _invalid("annotation_id", "annotation_id must be a non-empty string")
        with self._connect() as conn:
            cur = conn.execute(
                """
                DELETE FROM annotations
                WHERE paper_ref = ? AND annotation_id = ?
                """,
                (paper_ref, annotation_id),
            )
        return cur.rowcount > 0

    def upsert_note(self, *, session_id: str, note: dict[str, Any]) -> NoteRecord:
        paper_ref = self._resolve_paper_scope(session_id=session_id, for_write=True)
        note = validate_note_payload(note)

        note_id = note["id"]

        now = _utc_now()
        payload_json = json.dumps(note, ensure_ascii=True)
        with self._connect() as conn:
            existing = conn.execute(
                """
                SELECT created_at
                FROM notes
                WHERE paper_ref = ? AND note_id = ?
                """,
                (paper_ref, note_id),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO notes (
                        paper_ref, note_id, session_id, payload_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (paper_ref, note_id, session_id, payload_json, now, now),
                )
            else:
                conn.execute(
                    """
                    UPDATE notes
                    SET payload_json = ?, session_id = ?, updated_at = ?
                    WHERE paper_ref = ? AND note_id = ?
                    """,
                    (payload_json, session_id, now, paper_ref, note_id),
                )
            row = conn.execute(
                """
                SELECT * FROM notes
                WHERE paper_ref = ? AND note_id = ?
                """,
                (paper_ref, note_id),
            ).fetchone()
        if row is None:
            raise RuntimeError("Failed to upsert note.")
        return self._note_from_row(row)

    def list_notes(
        self,
        *,
        session_id: str | None = None,
        paper_ref: str | None = None,
        limit: int = DEFAULT_LIST_LIMIT,
        offset: int = 0,
    ) -> list[NoteRecord]:
        scope = self._scope_from_arguments(session_id=session_id, paper_ref=paper_ref)
        validated_limit = _validate_limit(limit)
        validated_offset = _validate_offset(offset)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM notes
                WHERE paper_ref = ?
                ORDER BY note_id ASC
                LIMIT ?
                OFFSET ?
                """,
                (scope, validated_limit, validated_offset),
            ).fetchall()
        return [self._note_from_row(row) for row in rows]

    def delete_note(self, *, session_id: str, note_id: str) -> bool:
        paper_ref = self._resolve_paper_scope(session_id=session_id, for_write=True)
        if not note_id.strip():
            raise _invalid("note_id", "note_id must be a non-empty string")
        with self._connect() as conn:
            cur = conn.execute(
                """
                DELETE FROM notes
                WHERE paper_ref = ? AND note_id = ?
                """,
                (paper_ref, note_id),
            )
        return cur.rowcount > 0

    def backup_to(self, target_path: Path) -> None:
        """Create a consistent online backup of the database using SQLite's backup API.

        The target file is created or overwritten.  Safe to call while the
        server is running (uses SQLite's incremental backup mechanism).
        """
        target_path.parent.mkdir(parents=True, exist_ok=True)
        src = sqlite3.connect(self._db_path)
        dst = sqlite3.connect(target_path)
        try:
            with dst:
                src.backup(dst)
        finally:
            src.close()
            dst.close()

    def checkpoint(self) -> dict:
        """Force a WAL checkpoint and return the result counters.

        Returns a dict with keys: ``log`` (pages in WAL),
        ``checkpointed`` (pages written back to the main DB).
        """
        with self._connect() as conn:
            row = conn.execute("PRAGMA wal_checkpoint(FULL)").fetchone()
        # PRAGMA wal_checkpoint returns: (busy, log, checkpointed)
        return {"busy": row[0], "log": row[1], "checkpointed": row[2]}

    def list_sessions(
        self,
        *,
        paper_ref: str | None = None,
        open_only: bool = False,
        limit: int = DEFAULT_LIST_LIMIT,
        offset: int = 0,
    ) -> list[PaperSession]:
        """List sessions newest-first, optionally filtered by paper or open state.

        This is how an agent finds the session a reader is currently in, instead
        of having to be told the id out of band.
        """
        validated_limit = _validate_limit(limit)
        validated_offset = _validate_offset(offset)
        clauses: list[str] = []
        params: list[Any] = []
        if paper_ref is not None:
            if not isinstance(paper_ref, str) or not paper_ref.strip():
                raise _invalid("paper_ref", "paper_ref must be a non-empty string")
            clauses.append("paper_ref = ?")
            params.append(paper_ref)
        if open_only:
            clauses.append("closed_at IS NULL")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([validated_limit, validated_offset])
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM paper_sessions
                {where}
                ORDER BY opened_at DESC, id ASC
                LIMIT ?
                OFFSET ?
                """,
                tuple(params),
            ).fetchall()
        return [self._session_from_row(row) for row in rows]

    def list_all_sessions(self) -> list[PaperSession]:
        """Return all sessions ordered by opened_at descending."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM paper_sessions ORDER BY opened_at DESC, id ASC"
            ).fetchall()
        return [self._session_from_row(row) for row in rows]

    def list_paper_refs(self) -> list[str]:
        """Return every distinct paper_ref that has a session, newest paper first."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT paper_ref, MAX(opened_at) AS latest
                FROM paper_sessions
                GROUP BY paper_ref
                ORDER BY latest DESC, paper_ref ASC
                """
            ).fetchall()
        return [row["paper_ref"] for row in rows]

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
    def _parse_iso_datetime(value: str) -> datetime | None:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    @staticmethod
    def _should_coalesce_with_latest_event(
        *,
        latest_row: sqlite3.Row | None,
        event_type: str,
        source: str,
        now: str,
    ) -> bool:
        if (
            latest_row is None
            or source != "viewer"
            or event_type not in COALESCIBLE_EVENT_TYPES
            or latest_row["source"] != source
            or latest_row["event_type"] != event_type
        ):
            return False

        latest_created_at = EventStore._parse_iso_datetime(latest_row["created_at"])
        current_created_at = EventStore._parse_iso_datetime(now)
        if latest_created_at is None or current_created_at is None:
            return False
        if current_created_at < latest_created_at:
            return False

        return (
            current_created_at - latest_created_at
        ).total_seconds() <= EVENT_COALESCE_WINDOW_SECONDS

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
            paper_ref=row["paper_ref"],
            session_id=row["session_id"],
            annotation=json.loads(row["payload_json"] or "{}"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _note_from_row(row: sqlite3.Row) -> NoteRecord:
        return NoteRecord(
            id=row["note_id"],
            paper_ref=row["paper_ref"],
            session_id=row["session_id"],
            note=json.loads(row["payload_json"] or "{}"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
