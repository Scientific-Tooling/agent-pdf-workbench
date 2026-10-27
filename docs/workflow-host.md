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
