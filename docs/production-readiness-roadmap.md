# Agent PDF Workbench Production Readiness Roadmap (Local-Only)

This roadmap defines the work needed to make the app production-ready for local usage on one machine (`127.0.0.1`), not for hosted multi-user deployment.

## Scope and Constraints

- Single user, local workstation usage.
- Local HTTP server only (`127.0.0.1` binding).
- SQLite as the system of record.
- No remote auth, tenancy, cloud infra, or internet-facing hardening in this phase.

## Exit Criteria for Local Production Readiness

- Reproducible install and launch on macOS/Linux/Windows (WSL acceptable for Windows path).
- Deterministic test gate with green backend/unit/E2E in CI and local runner.
- Safe defaults for local file access and remote PDF behavior.
- Clear upgrade, backup/restore, and rollback path for SQLite data.
- Actionable logs and troubleshooting docs for common failures.

## Phase 0: Stabilize Core Runtime

- [x] Add explicit DB schema versioning and migrations (with forward-only migration runner).
- [x] Add startup integrity checks for DB schema and web asset presence.
- [x] Enforce strict request validation for all API payloads (field type, bounds, required keys).
- [x] Standardize API error response format across endpoints (`error`, `code`, `details`).
- [x] Add graceful shutdown handling to flush pending writes and close DB cleanly.
- [x] Add config validation at startup for `APW_*` env vars and CLI flags.

## Phase 1: Local Security Hardening

- [x] Keep default host binding to `127.0.0.1`; add explicit warning when non-local bind is requested.
- [x] Enable `--pdf-root` guidance and recommend it in docs as default production local mode.
- [x] Add max request body size limits for POST endpoints.
- [x] Add stricter PDF URI normalization and error handling for invalid/malformed paths.
- [x] Add response headers for safer local browser behavior (`X-Content-Type-Options`, etc.).
- [x] Add audit events for security-relevant actions (open/close session, delete annotation/note).

## Phase 2: Reliability and Data Durability

- [x] Define SQLite pragmas for durability/perf balance in local mode (`WAL`, `synchronous`).
- [x] Add periodic checkpoint/compaction guidance and command(s).
- [x] Add crash recovery and DB corruption detection playbook.
- [x] Add export/import command for full workspace backup and restore validation.
- [x] Add idempotency behavior for upsert/delete APIs and test edge cases.
- [x] Add load test for long reading sessions (large event counts, many annotations/notes).

## Phase 3: Test and Quality Gates

- [x] Split tests into deterministic tiers (`unit`, `integration`, `e2e`) with clear ownership.
- [x] Ensure `npm run verify` passes in a clean environment including browser prerequisites.
- [x] Add CI workflow that runs Python tests, frontend checks, and Playwright E2E.
- [x] Add smoke test for packaged/built assets served from `src/agent_pdf_workbench/web`.
- [x] Add regression tests for session close semantics and state reset in UI.
- [x] Add fuzz-style input tests for API JSON payload validation.

## Phase 4: Packaging and Release Operations

- [x] Add pinned dependency strategy and documented update cadence.
- [x] Define versioning/release policy (`0.x` cadence, compatibility guarantees).
- [x] Provide one-command local install/bootstrap script.
- [x] Provide local service runner docs (foreground, background, restart behavior).
- [x] Add release checklist: build assets, run gates, tag, publish notes.
- [x] Add rollback instructions for previous app version and DB compatibility expectations.

## Phase 5: Observability and Supportability

- [x] Add structured logs with consistent fields (`timestamp`, `level`, `event`, `session_id`).
- [x] Add log verbosity levels and redaction policy for potentially sensitive text content.
- [x] Add `/api/health` expansion with version/build metadata.
- [x] Add optional diagnostics command for environment validation (Python/node/browser checks).
- [x] Add troubleshooting guide for common failures (port in use, missing browser, bad PDF path).
- [x] Add “known limitations” section for local-only mode.

## Documentation Deliverables

- [x] Update `README.md` with local production profile and recommended startup flags.
- [x] Add `docs/operations-local.md` (runbook, backup, restore, upgrade, rollback).
- [x] Add `docs/security-local.md` (threat model and mitigations for local usage).
- [x] Add `docs/release-checklist.md` (pre-release and post-release checks).

## Suggested Implementation Order

1. Phase 0 (runtime stability) and key tasks from Phase 1 (host binding, request size limits).
2. Phase 2 durability work (backup/restore + SQLite operational defaults).
3. Phase 3 CI and deterministic test gates.
4. Phase 4 packaging/release process.
5. Phase 5 observability and support docs.

## Non-Goals for This Roadmap

- Multi-user account system.
- Internet-exposed server deployment.
- Cloud database or distributed sync.
- Real-time collaboration/presence.
