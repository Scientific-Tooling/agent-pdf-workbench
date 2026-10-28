# Hosting the reader in a local workflow

`agent_pdf_workbench.viewer_server.create_viewer_server(db_path, pdf_root,
host="127.0.0.1", port=0, workflow=None)` creates an embedded local HTTP reader.
The caller owns `serve_forever()`, `shutdown()` from another thread, and
`server_close()`. Port zero allocates an available port, exposed through
`server.server_address`. Closing drains active requests before returning.

The optional `ReadingWorkflow` protocol has `status(session_id)` and
`execute(payload)` methods returning JSON objects. APW invokes it only for
`GET/POST /api/workflow`, after normal Host/Origin, JSON media type and request
size validation. A workflow raises `ValueError` for actionable client errors.
APW does not import RKS or own external evidence storage. Standalone status
returns `{"enabled": false}` and the optional panel stays hidden.

The panel expects status fields `enabled`, `question`, `preview`, and `brief`.
Previews include an ID, addition/unchanged/conflict counts, original evidence
items, the native import plan, and an applied flag. Briefs include plain Markdown
and original passage URLs. Actions carry the current session ID and explicit
annotation/note selections, or the exact preview ID being applied. Hosts must
validate scope, reject changed selections, and preserve the native store's
transaction and revision checks. Content is rendered as text, not raw HTML.

Scientific Tooling implements this protocol and owns its persistent workspace,
background process and import artifacts. Its CLI is the recommended public
entry point; use this embedding interface when implementing another local host.

Status and each entry in `papers` may include optional `bibliography` with
`authors` (a list of display names), `venue` and `year`. The reader uses these
recorded fields for the document byline and compact paper list. Omit or return
null when unavailable; the reader does not infer bibliography from filenames.
Scientific Tooling supplies it only from the paper's explicitly linked work.

## Optional project evidence search (unreleased)

A host can advertise `capabilities: {"evidence_search": true}` in session status
and implement `search(params)`. The Evidence tab then displays project evidence
search. Hosts without this capability retain the existing reading/import controls.

`GET /api/workflow/search` passes the decoded `session_id`, `q`, `paper`, `review`,
`mode`, `limit` and `offset` parameters to the host after the normal origin/host
checks. The host validates that the session belongs to its project and resolves
filters through its own CLI-equivalent search operation. Missing search support
returns 404; invalid scope or filters return a validation error. Search is read-only.

Scientific Tooling returns `scientific-tooling.evidence-search.v1`: current imported
quotations and commentary, exact evidence/source revisions, explicit review status,
matched text, pagination and checked source links. A missing or changed passage
keeps its text with an unavailable message. APW renders returned text safely and
does not independently search RKS, infer scientific support or alter review status.
The form discards pending responses when its query, filters or session change.

## Optional comparisons and human review (unreleased)

A host advertises `capabilities: {"comparisons": true}` and implements
`comparisons(params)`. `GET /api/workflow/comparisons` passes `session_id` and an
optional `comparison_id`, with the same Host/Origin guards. The host validates
project ownership and returns comparison definitions; with an ID it also returns
the selected matrix and scoped evidence choices. Missing support returns 404.

The Compare tab renders fixed criteria/papers, distinct interpretations and literal
source quotations, experimental conditions, explicit gaps and stale/review labels.
POST `/api/workflow` carries `comparison_create`, `comparison_set`, or
`comparison_review`, plus `session_id`, `request_id`, `comparison_id`,
`expected_revision`, and action `payload`. The host owns validation, revision
checks, exact retry and persistence. APW owns the interface and source navigation.

The reader preserves agent origin, never substitutes changed evidence selections,
requires saved edits before review, and requires explicit human attestation with
name, scope, statement and decision. Acceptance is disabled for unsupported/stale
entries. Pending replies cannot update a different session. Failed identical
requests retain their ID for safe replay; sci also saves requests durably.
Markdown download preserves separate support and review labels. Standalone readers
and hosts without the capability retain their existing tabs.

## Optional paper discovery (unreleased)

A host advertises `capabilities: {"discovery": true}` and implements
`discovery(params)`. `GET /api/workflow/discovery` passes `session_id` and optional
`discovery_id` after the normal Host/Origin checks. The host verifies project
ownership and returns saved discovery summaries, selections and, when requested,
the selected discovery with its candidates. Missing support returns 404.

The paper navigation panel offers query/identifier search, saved discoveries,
bibliographic metadata, explicit PDF selection and interrupted-selection retry.
POST `/api/workflow` actions are `discovery_search`, `discovery_lookup`,
`discovery_select`, and `discovery_retry`, with the current `session_id`.
Search carries `query`, `provider` and `limit`; lookup carries `query`. Selection
carries `discovery_id`, `candidate_id`, optional numbered `source` and a stable
`request_id`; retry carries the saved `request_id`. The host owns network access,
bounded retrieval, artifacts, identity reconciliation and native ingestion.

APW renders metadata as text and safe HTTPS links. It never treats an abstract as
a read source, selects among multiple PDF links implicitly or promotes review
status. Identical failed selections retain their request ID; saved pending/failed
selections can be retried after reopening. Session changes discard old replies.
Successful additions refresh Project papers and use the host's verified session
links. Standalone readers and hosts without the capability retain their controls.
