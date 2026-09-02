from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import signal
import sys
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from .service import AgentPdfWorkbenchService
from .store import SCHEMA_VERSION, FieldValidationError

try:
    from importlib.metadata import version as _pkg_version
    _APP_VERSION: str = _pkg_version("agent-pdf-workbench")
except Exception:
    _APP_VERSION = "0.1.0-dev"


WEB_DIR = Path(__file__).with_name("web")

# Maximum POST body size (1 MiB). Protects against runaway payloads.
_MAX_REQUEST_BODY = 1 * 1024 * 1024

# Maximum PDF response size (100 MiB). The local server currently buffers PDF
# bytes before handing them to PDF.js, so fail clearly instead of exhausting RAM.
_DEFAULT_MAX_PDF_BYTES = 100 * 1024 * 1024

# Security headers added to every response for safer local browser behaviour.
_SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Cache-Control", "no-store"),
]

# Known-safe local bind addresses.
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}

# Accepted request media types for POST bodies.  Requiring JSON is what stops a
# cross-origin "simple request" (text/plain, no preflight) from reaching a
# write handler.
_JSON_CONTENT_TYPE = "application/json"

# Structured audit logger.  Emits INFO-level JSON lines when logging is configured.
_audit_logger = logging.getLogger("apw.audit")

# Maximum length of potentially sensitive text fields logged in audit events.
_AUDIT_TEXT_MAX = 0  # 0 = never log text content (redact fully)


class _MissingFieldError(ValueError):
    def __init__(self, field: str) -> None:
        super().__init__(f"missing field: {field}")
        self.field = field


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(event: str, **kwargs: object) -> None:
    """Emit a structured audit log line with consistent timestamp/level/event fields.

    Text content (selection_text, quotes) is never included to avoid leaking
    document content into logs.  Only IDs, types, and counts are logged.
    """
    record = {
        "timestamp": _utc_now_iso(),
        "level": "AUDIT",
        "event": event,
        **kwargs,
    }
    _audit_logger.info(json.dumps(record, ensure_ascii=True))


def _add_security_headers(handler: BaseHTTPRequestHandler) -> None:
    for name, value in _SECURITY_HEADERS:
        handler.send_header(name, value)


def _write_response_body(handler: BaseHTTPRequestHandler, body: bytes) -> None:
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        # Browsers may cancel static/PDF requests during navigation or E2E
        # teardown. Treat that as a normal disconnect, not a server error.
        return


