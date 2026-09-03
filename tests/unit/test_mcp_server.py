"""Tests for the MCP surface — the tool layer agents actually call.

The optional ``mcp`` dependency is skipped when absent so that non-MCP users
keep a green suite.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from agent_pdf_workbench.mcp_server import build_server

try:  # pragma: no cover - import guard mirrors mcp_server.build_server
    from mcp.server.mcpserver import MCPServer  # noqa: F401

    MCP_AVAILABLE = True
except ImportError:  # pragma: no cover
    MCP_AVAILABLE = False

TEST_TIME = "2026-09-02T10:00:00+00:00"


def annotation_payload(**overrides: Any) -> dict:
    payload = {
        "id": "ann_mcp",
        "page": 1,
        "type": "highlight",
        "quote": "attention is all you need",
        "anchor": None,
        "comment": "",
        "tags": [],
        "rects": [],
        "createdAt": TEST_TIME,
        "updatedAt": TEST_TIME,
    }
    payload.update(overrides)
    return payload


def _unwrap(result: Any) -> Any:
    """Return the JSON payload from an MCP v2 ``CallToolResult``."""
    structured_content = getattr(result, "structured_content", None)
    if structured_content is not None:
        return structured_content

    content = getattr(result, "content", None)
    if content is None:
        raise AssertionError(f"Expected an MCP v2 CallToolResult: {result!r}")
    for item in content:
        text = getattr(item, "text", None)
        if text:
            return json.loads(text)
    raise AssertionError(f"No text content in MCP v2 tool result: {result!r}")


@unittest.skipUnless(MCP_AVAILABLE, "optional dependency 'mcp' is not installed")
class McpServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._server = build_server(Path(self._tmp.name) / "mcp.db")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _call(self, name: str, arguments: dict | None = None) -> Any:
        return _unwrap(asyncio.run(self._server.call_tool(name, arguments or {})))

    def test_expected_tools_are_registered(self) -> None:
        tools = asyncio.run(self._server.list_tools())
        names = {tool.name for tool in tools}
        self.assertEqual(
            names,
            {
                "open_paper",
                "record_action",
                "list_actions",
                "close_paper",
                "list_sessions",
                "get_session",
                "upsert_annotation",
                "list_annotations",
                "delete_annotation",
                "upsert_note",
                "list_notes",
                "delete_note",
                "export_workspace",
            },
        )
        for tool in tools:
            self.assertTrue(tool.description, f"{tool.name} is missing a description")

    def test_full_reading_workflow_without_http(self) -> None:
        session = self._call(
            "open_paper",
            {"paper_ref": "10.48550/arXiv.1706.03762", "pdf_uri": "/tmp/paper.pdf"},
        )
        session_id = session["id"]
        self.assertTrue(session_id.startswith("ps_"))

        self._call("record_action", {"session_id": session_id, "event_type": "page_change", "page": 3})
        self._call(
            "upsert_annotation",
            {"session_id": session_id, "annotation": annotation_payload(comment="key idea")},
        )
        self._call(
            "upsert_note",
            {
                "session_id": session_id,
                "note": {
                    "id": "note_mcp",
                    "title": "Reading note",
                    "markdown": "Linked to the highlight.",
                    "linkedAnnotationIds": ["ann_mcp"],
                    "createdAt": TEST_TIME,
                    "updatedAt": TEST_TIME,
                },
            },
        )

        actions = self._call("list_actions", {"session_id": session_id})
        self.assertGreaterEqual(actions["count"], 1)

        annotations = self._call("list_annotations", {"session_id": session_id})
        self.assertEqual(annotations["count"], 1)
        self.assertEqual(annotations["annotations"][0]["annotation"]["comment"], "key idea")

        notes = self._call("list_notes", {"session_id": session_id})
        self.assertEqual(notes["count"], 1)

        exported = self._call("export_workspace", {})
        self.assertEqual(exported["paper_count"], 1)
        self.assertEqual(len(exported["papers"][0]["annotations"]), 1)

        self.assertTrue(self._call("delete_note", {"session_id": session_id, "note_id": "note_mcp"})["deleted"])
        self.assertTrue(
            self._call("delete_annotation", {"session_id": session_id, "annotation_id": "ann_mcp"})["deleted"]
        )
        self.assertIsNotNone(self._call("close_paper", {"session_id": session_id})["closed_at"])

    def test_agent_can_discover_the_session_a_reader_has_open(self) -> None:
        stale = self._call("open_paper", {"paper_ref": "p_discovery", "pdf_uri": "/tmp/a.pdf"})
        self._call("close_paper", {"session_id": stale["id"]})
        live = self._call("open_paper", {"paper_ref": "p_discovery", "pdf_uri": "/tmp/a.pdf"})

        listed = self._call("list_sessions", {"paper_ref": "p_discovery", "open_only": True})
        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["sessions"][0]["id"], live["id"])

        fetched = self._call("get_session", {"session_id": live["id"]})
        self.assertEqual(fetched["pdf_uri"], "/tmp/a.pdf")

    def test_annotations_are_addressable_by_paper_ref(self) -> None:
        first = self._call("open_paper", {"paper_ref": "p_paper_scope", "pdf_uri": "/tmp/a.pdf"})
        self._call("upsert_annotation", {"session_id": first["id"], "annotation": annotation_payload()})
        self._call("close_paper", {"session_id": first["id"]})

        by_paper = self._call("list_annotations", {"paper_ref": "p_paper_scope"})
        self.assertEqual(by_paper["count"], 1)

        second = self._call("open_paper", {"paper_ref": "p_paper_scope", "pdf_uri": "/tmp/a.pdf"})
        by_new_session = self._call("list_annotations", {"session_id": second["id"]})
        self.assertEqual(by_new_session["count"], 1, "a new session sees the paper's existing annotations")


if __name__ == "__main__":
    unittest.main()
