from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from .service import AgentPdfWorkbenchService
from .store import SCHEMA_VERSION


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="apw-dev")
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path(".apw/events.db"),
        help="Path to local SQLite file.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # ── paper session lifecycle ────────────────────────────────────────────────
    open_parser = subparsers.add_parser("open-paper", help="Create a new paper reading session.")
    open_parser.add_argument("--paper-ref", required=True)
    open_parser.add_argument("--pdf-uri", required=True)
    open_parser.add_argument("--agent-id", default="agent:codex")
    open_parser.add_argument("--user-id", default="user:local")
    open_parser.set_defaults(handler=handle_open_paper)

    record_parser = subparsers.add_parser("record-action", help="Append one action event.")
    record_parser.add_argument("--session-id", required=True)
    record_parser.add_argument("--event-type", required=True)
    record_parser.add_argument("--page", type=int)
    record_parser.add_argument("--selection-text")
    record_parser.add_argument("--payload-json", default="{}")
    record_parser.add_argument("--source", default="viewer")
    record_parser.set_defaults(handler=handle_record_action)

    list_parser = subparsers.add_parser("list-actions", help="List action events for a session.")
    list_parser.add_argument("--session-id", required=True)
    list_parser.add_argument("--after-id", type=int)
    list_parser.add_argument("--limit", type=int, default=100)
    list_parser.set_defaults(handler=handle_list_actions)

    sessions_parser = subparsers.add_parser(
        "list-sessions",
        help="List reading sessions newest-first (use --open-only to find an active one).",
    )
    sessions_parser.add_argument("--paper-ref")
    sessions_parser.add_argument("--open-only", action="store_true")
    sessions_parser.add_argument("--limit", type=int, default=100)
    sessions_parser.add_argument("--offset", type=int, default=0)
    sessions_parser.set_defaults(handler=handle_list_sessions)

    close_parser = subparsers.add_parser("close-paper", help="Close a paper reading session.")
    close_parser.add_argument("--session-id", required=True)
    close_parser.set_defaults(handler=handle_close_paper)

    # ── backup / durability ────────────────────────────────────────────────────
    backup_parser = subparsers.add_parser(
        "backup",
        help="Create an online SQLite backup of the workspace database.",
    )
    backup_parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Destination path for the backup file (e.g. backup/events-2026-03-21.db).",
    )
    backup_parser.set_defaults(handler=handle_backup)

    checkpoint_parser = subparsers.add_parser(
        "checkpoint",
        help="Force a WAL checkpoint to compact the database.",
    )
    checkpoint_parser.set_defaults(handler=handle_checkpoint)

    # ── export ─────────────────────────────────────────────────────────────────
    export_parser = subparsers.add_parser(
        "export",
        help="Export all workspace data to a JSON file for offline analysis or backup.",
    )
    export_parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output path (default: stdout).",
    )
    export_parser.set_defaults(handler=handle_export)

    # ── diagnostics ────────────────────────────────────────────────────────────
    subparsers.add_parser(
        "diagnostics",
        help="Check environment and report Python, Node, Playwright, DB, and asset status.",
    ).set_defaults(handler=handle_diagnostics)

    return parser


def _service(args: argparse.Namespace) -> AgentPdfWorkbenchService:
    return AgentPdfWorkbenchService(db_path=args.db_path)


def handle_open_paper(args: argparse.Namespace) -> int:
    payload = _service(args).open_paper(
        paper_ref=args.paper_ref,
        pdf_uri=args.pdf_uri,
        agent_id=args.agent_id,
        user_id=args.user_id,
    )
    print(json.dumps(payload, indent=2))
    return 0


def handle_record_action(args: argparse.Namespace) -> int:
    payload = _service(args).record_action(
        session_id=args.session_id,
        event_type=args.event_type,
        page=args.page,
        selection_text=args.selection_text,
        payload=json.loads(args.payload_json),
        source=args.source,
    )
    print(json.dumps(payload, indent=2))
    return 0


def handle_list_sessions(args: argparse.Namespace) -> int:
    payload = _service(args).list_sessions(
        paper_ref=args.paper_ref,
        open_only=args.open_only,
        limit=args.limit,
        offset=args.offset,
    )
    print(json.dumps(payload, indent=2))
    return 0


