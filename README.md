# agent-pdf-workbench

Agent-aware PDF workspace for Codex/Claude integrations.

This project provides a tool layer that lets an AI agent open a paper PDF session and observe user actions such as highlight, copy, page navigation, and comments. The core output is a durable, queryable event stream that can be reused in later conversations.

## Why this exists

Traditional PDF readers do not expose user interactions to an AI agent. This project adds:

- explicit paper sessions (`open_paper`)
- structured user interaction events (`record_action`)
- event replay for agent grounding (`list_actions`)
- session discovery (`list_sessions`), so an agent can find the session a reader
  already has open instead of being told the id
- durable annotation/note state, scoped to the **paper** rather than the session,
  so reopening a paper keeps earlier highlights and notes

## Scope

Current repo focus:

- local event store (SQLite with WAL mode)
- server-side annotation/note CRUD store (SQLite)
- stable Python service API
- MCP server entrypoint (for Codex/Claude tool integration)
- dev CLI for local testing, backup, export, and diagnostics
- local PDF.js-based viewer server with event capture

Future scope:

- real-time sync and presence
- richer annotation model
- integration adapter for RKS (`paper_id -> pdf_uri`)

## Quick start (one command)

```bash
bash bootstrap.sh
```

Then start the server:

```bash
apw-viewer-server --db-path ~/.apw/events.db --pdf-root ~/Papers
```

Open: `http://127.0.0.1:8790`

Deep links open the viewer directly:

- `http://127.0.0.1:8790/?session_id=ps_abc123` — attach to an existing session
- `http://127.0.0.1:8790/?pdf_uri=/path/to/paper.pdf` — open that file

## Recommended local production profile

```bash
apw-viewer-server \
  --db-path ~/.apw/events.db \
  --pdf-root ~/Papers
```

- `--pdf-root` restricts local PDF access to that directory (recommended).
- Server always binds to `127.0.0.1` — never exposed to the network by default.
- Set `APW_LOG_LEVEL=DEBUG` for verbose logging.
- See [docs/security-local.md](docs/security-local.md) for the full threat model.

## Dev CLI

```bash
# Session lifecycle
apw-dev --db-path ~/.apw/events.db open-paper \
  --paper-ref "10.48550/arXiv.1706.03762" --pdf-uri "/tmp/paper.pdf"
apw-dev --db-path ~/.apw/events.db list-actions --session-id ps_abc123
apw-dev --db-path ~/.apw/events.db list-sessions --open-only --limit 5
apw-dev --db-path ~/.apw/events.db close-paper --session-id ps_abc123

# Backup and maintenance
apw-dev --db-path ~/.apw/events.db backup --output backup/events.db
apw-dev --db-path ~/.apw/events.db checkpoint
apw-dev --db-path ~/.apw/events.db export --output workspace.json

# Environment check
apw-dev --db-path ~/.apw/events.db diagnostics
```

See [docs/operations-local.md](docs/operations-local.md) for the full operations runbook.

## Frontend development

The viewer frontend is engineered with `Vite + React + TypeScript`.

Source of truth:

- `frontend/index.html`
- `frontend/src/*.{ts,tsx}`
- `frontend/src/styles.css`

Build output served by Python:

- `src/agent_pdf_workbench/web/index.html`
- `src/agent_pdf_workbench/web/app.js`
- `src/agent_pdf_workbench/web/styles.css`
- `src/agent_pdf_workbench/web/*` support assets (PDF.js worker, PWA manifest, icon, service worker)

Requires Node `^20.19 || ^22.13 || >=24` (Vite 8 and ESLint 10 set the floor).

Commands:

```bash
npm install
pip install -e '.[mcp,dev]'      # mcp tools + ruff

npm run format:check
npm run lint:python              # ruff
npm run test:unit
npm run test:python:unit         # unit tests only
npm run test:python:integration  # integration tests only
npm run test:e2e
npm run check:frontend           # typecheck, eslint, prettier, unit tests, build
npm run check:backend            # ruff + python tests
npm run verify:without-e2e
npm run verify                   # everything above plus Playwright E2E
```

Playwright browser setup (first time only):

```bash
npx playwright install --with-deps chromium
```

For local frontend dev with hot reload:

1. Run backend viewer API on `127.0.0.1:8790`:
`PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server --db-path /tmp/apw/events.db --port 8790`
2. Run Vite dev server:
`npm run dev`
3. Open `http://127.0.0.1:5173`

## Agent skill

This repo includes a reusable skill for agents that need to open a PDF in this app:

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
- `list_sessions`
- `get_session`
- `upsert_annotation`
- `list_annotations`
- `delete_annotation`
- `upsert_note`
- `list_notes`
- `delete_note`
- `export_workspace`

See [docs/mcp-tools.md](docs/mcp-tools.md) for tool contracts and examples.

## PDF viewer

Run local server:

```bash
apw-viewer-server --db-path ~/.apw/events.db --pdf-root ~/Papers
```

Security defaults:

- server binds to `127.0.0.1` (non-local bind prints a warning)
- requests must carry a loopback `Host` header (blocks DNS rebinding) and, if
  they carry `Origin` at all, a same-origin one (blocks cross-site writes)
- `POST` requires `Content-Type: application/json`
- running without `--pdf-root` prints a warning: any file the OS user can read
  is then reachable through `/api/pdf`
