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
npm run lint
npm run test
npm run typecheck
npm run build
npm run check
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
- `highlight` (selected text)
- `copy`
- `comment`

These actions appear in the timeline and are persisted to SQLite.

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

### 5.5 Close session

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
