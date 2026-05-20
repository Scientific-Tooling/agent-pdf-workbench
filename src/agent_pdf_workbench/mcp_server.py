from __future__ import annotations

import os
from pathlib import Path

from .service import AgentPdfWorkbenchService


def build_server(db_path: Path):
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:
        raise RuntimeError(
            "MCP support requires the optional dependency `mcp`. Install with: pip install 'agent-pdf-workbench[mcp]'"
        ) from exc

    service = AgentPdfWorkbenchService(db_path=db_path)
    mcp = FastMCP("agent-pdf-workbench")

    @mcp.tool()
    def open_paper(
        paper_ref: str,
        pdf_uri: str,
        agent_id: str = "agent:unknown",
        user_id: str = "user:unknown",
    ) -> dict:
        """Open a paper session and return session metadata."""
        return service.open_paper(
            paper_ref=paper_ref,
            pdf_uri=pdf_uri,
            agent_id=agent_id,
            user_id=user_id,
        )

    @mcp.tool()
    def record_action(
        session_id: str,
        event_type: str,
        page: int | None = None,
        selection_text: str | None = None,
        payload: dict | None = None,
        source: str = "viewer",
    ) -> dict:
        """Record one user action in the active paper session."""
        return service.record_action(
            session_id=session_id,
            event_type=event_type,
            page=page,
            selection_text=selection_text,
            payload=payload,
            source=source,
        )

    @mcp.tool()
    def list_actions(session_id: str, after_id: int | None = None, limit: int = 100) -> dict:
        """List recorded actions for one paper session."""
        return service.list_actions(session_id=session_id, after_id=after_id, limit=limit)

    @mcp.tool()
    def close_paper(session_id: str) -> dict:
        """Close an active paper session."""
        return service.close_paper(session_id=session_id)

    @mcp.tool()
    def upsert_annotation(session_id: str, annotation: dict) -> dict:
        """Create or update an annotation in a paper session."""
        return service.upsert_annotation(session_id=session_id, annotation=annotation)

    @mcp.tool()
    def list_annotations(session_id: str, limit: int = 100, offset: int = 0) -> dict:
        """List annotations for one paper session."""
        return service.list_annotations(session_id=session_id, limit=limit, offset=offset)

    @mcp.tool()
    def delete_annotation(session_id: str, annotation_id: str) -> dict:
        """Delete an annotation by id. Missing annotations return deleted=false."""
        return service.delete_annotation(session_id=session_id, annotation_id=annotation_id)

    @mcp.tool()
    def upsert_note(session_id: str, note: dict) -> dict:
        """Create or update a note in a paper session."""
        return service.upsert_note(session_id=session_id, note=note)

    @mcp.tool()
    def list_notes(session_id: str, limit: int = 100, offset: int = 0) -> dict:
        """List notes for one paper session."""
        return service.list_notes(session_id=session_id, limit=limit, offset=offset)

    @mcp.tool()
    def delete_note(session_id: str, note_id: str) -> dict:
        """Delete a note by id. Missing notes return deleted=false."""
        return service.delete_note(session_id=session_id, note_id=note_id)

    @mcp.tool()
    def export_workspace() -> dict:
        """Export all sessions, events, annotations, and notes."""
        return service.export_workspace()

    return mcp


def main() -> int:
    db_path = Path(os.environ.get("APW_DB_PATH", ".apw/events.db"))
    server = build_server(db_path)
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
