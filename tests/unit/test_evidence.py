from __future__ import annotations

import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from agent_pdf_workbench.evidence import export_evidence
from agent_pdf_workbench.service import AgentPdfWorkbenchService
from tests.unit.test_store import TEST_TIME, annotation_payload, note_payload


class EvidenceExportTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / "paper.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\nsource\n%%EOF")
        self.sha = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.db = self.root / "events.db"
        self.service = AgentPdfWorkbenchService(self.db)
        self.ref = f"rks:lab:p_000001:sha256:{self.sha}"
        self.session = self.service.open_paper(paper_ref=self.ref, pdf_uri=str(self.pdf))["id"]
        self.service.upsert_annotation(session_id=self.session, annotation=annotation_payload())
        self.service.upsert_note(session_id=self.session, note=note_payload(
            markdown="Machine interpretation, not yet reviewed.", linkedAnnotationIds=["ann_test"],
        ))

    def export(self, **kwargs):
        return export_evidence(self.db, session_id=self.session, source_id="reader",
                               annotation_ids=kwargs.pop("annotation_ids", ["ann_test"]),
                               note_ids=kwargs.pop("note_ids", []), **kwargs)

    def test_selected_snapshot_is_readonly_and_repeated_revisions_are_stable(self):
        with closing(sqlite3.connect(self.db)) as conn:
            before = list(conn.iterdump())
        first, second = self.export(), self.export()
        self.assertEqual(first["items"], second["items"])
        self.assertEqual(len(first["items"]), 1)
        self.assertEqual(first["items"][0]["review"], {"status": "unreviewed"})
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(before, list(conn.iterdump()))

    def test_review_is_explicit_and_bound_to_exact_content(self):
        item = self.export()["items"][0]
        manifest = {"schema": "scientific-tooling.evidence-reviews.v1", "source_id": "reader",
                    "paper_ref": self.ref, "reviews": {"annotation:ann_test": {
                        "status": "reviewed", "reviewer": "test-fixture reviewer", "reviewed_at": TEST_TIME,
                        "method": "human", "content_revision": item["content_revision"],
                        "statement": "Synthetic test assertion only.",
                    }}}
        reviewed = self.export(reviews=manifest)["items"][0]
        self.assertEqual(reviewed["content_revision"], item["content_revision"])
        self.assertNotEqual(reviewed["revision"], item["revision"])
        self.service.upsert_annotation(session_id=self.session, annotation=annotation_payload(comment="edited"))
        with self.assertRaisesRegex(ValueError, "stale"):
            self.export(reviews=manifest)

    def test_note_embeds_linked_passages_and_tracks_their_edits(self):
        before = self.export(annotation_ids=[], note_ids=["note_test"])["items"][0]
        self.assertEqual(before["passages"][0]["quote"], "test quote")
        self.service.upsert_annotation(session_id=self.session, annotation=annotation_payload(quote="changed"))
        after = self.export(annotation_ids=[], note_ids=["note_test"])["items"][0]
        self.assertNotEqual(before["content_revision"], after["content_revision"])
        self.service.delete_annotation(session_id=self.session, annotation_id="ann_test")
        with self.assertRaisesRegex(ValueError, "missing"):
            self.export(annotation_ids=[], note_ids=["note_test"])

    def test_empty_duplicate_missing_selection_and_changed_pdf_fail(self):
        for selection in ([], ["ann_test", "ann_test"], ["missing"]):
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                self.export(annotation_ids=selection)
        self.pdf.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.export()

    def test_missing_database_is_not_created(self):
        missing = self.root / "missing.db"
        with self.assertRaises(sqlite3.OperationalError):
            export_evidence(missing, session_id=self.session, source_id="reader", annotation_ids=["a"], note_ids=[])
        self.assertFalse(missing.exists())

    def test_invalid_review_or_inconsistent_anchor_is_actionable(self):
        with self.assertRaisesRegex(ValueError, "manifest"):
            self.export(reviews=[])
        self.service.upsert_annotation(session_id=self.session, annotation=annotation_payload(
            anchor={"quote": "different quote"},
        ))
        with self.assertRaisesRegex(ValueError, "quote and anchor disagree"):
            self.export()

    def test_other_reading_session_preserves_paper_scoped_identity(self):
        before = self.export()["items"][0]
        self.session = self.service.open_paper(paper_ref=self.ref, pdf_uri=str(self.pdf))["id"]
        self.assertEqual(self.export()["items"][0], before)
