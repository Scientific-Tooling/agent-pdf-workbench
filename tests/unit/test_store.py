from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from agent_pdf_workbench.store import SCHEMA_VERSION, EventStore

TEST_TIME = "2026-05-19T12:00:00+00:00"


def annotation_payload(**overrides):
    payload = {
        "id": "ann_test",
        "page": 1,
        "type": "highlight",
        "quote": "test quote",
        "anchor": None,
        "comment": "",
        "tags": [],
        "rects": [],
        "createdAt": TEST_TIME,
        "updatedAt": TEST_TIME,
    }
    payload.update(overrides)
    return payload


def note_payload(**overrides):
    payload = {
        "id": "note_test",
        "title": "",
        "markdown": "",
        "linkedAnnotationIds": [],
        "createdAt": TEST_TIME,
        "updatedAt": TEST_TIME,
    }
    payload.update(overrides)
    return payload


class EventStoreTest(unittest.TestCase):
    def test_open_append_and_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)

            session = store.open_session(
                session_id="ps_0001",
                paper_ref="10.48550/arXiv.1706.03762",
                pdf_uri="/tmp/paper.pdf",
                agent_id="agent:test",
                user_id="user:test",
                metadata={"topic": "attention"},
            )
            self.assertEqual(session.id, "ps_0001")
            self.assertEqual(session.metadata["topic"], "attention")

            first = store.append_event(
                session_id="ps_0001",
                event_type="highlight",
                page=3,
                selection_text="attention is all you need",
                payload={"color": "yellow"},
            )
            second = store.append_event(
                session_id="ps_0001",
                event_type="comment",
                page=3,
                payload={"text": "revisit this claim"},
            )
            self.assertLess(first.id, second.id)

            events = store.list_events(session_id="ps_0001")
            self.assertEqual(len(events), 2)
            self.assertEqual(events[0].event_type, "highlight")
            self.assertEqual(events[1].event_type, "comment")

            incremental = store.list_events(session_id="ps_0001", after_id=first.id)
            self.assertEqual(len(incremental), 1)
            self.assertEqual(incremental[0].id, second.id)

    def test_close_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0002",
                paper_ref="p_000001",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )
            closed = store.close_session("ps_0002")
            self.assertIsNotNone(closed.closed_at)

    def test_closed_session_rejects_new_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0003",
                paper_ref="p_000003",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )
            store.close_session("ps_0003")
            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.append_event(
                    session_id="ps_0003",
                    event_type="comment",
                    payload={"text": "should fail"},
                )

    def test_list_events_validates_limit_and_after_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0004",
                paper_ref="p_000004",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )
            store.append_event(session_id="ps_0004", event_type="highlight")

            with self.assertRaisesRegex(ValueError, "limit must be >= 1"):
                store.list_events(session_id="ps_0004", limit=0)
            with self.assertRaisesRegex(ValueError, "limit must be <= 1000"):
                store.list_events(session_id="ps_0004", limit=1001)
            with self.assertRaisesRegex(ValueError, "after_id must be >= 0"):
                store.list_events(session_id="ps_0004", after_id=-1)

    def test_append_event_coalesces_high_frequency_page_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0005",
                paper_ref="p_000005",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )

            first = store.append_event(
                session_id="ps_0005",
                event_type="page_change",
                page=1,
                payload={"total_pages": 10},
                source="viewer",
            )
            second = store.append_event(
                session_id="ps_0005",
                event_type="page_change",
                page=2,
                payload={"total_pages": 10},
                source="viewer",
            )

            self.assertEqual(second.id, first.id)
            self.assertEqual(second.page, 2)
            events = store.list_events(session_id="ps_0005")
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].page, 2)

    def test_append_event_does_not_coalesce_outside_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0006",
                paper_ref="p_000006",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )

            first = store.append_event(
                session_id="ps_0006",
                event_type="page_change",
                page=1,
                payload={"total_pages": 10},
                source="viewer",
            )
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "UPDATE action_events SET created_at = ? WHERE id = ?",
                    ("2000-01-01T00:00:00+00:00", first.id),
                )

            second = store.append_event(
                session_id="ps_0006",
                event_type="page_change",
                page=2,
                payload={"total_pages": 10},
                source="viewer",
            )
            self.assertNotEqual(second.id, first.id)
            self.assertEqual(len(store.list_events(session_id="ps_0006")), 2)

    def test_append_event_does_not_coalesce_non_viewer_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0007",
                paper_ref="p_000007",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )

            first = store.append_event(
                session_id="ps_0007",
                event_type="page_change",
                page=1,
                payload={"total_pages": 10},
                source="agent",
            )
            second = store.append_event(
                session_id="ps_0007",
                event_type="page_change",
                page=2,
                payload={"total_pages": 10},
                source="agent",
            )

            self.assertNotEqual(second.id, first.id)
            self.assertEqual(len(store.list_events(session_id="ps_0007")), 2)

    def test_append_event_coalesces_zoom_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_0008",
                paper_ref="p_000008",
                pdf_uri="/tmp/source.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )

            first = store.append_event(
                session_id="ps_0008",
                event_type="zoom_change",
                page=3,
                payload={"zoom": 1.0},
                source="viewer",
            )
            second = store.append_event(
                session_id="ps_0008",
                event_type="zoom_change",
                page=3,
                payload={"zoom": 1.25},
                source="viewer",
            )

            self.assertEqual(second.id, first.id)
            self.assertEqual(second.payload["zoom"], 1.25)
            events = store.list_events(session_id="ps_0008")
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].payload["zoom"], 1.25)

    def test_annotation_and_note_crud(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_1001",
                paper_ref="p_1001",
                pdf_uri="/tmp/paper.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )

            ann = store.upsert_annotation(
                session_id="ps_1001",
                annotation=annotation_payload(
                    id="ann_1",
                    page=2,
                    type="highlight",
                    quote="attention is all you need",
                    comment="core idea",
                    tags=["idea"],
                    rects=[{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}],
                ),
            )
            self.assertEqual(ann.id, "ann_1")
            self.assertEqual(ann.annotation["quote"], "attention is all you need")

            ann_updated = store.upsert_annotation(
                session_id="ps_1001",
                annotation=annotation_payload(
                    id="ann_1",
                    page=2,
                    type="highlight",
                    quote="attention is all you need",
                    comment="updated",
                    tags=["idea", "todo"],
                    rects=[{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}],
                ),
            )
            self.assertEqual(ann_updated.annotation["comment"], "updated")
            annotations = store.list_annotations(session_id="ps_1001", limit=10)
            self.assertEqual(len(annotations), 1)
            self.assertEqual(annotations[0].id, "ann_1")

            note = store.upsert_note(
                session_id="ps_1001",
                note=note_payload(
                    id="note_1",
                    title="note title",
                    markdown="content",
                    linkedAnnotationIds=["ann_1"],
                ),
            )
            self.assertEqual(note.id, "note_1")

            notes = store.list_notes(session_id="ps_1001", limit=10)
            self.assertEqual(len(notes), 1)
            self.assertEqual(notes[0].note["linkedAnnotationIds"], ["ann_1"])

            self.assertTrue(store.delete_annotation(session_id="ps_1001", annotation_id="ann_1"))
            self.assertEqual(store.list_annotations(session_id="ps_1001", limit=10), [])
            self.assertFalse(store.delete_annotation(session_id="ps_1001", annotation_id="missing"))

            self.assertTrue(store.delete_note(session_id="ps_1001", note_id="note_1"))
            self.assertEqual(store.list_notes(session_id="ps_1001", limit=10), [])
            self.assertFalse(store.delete_note(session_id="ps_1001", note_id="missing"))

    def test_closed_session_rejects_annotation_and_note_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            store.open_session(
                session_id="ps_1002",
                paper_ref="p_1002",
                pdf_uri="/tmp/paper.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )
            store.close_session("ps_1002")

            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.upsert_annotation(
                    session_id="ps_1002",
                    annotation=annotation_payload(id="ann_x"),
                )
            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.delete_annotation(session_id="ps_1002", annotation_id="ann_x")

            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.upsert_note(
                    session_id="ps_1002",
                    note=note_payload(id="note_x"),
                )
            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.delete_note(session_id="ps_1002", note_id="note_x")


class SchemaVersioningTest(unittest.TestCase):
    def test_fresh_db_has_expected_schema_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            self.assertEqual(store.get_schema_version(), SCHEMA_VERSION)

    def test_migrations_are_idempotent(self) -> None:
        """Constructing a second EventStore on the same DB must not fail."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            EventStore(db_path)
            store2 = EventStore(db_path)
            self.assertEqual(store2.get_schema_version(), SCHEMA_VERSION)

    def test_check_integrity_rejects_newer_version(self) -> None:
        """A DB whose schema version exceeds SCHEMA_VERSION should raise."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            store = EventStore(db_path)
            # Manually bump the recorded version to simulate a newer DB.
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "UPDATE schema_migrations SET version = ? WHERE version = ?",
                    (SCHEMA_VERSION + 1, SCHEMA_VERSION),
                )
            with self.assertRaisesRegex(RuntimeError, "newer than supported"):
                store.check_integrity()

    def test_wal_pragma_applied(self) -> None:
        """The journal mode should be WAL after opening the store."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            EventStore(db_path)
            with sqlite3.connect(db_path) as conn:
                row = conn.execute("PRAGMA journal_mode").fetchone()
                self.assertEqual(row[0], "wal")


if __name__ == "__main__":
    unittest.main()


class PaperScopedStateTest(unittest.TestCase):
    """Annotations and notes belong to the paper, not to one reading session."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "scope.db")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _open(self, session_id: str, paper_ref: str = "p_scope") -> None:
        self._store.open_session(
            session_id=session_id,
            paper_ref=paper_ref,
            pdf_uri="/tmp/scope.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )

    def test_annotations_survive_into_a_later_session_on_the_same_paper(self) -> None:
        self._open("ps_first")
        self._store.upsert_annotation(
            session_id="ps_first",
            annotation=annotation_payload(id="ann_keep", quote="scaled dot-product attention"),
        )
        self._store.close_session("ps_first")

        self._open("ps_second")
        records = self._store.list_annotations(session_id="ps_second")
        self.assertEqual([record.id for record in records], ["ann_keep"])
        self.assertEqual(records[0].annotation["quote"], "scaled dot-product attention")
        self.assertEqual(records[0].paper_ref, "p_scope")

    def test_notes_survive_into_a_later_session_on_the_same_paper(self) -> None:
        self._open("ps_first")
        self._store.upsert_note(session_id="ps_first", note=note_payload(id="note_keep", title="Kept"))
        self._store.close_session("ps_first")

        self._open("ps_second")
        records = self._store.list_notes(session_id="ps_second")
        self.assertEqual([record.id for record in records], ["note_keep"])
        self.assertEqual(records[0].note["title"], "Kept")

    def test_other_papers_stay_separate(self) -> None:
        self._open("ps_a", paper_ref="p_a")
        self._open("ps_b", paper_ref="p_b")
        self._store.upsert_annotation(session_id="ps_a", annotation=annotation_payload(id="ann_a"))

        self.assertEqual(len(self._store.list_annotations(session_id="ps_a")), 1)
        self.assertEqual(self._store.list_annotations(session_id="ps_b"), [])

    def test_later_session_can_update_and_delete_earlier_work(self) -> None:
        self._open("ps_first")
        self._store.upsert_annotation(session_id="ps_first", annotation=annotation_payload(id="ann_1"))
        self._open("ps_second")
        updated = self._store.upsert_annotation(
            session_id="ps_second",
            annotation=annotation_payload(id="ann_1", comment="second pass"),
        )
        self.assertEqual(updated.annotation["comment"], "second pass")
        self.assertEqual(updated.session_id, "ps_second", "row records its last writer")
        self.assertEqual(len(self._store.list_annotations(paper_ref="p_scope")), 1)

        self.assertTrue(self._store.delete_annotation(session_id="ps_second", annotation_id="ann_1"))
        self.assertEqual(self._store.list_annotations(paper_ref="p_scope"), [])

    def test_listing_requires_exactly_one_scope(self) -> None:
        self._open("ps_first")
        with self.assertRaises(ValueError):
            self._store.list_annotations()
        with self.assertRaises(ValueError):
            self._store.list_annotations(session_id="ps_first", paper_ref="p_scope")

    def test_list_sessions_filters_by_paper_and_open_state(self) -> None:
        self._open("ps_a", paper_ref="p_a")
        self._open("ps_b", paper_ref="p_b")
        self._open("ps_c", paper_ref="p_a")
        self._store.close_session("ps_a")

        all_ids = {session.id for session in self._store.list_sessions()}
        self.assertEqual(all_ids, {"ps_a", "ps_b", "ps_c"})

        paper_a = {session.id for session in self._store.list_sessions(paper_ref="p_a")}
        self.assertEqual(paper_a, {"ps_a", "ps_c"})

        open_a = {session.id for session in self._store.list_sessions(paper_ref="p_a", open_only=True)}
        self.assertEqual(open_a, {"ps_c"})

    def test_list_paper_refs_deduplicates(self) -> None:
        self._open("ps_a", paper_ref="p_a")
        self._open("ps_b", paper_ref="p_a")
        self._open("ps_c", paper_ref="p_b")
        self.assertEqual(sorted(self._store.list_paper_refs()), ["p_a", "p_b"])


class SchemaMigrationTest(unittest.TestCase):
    """A v1 database must upgrade in place without losing reading output."""

    _V1_SCHEMA = [
        """
        CREATE TABLE paper_sessions (
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
        CREATE TABLE action_events (
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
        CREATE TABLE annotations (
            session_id TEXT NOT NULL,
            annotation_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (session_id, annotation_id)
        )
        """,
        """
        CREATE TABLE notes (
            session_id TEXT NOT NULL,
            note_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (session_id, note_id)
        )
        """,
        """
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            applied_at TEXT NOT NULL
        )
        """,
        "INSERT INTO schema_migrations (version, description, applied_at)"
        " VALUES (1, 'initial schema', '2026-01-01T00:00:00+00:00')",
    ]

    def _write_v1_database(self, db_path: Path) -> None:
        import json as _json

        conn = sqlite3.connect(db_path)
        try:
            for statement in self._V1_SCHEMA:
                conn.execute(statement)
            legacy_sessions = (
                ("ps_old", "2026-01-01T00:00:00+00:00"),
                ("ps_new", "2026-02-01T00:00:00+00:00"),
            )
            for session_id, opened_at in legacy_sessions:
                conn.execute(
                    """
                    INSERT INTO paper_sessions (id, paper_ref, pdf_uri, agent_id, user_id, metadata_json, opened_at)
                    VALUES (?, 'p_legacy', '/tmp/legacy.pdf', 'agent:x', 'user:x', '{}', ?)
                    """,
                    (session_id, opened_at),
                )
            # Same annotation id touched in two sessions of one paper: newest wins.
            old = "2026-01-01T00:00:00+00:00"
            new = "2026-02-01T00:00:00+00:00"
            insert_annotation = "INSERT INTO annotations VALUES (?, ?, ?, ?, ?)"
            conn.execute(
                insert_annotation,
                ("ps_old", "ann_dup", _json.dumps(annotation_payload(id="ann_dup", comment="older")), old, old),
            )
            conn.execute(
                insert_annotation,
                ("ps_new", "ann_dup", _json.dumps(annotation_payload(id="ann_dup", comment="newer")), new, new),
            )
            conn.execute(
                insert_annotation,
                ("ps_old", "ann_only_old", _json.dumps(annotation_payload(id="ann_only_old")), old, old),
            )
            conn.execute(
                "INSERT INTO notes VALUES (?, ?, ?, ?, ?)",
                ("ps_old", "note_legacy", _json.dumps(note_payload(id="note_legacy", title="Legacy")), old, old),
            )
            conn.commit()
        finally:
            conn.close()

    def test_v1_database_upgrades_and_keeps_annotations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "legacy.db"
            self._write_v1_database(db_path)

            store = EventStore(db_path)
            self.assertEqual(store.get_schema_version(), SCHEMA_VERSION)

            records = store.list_annotations(paper_ref="p_legacy")
            by_id = {record.id: record for record in records}
            self.assertEqual(sorted(by_id), ["ann_dup", "ann_only_old"])
            self.assertEqual(
                by_id["ann_dup"].annotation["comment"],
                "newer",
                "the most recently updated row must win the merge",
            )
            self.assertEqual(by_id["ann_only_old"].paper_ref, "p_legacy")

            notes = store.list_notes(paper_ref="p_legacy")
            self.assertEqual([note.id for note in notes], ["note_legacy"])

            # Both legacy sessions now see the merged paper-level set.
            self.assertEqual(len(store.list_annotations(session_id="ps_old")), 2)
            self.assertEqual(len(store.list_annotations(session_id="ps_new")), 2)
