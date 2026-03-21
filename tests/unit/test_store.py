from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from agent_pdf_workbench.store import EventStore, SCHEMA_VERSION


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
                annotation={
                    "id": "ann_1",
                    "page": 2,
                    "type": "highlight",
                    "quote": "attention is all you need",
                    "comment": "core idea",
                    "tags": ["idea"],
                    "rects": [{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}],
                },
            )
            self.assertEqual(ann.id, "ann_1")
            self.assertEqual(ann.annotation["quote"], "attention is all you need")

            ann_updated = store.upsert_annotation(
                session_id="ps_1001",
                annotation={
                    "id": "ann_1",
                    "page": 2,
                    "type": "highlight",
                    "quote": "attention is all you need",
                    "comment": "updated",
                    "tags": ["idea", "todo"],
                    "rects": [{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}],
                },
            )
            self.assertEqual(ann_updated.annotation["comment"], "updated")
            annotations = store.list_annotations(session_id="ps_1001", limit=10)
            self.assertEqual(len(annotations), 1)
            self.assertEqual(annotations[0].id, "ann_1")

            note = store.upsert_note(
                session_id="ps_1001",
                note={
                    "id": "note_1",
                    "title": "note title",
                    "markdown": "content",
                    "linkedAnnotationIds": ["ann_1"],
                },
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
                    annotation={"id": "ann_x", "page": 1, "type": "highlight", "rects": []},
                )
            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.delete_annotation(session_id="ps_1002", annotation_id="ann_x")

            with self.assertRaisesRegex(ValueError, "Session is closed"):
                store.upsert_note(
                    session_id="ps_1002",
                    note={"id": "note_x", "title": "", "markdown": "", "linkedAnnotationIds": []},
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
