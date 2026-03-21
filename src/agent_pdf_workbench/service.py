from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

from .store import EventStore, MAX_LIST_LIMIT


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

    def upsert_annotation(self, *, session_id: str, annotation: dict) -> dict:
        record = self._store.upsert_annotation(session_id=session_id, annotation=annotation)
        return asdict(record)

    def list_annotations(self, *, session_id: str, limit: int = 100) -> dict:
        records = self._store.list_annotations(session_id=session_id, limit=limit)
        return {
            "session_id": session_id,
            "count": len(records),
            "annotations": [asdict(record) for record in records],
        }

    def delete_annotation(self, *, session_id: str, annotation_id: str) -> dict:
        deleted = self._store.delete_annotation(session_id=session_id, annotation_id=annotation_id)
        return {"session_id": session_id, "annotation_id": annotation_id, "deleted": deleted}

    def upsert_note(self, *, session_id: str, note: dict) -> dict:
        record = self._store.upsert_note(session_id=session_id, note=note)
        return asdict(record)

    def list_notes(self, *, session_id: str, limit: int = 100) -> dict:
        records = self._store.list_notes(session_id=session_id, limit=limit)
        return {
            "session_id": session_id,
            "count": len(records),
            "notes": [asdict(record) for record in records],
        }

    def delete_note(self, *, session_id: str, note_id: str) -> dict:
        deleted = self._store.delete_note(session_id=session_id, note_id=note_id)
        return {"session_id": session_id, "note_id": note_id, "deleted": deleted}

    def backup(self, *, target_path: Path) -> dict:
        """Create an online SQLite backup at *target_path*.

        Returns a summary dict with the resolved target path.
        """
        self._store.backup_to(target_path)
        return {"backed_up_to": str(target_path.resolve())}

    def checkpoint(self) -> dict:
        """Force a WAL checkpoint and return result counters."""
        return self._store.checkpoint()

    def export_workspace(self) -> dict:
        """Export all sessions with their events, annotations, and notes as a dict.

        Intended for human-readable JSON backup and offline analysis.
        The structure is:
        ``{"sessions": [{"session": {...}, "events": [...], "annotations": [...], "notes": [...]}]}``
        """
        sessions = self._store.list_all_sessions()
        result = []
        for session in sessions:
            events = self._store.list_events(session_id=session.id, limit=MAX_LIST_LIMIT)
            annotations = self._store.list_annotations(session_id=session.id, limit=MAX_LIST_LIMIT)
            notes = self._store.list_notes(session_id=session.id, limit=MAX_LIST_LIMIT)
            result.append(
                {
                    "session": asdict(session),
                    "events": [asdict(e) for e in events],
                    "annotations": [asdict(a) for a in annotations],
                    "notes": [asdict(n) for n in notes],
                }
            )
        return {"sessions": result, "session_count": len(result)}
