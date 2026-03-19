from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_pdf_workbench.store import EventStore


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


if __name__ == "__main__":
    unittest.main()
