# MCP Tools

The MCP server exposes the service-layer API for local agents. MCP support is
optional and requires installing the `mcp` extra:

```bash
pip install 'agent-pdf-workbench[mcp]'
python3 -m agent_pdf_workbench.mcp_server
```

The server uses `APW_DB_PATH` when set, otherwise `.apw/events.db`.

## Session and Event Tools

- `open_paper(paper_ref, pdf_uri, agent_id?, user_id?)`
- `record_action(session_id, event_type, page?, selection_text?, payload?, source?)`
- `list_actions(session_id, after_id?, limit?)`
- `close_paper(session_id)`
- `list_sessions(paper_ref?, open_only?, limit?, offset?)`
- `get_session(session_id)`

### Finding what the user is reading

An agent does not have to be told a session id. `list_sessions(open_only=True)`
returns the sessions a reader currently has open, newest first:

```python
open_sessions = list_sessions(open_only=True)
session_id = open_sessions["sessions"][0]["id"]
events = list_actions(session_id=session_id)
```

To put a specific paper in front of the reader, open a session and hand them the
viewer link for it — `http://127.0.0.1:8790/?session_id=<id>` attaches the
viewer to that session rather than starting a new one.

## Annotation Tools

- `upsert_annotation(session_id, annotation)`
- `list_annotations(session_id?, paper_ref?, limit?, offset?)`
- `delete_annotation(session_id, annotation_id)`

Annotation payloads follow the same contract as `POST /api/annotations`.

Annotations belong to the paper, not the session: pass either the id of any
session on that paper or the `paper_ref` itself, and the same set comes back.
Writes go through a session so that closed sessions stay read-only.

## Note Tools

- `upsert_note(session_id, note)`
- `list_notes(session_id?, paper_ref?, limit?, offset?)`
- `delete_note(session_id, note_id)`

Note payloads follow the same contract as `POST /api/notes`.

## Export Tool

- `export_workspace()`

The export is paper-centric, because a paper read across several sessions has
one set of annotations and several event streams:

```json
{
  "papers": [
    {
      "paper_ref": "10.48550/arXiv.1706.03762",
      "annotations": [],
      "notes": [],
      "sessions": [{ "session": {}, "events": [] }]
    }
  ],
  "paper_count": 1,
  "session_count": 3
}
```

It pages internally and does not truncate at `MAX_LIST_LIMIT`.

## Example Annotation

```json
{
  "id": "ann_agent_001",
  "page": 3,
  "type": "highlight",
  "quote": "important result",
  "anchor": null,
  "comment": "Key evidence for later discussion",
  "tags": ["result"],
  "rects": [],
  "createdAt": "2026-05-19T12:00:00+00:00",
  "updatedAt": "2026-05-19T12:00:00+00:00"
}
```

## Example Note

```json
{
  "id": "note_agent_001",
  "title": "Main result",
  "markdown": "This result should be checked against follow-up work.",
  "linkedAnnotationIds": ["ann_agent_001"],
  "createdAt": "2026-05-19T12:05:00+00:00",
  "updatedAt": "2026-05-19T12:05:00+00:00"
}
```