def handle_list_actions(args: argparse.Namespace) -> int:
    payload = _service(args).list_actions(
        session_id=args.session_id,
        after_id=args.after_id,
        limit=args.limit,
    )
    print(json.dumps(payload, indent=2))
    return 0


def handle_close_paper(args: argparse.Namespace) -> int:
    payload = _service(args).close_paper(session_id=args.session_id)
    print(json.dumps(payload, indent=2))
    return 0


def handle_backup(args: argparse.Namespace) -> int:
    payload = _service(args).backup(target_path=args.output)
    print(json.dumps(payload, indent=2))
    return 0


def handle_checkpoint(args: argparse.Namespace) -> int:
    payload = _service(args).checkpoint()
    print(json.dumps(payload, indent=2))
    return 0


def handle_export(args: argparse.Namespace) -> int:
    payload = _service(args).export_workspace()
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.output is None:
        print(text)
    else:
        args.output.write_text(text, encoding="utf-8")
        print(f"Exported {payload['session_count']} session(s) to {args.output}", file=sys.stderr)
    return 0


def handle_diagnostics(args: argparse.Namespace) -> int:
    results: list[dict] = []

    def _check(name: str, ok: bool, detail: str) -> None:
        status = "ok" if ok else "fail"
        results.append({"check": name, "status": status, "detail": detail})
        icon = "✓" if ok else "✗"
        print(f"  {icon} {name}: {detail}")

    print("agent-pdf-workbench diagnostics")
    print("=" * 40)

    # Python version
    import sys as _sys
    py_ver = _sys.version_info
    py_ok = py_ver >= (3, 10)
    _check("python_version", py_ok, f"{py_ver.major}.{py_ver.minor}.{py_ver.micro} (need >=3.10)")

    # Node / npm
    node_path = shutil.which("node")
    npm_path = shutil.which("npm")
    _check("node", node_path is not None, node_path or "not found")
    _check("npm", npm_path is not None, npm_path or "not found")

    # Playwright browser and native browser dependencies
    playwright_ok = False
    playwright_detail = "not checked (npm not available)"
    if node_path and npm_path:
        try:
            result = subprocess.run(
                [
                    "node",
                    "-e",
                    (
                        "const { chromium } = require('@playwright/test');"
                        "const t=setTimeout(()=>{console.error('chromium launch timed out'); process.exit(1);},15000);"
                        "(async()=>{const b=await chromium.launch({headless:true, timeout:10000});"
                        "await b.close(); clearTimeout(t);})()"
                        ".catch((e)=>{console.error(e && e.message ? e.message : e); process.exit(1);});"
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            playwright_ok = result.returncode == 0
            if playwright_ok:
                playwright_detail = "chromium launches successfully"
            else:
                detail = (result.stderr or result.stdout).strip().splitlines()
                first_line = next(
                    (line for line in detail if "error while loading shared libraries" in line),
                    detail[0] if detail else "chromium launch failed",
                )
                playwright_detail = (
                    f"{first_line} (run: npx playwright install --with-deps chromium)"
                )
        except subprocess.TimeoutExpired:
            playwright_detail = "chromium launch check timed out (run: npx playwright install --with-deps chromium)"
        except Exception as exc:
            playwright_detail = f"check failed: {exc}"
    _check("playwright_chromium", playwright_ok, playwright_detail)

    # Database
    db_exists = args.db_path.exists()
    db_detail = str(args.db_path.resolve())
    if db_exists:
        try:
            svc = _service(args)
            schema_ver = svc._store.get_schema_version()
            db_detail = f"{db_detail} (schema v{schema_ver}, expected v{SCHEMA_VERSION})"
            db_ok = schema_ver == SCHEMA_VERSION
        except Exception as exc:
            db_ok = False
            db_detail = f"{db_detail} — error: {exc}"
    else:
        db_ok = True  # Not existing yet is fine (will be created on first run)
        db_detail = f"{db_detail} (not yet created)"
    _check("database", db_ok, db_detail)

    # Web assets
    from .viewer_server import WEB_DIR
    index_html = WEB_DIR / "index.html"
    assets_ok = index_html.is_file()
    _check(
        "web_assets",
        assets_ok,
        str(WEB_DIR) + (" (index.html present)" if assets_ok else " (missing — run: npm run build)"),
    )

    print("=" * 40)
    all_ok = all(r["status"] == "ok" for r in results)
    print("All checks passed." if all_ok else "Some checks failed. See above.")
    return 0 if all_ok else 1


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
