from __future__ import annotations

import argparse
import json
from pathlib import Path

from .service import AgentPdfWorkbenchService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="apw-dev")
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path(".apw/events.db"),
        help="Path to local SQLite file.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

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

    close_parser = subparsers.add_parser("close-paper", help="Close a paper reading session.")
    close_parser.add_argument("--session-id", required=True)
    close_parser.set_defaults(handler=handle_close_paper)

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


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
