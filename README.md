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

Future scope:

- browser-based PDF viewer (PDF.js)
- real-time sync and presence
- richer annotation model
- integration adapter for RKS (`paper_id -> pdf_uri`)

## Quick start

```bash
python3 -m unittest discover -s tests -p "test_*.py"
python3 -m agent_pdf_workbench.dev_cli open-paper --paper-ref "10.48550/arXiv.1706.03762" --pdf-uri "/tmp/paper.pdf"
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

## Project layout

```text
src/agent_pdf_workbench/
  store.py        # SQLite persistence for sessions/events
  service.py      # tool-facing service layer
  dev_cli.py      # local smoke-test CLI
  mcp_server.py   # MCP server entrypoint
tests/
  test_store.py
```
