from __future__ import annotations

import hashlib
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

from agent_pdf_workbench.evidence import digest
from agent_pdf_workbench.passage import annotation_passage
from agent_pdf_workbench.service import AgentPdfWorkbenchService
from agent_pdf_workbench.viewer_server import _create_handler
from tests.unit.test_store import annotation_payload


class PassageRoutesTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / "source.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\nsource bytes\n%%EOF")
        self.sha = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.service = AgentPdfWorkbenchService(self.root / "events.db")
        self.session = self.service.open_paper(paper_ref=f"rks:lab:p_000001:sha256:{self.sha}", pdf_uri=str(self.pdf))
        self.annotation = annotation_payload()
        self.service.upsert_annotation(session_id=self.session["id"], annotation=self.annotation)
        self.citation = {"session_id": self.session["id"], "document_sha256": self.sha,
                         "annotation_id": self.annotation["id"], "page": 1,
                         "passage_sha256": digest(annotation_passage(self.annotation))}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _create_handler(self.service, pdf_root=self.root))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def get(self, route, query):
        try:
            response = urlopen(f"{self.base}{route}?{urlencode(query)}", timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_route_resolves_and_pdf_transport_checks_the_exact_served_bytes(self):
        status, body = self.get("/api/passage", self.citation)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["annotation"]["id"], self.annotation["id"])
        status, body = self.get("/api/pdf", {"uri": str(self.pdf), "sha256": self.sha})
        self.assertEqual(status, 200, body)
        self.assertEqual(hashlib.sha256(body).hexdigest(), self.sha)
        self.pdf.write_bytes(b"replaced after passage resolution")
        status, body = self.get("/api/pdf", {"uri": str(self.pdf), "sha256": self.sha})
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(body)["code"], "DOCUMENT_CHANGED")

    def test_invalid_changed_and_deleted_anchors_are_distinct(self):
        for changes, status, code in (({"page": "bad"}, 400, "VALIDATION_ERROR"),
                                     ({"document_sha256": "bad"}, 400, "INVALID_CITATION"),
                                     ({"page": 2}, 409, "PASSAGE_CHANGED"),
                                     ({"annotation_id": "missing"}, 404, "PASSAGE_MISSING")):
            with self.subTest(changes=changes):
                actual, body = self.get("/api/passage", {**self.citation, **changes})
                self.assertEqual(actual, status, body)
                self.assertEqual(json.loads(body)["code"], code)

    def test_hash_verification_does_not_bypass_pdf_root(self):
        outside = self.root.parent / "outside-passage-does-not-exist.pdf"
        status, body = self.get("/api/pdf", {"uri": str(outside), "sha256": self.sha})
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["code"], "FORBIDDEN")

    def test_module_scripts_have_javascript_mime_despite_windows_associations(self):
        from agent_pdf_workbench.viewer_server import WEB_DIR

        worker = next(WEB_DIR.glob("pdf.worker*.mjs"))
        with patch("agent_pdf_workbench.viewer_server.mimetypes.guess_type", return_value=("text/plain", None)):
            with urlopen(f"{self.base}/{worker.name}", timeout=5) as response:
                self.assertEqual(response.headers.get_content_type(), "text/javascript")
