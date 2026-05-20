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
        has_more = False
        next_after_id = events[-1].id if events else None
        if next_after_id is not None and len(events) == limit:
            has_more = bool(
                self._store.list_events(
                    session_id=session_id,
                    after_id=next_after_id,
                    limit=1,
                )
            )
        return {
            "session_id": session_id,
            "count": len(events),
            "events": [asdict(event) for event in events],
            "has_more": has_more,
            "next_after_id": next_after_id if has_more else None,
        }

    def close_paper(self, *, session_id: str) -> dict:
        session = self._store.close_session(session_id)
        return asdict(session)

    def upsert_annotation(self, *, session_id: str, annotation: dict) -> dict:
        record = self._store.upsert_annotation(session_id=session_id, annotation=annotation)
        return asdict(record)

    def list_annotations(self, *, session_id: str, limit: int = 100, offset: int = 0) -> dict:
        records = self._store.list_annotations(session_id=session_id, limit=limit, offset=offset)
        has_more = False
        next_offset = offset + len(records)
        if len(records) == limit:
            has_more = bool(
                self._store.list_annotations(
                    session_id=session_id,
                    limit=1,
                    offset=next_offset,
                )
            )
        return {
            "session_id": session_id,
            "count": len(records),
            "annotations": [asdict(record) for record in records],
            "offset": offset,
            "has_more": has_more,
            "next_offset": next_offset if has_more else None,
        }

    def delete_annotation(self, *, session_id: str, annotation_id: str) -> dict:
        deleted = self._store.delete_annotation(session_id=session_id, annotation_id=annotation_id)
        return {"session_id": session_id, "annotation_id": annotation_id, "deleted": deleted}

    def upsert_note(self, *, session_id: str, note: dict) -> dict:
        record = self._store.upsert_note(session_id=session_id, note=note)
        return asdict(record)

    def list_notes(self, *, session_id: str, limit: int = 100, offset: int = 0) -> dict:
        records = self._store.list_notes(session_id=session_id, limit=limit, offset=offset)
        has_more = False
        next_offset = offset + len(records)
        if len(records) == limit:
            has_more = bool(
                self._store.list_notes(
                    session_id=session_id,
                    limit=1,
                    offset=next_offset,
                )
            )
        return {
            "session_id": session_id,
            "count": len(records),
            "notes": [asdict(record) for record in records],
            "offset": offset,
            "has_more": has_more,
            "next_offset": next_offset if has_more else None,
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
            events = self._list_all_events(session.id)
            annotations = self._list_all_annotations(session.id)
            notes = self._list_all_notes(session.id)
            result.append(
                {
                    "session": asdict(session),
                    "events": [asdict(e) for e in events],
                    "annotations": [asdict(a) for a in annotations],
                    "notes": [asdict(n) for n in notes],
                }
            )
        return {"sessions": result, "session_count": len(result)}

    def _list_all_events(self, session_id: str) -> list:
        events = []
        after_id = None
        while True:
            batch = self._store.list_events(
                session_id=session_id,
                after_id=after_id,
                limit=MAX_LIST_LIMIT,
            )
            if not batch:
                break
            events.extend(batch)
            after_id = batch[-1].id
            if len(batch) < MAX_LIST_LIMIT:
                break
        return events

    def _list_all_annotations(self, session_id: str) -> list:
        records = []
        offset = 0
        while True:
            batch = self._store.list_annotations(
                session_id=session_id,
                limit=MAX_LIST_LIMIT,
                offset=offset,
            )
            if not batch:
                break
            records.extend(batch)
            offset += len(batch)
            if len(batch) < MAX_LIST_LIMIT:
                break
        return records

    def _list_all_notes(self, session_id: str) -> list:
        records = []
        offset = 0
        while True:
            batch = self._store.list_notes(
                session_id=session_id,
                limit=MAX_LIST_LIMIT,
                offset=offset,
            )
            if not batch:
                break
            records.extend(batch)
            offset += len(batch)
            if len(batch) < MAX_LIST_LIMIT:
                break
        return records
