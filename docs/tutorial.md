# Agent PDF Workbench Tutorial

This tutorial walks through the project end-to-end using the local CLI, the viewer server HTTP API, and MCP mode.

## 1. Prerequisites

- Python 3.10+
- Local clone of this repository

From repo root:

```bash
cd /mnt/c/Users/mingz/Codes/scientific-tooling/agent-pdf-workbench
```

## 2. Run Tests First

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

Expected result: all tests pass.

## 2.1 Frontend Tooling (for contributors)

The frontend source is in `frontend/` and is built into `src/agent_pdf_workbench/web/`.

```bash
npm install
npm run format:check
npm run test:unit
npm run test:e2e
npm run test:python
npm run check:frontend
npm run verify
```

Playwright browser setup (first time):

```bash
npx playwright install chromium
```

For hot-reload development:

1. Start backend API:
`PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server --db-path /tmp/apw/events.db --port 8790`
2. Start Vite:
`npm run dev`
3. Open:
`http://127.0.0.1:5173`

## 3. CLI Walkthrough

This section uses a temporary database at `/tmp/apw/events.db`.

### 3.1 Open a paper session

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path /tmp/apw/events.db \
  open-paper \
  --paper-ref "10.48550/arXiv.1706.03762" \
  --pdf-uri "/tmp/paper.pdf" \
  --agent-id "agent:demo" \
  --user-id "user:local"
```

You will get JSON containing a new `id` (for example `ps_abc123...`). Save that as `SESSION_ID`.

### 3.2 Record actions

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path /tmp/apw/events.db \
  record-action \
  --session-id "SESSION_ID" \
  --event-type "page_change" \
  --page 2 \
  --payload-json '{"total_pages": 12}'
```

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path /tmp/apw/events.db \
  record-action \
  --session-id "SESSION_ID" \
  --event-type "comment" \
  --page 2 \
  --payload-json '{"text":"Important claim"}'
```

### 3.3 List actions

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path /tmp/apw/events.db \
  list-actions \
  --session-id "SESSION_ID" \
  --limit 100
```

You should see events sorted by ascending event `id`.

### 3.4 Close session

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path /tmp/apw/events.db \
  close-paper \
  --session-id "SESSION_ID"
```

After close, new `record-action` calls for that session are rejected.

## 4. Viewer Server Walkthrough

Start server:

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server \
  --db-path /tmp/apw/events.db \
  --port 8790
```

Open in browser:

```text
http://127.0.0.1:8790
```

### 4.1 Security defaults

- Remote PDF URLs are blocked by default.
- To allow remote PDFs: `--allow-remote-pdf` or `APW_ALLOW_REMOTE_PDF=1`.
- To restrict local PDF access to one directory: `--pdf-root /path/to/pdfs` or `APW_PDF_ROOT`.

### 4.2 What the UI records

- `page_change`
- `zoom_change`
- `copy` (selected text on PDF text layer)
- `comment`
- `annotation_upsert`
- `annotation_delete`
- `note_upsert`
- `note_delete`

These actions appear in the timeline and are persisted to SQLite.

### 4.3 Daily reading workflow in UI

1. Open paper session from left panel (`Paper Ref` + `PDF URI` + `Open Paper`).
2. Use reading controls: page jump, zoom, fit-width, and outline navigation.
3. Use search bar for full-text search and jump through hits.
4. Select text on PDF text layer, then click `Highlight` or `Underline`.
5. Add annotation comments/tags, and manage annotations from the right panel.
6. Annotation rendering is anchor-first (`quote + start/end + prefix/suffix`) with rect fallback.
7. Write Markdown notes and link them to annotation IDs.
8. Export outputs via `Export JSON` or `Export Markdown`.
9. Resume quickly from `Recent Papers` (progress is kept locally).

Keyboard shortcuts:

- `j`: next page
- `k`: previous page
- `f`: focus search input

## 5. HTTP API Quick Check

With server running on `127.0.0.1:8790`:

### 5.1 Health

```bash
curl -s http://127.0.0.1:8790/api/health
```

### 5.2 Open session

```bash
curl -s -X POST http://127.0.0.1:8790/api/open-paper \
  -H "Content-Type: application/json" \
  -d '{"paper_ref":"p_demo","pdf_uri":"/tmp/paper.pdf","agent_id":"agent:http","user_id":"user:http"}'
```

Copy returned `id` into `SESSION_ID`.

### 5.3 Record action

```bash
curl -s -X POST http://127.0.0.1:8790/api/record-action \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","event_type":"comment","page":1,"payload":{"text":"from curl"}}'
```

### 5.4 List actions

```bash
curl -s "http://127.0.0.1:8790/api/list-actions?session_id=SESSION_ID&limit=100"
```

### 5.5 Upsert/List/Delete annotation

```bash
curl -s -X POST http://127.0.0.1:8790/api/annotations \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","annotation":{"id":"ann_1","page":1,"type":"highlight","quote":"attention","anchor":{"quote":"attention","start":10,"end":19,"prefix":"...","suffix":"..."},"comment":"important","tags":["core"],"rects":[{"x":0.1,"y":0.2,"width":0.3,"height":0.1}],"createdAt":"2026-03-20T12:00:00+00:00","updatedAt":"2026-03-20T12:00:00+00:00"}}'
```

```bash
curl -s "http://127.0.0.1:8790/api/annotations?session_id=SESSION_ID&limit=100"
```

```bash
curl -s -X POST http://127.0.0.1:8790/api/annotations/delete \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","annotation_id":"ann_1"}'
```

### 5.6 Upsert/List/Delete note

```bash
curl -s -X POST http://127.0.0.1:8790/api/notes \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","note":{"id":"note_1","title":"intro","markdown":"text","linkedAnnotationIds":["ann_1"],"createdAt":"2026-03-20T12:00:00+00:00","updatedAt":"2026-03-20T12:00:00+00:00"}}'
```

```bash
curl -s "http://127.0.0.1:8790/api/notes?session_id=SESSION_ID&limit=100"
```

```bash
curl -s -X POST http://127.0.0.1:8790/api/notes/delete \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","note_id":"note_1"}'
```

### 5.7 Close session

```bash
curl -s -X POST http://127.0.0.1:8790/api/close-paper \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID"}'
```

## 6. MCP Mode

Install optional MCP dependency:

```bash
pip install "agent-pdf-workbench[mcp]"
```

Run MCP server:

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.mcp_server
```

Exposed tools:

- `open_paper`
- `record_action`
- `list_actions`
- `close_paper`

Set database path for MCP with:

```bash
export APW_DB_PATH=/tmp/apw/events.db
```

## 7. Troubleshooting

- `Unknown session_id`: ensure you are using the session from the same DB file.
- `Session is closed`: reopen a new session before recording more actions.
- `limit must be >= 1` or `<= 1000`: use a valid `limit` range.
- `remote PDF fetch is disabled`: start viewer with `--allow-remote-pdf` if needed.

## 8. E2E Main Path

Run the API main-path e2e test:

```bash
PYTHONPATH=src python3 -m unittest tests.test_viewer_server.ViewerServerApiE2ETest
npm run test:e2e
```
