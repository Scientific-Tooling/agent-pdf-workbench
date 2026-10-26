from __future__ import annotations

import copy
import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from agent_pdf_workbench.evidence import digest
from agent_pdf_workbench.passage import PassageError, annotation_passage, resolve_passage
from agent_pdf_workbench.service import AgentPdfWorkbenchService
from tests.unit.test_store import annotation_payload


class PassageTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.db = self.root / "events.db"
        self.pdf = self.root / "source.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\nsource")
        self.sha = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.service = AgentPdfWorkbenchService(self.db)
        self.session = self.service.open_paper(paper_ref=f"rks:lab:p_000001:sha256:{self.sha}", pdf_uri=str(self.pdf))
        self.annotation = annotation_payload(page=2)
        self.service.upsert_annotation(session_id=self.session["id"], annotation=self.annotation)
        self.citation = {"session_id": self.session["id"], "document_sha256": self.sha,
                         "annotation_id": self.annotation["id"], "page": 2,
                         "passage_sha256": digest(annotation_passage(self.annotation))}

    def resolve(self, **overrides):
        return resolve_passage(self.db, **{**self.citation, **overrides})

    def test_exact_passage_is_readonly_and_survives_session_close(self):
        self.service.close_paper(session_id=self.session["id"])
        with closing(sqlite3.connect(self.db)) as conn:
            before = list(conn.iterdump())
        result = self.resolve()
        self.assertEqual(result["annotation"], self.annotation)
        self.assertIsNotNone(result["session"]["closed_at"])
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(before, list(conn.iterdump()))

    def test_missing_and_changed_passages_are_actionable(self):
        for override, code in (({"session_id": "missing"}, "SESSION_MISSING"),
                               ({"annotation_id": "missing"}, "PASSAGE_MISSING"),
                               ({"document_sha256": "a" * 64}, "DOCUMENT_CHANGED"),
                               ({"page": 1}, "PASSAGE_CHANGED")):
            with self.subTest(override=override), self.assertRaises(PassageError) as error:
                self.resolve(**override)
            self.assertEqual(error.exception.code, code)
        edited = copy.deepcopy(self.annotation)
        edited["quote"] = "edited"
        self.service.upsert_annotation(session_id=self.session["id"], annotation=edited)
        with self.assertRaises(PassageError) as error:
            self.resolve()
        self.assertEqual(error.exception.code, "PASSAGE_CHANGED")

    def test_comment_edit_does_not_retarget_an_unchanged_passage(self):
        self.service.upsert_annotation(
            session_id=self.session["id"], annotation={**self.annotation, "comment": "edited"},
        )
        self.assertEqual(self.resolve()["annotation"]["quote"], self.annotation["quote"])

    def test_malformed_and_missing_text_anchors_fail(self):
        for override in ({"page": True}, {"page": 0}, {"document_sha256": "bad"}, {"passage_sha256": "bad"}):
            with self.subTest(override=override), self.assertRaises(PassageError) as error:
                self.resolve(**override)
            self.assertEqual(error.exception.code, "INVALID_CITATION")
        empty = {**self.annotation, "quote": ""}
        self.service.upsert_annotation(session_id=self.session["id"], annotation=empty)
        with self.assertRaises(PassageError) as error:
            self.resolve(passage_sha256=digest(annotation_passage(empty)))
        self.assertEqual(error.exception.code, "ANCHOR_MISSING")

    def test_missing_workspace_stays_absent(self):
        missing = self.root / "missing.db"
        with self.assertRaises(sqlite3.OperationalError):
            resolve_passage(missing, **self.citation)
        self.assertFalse(missing.exists())
