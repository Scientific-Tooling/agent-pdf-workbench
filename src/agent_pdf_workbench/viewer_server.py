from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import signal
import socket
import sys
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from .service import AgentPdfWorkbenchService
from .store import SCHEMA_VERSION

try:
    from importlib.metadata import version as _pkg_version
    _APP_VERSION: str = _pkg_version("agent-pdf-workbench")
except Exception:
    _APP_VERSION = "0.1.0-dev"


WEB_DIR = Path(__file__).with_name("web")

# Maximum POST body size (1 MiB). Protects against runaway payloads.
_MAX_REQUEST_BODY = 1 * 1024 * 1024

# Security headers added to every response for safer local browser behaviour.
_SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Cache-Control", "no-store"),
]

# Known-safe local bind addresses.
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}

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


def _json_response(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    _add_security_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


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


def _text_response(handler: BaseHTTPRequestHandler, message: str, status: int) -> None:
    body = message.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    _add_security_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


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


def _create_handler(
    service: AgentPdfWorkbenchService,
    *,
    allow_remote_pdf: bool = False,
    pdf_root: Path | None = None,
):
    web_root = WEB_DIR.resolve()
    resolved_pdf_root = pdf_root.resolve() if pdf_root is not None else None

    class ViewerRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
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
                    _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/annotations":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _error_response(
                        self,
                        "session_id is required",
                        code="MISSING_FIELD",
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                limit_raw = query.get("limit", [1000])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 1000
                    payload = service.list_annotations(session_id=session_id, limit=limit)
                except ValueError as exc:
                    _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/notes":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _error_response(
                        self,
                        "session_id is required",
                        code="MISSING_FIELD",
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                limit_raw = query.get("limit", [1000])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 1000
                    payload = service.list_notes(session_id=session_id, limit=limit)
                except ValueError as exc:
                    _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)
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
            parsed = urlparse(self.path)
            path = parsed.path

            try:
                body = self._read_json_body()
            except ValueError as exc:
                _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)
                return

            def _handle_post_validation_error(exc: ValueError) -> None:
                if isinstance(exc, _MissingFieldError):
                    _error_response(self, str(exc), code="MISSING_FIELD", status=HTTPStatus.BAD_REQUEST)
                else:
                    _error_response(self, str(exc), code="VALIDATION_ERROR", status=HTTPStatus.BAD_REQUEST)

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
                        content = resp.read()
                        content_type = resp.headers.get_content_type() or "application/pdf"
                except HTTPError as exc:
                    _error_response(
                        self,
                        f"remote PDF fetch failed: upstream HTTP {exc.code}",
                        code="BAD_GATEWAY",
                        status=HTTPStatus.BAD_GATEWAY,
                    )
                    return
                except (URLError, socket.timeout, TimeoutError, OSError) as exc:
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
                content = file_path.read_bytes()
                content_type = "application/pdf"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            _add_security_headers(self)
            self.end_headers()
            self.wfile.write(content)

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
            self.wfile.write(data)

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

    _check_web_assets()

    service = AgentPdfWorkbenchService(db_path=args.db_path)
    server = ThreadingHTTPServer(
        (args.host, args.port),
        _create_handler(service, allow_remote_pdf=args.allow_remote_pdf, pdf_root=args.pdf_root),
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
