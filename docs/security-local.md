# Security — Local Mode Threat Model

This document describes the security model, assumptions, threats, and mitigations
for running agent-pdf-workbench in local single-user mode.

## Scope

This applies only to local workstation usage (`127.0.0.1` binding).
It does not apply to any internet-facing or multi-user deployment.

---

## Assumptions

- The workstation is owned and controlled by a single trusted user.
- The operating system user account running the server is the same account that
  owns the data directory and PDF files.
- No other untrusted users have shell access to the machine.
- The browser used to access the viewer is a standard modern browser (Chrome,
  Firefox, Edge, Safari) running on the same machine.

---

## Threat Model

### In scope (mitigated)

| Threat | Mitigation |
|---|---|
| Malicious web page reading the viewer API via cross-origin request | Server binds to `127.0.0.1` only; browsers enforce same-origin policy for cross-origin requests to `127.0.0.1` |
| Path traversal in PDF URI (`../../etc/passwd`) | `Path.resolve()` normalises the path; `_is_within_directory()` enforces `--pdf-root` boundary when set; `resolve()` makes symlink attacks visible |
| Oversized POST payloads (memory exhaustion) | `Content-Length` checked against 1 MiB limit before reading body |
| Oversized PDF responses (memory exhaustion) | PDF bytes are capped at 100 MiB by default; use `--max-pdf-bytes` or `APW_MAX_PDF_BYTES` to tune |
| MIME sniffing attacks on served files | `X-Content-Type-Options: nosniff` header on all responses |
| Clickjacking via iframe embedding | `X-Frame-Options: SAMEORIGIN` header on all responses |
| Browser caching sensitive session data | `Cache-Control: no-store` header on all responses |
| Malformed JSON crashing the server | JSON parsing errors return 400 without crashing the server thread |
| Null-byte injection in PDF URI | Explicit null-byte check in `_validate_pdf_uri()` |
| Remote PDF fetch to internal services (SSRF-lite) | Remote PDF fetch is disabled by default; requires explicit `--allow-remote-pdf` flag |
| Exposing server to network | Server prints a visible WARNING to stderr if bound to a non-local address |

### Out of scope (not mitigated in this phase)

| Threat | Reason |
|---|---|
| Authenticated access control | Single-user local use only; OS-level account separation is the boundary |
| TLS/HTTPS | Local-only; no untrusted network path |
| Multi-user session isolation | Not supported in this phase |
| Rate limiting / DoS from the network | Not applicable for local-only binding |
| Supply chain attacks on Python/Node dependencies | Dependency pinning and update cadence is a Phase 4 item |

---

## Recommended Local Configuration

```bash
apw-viewer-server \
  --db-path ~/.apw/events.db \
  --pdf-root ~/Papers
```

- **Always set `--pdf-root`** to restrict PDF access to a known directory.
  Without it, the server will serve any local file path the OS user can read.
- **Never use `--host 0.0.0.0`** unless you understand the consequences.
- **Do not enable `--allow-remote-pdf`** unless you trust the PDF source URLs.
- **Keep `--max-pdf-bytes` conservative** unless you know your workstation can handle larger documents.

---

## Data Stored

The SQLite database contains:

| Data | Notes |
|---|---|
| Paper references and PDF file paths | Stored in plain text |
| Action events (page changes, highlights, copies) | May contain copied text from the PDF |
| Annotation quotes and comments | Contains document text and user notes |
| Note markdown content | Contains user-written text |

### Recommendations

- Store the database in your home directory (default: `~/.apw/events.db`).
- Back up with standard file permissions (mode 600 or 640).
- If you handle confidential documents, be aware that selected/copied text is
  stored in the action event log.

---

## Audit Log

Security-relevant events are logged to the `apw.audit` logger:

| Event | Logged fields |
|---|---|
| `open_session` | `session_id`, `paper_ref` |
| `close_session` | `session_id` |
| `delete_annotation` | `session_id`, `annotation_id` |
| `delete_note` | `session_id`, `note_id` |

Text content (quotes, selection text, markdown) is **never** included in audit
logs to avoid leaking document content.

Set `APW_LOG_LEVEL=DEBUG` to increase log verbosity; the audit logger always
runs at INFO regardless of the global level.

---

## Response Headers

All HTTP responses include the following security headers:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | Prevent clickjacking |
| `Cache-Control` | `no-store` | Prevent sensitive data caching |
