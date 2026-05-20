# Agent PDF Workbench Evaluation Remediation Plan

Created: 2026-05-19

This plan turns the May 2026 project evaluation findings into concrete engineering
work. It is narrower than `future-development-plan.md`: the goal is to resolve
known quality, reliability, and maintainability issues before adding larger
product features.

## Baseline

Current evaluation result:

- `npm run verify` passes locally.
- `npm audit --omit=dev` reports zero production dependency vulnerabilities.
- CI covers Python 3.10-3.12, frontend checks, build, and Playwright E2E.
- The project is suitable for local single-user usage, but several issues should
  be fixed before treating it as a durable research workspace.

## Goals

1. Prevent silent data loss or incomplete exports in long reading sessions.
2. Enforce backend data contracts for annotations, notes, and events.
3. Reduce frontend coupling so future reader/workspace changes stay safe.
4. Keep verification output clean and actionable.
5. Improve browser payload size and agent-facing capabilities.

## Non-Goals

- Hosted or internet-facing deployment.
- Multi-user authentication, authorization, or collaboration.
- Cloud sync.
- Replacing SQLite or the local Python HTTP server.

## Priority Summary

| Priority | Workstream | Outcome |
|---|---|---|
| P0 | Data completeness | Exports and UI listing do not silently truncate session data. |
| P0 | Backend contracts | Malformed annotation/note/event payloads are rejected before storage. |
| P1 | Frontend maintainability | `App.tsx` orchestration is split into testable hooks/modules. |
| P1 | Verification quality | Expected browser disconnects no longer pollute E2E logs. |
| P2 | Bundle performance | Main app bundle is reduced or the warning is intentionally budgeted. |
| P2 | MCP capability | Agents can operate annotations, notes, and workspace exports directly. |

## Phase 1: Fix Data Completeness

Problem:

- `AgentPdfWorkbenchService.export_workspace()` requests at most
  `MAX_LIST_LIMIT` rows per session.
- The frontend also loads events, annotations, and notes with `limit=1000`.
- Long sessions can therefore be partially exported or displayed without a clear
  warning.

Tasks:

- Add paginated store/service APIs for events, annotations, and notes.
- Update workspace export to iterate until all rows are included.
- Add response metadata for list endpoints, such as `has_more` and
  `next_after_id` or equivalent cursor fields.
- Update frontend refresh paths to either paginate or explicitly show that only
  the latest/current page of records is loaded.
- Add tests with more than `MAX_LIST_LIMIT` events and records.

Acceptance criteria:

- Export includes every event, annotation, and note in a session.
- API callers can detect whether additional rows exist.
- Frontend behavior is explicit for large histories.
- Python integration tests fail if export truncates data.

Verification:

```bash
npm run test:python
npm run verify
```

## Phase 2: Enforce Backend Data Contracts

Problem:

- The HTTP layer currently checks that annotation and note payloads are objects,
  while the store mostly checks only `id`.
- Invalid payloads can be persisted and later ignored by frontend parsers.

Tasks:

- Define canonical schemas for:
  - action events
  - annotations
  - text anchors
  - normalized rectangles
  - notes
- Validate required fields and types before writing to SQLite.
- Validate numeric bounds, including page numbers, rectangle dimensions, and text
  anchor offsets.
- Return consistent `VALIDATION_ERROR` responses with field-level details.
- Add tests for invalid and boundary payloads at both store and HTTP layers.
- Document the API contracts in `README.md` or a dedicated API contract doc.

Acceptance criteria:

- Invalid annotations and notes cannot enter the database.
- Error responses identify the invalid field.
- Existing valid UI and E2E workflows continue to pass.
- Frontend parser fallback behavior remains defensive, but is no longer the
  primary protection against malformed stored data.

Verification:

```bash
npm run test:python:unit
npm run test:python:integration
npm run test:e2e
```

## Phase 3: Split Frontend Orchestration

Problem:

- `frontend/src/app/App.tsx` owns session lifecycle, PDF rendering, page cache,
  search, annotations, notes, event sync, exports, and UI composition.
- The file is working, but the coupling increases regression risk as features
  are added.

Tasks:

