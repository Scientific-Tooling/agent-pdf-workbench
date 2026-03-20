---
name: apw-open-pdf-session
description: Open a PDF in Agent PDF Workbench by creating a paper session and returning session details an agent can use in follow-up actions. Use when a user asks to open/load/start reading a PDF in this app, to initialize a session from a local file or URL, or to prepare viewer-server/API state before recording actions.
---

# APW Open PDF Session

Open a session, verify it is usable, and return the exact identifiers needed for the next tool call.

## Required Inputs

- `paper_ref`: stable paper identifier (DOI, arXiv ID, or local ID)
- `pdf_uri`: local file path or URL
- optional: `agent_id`, `user_id`, `db_path` (default `.apw/events.db`)

If `paper_ref` is missing, derive one from the filename stem.
If `db_path` is missing, use `.apw/events.db`.

## Workflow

1. Validate `pdf_uri`.
- For local files: confirm path exists before opening.
- For URLs: note viewer security defaults (remote fetch disabled unless enabled).

2. Open the paper session (preferred: CLI):

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path "<DB_PATH>" \
  open-paper \
  --paper-ref "<PAPER_REF>" \
  --pdf-uri "<PDF_URI>" \
  --agent-id "<AGENT_ID>" \
  --user-id "<USER_ID>"
```

3. Parse the JSON response and extract:
- `id` (`session_id`)
- `paper_ref`
- `pdf_uri`
- `opened_at`

4. Verify session usability:

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
  --db-path "<DB_PATH>" \
  list-actions \
  --session-id "<SESSION_ID>" \
  --limit 1
```

5. If user asks to open the browser viewer, provide/run:

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server \
  --db-path "<DB_PATH>" \
  --port 8790
```

Then use `http://127.0.0.1:8790` and set the same `paper_ref`/`pdf_uri` in UI.

Enable URL-backed PDFs only when needed:

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server \
  --db-path "<DB_PATH>" \
  --port 8790 \
  --allow-remote-pdf
```

## HTTP Alternative

If CLI is not desired, call the viewer API directly:

```bash
curl -s -X POST http://127.0.0.1:8790/api/open-paper \
  -H "Content-Type: application/json" \
  -d '{"paper_ref":"<PAPER_REF>","pdf_uri":"<PDF_URI>","agent_id":"<AGENT_ID>","user_id":"<USER_ID>"}'
```

## Output Contract

Always return:
- `session_id`
- `paper_ref`
- `pdf_uri`
- `db_path`
- how to fetch events next (`list-actions` command)

If viewer mode is used, also return:
- `viewer_url`
- whether remote URLs were enabled

## Failure Handling

- Missing local file: stop and report the resolved path.
- Unknown session in follow-up calls: confirm `db_path` and recreate session.
- Closed session: open a new session; do not append to closed sessions.
- Invalid pagination: keep `limit` in `1..1000`.
