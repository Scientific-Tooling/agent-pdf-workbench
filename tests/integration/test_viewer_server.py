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


class ViewerServerHardeningTest(unittest.TestCase):
    """Tests for Phase 0/1 hardening: error format, body size, security headers."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        db_path = Path(self._tmp.name) / "events.db"
        service = AgentPdfWorkbenchService(db_path=db_path)
        handler_cls = _create_handler(service)
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        host, port = self._server.server_address
        thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        thread.start()
        self._base = f"http://{host}:{port}"

    def tearDown(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._tmp.cleanup()

    def _raw_request(self, method: str, url: str, payload: dict | None = None) -> tuple[int, dict, dict]:
        """Return (status_code, response_headers, response_body_dict)."""
        import http.client
        from urllib.parse import urlparse as _up

        parsed = _up(url)
        conn = http.client.HTTPConnection(parsed.netloc)
        body_bytes = None
        headers: dict[str, str] = {}
        if payload is not None:
            body_bytes = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        conn.request(method, parsed.path + (f"?{parsed.query}" if parsed.query else ""), body_bytes, headers)
        resp = conn.getresponse()
        raw = resp.read()
        resp_headers = dict(resp.getheaders())
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            body = {}
        conn.close()
        return resp.status, resp_headers, body

    def test_error_response_has_code_field(self) -> None:
        status, _, body = self._raw_request("GET", f"{self._base}/api/list-actions")
        self.assertEqual(status, 400)
        self.assertIn("error", body)
        self.assertIn("code", body)
        self.assertEqual(body["code"], "MISSING_FIELD")

    def test_security_headers_present_on_json_response(self) -> None:
        _, headers, _ = self._raw_request("GET", f"{self._base}/api/health")
        # Header names from http.client come back in mixed/lower case depending on Python version.
        header_keys_lower = {k.lower() for k in headers}
        self.assertIn("x-content-type-options", header_keys_lower)
        self.assertIn("x-frame-options", header_keys_lower)
        self.assertIn("cache-control", header_keys_lower)

    def test_oversized_body_rejected(self) -> None:
        import http.client
        from urllib.parse import urlparse as _up

        url = f"{self._base}/api/open-paper"
        parsed = _up(url)
        conn = http.client.HTTPConnection(parsed.netloc)
        # Declare a Content-Length just over the 1 MiB limit without sending a body.
        # The server rejects based on the header value before reading the body.
        conn.putrequest("POST", parsed.path)
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(2 * 1024 * 1024))
        conn.endheaders()
        resp = conn.getresponse()
        resp.read()
        conn.close()
        self.assertEqual(resp.status, 400)

    def test_missing_session_id_returns_missing_field_code(self) -> None:
        status, _, body = self._raw_request("GET", f"{self._base}/api/annotations")
        self.assertEqual(status, 400)
        self.assertEqual(body.get("code"), "MISSING_FIELD")

    def test_open_paper_rejects_invalid_field_types(self) -> None:
        status, _, body = self._raw_request(
            "POST",
            f"{self._base}/api/open-paper",
            {"paper_ref": 123, "pdf_uri": "/tmp/paper.pdf"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(body.get("code"), "VALIDATION_ERROR")
        self.assertIn("paper_ref must be a string", body.get("error", ""))

    def test_open_paper_rejects_non_object_metadata(self) -> None:
        status, _, body = self._raw_request(
            "POST",
            f"{self._base}/api/open-paper",
            {"paper_ref": "p_meta", "pdf_uri": "/tmp/paper.pdf", "metadata": ["bad"]},
        )
        self.assertEqual(status, 400)
        self.assertEqual(body.get("code"), "VALIDATION_ERROR")
        self.assertIn("metadata must be an object", body.get("error", ""))

    def test_record_action_rejects_invalid_page_type_and_range(self) -> None:
        open_status, _, opened = self._raw_request(
            "POST",
            f"{self._base}/api/open-paper",
            {"paper_ref": "p_rec", "pdf_uri": "/tmp/paper.pdf"},
        )
        self.assertEqual(open_status, 201)
        session_id = opened["id"]

        status_type, _, body_type = self._raw_request(
            "POST",
            f"{self._base}/api/record-action",
            {"session_id": session_id, "event_type": "page_change", "page": "1"},
        )
        self.assertEqual(status_type, 400)
        self.assertEqual(body_type.get("code"), "VALIDATION_ERROR")
        self.assertIn("page must be an integer", body_type.get("error", ""))

        status_range, _, body_range = self._raw_request(
            "POST",
            f"{self._base}/api/record-action",
            {"session_id": session_id, "event_type": "page_change", "page": 0},
        )
        self.assertEqual(status_range, 400)
        self.assertEqual(body_range.get("code"), "VALIDATION_ERROR")
        self.assertIn("page must be >= 1", body_range.get("error", ""))

    def test_annotation_validation_returns_field_details(self) -> None:
        open_status, _, opened = self._raw_request(
            "POST",
            f"{self._base}/api/open-paper",
            {"paper_ref": "p_ann_validation", "pdf_uri": "/tmp/paper.pdf"},
        )
        self.assertEqual(open_status, 201)
        status, _, body = self._raw_request(
            "POST",
            f"{self._base}/api/annotations",
            {
                "session_id": opened["id"],
                "annotation": {
                    "id": "ann_bad",
                    "type": "highlight",
                    "quote": "missing page and timestamps",
                },
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(body.get("code"), "VALIDATION_ERROR")
        self.assertEqual(body.get("details", {}).get("field"), "annotation.page")

    def test_list_annotations_exposes_pagination_metadata(self) -> None:
        open_status, _, opened = self._raw_request(
            "POST",
            f"{self._base}/api/open-paper",
            {"paper_ref": "p_ann_page", "pdf_uri": "/tmp/paper.pdf"},
        )
        self.assertEqual(open_status, 201)
        for index in range(2):
            status, _, _ = self._raw_request(
                "POST",
                f"{self._base}/api/annotations",
                {
                    "session_id": opened["id"],
                    "annotation": {
                        "id": f"ann_page_{index}",
                        "page": 1,
                        "type": "highlight",
                        "quote": f"quote {index}",
                        "anchor": None,
                        "comment": "",
                        "tags": [],
                        "rects": [],
                        "createdAt": f"2026-05-19T12:00:0{index}+00:00",
                        "updatedAt": f"2026-05-19T12:00:0{index}+00:00",
                    },
                },
            )
            self.assertEqual(status, 201)

        status, _, body = self._raw_request(
            "GET",
            f"{self._base}/api/annotations?session_id={opened['id']}&limit=1&offset=0",
        )
        self.assertEqual(status, 200)
        self.assertEqual(body.get("count"), 1)
        self.assertTrue(body.get("has_more"))
        self.assertEqual(body.get("next_offset"), 1)

    def test_pdf_uri_null_byte_rejected(self) -> None:
        from urllib.parse import quote
        uri = quote("/tmp/bad\x00file.pdf", safe="")
        status, _, body = self._raw_request("GET", f"{self._base}/api/pdf?uri={uri}")
        self.assertEqual(status, 400)
        self.assertIn("null byte", body.get("error", "").lower())

    def test_pdf_not_found_uses_json_error_envelope(self) -> None:
        uri = quote("/tmp/apw-this-file-should-not-exist.pdf", safe="")
        status, _, body = self._raw_request("GET", f"{self._base}/api/pdf?uri={uri}")
        self.assertEqual(status, 404)
        self.assertEqual(body.get("code"), "NOT_FOUND")
        self.assertIn("PDF not found", body.get("error", ""))

    def test_oversized_local_pdf_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            pdf_path = Path(tmp_dir) / "large.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n0123456789")

            service = AgentPdfWorkbenchService(db_path=Path(tmp_dir) / "events.db")
            handler_cls = _create_handler(service, max_pdf_bytes=8)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
            host, port = server.server_address
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://{host}:{port}"

            try:
                uri = quote(str(pdf_path), safe="")
                status, _, body = self._raw_request("GET", f"{base}/api/pdf?uri={uri}")
                self.assertEqual(status, 413)
                self.assertEqual(body.get("code"), "PAYLOAD_TOO_LARGE")
                self.assertIn("PDF too large", body.get("error", ""))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_unknown_api_route_returns_json_not_found(self) -> None:
        status, _, body = self._raw_request("GET", f"{self._base}/api/not-a-route")
        self.assertEqual(status, 404)
        self.assertEqual(body.get("code"), "NOT_FOUND")
        self.assertEqual(body.get("error"), "Not Found")


if __name__ == "__main__":
    unittest.main()
