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

## Annotation Tools

- `upsert_annotation(session_id, annotation)`
- `list_annotations(session_id, limit?, offset?)`
- `delete_annotation(session_id, annotation_id)`

Annotation payloads follow the same contract as `POST /api/annotations`.

## Note Tools

- `upsert_note(session_id, note)`
- `list_notes(session_id, limit?, offset?)`
- `delete_note(session_id, note_id)`

Note payloads follow the same contract as `POST /api/notes`.

## Export Tool

- `export_workspace()`

The export tool returns all sessions with complete event, annotation, and note
lists. It uses internal pagination and does not truncate at `MAX_LIST_LIMIT`.

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