- remote PDF fetch is disabled by default; enable explicitly with `--allow-remote-pdf` or `APW_ALLOW_REMOTE_PDF=1`
- constrain local PDF access with `--pdf-root /path/to/pdfs` (recommended; or `APW_PDF_ROOT`)
- PDF responses are capped at 100 MiB by default; override with `--max-pdf-bytes` or `APW_MAX_PDF_BYTES`
- all responses include security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Cache-Control`)
- POST body limit: 1 MiB

Health check:

```bash
curl http://127.0.0.1:8790/api/health
# {"ok": true, "service": "agent-pdf-workbench", "version": "0.1.0", "schema_version": 2, ...}
```

Current viewer events:

- `page_change`
- `zoom_change`
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
- robust text anchors (`start/end/prefix/suffix`) with rectangle fallback for rendering
- markdown notes linked to annotation IDs (back-link to evidence)
- export reading outputs as JSON and Markdown
- reading progress + recent papers (local persistence)

HTTP API:

- `GET /api/health` — service health, version, schema version
- `GET /api/list-actions?session_id=...&after_id=...&limit=...`
- `GET /api/sessions?paper_ref=...&open_only=1&limit=...&offset=...`
- `GET /api/session?session_id=...`
- `GET /api/annotations?session_id=...|paper_ref=...&limit=...&offset=...`
- `GET /api/notes?session_id=...|paper_ref=...&limit=...&offset=...`
- `POST /api/open-paper` (`{paper_ref, pdf_uri, agent_id?, user_id?, metadata?}`)
- `POST /api/record-action` (`{session_id, event_type, page?, selection_text?, payload?, source?}`)
- `POST /api/close-paper` (`{session_id}`)
- `POST /api/annotations` (`{session_id, annotation}`)
- `POST /api/annotations/delete` (`{session_id, annotation_id}`)
- `POST /api/notes` (`{session_id, note}`)
- `POST /api/notes/delete` (`{session_id, note_id}`)

Action event semantics:

- Events are ordered by ascending `id`.
- Rapid high-frequency viewer events are coalesced: for `source="viewer"`, consecutive
  `page_change` or `zoom_change` events within 0.75s update the latest row instead of inserting
  a new one.
- When coalescing occurs, `POST /api/record-action` returns the updated existing event id
  (the id is reused).
- `after_id` in `list-actions` only returns rows with larger ids; callers should upsert events by
  id and treat `record-action` response as authoritative for the latest coalesced value.

List responses include pagination metadata (`has_more` plus `next_after_id` or
`next_offset`) so long sessions can be fetched without truncation.

Annotations and notes are keyed by `paper_ref`: any session on a paper reads and
writes the same set, and a `paper_ref` query works without a session at all.
Only the action event stream is per-session.

Error responses always include `{"error": "...", "code": "..."}` with a machine-readable code
(`MISSING_FIELD`, `VALIDATION_ERROR`, `FORBIDDEN`, `UNSUPPORTED_MEDIA_TYPE`,
`PAYLOAD_TOO_LARGE`, `BAD_GATEWAY`).
Validation errors include `details.field` when the failing field can be identified.

See [docs/api-contract.md](docs/api-contract.md) for full payload contracts.

E2E main-path test:

```bash
npm run test:smoke
npm run test:e2e
```

## Project layout

```text
src/agent_pdf_workbench/
  store.py         # SQLite persistence (sessions/events/annotations/notes + migrations)
  service.py       # tool-facing service layer (backup, export, checkpoint)
  dev_cli.py       # dev CLI (open-paper, backup, export, checkpoint, diagnostics, ...)
  mcp_server.py    # MCP server entrypoint
  viewer_server.py # local web UI/API server
  web/             # built frontend assets served by viewer_server.py
frontend/
  index.html       # Vite entry HTML
  src/
    app/           # App composition + session/reader/search/workspace hooks
    pdf/           # anchoring, text layer, payload parsers
    services/      # api client, exporters, local storage
    types/         # re-exports of the type declarations pdfjs-dist ships
    ui/            # search highlighting
tests/
  unit/            # pure unit tests (no HTTP server)
    test_store.py
    test_api_validation.py
    test_mcp_server.py
  integration/     # integration tests (in-process HTTP server + load/regression)
    test_viewer_server.py
    test_load.py
.github/
  workflows/ci.yml # CI: Python 3.10–3.12, frontend checks, Playwright E2E
docs/
  tutorial.md
  operations-local.md    # runbook: backup, restore, upgrade, rollback
  security-local.md      # threat model and mitigations
  release-checklist.md   # pre/post-release steps
  production-readiness-roadmap.md
bootstrap.sh       # one-command local install
```

## Documentation

- [docs/tutorial.md](docs/tutorial.md) — walkthrough
- [docs/operations-local.md](docs/operations-local.md) — backup, restore, upgrade, rollback
- [docs/security-local.md](docs/security-local.md) — threat model and mitigations
- [docs/release-checklist.md](docs/release-checklist.md) — release process
- [docs/review-2026-09-remediation.md](docs/review-2026-09-remediation.md) — September 2026 review and what changed
- [docs/ui-improvement-plan.md](docs/ui-improvement-plan.md) — batched plan for the viewer UI

## License

MIT — see [LICENSE](LICENSE).
