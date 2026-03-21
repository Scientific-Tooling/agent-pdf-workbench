"""Fuzz-style unit tests for store-layer input validation.

These tests exercise boundary and adversarial inputs at the store layer
without requiring an HTTP server.  They complement the integration tests
in tests/integration/ which hit the HTTP API.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_pdf_workbench.store import EventStore, MAX_LIST_LIMIT


class LimitValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "events.db")
        self._store.open_session(
            session_id="ps_fuzz",
            paper_ref="p_fuzz",
            pdf_uri="/tmp/fuzz.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )
        self._store.append_event(session_id="ps_fuzz", event_type="highlight")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_limit_zero_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "limit must be >= 1"):
            self._store.list_events(session_id="ps_fuzz", limit=0)

    def test_limit_negative_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "limit must be >= 1"):
            self._store.list_events(session_id="ps_fuzz", limit=-99)

    def test_limit_over_max_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, f"limit must be <= {MAX_LIST_LIMIT}"):
            self._store.list_events(session_id="ps_fuzz", limit=MAX_LIST_LIMIT + 1)

    def test_limit_exactly_max_accepted(self) -> None:
        events = self._store.list_events(session_id="ps_fuzz", limit=MAX_LIST_LIMIT)
        self.assertIsInstance(events, list)

    def test_after_id_negative_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "after_id must be >= 0"):
            self._store.list_events(session_id="ps_fuzz", after_id=-1)

    def test_after_id_zero_accepted(self) -> None:
        events = self._store.list_events(session_id="ps_fuzz", after_id=0)
        self.assertIsInstance(events, list)


class AnnotationValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "events.db")
        self._store.open_session(
            session_id="ps_ann_fuzz",
            paper_ref="p_ann",
            pdf_uri="/tmp/ann.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_annotation_missing_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "annotation.id"):
            self._store.upsert_annotation(
                session_id="ps_ann_fuzz",
                annotation={"type": "highlight"},
            )

    def test_annotation_empty_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "annotation.id"):
            self._store.upsert_annotation(
                session_id="ps_ann_fuzz",
                annotation={"id": "  "},
            )

    def test_annotation_non_string_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "annotation.id"):
            self._store.upsert_annotation(
                session_id="ps_ann_fuzz",
                annotation={"id": 42},
            )

    def test_delete_empty_annotation_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "annotation_id must be a non-empty string"):
            self._store.delete_annotation(session_id="ps_ann_fuzz", annotation_id="   ")

    def test_unknown_session_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown session_id"):
            self._store.upsert_annotation(
                session_id="ps_does_not_exist",
                annotation={"id": "ann_x"},
            )


class NoteValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "events.db")
        self._store.open_session(
            session_id="ps_note_fuzz",
            paper_ref="p_note",
            pdf_uri="/tmp/note.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_note_missing_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "note.id"):
            self._store.upsert_note(
                session_id="ps_note_fuzz",
                note={"title": "x"},
            )

    def test_note_empty_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "note.id"):
            self._store.upsert_note(
                session_id="ps_note_fuzz",
                note={"id": ""},
            )

    def test_delete_empty_note_id_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "note_id must be a non-empty string"):
            self._store.delete_note(session_id="ps_note_fuzz", note_id="")

    def test_closed_session_rejects_all_writes(self) -> None:
        self._store.close_session("ps_note_fuzz")
        with self.assertRaisesRegex(ValueError, "Session is closed"):
            self._store.upsert_note(
                session_id="ps_note_fuzz",
                note={"id": "n1", "title": "", "markdown": "", "linkedAnnotationIds": []},
            )
        with self.assertRaisesRegex(ValueError, "Session is closed"):
            self._store.delete_note(session_id="ps_note_fuzz", note_id="n1")
        with self.assertRaisesRegex(ValueError, "Session is closed"):
            self._store.upsert_annotation(
                session_id="ps_note_fuzz",
                annotation={"id": "a1"},
            )
        with self.assertRaisesRegex(ValueError, "Session is closed"):
            self._store.delete_annotation(session_id="ps_note_fuzz", annotation_id="a1")


class JsonPayloadEdgeCaseTest(unittest.TestCase):
    """Test that arbitrary JSON-serialisable payloads round-trip correctly."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "events.db")
        self._store.open_session(
            session_id="ps_json",
            paper_ref="p_json",
            pdf_uri="/tmp/json.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_unicode_payload_roundtrips(self) -> None:
        payload = {"text": "αβγ 日本語 🎉", "nested": {"a": [1, 2, 3]}}
        event = self._store.append_event(
            session_id="ps_json",
            event_type="comment",
            payload=payload,
        )
        events = self._store.list_events(session_id="ps_json")
        self.assertEqual(events[0].payload, payload)

    def test_annotation_payload_with_special_chars_roundtrips(self) -> None:
        ann = {
            "id": "ann_special",
            "quote": 'He said "Hello" & <goodbye>',
            "tags": ["a&b", "c<d>"],
        }
        record = self._store.upsert_annotation(session_id="ps_json", annotation=ann)
        annotations = self._store.list_annotations(session_id="ps_json")
        self.assertEqual(annotations[0].annotation["quote"], ann["quote"])

    def test_empty_payload_accepted(self) -> None:
        event = self._store.append_event(session_id="ps_json", event_type="page_change")
        self.assertEqual(event.payload, {})

    def test_none_payload_treated_as_empty(self) -> None:
        event = self._store.append_event(
            session_id="ps_json",
            event_type="zoom_change",
            payload=None,
        )
        self.assertEqual(event.payload, {})


if __name__ == "__main__":
    unittest.main()