- Extract session lifecycle into `usePaperSession`.
- Extract PDF rendering and page cache into `usePdfReader`.
- Extract search state and page-text lookup into `usePdfSearch`.
- Extract annotations/notes/event refresh into `useWorkspaceData`.
- Keep `App.tsx` as composition and cross-workflow coordination.
- Add focused unit tests around extracted pure helpers and hook-level behavior
  where practical.

Acceptance criteria:

- `App.tsx` is substantially smaller and mostly declarative.
- PDF rendering, workspace data sync, and session lifecycle can be reasoned
  about independently.
- Existing Playwright tests pass unchanged or with only selector-stability
  adjustments.

Verification:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e
```

## Phase 4: Clean Verification Logs

Problem:

- Playwright passes, but server teardown can print `BrokenPipeError` when the
  browser disconnects during a static response.
- This makes real server failures harder to spot in CI logs.

Tasks:

- Catch `BrokenPipeError` and `ConnectionResetError` around static/PDF response
  writes.
- Keep unexpected exceptions visible.
- Add a small integration test or manual regression note for disconnected
  clients if practical.

Acceptance criteria:

- E2E test logs are free of expected client-disconnect tracebacks.
- Real HTTP handler exceptions still fail tests or remain visible.

Verification:

```bash
npm run test:e2e
```

## Phase 5: Improve Bundle and Load Performance

Problem:

- The production build emits a Vite warning because the main app bundle is above
  the default 500 kB chunk threshold.
- PDF.js is expected to be large, but the app bundle should have an explicit
  budget.

Tasks:

- Measure current bundle contents with a build analyzer.
- Split PDF-heavy code from the initial app shell if it materially improves
  startup.
- Consider lazy-loading export and reader-specific paths.
- Add a documented bundle budget or explicitly configure the warning threshold
  with rationale.

Acceptance criteria:

- Either the warning is eliminated through useful code splitting, or a documented
  bundle budget explains why the current size is acceptable.
- Startup and reader load behavior do not regress.

Verification:

```bash
npm run build:frontend
npm run test:e2e
```

## Phase 6: Expand Agent-Facing MCP Tools

Problem:

- The MCP server currently exposes session/event operations only.
- Agents cannot directly create, list, update, or delete annotations and notes
  through the MCP surface.

Tasks:

- Add MCP tools for annotation CRUD.
- Add MCP tools for note CRUD.
- Add workspace export through MCP.
- Add filtered listing support for page, tag, and time-window retrieval if the
  store API supports it.
- Document MCP examples in `README.md` or a dedicated MCP doc.

Acceptance criteria:

- An agent can complete a full paper-reading workflow through MCP without
  fallback HTTP calls.
- MCP tool behavior matches HTTP/service-layer contracts.
- Optional MCP dependency remains optional for non-MCP users.

Verification:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py'
```

## Cross-Cutting Requirements

- Every behavior change includes tests at the lowest useful layer.
- API contract changes update docs and examples.
- SQLite schema changes use forward-only migrations and mention rollback
  expectations in release notes.
- Long-session behavior should be tested with more than 1000 events and at least
  200 annotations.
- The full gate must pass before considering a phase complete:

```bash
npm run verify
npm audit --omit=dev
```

## Suggested Execution Order

1. Complete Phase 1 before any work that depends on export/list correctness.
2. Complete Phase 2 before expanding MCP, so every interface shares the same
   contract.
3. Do Phase 3 after data and contract fixes, keeping refactors behavior-neutral.
4. Do Phase 4 opportunistically; it is small and improves CI signal.
5. Do Phase 5 after the frontend split, when code-splitting boundaries are
   clearer.
6. Do Phase 6 last, using the hardened service API as the source of truth.

## Tracking Checklist

- [x] Phase 1: Data completeness fixed and tested.
- [x] Phase 2: Backend data contracts enforced and documented.
- [x] Phase 3: Frontend orchestration split into focused hooks/modules.
- [x] Phase 4: Expected disconnect tracebacks removed from E2E logs.
- [x] Phase 5: Bundle warning resolved or explicitly budgeted.
- [x] Phase 6: MCP annotation/note/export tools added and documented.
