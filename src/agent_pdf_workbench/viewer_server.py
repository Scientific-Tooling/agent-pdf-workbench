from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from .service import AgentPdfWorkbenchService


WEB_DIR = Path(__file__).with_name("web")


def _json_response(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _text_response(handler: BaseHTTPRequestHandler, message: str, status: int) -> None:
    body = message.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
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
                _json_response(self, {"ok": True, "service": "agent-pdf-workbench"})
                return

            if path == "/api/list-actions":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _json_response(self, {"error": "session_id is required"}, status=HTTPStatus.BAD_REQUEST)
                    return
                after_raw = query.get("after_id", [None])[0]
                limit_raw = query.get("limit", [100])[0]
                try:
                    after_id = int(after_raw) if after_raw is not None else None
                    limit = int(limit_raw) if limit_raw is not None else 100
                    payload = service.list_actions(session_id=session_id, after_id=after_id, limit=limit)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/annotations":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _json_response(self, {"error": "session_id is required"}, status=HTTPStatus.BAD_REQUEST)
                    return
                limit_raw = query.get("limit", [1000])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 1000
                    payload = service.list_annotations(session_id=session_id, limit=limit)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/notes":
                session_id = query.get("session_id", [None])[0]
                if not session_id:
                    _json_response(self, {"error": "session_id is required"}, status=HTTPStatus.BAD_REQUEST)
                    return
                limit_raw = query.get("limit", [1000])[0]
                try:
                    limit = int(limit_raw) if limit_raw is not None else 1000
                    payload = service.list_notes(session_id=session_id, limit=limit)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/pdf":
                uri = query.get("uri", [None])[0]
                if not uri:
                    _json_response(self, {"error": "uri query is required"}, status=HTTPStatus.BAD_REQUEST)
                    return
                self._serve_pdf(uri)
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
                _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return

            if path == "/api/open-paper":
                try:
                    payload = service.open_paper(
                        paper_ref=body["paper_ref"],
                        pdf_uri=body["pdf_uri"],
                        agent_id=body.get("agent_id", "agent:unknown"),
                        user_id=body.get("user_id", "user:unknown"),
                        metadata=body.get("metadata"),
                    )
                except KeyError as exc:
                    _json_response(self, {"error": f"missing field: {exc}"}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/record-action":
                try:
                    payload = service.record_action(
                        session_id=body["session_id"],
                        event_type=body["event_type"],
                        page=body.get("page"),
                        selection_text=body.get("selection_text"),
                        payload=body.get("payload"),
                        source=body.get("source", "viewer"),
                    )
                except KeyError as exc:
                    _json_response(self, {"error": f"missing field: {exc}"}, status=HTTPStatus.BAD_REQUEST)
                    return
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/close-paper":
                session_id = body.get("session_id")
                if not session_id:
                    _json_response(self, {"error": "missing field: session_id"}, status=HTTPStatus.BAD_REQUEST)
                    return
                try:
                    payload = service.close_paper(session_id=session_id)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/annotations":
                session_id = body.get("session_id")
                annotation = body.get("annotation")
                if not session_id:
                    _json_response(self, {"error": "missing field: session_id"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if not isinstance(annotation, dict):
                    _json_response(
                        self,
                        {"error": "missing field: annotation"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                try:
                    payload = service.upsert_annotation(session_id=session_id, annotation=annotation)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/annotations/delete":
                session_id = body.get("session_id")
                annotation_id = body.get("annotation_id")
                if not session_id:
                    _json_response(self, {"error": "missing field: session_id"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if not isinstance(annotation_id, str):
                    _json_response(
                        self,
                        {"error": "missing field: annotation_id"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                try:
                    payload = service.delete_annotation(session_id=session_id, annotation_id=annotation_id)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
                return

            if path == "/api/notes":
                session_id = body.get("session_id")
                note = body.get("note")
                if not session_id:
                    _json_response(self, {"error": "missing field: session_id"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if not isinstance(note, dict):
                    _json_response(
                        self,
                        {"error": "missing field: note"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                try:
                    payload = service.upsert_note(session_id=session_id, note=note)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload, status=HTTPStatus.CREATED)
                return

            if path == "/api/notes/delete":
                session_id = body.get("session_id")
                note_id = body.get("note_id")
                if not session_id:
                    _json_response(self, {"error": "missing field: session_id"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if not isinstance(note_id, str):
                    _json_response(
                        self,
                        {"error": "missing field: note_id"},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                try:
                    payload = service.delete_note(session_id=session_id, note_id=note_id)
                except ValueError as exc:
                    _json_response(self, {"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                    return
                _json_response(self, payload)
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
                    _json_response(
                        self,
                        {"error": "remote PDF fetch is disabled (set APW_ALLOW_REMOTE_PDF=1 to enable)"},
                        status=HTTPStatus.FORBIDDEN,
                    )
                    return
                try:
                    with urlopen(uri, timeout=15) as resp:  # noqa: S310 - intended for configurable viewer source.
                        content = resp.read()
                        content_type = resp.headers.get_content_type() or "application/pdf"
                except HTTPError as exc:
                    _json_response(
                        self,
                        {"error": f"remote PDF fetch failed: upstream HTTP {exc.code}"},
                        status=HTTPStatus.BAD_GATEWAY,
                    )
                    return
                except (URLError, socket.timeout, TimeoutError, OSError) as exc:
                    _json_response(
                        self,
                        {"error": f"remote PDF fetch failed: {exc}"},
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
                    _json_response(
                        self,
                        {"error": f"PDF path must be inside configured root: {resolved_pdf_root}"},
                        status=HTTPStatus.FORBIDDEN,
                    )
                    return
                if not file_path.exists() or not file_path.is_file():
                    _text_response(self, f"PDF not found: {file_path}", HTTPStatus.NOT_FOUND)
                    return
                content = file_path.read_bytes()
                content_type = "application/pdf"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
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
    args = build_parser().parse_args()
    service = AgentPdfWorkbenchService(db_path=args.db_path)
    server = ThreadingHTTPServer(
        (args.host, args.port),
        _create_handler(service, allow_remote_pdf=args.allow_remote_pdf, pdf_root=args.pdf_root),
    )
    print(f"agent-pdf-workbench viewer server running on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
