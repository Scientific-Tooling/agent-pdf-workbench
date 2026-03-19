from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

from .store import EventStore


class AgentPdfWorkbenchService:
    def __init__(self, db_path: Path) -> None:
        self._store = EventStore(db_path)

    def open_paper(
        self,
        *,
        paper_ref: str,
        pdf_uri: str,
        agent_id: str = "agent:unknown",
        user_id: str = "user:unknown",
        metadata: dict | None = None,
    ) -> dict:
        session = self._store.open_session(
            session_id=f"ps_{uuid4().hex[:12]}",
            paper_ref=paper_ref,
            pdf_uri=pdf_uri,
            agent_id=agent_id,
            user_id=user_id,
            metadata=metadata,
        )
        return asdict(session)

    def record_action(
        self,
        *,
        session_id: str,
        event_type: str,
        page: int | None = None,
        selection_text: str | None = None,
        payload: dict | None = None,
        source: str = "viewer",
    ) -> dict:
        event = self._store.append_event(
            session_id=session_id,
            event_type=event_type,
            page=page,
            selection_text=selection_text,
            payload=payload,
            source=source,
        )
        return asdict(event)

    def list_actions(self, *, session_id: str, after_id: int | None = None, limit: int = 100) -> dict:
        events = self._store.list_events(session_id=session_id, after_id=after_id, limit=limit)
        return {
            "session_id": session_id,
            "count": len(events),
            "events": [asdict(event) for event in events],
        }

    def close_paper(self, *, session_id: str) -> dict:
        session = self._store.close_session(session_id)
        return asdict(session)
