from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from agent_pdf_workbench.store import EventStore


class ConnectionLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.db_path = Path(self.workspace.name) / "events.db"
        self.store = EventStore(self.db_path)

    def assert_closed(self, connection: sqlite3.Connection) -> None:
        with self.assertRaisesRegex(sqlite3.ProgrammingError, "closed"):
            connection.execute("SELECT 1")

    def test_success_commits_and_closes_connection(self) -> None:
        with self.store._connect() as connection:
            connection.execute("CREATE TABLE lifecycle (value TEXT)")
            connection.execute("INSERT INTO lifecycle VALUES ('committed')")
        self.assert_closed(connection)
        with self.store._connect() as reopened:
            self.assertEqual(reopened.execute("SELECT value FROM lifecycle").fetchone()[0], "committed")
        self.assert_closed(reopened)

    def test_exception_rolls_back_and_closes_connection(self) -> None:
        with self.store._connect() as connection:
            connection.execute("CREATE TABLE lifecycle (value TEXT)")
        with self.assertRaisesRegex(ValueError, "interrupted"):
            with self.store._connect() as connection:
                connection.execute("INSERT INTO lifecycle VALUES ('uncommitted')")
                raise ValueError("interrupted")
        self.assert_closed(connection)
        with self.store._connect() as reopened:
            self.assertEqual(reopened.execute("SELECT COUNT(*) FROM lifecycle").fetchone()[0], 0)

    def test_connection_setup_failure_closes_connection(self) -> None:
        connection = Mock(spec=sqlite3.Connection)
        connection.execute.side_effect = sqlite3.OperationalError("pragma failed")
        with patch("agent_pdf_workbench.store.sqlite3.connect", return_value=connection):
            with self.assertRaisesRegex(sqlite3.OperationalError, "pragma failed"):
                with self.store._connect():
                    self.fail("connection setup should fail before yielding")
        connection.close.assert_called_once_with()

    def test_backup_target_failure_closes_source(self) -> None:
        source = sqlite3.connect(self.db_path)
        self.addCleanup(source.close)
        with patch(
            "agent_pdf_workbench.store.sqlite3.connect",
            side_effect=[source, sqlite3.OperationalError("target unavailable")],
        ):
            with self.assertRaisesRegex(sqlite3.OperationalError, "target unavailable"):
                self.store.backup_to(Path(self.workspace.name) / "backup.db")
        self.assert_closed(source)

    def test_backup_reopen_and_checkpoint_preserve_session(self) -> None:
        self.store.open_session(
            session_id="session-backup",
            paper_ref="paper-backup",
            pdf_uri="paper.pdf",
            agent_id="agent:test",
            user_id="user:test",
        )
        self.store.append_event(session_id="session-backup", event_type="comment", payload={"text": "Keep this"})
        backup = Path(self.workspace.name) / "backup.db"
        self.store.backup_to(backup)
        restored = EventStore(backup)
        self.assertEqual(restored.get_session("session-backup").paper_ref, "paper-backup")
        self.assertEqual(restored.list_events(session_id="session-backup")[0].payload, {"text": "Keep this"})
        self.assertEqual(restored.checkpoint()["busy"], 0)


if __name__ == "__main__":
    unittest.main()
