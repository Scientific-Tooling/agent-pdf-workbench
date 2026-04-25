# Agent PDF Workbench Future Development Plan (2026-2027)

This document defines the next development plan after the local production-readiness roadmap.

## Planning Scope

- Product: local-first PDF reading and annotation workspace with agent-facing event history.
- Deployment model: single-user local server by default.
- Time horizon: April 2026 to March 2027.
- Team model assumption: 1-3 active maintainers.

## Strategic Objectives

1. Make quality gates trustworthy and representative of real user paths.
2. Tighten API and data contracts so malformed data cannot enter the system.
3. Improve runtime scalability for long reading sessions and large PDFs.
4. Expand agent-facing capabilities beyond basic session/event APIs.
5. Keep release and maintenance cost low for a small team.

## Success Criteria (End of Plan)

- `npm run verify` and `npm run test:e2e` are stable and deterministic in local and CI environments.
- API input validation is strict for all endpoints, with consistent JSON error envelopes.
- Large-session usage (1000+ events, 200+ annotations, 50+ notes) remains responsive without unbounded memory growth.
- MCP surface includes first-class annotation and note workflows, not only session and event operations.
- Release process includes explicit performance and regression gates in addition to functional tests.

## Phase A: Immediate Hardening (Q2 2026)

### A1. Rebuild E2E as a Reliable Gate

- Align Playwright selectors with current React UI structure.
- Add explicit browser bootstrap (`npx playwright install chromium`) to setup docs and CI guard rails.
- Add one smoke test that validates the app shell and one full-flow test for open/search/annotate/note/export/close.

Acceptance criteria:

- E2E suite passes locally on a clean machine after documented setup.
- CI fails on real regressions, not selector drift.
- E2E tests run in less than 5 minutes on CI baseline hardware.

### A2. Enforce Strict API Validation

- Add central request validation helpers for `open-paper`, `record-action`, annotations, and notes payloads.
- Validate field types and bounds (for example: `page` integer and >= 1 when present).
- Return consistent `{"error","code","details"}` envelopes for all API errors, including `/api/pdf` local file errors.

Acceptance criteria:

- Invalid payload type tests added for all POST endpoints.
- No endpoint returns plain-text errors for API routes.
- Contract tests verify both status code and machine-readable error code.

### A3. Correct Search Highlight Path

- Ensure text layer spans expose the data needed by highlight logic.
- Add unit tests for search highlight mapping from result index to current span.

Acceptance criteria:

- Visible "current hit" marker always matches the active search result on the current page.
- Search highlight regression test added and passing.

### A4. Fix Frontend Cache Memory Lifecycle

- Dispose replaced/evicted `ImageBitmap` entries with `bitmap.close()`.
- Add cache size limits and eviction policy for pre-rendered pages.
- Add a cleanup path on session close and on component unmount.

Acceptance criteria:

- Memory usage plateaus during sustained page navigation and zoom cycles.
- No stale page bitmap remains after session reset.

## Phase B: Performance and UX Quality (Q3 2026)

### B1. Interaction Performance

- Debounce expensive refresh paths after write operations.
- Avoid duplicate timeline events for unchanged annotation metadata.
- Consider incremental event loading for large histories.

Acceptance criteria:

- Annotation/comment edits feel immediate without unnecessary timeline spam.
- Timeline and workspace panels remain responsive with 1000+ events.

### B2. Reader Experience Upgrades

- Add clear resume behavior from recent papers (open directly to saved page).
- Improve page-jump/search UX feedback when target is invalid or missing.
- Add empty/error state polish for PDF load failures.

Acceptance criteria:

- Resume flow is one click from "Recent Papers" to rendered document page.
- User-visible errors are actionable and consistent across workflows.

### B3. Test Coverage Expansion

- Add frontend tests for core app state transitions (open/close/reset/search/annotation update).
- Expand parser/normalizer tests for malformed annotation/note payloads.

Acceptance criteria:

- Core app logic has targeted unit coverage beyond `timeline.test.ts`.
- Regressions in session reset and search behavior are caught pre-merge.

## Phase C: Agent Capability Expansion (Q4 2026)

### C1. MCP Tooling Expansion

- Add MCP tools for annotation CRUD, note CRUD, and workspace export.
- Add list/filter operations (by session/page/tag/time window) for agent retrieval quality.

Acceptance criteria:

- Agents can complete full reading workflows through MCP without relying on ad hoc HTTP calls.
- MCP tool contracts are documented with examples.

### C2. Better Evidence Linking

- Improve anchor robustness with fallback heuristics and drift detection.
- Add explicit evidence links from notes back to annotations and source page locations.

Acceptance criteria:

- Annotation rendering remains stable after zoom/page rerender cycles.
- Notes retain reliable links to supporting annotations.

## Phase D: Productization Decisions (Q1 2027)

### D1. Decide Next Product Track

Evaluate and choose one primary direction:

1. Keep local-first single-user and optimize reliability/performance further.
2. Add optional multi-user sync/collaboration model.
3. Prioritize deeper research tooling integration (for example RKS-style paper graph workflows).

Acceptance criteria:

- Written decision record with rationale, constraints, and non-goals.
- Updated roadmap and architecture doc aligned to chosen direction.

## Cross-Phase Engineering Standards

- Every feature change includes tests at the most appropriate layer.
- API contract changes require docs updates in `README.md` and relevant `docs/*`.
- New migrations remain forward-only and include upgrade/rollback notes.
- Performance-sensitive changes include before/after measurements.

## Risks and Mitigations

- Risk: E2E brittleness returns after UI refactors.
  Mitigation: favor stable semantic selectors and require E2E updates in UI PR checklist.
- Risk: Feature expansion outpaces maintainers.
  Mitigation: keep phase scope strict and enforce exit criteria before starting next phase.
- Risk: Memory/performance regressions go unnoticed.
  Mitigation: add lightweight benchmark scenarios to pre-release checks.

## Suggested Execution Order

1. Complete all Phase A items before net-new feature expansion.
2. Execute Phase B in parallel tracks (performance + UX + tests) where ownership allows.
3. Start Phase C only after Phase B acceptance criteria are met.
4. Use Phase D to make an explicit strategic choice rather than mixing tracks.

