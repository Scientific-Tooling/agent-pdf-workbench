from __future__ import annotations

import json
import threading
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from agent_pdf_workbench.service import AgentPdfWorkbenchService
from agent_pdf_workbench.viewer_server import _is_within_directory
from agent_pdf_workbench.viewer_server import _create_handler


class ViewerServerTest(unittest.TestCase):
    def test_is_within_directory_rejects_prefix_collision(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            web_dir = (root / "web").resolve()
            sibling = (root / "web2" / "secret.txt").resolve()
            web_dir.mkdir(parents=True, exist_ok=True)
            sibling.parent.mkdir(parents=True, exist_ok=True)
            sibling.write_text("secret", encoding="utf-8")

            self.assertFalse(_is_within_directory(sibling, web_dir))
            self.assertTrue(_is_within_directory((web_dir / "index.html").resolve(), web_dir))


class ViewerServerApiE2ETest(unittest.TestCase):
    def test_main_path_annotation_note_crud_and_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            service = AgentPdfWorkbenchService(db_path=db_path)
            handler_cls = _create_handler(service)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
            host, port = server.server_address
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://{host}:{port}"

            try:
                opened = self._request_json(
                    "POST",
                    f"{base}/api/open-paper",
                    {
                        "paper_ref": "10.48550/arXiv.1706.03762",
                        "pdf_uri": "/tmp/paper.pdf",
                        "agent_id": "agent:e2e",
                        "user_id": "user:e2e",
                    },
                )
                session_id = opened["id"]
                self.assertTrue(session_id.startswith("ps_"))

                annotation = {
                    "id": "ann_e2e_1",
                    "page": 1,
                    "type": "highlight",
                    "quote": "attention is all you need",
                    "anchor": {
                        "quote": "attention is all you need",
                        "start": 10,
                        "end": 35,
                        "prefix": "paper ",
                        "suffix": " today",
                    },
                    "comment": "main claim",
                    "tags": ["core", "e2e"],
                    "rects": [{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}],
                    "createdAt": "2026-03-20T12:00:00+00:00",
                    "updatedAt": "2026-03-20T12:00:00+00:00",
                }
                upserted_ann = self._request_json(
                    "POST",
                    f"{base}/api/annotations",
                    {"session_id": session_id, "annotation": annotation},
                )
                self.assertEqual(upserted_ann["annotation"]["id"], "ann_e2e_1")

                annotations = self._request_json(
                    "GET",
                    f"{base}/api/annotations?session_id={session_id}&limit=100",
                )
                self.assertEqual(annotations["count"], 1)
                self.assertEqual(annotations["annotations"][0]["annotation"]["comment"], "main claim")

                note = {
                    "id": "note_e2e_1",
                    "title": "first note",
                    "markdown": "linked note",
                    "linkedAnnotationIds": ["ann_e2e_1"],
                    "createdAt": "2026-03-20T12:01:00+00:00",
                    "updatedAt": "2026-03-20T12:01:00+00:00",
                }
                upserted_note = self._request_json(
                    "POST",
                    f"{base}/api/notes",
                    {"session_id": session_id, "note": note},
                )
                self.assertEqual(upserted_note["note"]["id"], "note_e2e_1")

                notes = self._request_json("GET", f"{base}/api/notes?session_id={session_id}&limit=100")
                self.assertEqual(notes["count"], 1)
                self.assertEqual(notes["notes"][0]["note"]["linkedAnnotationIds"], ["ann_e2e_1"])

                self._request_json(
                    "POST",
                    f"{base}/api/record-action",
                    {
                        "session_id": session_id,
                        "event_type": "annotation_upsert",
                        "page": 1,
                        "payload": {"annotation_id": "ann_e2e_1"},
                    },
                )
                actions = self._request_json(
                    "GET",
                    f"{base}/api/list-actions?session_id={session_id}&limit=100",
                )
                self.assertEqual(actions["count"], 1)
                self.assertEqual(actions["events"][0]["event_type"], "annotation_upsert")

                deleted_ann = self._request_json(
                    "POST",
                    f"{base}/api/annotations/delete",
                    {"session_id": session_id, "annotation_id": "ann_e2e_1"},
                )
                self.assertTrue(deleted_ann["deleted"])
                annotations_after = self._request_json(
                    "GET",
                    f"{base}/api/annotations?session_id={session_id}&limit=100",
                )
                self.assertEqual(annotations_after["count"], 0)

                deleted_note = self._request_json(
                    "POST",
                    f"{base}/api/notes/delete",
                    {"session_id": session_id, "note_id": "note_e2e_1"},
                )
                self.assertTrue(deleted_note["deleted"])
                notes_after = self._request_json("GET", f"{base}/api/notes?session_id={session_id}&limit=100")
                self.assertEqual(notes_after["count"], 0)

                self._request_json("POST", f"{base}/api/close-paper", {"session_id": session_id})
                with self.assertRaisesRegex(AssertionError, "HTTP 400"):
                    self._request_json(
                        "POST",
                        f"{base}/api/annotations",
                        {"session_id": session_id, "annotation": annotation},
                    )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_remote_pdf_fetch_failure_returns_json_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "events.db"
            service = AgentPdfWorkbenchService(db_path=db_path)
            handler_cls = _create_handler(service, allow_remote_pdf=True)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
            host, port = server.server_address
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://{host}:{port}"

            try:
                remote_uri = quote("http://127.0.0.1:9/missing.pdf", safe="")
                request = Request(f"{base}/api/pdf?uri={remote_uri}", method="GET")
                with self.assertRaises(HTTPError) as err_ctx:
                    urlopen(request, timeout=5)
                self.assertEqual(err_ctx.exception.code, 502)
                body = err_ctx.exception.read().decode("utf-8")
                payload = json.loads(body)
                self.assertIn("remote PDF fetch failed", payload.get("error", ""))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def _request_json(self, method: str, url: str, payload: dict | None = None) -> dict:
        data = None
        headers: dict[str, str] = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(url, data=data, method=method, headers=headers)
        try:
            with urlopen(request, timeout=5) as response:  # noqa: S310 - local test server only.
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except HTTPError as exc:
            body = exc.read().decode("utf-8")
            raise AssertionError(f"HTTP {exc.code}: {body}") from exc


if __name__ == "__main__":
    unittest.main()
