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

    return mcp


def main() -> int:
    db_path = Path(os.environ.get("APW_DB_PATH", ".apw/events.db"))
    server = build_server(db_path)
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
