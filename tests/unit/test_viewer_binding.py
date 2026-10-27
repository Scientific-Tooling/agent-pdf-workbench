from __future__ import annotations

import io
import socket
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from agent_pdf_workbench import viewer_server


class ViewerBindingTest(unittest.TestCase):
    def test_local_startup_does_not_require_reverse_dns(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            arguments = ["apw-viewer-server", "--host", "127.0.0.1", "--port", str(port),
                         "--db-path", str(root / "events.db"), "--pdf-root", str(root)]
            bound = []

            def serve(server) -> None:
                bound.append((server.server_name, server.server_port))

            with (
                patch.object(sys, "argv", arguments),
                patch.object(viewer_server.signal, "signal"),
                patch.object(viewer_server.ThreadingHTTPServer, "serve_forever", autospec=True, side_effect=serve),
                patch(
                    "socket.getfqdn", side_effect=AssertionError("Local startup must not wait on reverse DNS")
                ) as lookup,
                redirect_stderr(io.StringIO()),
            ):
                self.assertEqual(viewer_server.main(), 0)
            lookup.assert_not_called()
            self.assertEqual(bound, [("127.0.0.1", port)])
