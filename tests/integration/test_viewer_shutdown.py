from __future__ import annotations

import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path


@unittest.skipUnless(os.name == "posix", "Requires Unix SIGTERM delivery")
class ViewerShutdownTest(unittest.TestCase):
    def test_sigterm_exits_without_deadlocking_the_serving_thread(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "events.db"
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            source = str(Path(__file__).resolve().parents[2] / "src")
            environment = {**os.environ, "PYTHONPATH": source + os.pathsep + os.environ.get("PYTHONPATH", "")}
            with subprocess.Popen(
                [sys.executable, "-m", "agent_pdf_workbench.viewer_server", "--db-path", str(database),
                 "--pdf-root", str(root), "--port", str(port)],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", env=environment,
            ) as process:
                ready = threading.Event()
                output: list[str] = []

                def read_output() -> None:
                    assert process.stdout is not None
                    for line in process.stdout:
                        output.append(line)
                        if "viewer server running on" in line:
                            ready.set()

                reader = threading.Thread(target=read_output, daemon=True)
                reader.start()
                try:
                    self.assertTrue(ready.wait(10), "".join(output))
                    process.terminate()
                    self.assertEqual(process.wait(timeout=5), 0, "".join(output))
                finally:
                    if process.poll() is None:
                        process.kill()  # Clean up the owned subprocess after a failing assertion/timeout.
                        process.wait(timeout=5)
                    reader.join(timeout=5)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