def _json_response(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    _add_security_headers(handler)
    handler.end_headers()
    _write_response_body(handler, body)


def _error_response(
    handler: BaseHTTPRequestHandler,
    message: str,
    *,
    code: str,
    status: int,
    details: dict | None = None,
) -> None:
    """Emit a standardised error envelope: {error, code, details?}."""
    payload: dict = {"error": message, "code": code}
    if details:
        payload["details"] = details
    _json_response(handler, payload, status=status)


def _query_flag(query: dict, name: str) -> bool:
    raw = query.get(name, [None])[0]
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on", ""}


def _handle_validation_error(handler: BaseHTTPRequestHandler, exc: ValueError) -> None:
    """Answer a validation failure, naming the offending field when known."""
    if isinstance(exc, _MissingFieldError):
        _error_response(
            handler,
            str(exc),
            code="MISSING_FIELD",
            status=HTTPStatus.BAD_REQUEST,
            details={"field": exc.field},
        )
        return
    details = {"field": exc.field} if isinstance(exc, FieldValidationError) else _validation_details(str(exc))
    _error_response(
        handler,
        str(exc),
        code="VALIDATION_ERROR",
        status=HTTPStatus.BAD_REQUEST,
        details=details,
    )


def _validation_details(message: str) -> dict:
    """Best-effort field name for errors that do not carry one.

    Validators raise ``FieldValidationError`` with an explicit field; this is the
    fallback for plain ``ValueError`` messages raised elsewhere.
    """
    field = message.split(" must be ", 1)[0]
    field = field.split(" is required", 1)[0]
    field = field.split(" contains ", 1)[0]
    field = field.split(" too ", 1)[0]
    if field and " " not in field:
        return {"field": field}
    return {}


def _text_response(handler: BaseHTTPRequestHandler, message: str, status: int) -> None:
    body = message.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    _add_security_headers(handler)
    handler.end_headers()
    _write_response_body(handler, body)


def allowed_host_names(host: str | None = None) -> frozenset[str]:
    """Host names this server answers to, ignoring the port.

    An unvalidated Host header is what makes DNS rebinding work: a page on
    attacker.example whose DNS flips to 127.0.0.1 becomes same-origin with this
    server and can then read every response, including local files served by
    /api/pdf.  Answering only to loopback names closes that path.  The port is
    not part of the check — a request that reached us already arrived on our
    port.
    """
    names = {"127.0.0.1", "localhost", "::1"}
    if host:
        names.add(host)
    return frozenset(name.strip("[]").lower() for name in names)


def _hostname_of(netloc: str) -> str:
    """Return the lowercase hostname in a Host header or origin authority."""
    value = netloc.strip().lower()
    if value.startswith("["):
        closing = value.find("]")
        if closing != -1:
            return value[1:closing]
        return value.strip("[]")
    if value.count(":") > 1:
        # Bare IPv6 literal without brackets.
        return value
    return value.split(":", 1)[0]


def _host_header_allowed(host_header: str | None, allowed: frozenset[str]) -> bool:
    if host_header is None:
        # HTTP/1.0 clients may omit Host; browsers never do.
        return True
    return _hostname_of(host_header) in allowed


def _origin_allowed(origin: str | None, allowed: frozenset[str]) -> bool:
    """Reject requests carrying a foreign Origin.

    Same-origin policy stops another site from *reading* our responses, but it
    never stopped it from *sending* one.  The viewer's own fetches carry our
    origin, so anything else is cross-site and gets refused.
    """
    if origin is None:
        return True
    if origin == "null":
        return False
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False
    return _hostname_of(parsed.netloc) in allowed


def _is_json_content_type(content_type: str | None) -> bool:
    if not content_type:
        return False
    return content_type.split(";", 1)[0].strip().lower() == _JSON_CONTENT_TYPE


def _is_within_directory(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _validate_pdf_uri(uri: str) -> None:
    """Raise ValueError for obviously malformed PDF URIs."""
    if len(uri) > 4096:
        raise ValueError("PDF URI too long (max 4096 characters)")
    if "\x00" in uri:
        raise ValueError("PDF URI contains null byte")


def _read_with_limit(stream, max_bytes: int) -> bytes:
    """Read a stream up to max_bytes, raising ValueError if it is exceeded."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(min(64 * 1024, max_bytes + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"PDF too large: exceeds {max_bytes} bytes")
    return b"".join(chunks)


def _require_string(
    payload: dict,
    field: str,
    *,
    allow_empty: bool = False,
) -> str:
    if field not in payload:
        raise _MissingFieldError(field)
    value = payload[field]
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    if not allow_empty and not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value


def _optional_string(
    payload: dict,
    field: str,
    *,
    default: str | None = None,
    allow_none: bool = True,
    allow_empty: bool = False,
) -> str | None:
    if field not in payload:
        return default
    value = payload[field]
    if value is None and allow_none:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    if not allow_empty and not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value


def _optional_int(
    payload: dict,
    field: str,
    *,
    minimum: int | None = None,
    allow_none: bool = True,
) -> int | None:
    if field not in payload:
        return None
    value = payload[field]
    if value is None and allow_none:
        return None
    if type(value) is not int:  # bool is intentionally rejected.
        raise ValueError(f"{field} must be an integer")
    if minimum is not None and value < minimum:
        raise ValueError(f"{field} must be >= {minimum}")
    return value


def _optional_dict(
    payload: dict,
    field: str,
    *,
    default: dict | None = None,
    allow_none: bool = True,
) -> dict | None:
    if field not in payload:
        return default
    value = payload[field]
    if value is None and allow_none:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _require_dict(payload: dict, field: str) -> dict:
    if field not in payload:
        raise _MissingFieldError(field)
    value = payload[field]
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _check_web_assets() -> None:
    """Warn to stderr if required frontend assets are missing."""
    required = ["index.html"]
    missing = [f for f in required if not (WEB_DIR / f).is_file()]
    if missing:
        print(
            f"WARNING [apw] Missing web assets in {WEB_DIR}: {missing}. "
            "Run 'npm run build' to build frontend assets before serving.",
            file=sys.stderr,
        )


def _validate_config(args: argparse.Namespace) -> None:
    """Raise SystemExit for invalid configuration values."""
    if not (1 <= args.port <= 65535):
        raise SystemExit(f"Invalid --port {args.port}: must be 1–65535.")
    if args.pdf_root is not None and not args.pdf_root.exists():
        raise SystemExit(f"--pdf-root does not exist: {args.pdf_root}")
    if args.max_pdf_bytes < 1:
        raise SystemExit(f"Invalid --max-pdf-bytes {args.max_pdf_bytes}: must be >= 1.")


def _create_handler(
    service: AgentPdfWorkbenchService,
    *,
    allow_remote_pdf: bool = False,
    pdf_root: Path | None = None,
    max_pdf_bytes: int = _DEFAULT_MAX_PDF_BYTES,
    allowed_hosts: frozenset[str] | None = None,
):
    web_root = WEB_DIR.resolve()
    resolved_pdf_root = pdf_root.resolve() if pdf_root is not None else None
    host_allowlist = allowed_hosts if allowed_hosts is not None else allowed_host_names()

    class ViewerRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if not self._request_origin_is_local():
                return
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)

            if path == "/api/health":
                _json_response(
                    self,
                    {
                        "ok": True,
                        "service": "agent-pdf-workbench",
                        "version": _APP_VERSION,
                        "schema_version": SCHEMA_VERSION,
                        "web_assets_present": (WEB_DIR / "index.html").is_file(),
                        "max_pdf_bytes": max_pdf_bytes,
                    },
                )
                return

            if path == "/api/list-actions":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _error_response(
                        self,
                        "session_id is required",
                        code="MISSING_FIELD",
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                after_raw = query.get("after_id", [None])[0]
                limit_raw = query.get("limit", [100])[0]
                try:
                    after_id = int(after_raw) if after_raw is not None else None
                    limit = int(limit_raw) if limit_raw is not None else 100
                    payload = service.list_actions(session_id=session_id, after_id=after_id, limit=limit)
                except ValueError as exc:
                    _handle_validation_error(self, exc)
                    return
                _json_response(self, payload)
                return

            if path == "/api/sessions":
                paper_ref = query.get("paper_ref", [None])[0]
                open_only = _query_flag(query, "open_only")
                limit_raw = query.get("limit", [100])[0]
                offset_raw = query.get("offset", [0])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 100
                    offset = int(offset_raw) if offset_raw is not None else 0
                    payload = service.list_sessions(
                        paper_ref=paper_ref,
                        open_only=open_only,
                        limit=limit,
                        offset=offset,
                    )
                except ValueError as exc:
                    _handle_validation_error(self, exc)
                    return
                _json_response(self, payload)
                return

            if path == "/api/session":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _error_response(
                        self,
                        "session_id is required",
                        code="MISSING_FIELD",
                        status=HTTPStatus.BAD_REQUEST,
                        details={"field": "session_id"},
                    )
                    return
                try:
                    payload = service.get_session(session_id=session_id)
                except ValueError as exc:
                    _error_response(
                        self,
                        str(exc),
                        code="NOT_FOUND",
                        status=HTTPStatus.NOT_FOUND,
                    )
                    return
                _json_response(self, payload)
                return

            if path == "/api/annotations":
                scope = self._read_scope(query)
                if scope is None:
                    return
                limit_raw = query.get("limit", [1000])[0]
                offset_raw = query.get("offset", [0])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 1000
                    offset = int(offset_raw) if offset_raw is not None else 0
                    payload = service.list_annotations(**scope, limit=limit, offset=offset)
                except ValueError as exc:
                    _handle_validation_error(self, exc)
                    return
                _json_response(self, payload)
                return

            if path == "/api/notes":
                scope = self._read_scope(query)
                if scope is None:
                    return
                limit_raw = query.get("limit", [1000])[0]
                offset_raw = query.get("offset", [0])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 1000
                    offset = int(offset_raw) if offset_raw is not None else 0
                    payload = service.list_notes(**scope, limit=limit, offset=offset)
                except ValueError as exc:
                    _handle_validation_error(self, exc)
                    return
                _json_response(self, payload)
                return

            if path == "/api/pdf":
                uri = query.get("uri", [None])[0]
                if not uri:
                    _error_response(
                        self,
                        "uri query parameter is required",
                        code="MISSING_FIELD",
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                try:
                    _validate_pdf_uri(uri)
                except ValueError as exc:
                    _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)
                    return
                self._serve_pdf(uri)
                return

            if path.startswith("/api/"):
                _error_response(self, "Not Found", code="NOT_FOUND", status=HTTPStatus.NOT_FOUND)
                return

            if path == "/":
                self._serve_static("index.html")
                return

            static_name = path.lstrip("/")
            if static_name:
                self._serve_static(static_name)
                return

            _text_response(self, "Not Found", HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:  # noqa: N802
            if not self._request_origin_is_local():
                return
            parsed = urlparse(self.path)
            path = parsed.path

            if not _is_json_content_type(self.headers.get("Content-Type")):
                _error_response(
                    self,
                    "Content-Type must be application/json",
                    code="UNSUPPORTED_MEDIA_TYPE",
                    status=HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                )
                return

            try:
                body = self._read_json_body()
            except ValueError as exc:
                _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)
                return

            def _handle_post_validation_error(exc: ValueError) -> None:
                _handle_validation_error(self, exc)

            if path == "/api/open-paper":
                try:
                    paper_ref = _require_string(body, "paper_ref")
                    pdf_uri = _require_string(body, "pdf_uri")
                    _validate_pdf_uri(pdf_uri)
                    agent_id = _optional_string(
                        body,
                        "agent_id",
                        default="agent:unknown",
                        allow_none=False,
                    )
                    user_id = _optional_string(
                        body,
                        "user_id",
                        default="user:unknown",
                        allow_none=False,
                    )
                    metadata = _optional_dict(body, "metadata", default=None, allow_none=True)
                    if agent_id is None or user_id is None:
                        raise ValueError("agent_id and user_id must be strings")
                    payload = service.open_paper(
                        paper_ref=paper_ref,
                        pdf_uri=pdf_uri,
                        agent_id=agent_id,
                        user_id=user_id,
                        metadata=metadata,
                    )
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _audit("open_session", session_id=payload["id"], paper_ref=payload["paper_ref"])
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/record-action":
                try:
                    session_id = _require_string(body, "session_id")
                    event_type = _require_string(body, "event_type")
                    page = _optional_int(body, "page", minimum=1, allow_none=True)
                    selection_text = _optional_string(
                        body,
                        "selection_text",
                        default=None,
                        allow_none=True,
                        allow_empty=True,
                    )
                    payload_obj = _optional_dict(body, "payload", default=None, allow_none=True)
                    source = _optional_string(
                        body,
                        "source",
                        default="viewer",
                        allow_none=False,
                    )
                    if source is None:
                        raise ValueError("source must be a string")
                    payload = service.record_action(
                        session_id=session_id,
                        event_type=event_type,
                        page=page,
                        selection_text=selection_text,
                        payload=payload_obj,
                        source=source,
                    )
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/close-paper":
                try:
                    session_id = _require_string(body, "session_id")
                    payload = service.close_paper(session_id=session_id)
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _audit("close_session", session_id=session_id)
                _json_response(self, payload)
                return

            if path == "/api/annotations":
                try:
                    session_id = _require_string(body, "session_id")
                    annotation = _require_dict(body, "annotation")
                    payload = service.upsert_annotation(session_id=session_id, annotation=annotation)
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/annotations/delete":
                try:
                    session_id = _require_string(body, "session_id")
                    annotation_id = _require_string(body, "annotation_id")
                    payload = service.delete_annotation(session_id=session_id, annotation_id=annotation_id)
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _audit("delete_annotation", session_id=session_id, annotation_id=annotation_id)
                _json_response(self, payload)
                return

            if path == "/api/notes":
                try:
                    session_id = _require_string(body, "session_id")
                    note = _require_dict(body, "note")
                    payload = service.upsert_note(session_id=session_id, note=note)
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/notes/delete":
                try:
                    session_id = _require_string(body, "session_id")
                    note_id = _require_string(body, "note_id")
                    payload = service.delete_note(session_id=session_id, note_id=note_id)
                except ValueError as exc:
                    _handle_post_validation_error(exc)
                    return
                _audit("delete_note", session_id=session_id, note_id=note_id)
                _json_response(self, payload)
                return

            if path.startswith("/api/"):
                _error_response(self, "Not Found", code="NOT_FOUND", status=HTTPStatus.NOT_FOUND)
                return
            _text_response(self, "Not Found", HTTPStatus.NOT_FOUND)

        def log_message(self, fmt: str, *args) -> None:
            # Keep local dev output clean.
            return

        def _read_scope(self, query: dict) -> dict | None:
            """Resolve a read scope from ?session_id= or ?paper_ref=.

            Annotations and notes belong to the paper, so either handle names the
            same set.  Returns None after answering when neither is usable.
            """
            session_id = query.get("session_id", [None])[0]
            paper_ref = query.get("paper_ref", [None])[0]
            if bool(session_id) == bool(paper_ref):
                _error_response(
                    self,
                    "exactly one of session_id or paper_ref is required",
                    code="MISSING_FIELD",
                    status=HTTPStatus.BAD_REQUEST,
                    details={"field": "session_id"},
                )
                return None
            if session_id:
                return {"session_id": session_id}
            return {"paper_ref": paper_ref}

        def _request_origin_is_local(self) -> bool:
            """Refuse requests that did not come from this machine's viewer.

            Returns True when the request may proceed; otherwise it has already
            answered with 403 and the caller must return.
            """
            # Log the route only: a blocked /api/pdf request carries a file path
            # in its query string, and audit logs never take content.
            route = urlparse(self.path).path
            if not _host_header_allowed(self.headers.get("Host"), host_allowlist):
                _audit("blocked_request", reason="host", path=route)
                _error_response(
                    self,
                    "Host header is not a local address for this server",
                    code="FORBIDDEN",
                    status=HTTPStatus.FORBIDDEN,
                )
                return False
            if not _origin_allowed(self.headers.get("Origin"), host_allowlist):
                _audit("blocked_request", reason="origin", path=route)
                _error_response(
                    self,
                    "cross-origin requests are not accepted",
                    code="FORBIDDEN",
                    status=HTTPStatus.FORBIDDEN,
                )
                return False
            return True

        def _read_json_body(self) -> dict:
            length_raw = self.headers.get("Content-Length")
            if not length_raw:
                return {}
            try:
                length = int(length_raw)
            except ValueError as exc:
                raise ValueError("Invalid Content-Length") from exc
            if length > _MAX_REQUEST_BODY:
                raise ValueError(
                    f"Request body too large: {length} bytes (max {_MAX_REQUEST_BODY})"
                )
            raw = self.rfile.read(length)
            if not raw:
                return {}
            try:
                payload = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError("Body must be valid JSON") from exc
            if not isinstance(payload, dict):
                raise ValueError("Body must be a JSON object")
            return payload

        def _serve_pdf(self, uri: str) -> None:
            if uri.startswith("http://") or uri.startswith("https://"):
                if not allow_remote_pdf:
                    _error_response(
                        self,
                        "remote PDF fetch is disabled (set APW_ALLOW_REMOTE_PDF=1 to enable)",
                        code="FORBIDDEN",
                        status=HTTPStatus.FORBIDDEN,
                    )
                    return
                try:
                    with urlopen(uri, timeout=15) as resp:  # noqa: S310 - intended for configurable viewer source.
                        length_raw = resp.headers.get("Content-Length")
                        if length_raw is not None and int(length_raw) > max_pdf_bytes:
                            _error_response(
                                self,
                                f"PDF too large: {length_raw} bytes (max {max_pdf_bytes})",
                                code="PAYLOAD_TOO_LARGE",
                                status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                            )
                            return
                        content = _read_with_limit(resp, max_pdf_bytes)
                        content_type = resp.headers.get_content_type() or "application/pdf"
                except HTTPError as exc:
                    _error_response(
                        self,
                        f"remote PDF fetch failed: upstream HTTP {exc.code}",
                        code="BAD_GATEWAY",
                        status=HTTPStatus.BAD_GATEWAY,
                    )
                    return
                except ValueError as exc:
                    _error_response(
                        self,
                        str(exc),
                        code="PAYLOAD_TOO_LARGE",
                        status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    )
                    return
                except (URLError, TimeoutError, OSError) as exc:
                    _error_response(
                        self,
                        f"remote PDF fetch failed: {exc}",
                        code="BAD_GATEWAY",
                        status=HTTPStatus.BAD_GATEWAY,
                    )
                    return
            else:
                file_path = Path(uri).expanduser()
                if not file_path.is_absolute():
                    file_path = (Path.cwd() / file_path).resolve()
                else:
                    file_path = file_path.resolve()
                if resolved_pdf_root is not None and not _is_within_directory(file_path, resolved_pdf_root):
                    _error_response(
                        self,
                        f"PDF path must be inside configured root: {resolved_pdf_root}",
                        code="FORBIDDEN",
                        status=HTTPStatus.FORBIDDEN,
                    )
                    return
                if not file_path.exists() or not file_path.is_file():
                    _error_response(
                        self,
                        f"PDF not found: {file_path}",
                        code="NOT_FOUND",
                        status=HTTPStatus.NOT_FOUND,
                    )
                    return
                file_size = file_path.stat().st_size
                if file_size > max_pdf_bytes:
                    _error_response(
                        self,
                        f"PDF too large: {file_size} bytes (max {max_pdf_bytes})",
                        code="PAYLOAD_TOO_LARGE",
                        status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    )
                    return
                try:
                    with file_path.open("rb") as pdf_file:
                        content = _read_with_limit(pdf_file, max_pdf_bytes)
                except ValueError as exc:
                    _error_response(
                        self,
                        str(exc),
                        code="PAYLOAD_TOO_LARGE",
                        status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    )
                    return
                content_type = "application/pdf"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            _add_security_headers(self)
            self.end_headers()
            _write_response_body(self, content)

        def _serve_static(self, relative_name: str) -> None:
            target = (web_root / relative_name).resolve()
            if not _is_within_directory(target, web_root) or not target.exists() or not target.is_file():
                _text_response(self, "Not Found", HTTPStatus.NOT_FOUND)
                return
            data = target.read_bytes()
            content_type, _ = mimetypes.guess_type(str(target))
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            _add_security_headers(self)
            self.end_headers()
            _write_response_body(self, data)

    return ViewerRequestHandler


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="apw-viewer-server")
    parser.add_argument("--host", default=os.environ.get("APW_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("APW_PORT", "8790")))
    parser.add_argument("--db-path", type=Path, default=Path(os.environ.get("APW_DB_PATH", ".apw/events.db")))
    parser.add_argument(
        "--allow-remote-pdf",
        action="store_true",
        default=_env_flag("APW_ALLOW_REMOTE_PDF", default=False),
        help="Allow loading PDFs from http(s) URLs.",
    )
    parser.add_argument(
        "--pdf-root",
        type=Path,
        default=Path(os.environ["APW_PDF_ROOT"]).expanduser() if "APW_PDF_ROOT" in os.environ else None,
        help="Optional root directory for local PDF files. When set, local PDF paths outside this root are blocked.",
    )
    parser.add_argument(
        "--max-pdf-bytes",
        type=int,
        default=int(os.environ.get("APW_MAX_PDF_BYTES", str(_DEFAULT_MAX_PDF_BYTES))),
        help="Maximum PDF bytes served from local or remote sources (default: 104857600).",
    )
    return parser


def main() -> int:
    log_level_name = os.environ.get("APW_LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )

    args = build_parser().parse_args()
    _validate_config(args)

    if args.host not in _LOCAL_HOSTS:
        print(
            f"WARNING [apw] Binding to {args.host!r} exposes this server outside localhost. "
            "This is not recommended for local single-user usage.",
            file=sys.stderr,
        )

    if args.pdf_root is None:
        print(
            "WARNING [apw] --pdf-root is not set: /api/pdf can read any file this OS user can read. "
            "Pass --pdf-root ~/Papers (or APW_PDF_ROOT) to restrict it.",
            file=sys.stderr,
        )

    _check_web_assets()

    service = AgentPdfWorkbenchService(db_path=args.db_path)
    server = ThreadingHTTPServer(
        (args.host, args.port),
        _create_handler(
            service,
            allow_remote_pdf=args.allow_remote_pdf,
            pdf_root=args.pdf_root,
            max_pdf_bytes=args.max_pdf_bytes,
            allowed_hosts=allowed_host_names(args.host),
        ),
    )

    def _shutdown(signum: int, frame: object) -> None:
        # Schedule shutdown from the signal handler; server.shutdown() blocks
        # until serve_forever() exits so we run it in a thread-safe way by
        # just calling it directly (ThreadingHTTPServer handles it correctly).
        server.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)

    print(f"agent-pdf-workbench viewer server running on http://{args.host}:{args.port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
