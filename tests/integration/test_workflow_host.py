"""The embedded workflow uses the reader's actual request boundaries."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from agent_pdf_workbench.viewer_server import create_viewer_server


class HostedWorkflowTest(unittest.TestCase):
    def test_optional_hosted_workflow_and_request_guards(self):
        calls = []
        class Host:
            def status(self, session_id):
                return {"enabled": True, "session_id": session_id}
            def execute(self, payload):
                calls.append(payload)
                return {"accepted": True}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = create_viewer_server(root / "events.db", root, workflow=Host())
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            opener = build_opener(ProxyHandler({}))
            base = f"http://127.0.0.1:{server.server_port}"
            try:
                with opener.open(base + "/api/workflow?session_id=test") as response:
                    self.assertEqual(json.load(response), {"enabled": True, "session_id": "test"})
                payload = b'{"action":"preview"}'
                for headers in ({"Content-Type": "text/plain"},
                                {"Content-Type": "application/json", "Origin": "https://foreign.example"},
                                {"Content-Type": "application/json", "Host": "foreign.example"}):
                    with self.assertRaises(HTTPError):
                        opener.open(Request(base + "/api/workflow", data=payload, headers=headers))
                self.assertEqual(calls, [])
                with opener.open(Request(base + "/api/workflow", data=payload,
                                         headers={"Content-Type": "application/json"})) as response:
                    self.assertTrue(json.load(response)["accepted"])
                self.assertEqual(calls, [{"action": "preview"}])
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()
