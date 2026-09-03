"""Load and regression tests for long reading sessions.

These tests verify:
- Correctness with large event counts and many annotations/notes.
- Session close semantics and enforcement of closed-session state.
- Idempotency of upsert and delete operations.
"""

from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path

from agent_pdf_workbench.service import AgentPdfWorkbenchService
from agent_pdf_workbench.store import EventStore

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


class LoadTest(unittest.TestCase):
    """Load test: simulate a long reading session with many events and annotations."""

    _EVENT_COUNT = 1205
    _ANNOTATION_COUNT = 200
    _NOTE_COUNT = 50

    def test_large_event_stream(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = EventStore(Path(tmp_dir) / "load.db")
            store.open_session(
                session_id="ps_load",
                paper_ref="p_load",
                pdf_uri="/tmp/load.pdf",
                agent_id="agent:load",
                user_id="user:load",
            )
            # Append many events.
            for i in range(self._EVENT_COUNT):
                store.append_event(
                    session_id="ps_load",
                    event_type="page_change" if i % 3 == 0 else "highlight",
                    page=(i % 50) + 1,
                )
            # Paginate through with after_id cursor.
            collected = []
            after_id = None
            while True:
                batch = store.list_events(session_id="ps_load", after_id=after_id, limit=100)
                if not batch:
                    break
                collected.extend(batch)
                after_id = batch[-1].id
            self.assertEqual(len(collected), self._EVENT_COUNT)
            # Events must be in ascending id order.
            ids = [e.id for e in collected]
            self.assertEqual(ids, sorted(ids))

    def test_many_annotations_and_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = EventStore(Path(tmp_dir) / "ann_load.db")
            store.open_session(
                session_id="ps_ann_load",
                paper_ref="p_ann_load",
                pdf_uri="/tmp/ann_load.pdf",
                agent_id="agent:load",
                user_id="user:load",
            )
            # Upsert many annotations.
            for i in range(self._ANNOTATION_COUNT):
                store.upsert_annotation(
                    session_id="ps_ann_load",
                    annotation=annotation_payload(
                        id=f"ann_{i:04d}",
                        page=(i % 20) + 1,
                        type="highlight",
                        quote=f"quote {i}",
                    ),
                )
            # Update the first half.
            for i in range(self._ANNOTATION_COUNT // 2):
                store.upsert_annotation(
                    session_id="ps_ann_load",
                    annotation=annotation_payload(
                        id=f"ann_{i:04d}",
                        page=(i % 20) + 1,
                        type="underline",
                        quote=f"updated quote {i}",
                    ),
                )
            annotations = store.list_annotations(session_id="ps_ann_load", limit=1000)
            self.assertEqual(len(annotations), self._ANNOTATION_COUNT)
            # Verify the updated ones.
            by_id = {a.id: a for a in annotations}
            self.assertEqual(by_id["ann_0000"].annotation["type"], "underline")
            self.assertEqual(by_id[f"ann_{self._ANNOTATION_COUNT - 1:04d}"].annotation["type"], "highlight")

            # Upsert notes.
            for i in range(self._NOTE_COUNT):
                store.upsert_note(
                    session_id="ps_ann_load",
                    note=note_payload(
                        id=f"note_{i:04d}",
                        title=f"Note {i}",
                        markdown=f"Content {i}",
                        linkedAnnotationIds=[f"ann_{i:04d}"] if i < self._ANNOTATION_COUNT else [],
                    ),
                )
            notes = store.list_notes(session_id="ps_ann_load", limit=1000)
            self.assertEqual(len(notes), self._NOTE_COUNT)

    def test_workspace_export_does_not_truncate_large_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AgentPdfWorkbenchService(Path(tmp_dir) / "export.db")
            session = service.open_paper(
                paper_ref="p_export_load",
                pdf_uri="/tmp/export-load.pdf",
                agent_id="agent:load",
                user_id="user:load",
            )
            session_id = session["id"]

            event_count = 1205
            annotation_count = 205
            note_count = 55

            for i in range(event_count):
                service.record_action(
                    session_id=session_id,
                    event_type="highlight",
                    page=(i % 20) + 1,
                    payload={"index": i},
                )
            for i in range(annotation_count):
                service.upsert_annotation(
                    session_id=session_id,
                    annotation=annotation_payload(
                        id=f"ann_export_{i:04d}",
                        page=(i % 20) + 1,
                        quote=f"quote {i}",
                    ),
                )
            for i in range(note_count):
                service.upsert_note(
                    session_id=session_id,
                    note=note_payload(
                        id=f"note_export_{i:04d}",
                        title=f"Note {i}",
                        markdown=f"Content {i}",
                    ),
                )

            exported = service.export_workspace()
            self.assertEqual(exported["paper_count"], 1)
            exported_paper = exported["papers"][0]
            self.assertEqual(exported_paper["paper_ref"], "p_export_load")
            self.assertEqual(len(exported_paper["annotations"]), annotation_count)
            self.assertEqual(len(exported_paper["notes"]), note_count)
            self.assertEqual(len(exported_paper["sessions"]), 1)
            self.assertEqual(len(exported_paper["sessions"][0]["events"]), event_count)

    def test_export_keeps_one_annotation_set_across_many_sessions(self) -> None:
        """Re-reading a paper must not fragment or duplicate its annotations."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AgentPdfWorkbenchService(Path(tmp_dir) / "reread.db")
            for round_index in range(3):
                session = service.open_paper(
                    paper_ref="p_reread",
                    pdf_uri="/tmp/reread.pdf",
                )
                service.upsert_annotation(
                    session_id=session["id"],
                    annotation=annotation_payload(id=f"ann_round_{round_index}"),
                )
                service.record_action(session_id=session["id"], event_type="page_change", page=1)
                service.close_paper(session_id=session["id"])

            exported = service.export_workspace()
            self.assertEqual(exported["paper_count"], 1)
            self.assertEqual(exported["session_count"], 3)
            paper = exported["papers"][0]
            self.assertEqual(len(paper["annotations"]), 3)
            self.assertEqual(len(paper["sessions"]), 3)


class SessionCloseRegressionTest(unittest.TestCase):
    """Regression tests: session close must block all subsequent mutations."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "close.db")
        self._store.open_session(
            session_id="ps_close",
            paper_ref="p_close",
            pdf_uri="/tmp/close.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_read_operations_still_work_after_close(self) -> None:
        self._store.append_event(session_id="ps_close", event_type="highlight")
        self._store.upsert_annotation(
            session_id="ps_close",
            annotation=annotation_payload(id="ann_c1", quote="q"),
        )
        self._store.close_session("ps_close")
        # Reads must succeed.
        events = self._store.list_events(session_id="ps_close")
        self.assertEqual(len(events), 1)
        anns = self._store.list_annotations(session_id="ps_close")
        self.assertEqual(len(anns), 1)

    def test_all_write_paths_blocked_after_close(self) -> None:
        self._store.close_session("ps_close")
        write_ops = [
            lambda: self._store.append_event(session_id="ps_close", event_type="x"),
            lambda: self._store.upsert_annotation(
                session_id="ps_close", annotation=annotation_payload(id="a")
            ),
            lambda: self._store.delete_annotation(session_id="ps_close", annotation_id="a"),
            lambda: self._store.upsert_note(
                session_id="ps_close",
                note=note_payload(id="n"),
            ),
            lambda: self._store.delete_note(session_id="ps_close", note_id="n"),
        ]
        for op in write_ops:
            with self.assertRaisesRegex(ValueError, "Session is closed", msg=f"Expected close guard for {op}"):
                op()

    def test_close_is_idempotent(self) -> None:
        """Calling close_session twice should not raise."""
        self._store.close_session("ps_close")
        session = self._store.close_session("ps_close")
        self.assertIsNotNone(session.closed_at)


class IdempotencyTest(unittest.TestCase):
    """Upsert must be idempotent; delete must return False on missing items."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._store = EventStore(Path(self._tmp.name) / "idem.db")
        self._store.open_session(
            session_id="ps_idem",
            paper_ref="p_idem",
            pdf_uri="/tmp/idem.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_upsert_annotation_is_idempotent(self) -> None:
        ann = annotation_payload(id="ann_i", quote="same")
        r1 = self._store.upsert_annotation(session_id="ps_idem", annotation=ann)
        r2 = self._store.upsert_annotation(session_id="ps_idem", annotation=ann)
        self.assertEqual(r1.id, r2.id)
        self.assertEqual(r1.created_at, r2.created_at)
        self.assertEqual(len(self._store.list_annotations(session_id="ps_idem")), 1)

    def test_upsert_note_is_idempotent(self) -> None:
        note = note_payload(id="note_i", title="t", markdown="m")
        r1 = self._store.upsert_note(session_id="ps_idem", note=note)
        r2 = self._store.upsert_note(session_id="ps_idem", note=note)
        self.assertEqual(r1.id, r2.id)
        self.assertEqual(r1.created_at, r2.created_at)
        self.assertEqual(len(self._store.list_notes(session_id="ps_idem")), 1)

    def test_delete_annotation_returns_false_on_missing(self) -> None:
        self.assertFalse(
            self._store.delete_annotation(session_id="ps_idem", annotation_id="no_such")
        )

    def test_delete_note_returns_false_on_missing(self) -> None:
        self.assertFalse(self._store.delete_note(session_id="ps_idem", note_id="no_such"))

    def test_delete_annotation_then_delete_again_returns_false(self) -> None:
        self._store.upsert_annotation(
            session_id="ps_idem",
            annotation=annotation_payload(id="ann_del"),
        )
        self.assertTrue(
            self._store.delete_annotation(session_id="ps_idem", annotation_id="ann_del")
        )
        self.assertFalse(
            self._store.delete_annotation(session_id="ps_idem", annotation_id="ann_del")
        )


class ConcurrentWriteTest(unittest.TestCase):
    """Basic smoke test: concurrent event appends from multiple threads must not corrupt data."""

    def test_concurrent_event_append(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = EventStore(Path(tmp_dir) / "concurrent.db")
            store.open_session(
                session_id="ps_conc",
                paper_ref="p_conc",
                pdf_uri="/tmp/conc.pdf",
                agent_id="agent:test",
                user_id="user:test",
            )
            errors: list[Exception] = []
            threads_count = 10
            events_per_thread = 50

            def worker() -> None:
                try:
                    for _ in range(events_per_thread):
                        store.append_event(session_id="ps_conc", event_type="highlight")
                except Exception as exc:
                    errors.append(exc)

            threads = [threading.Thread(target=worker) for _ in range(threads_count)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(errors, [], msg=f"Concurrent write errors: {errors}")
            all_events = store.list_events(session_id="ps_conc", limit=1000)
            self.assertEqual(len(all_events), threads_count * events_per_thread)


if __name__ == "__main__":
    unittest.main()
