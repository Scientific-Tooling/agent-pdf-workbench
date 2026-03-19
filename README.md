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

Then open:

```text
http://127.0.0.1:8790
```

Current viewer events:

- `page_change`
- `highlight` (manual selection from extracted text panel)
- `copy` (copy action on extracted text panel)
- `comment`

## Project layout

```text
src/agent_pdf_workbench/
  store.py        # SQLite persistence for sessions/events
  service.py      # tool-facing service layer
  dev_cli.py      # local smoke-test CLI
  mcp_server.py   # MCP server entrypoint
  viewer_server.py # local web UI/API server
  web/            # viewer frontend files
tests/
  test_store.py
```
