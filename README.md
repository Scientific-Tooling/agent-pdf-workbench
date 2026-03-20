# agent-pdf-workbench

Agent-aware PDF workspace for Codex/Claude integrations.

This project provides a tool layer that lets an AI agent open a paper PDF session and observe user actions such as highlight, copy, page navigation, and comments. The core output is a durable, queryable event stream that can be reused in later conversations.

## Why this exists

Traditional PDF readers do not expose user interactions to an AI agent. This project adds:

- explicit paper sessions (`open_paper`)
- structured user interaction events (`record_action`)
- event replay for agent grounding (`list_actions`)

## Scope

Current repo focus:

- local event store (SQLite)
- stable Python service API
- MCP server entrypoint (for Codex/Claude tool integration)
- minimal dev CLI for local testing
- local PDF.js-based viewer server with event capture

Future scope:

- real-time sync and presence
- richer annotation model
- integration adapter for RKS (`paper_id -> pdf_uri`)

## Quick start

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli --db-path /tmp/apw/events.db open-paper --paper-ref "10.48550/arXiv.1706.03762" --pdf-uri "/tmp/paper.pdf"
```

Full walkthrough:

- [docs/tutorial.md](docs/tutorial.md)

## Frontend development

The viewer frontend is now engineered with `Vite + TypeScript`.

Source of truth:

- `frontend/index.html`
- `frontend/src/*.ts`
- `frontend/src/styles.css`

Build output served by Python:

- `src/agent_pdf_workbench/web/index.html`
- `src/agent_pdf_workbench/web/app.js`
- `src/agent_pdf_workbench/web/styles.css`

Commands:

```bash
npm install
npm run format:check
npm run lint
npm run test
npm run typecheck
npm run build
npm run check
```

For local frontend dev with hot reload:

1. Run backend viewer API on `127.0.0.1:8790`:
`PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server --db-path /tmp/apw/events.db --port 8790`
2. Run Vite dev server:
`npm run dev`
3. Open `http://127.0.0.1:5173`

## Agent skill

This repo now includes a reusable skill for agents that need to open a PDF in this app:

- [skills/apw-open-pdf-session/SKILL.md](skills/apw-open-pdf-session/SKILL.md)

Example invocation:

```text
Use $apw-open-pdf-session to open /tmp/paper.pdf with paper_ref 10.48550/arXiv.1706.03762 and return the session id.
```

## MCP integration

When `mcp` package is installed, run:

```bash
python3 -m agent_pdf_workbench.mcp_server
```

Exposed tools (v0):

- `open_paper`
- `record_action`
- `list_actions`
- `close_paper`

## PDF viewer (v0)

Run local server:

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server --db-path /tmp/apw/events.db --port 8790
```

Security defaults:

- remote PDF fetch is disabled by default; enable explicitly with `--allow-remote-pdf` or `APW_ALLOW_REMOTE_PDF=1`
- optionally constrain local PDF access with `--pdf-root /path/to/pdfs` (or `APW_PDF_ROOT`)

Then open:

```text
http://127.0.0.1:8790
```

Current viewer events:

- `page_change`
- `zoom_change`
- `highlight` (manual selection from PDF text layer)
- `copy` (copy action on PDF text layer)
- `comment`
- `annotation_upsert`
- `annotation_delete`
- `note_upsert`
- `note_delete`

Current viewer workflow features for literature reading:

- zoom, page jump, outline navigation, and keyboard shortcuts (`j/k/f`)
- full-text search with result list and jump
- in-PDF text-layer annotations (highlight/underline) with comments and tags
- markdown notes linked to annotation IDs (back-link to evidence)
- export reading outputs as JSON and Markdown
- reading progress + recent papers (local persistence)

## Project layout

```text
src/agent_pdf_workbench/
  store.py        # SQLite persistence for sessions/events
  service.py      # tool-facing service layer
  dev_cli.py      # local smoke-test CLI
  mcp_server.py   # MCP server entrypoint
  viewer_server.py # local web UI/API server
  web/            # built frontend assets served by viewer_server.py
frontend/
  index.html      # Vite entry HTML
  src/            # TypeScript frontend source
tests/
  test_store.py
```
