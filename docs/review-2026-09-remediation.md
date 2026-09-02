# September 2026 Review — Findings and Remediation

Reviewed at commit `611a4cf`; remediation applied in the working tree that
follows it.

The review ran every quality gate rather than reading them off the README. All
passed except `npm run format:check`, which was failing on 15 files because
neither `verify` nor CI ran it. The problems worth fixing were a level above the
code: two of them broke the promises in the first paragraph of the README.

## Findings and fixes

### 1. Reopening a paper lost every highlight and note (blocking)

Annotations and notes were keyed by `session_id`, but the viewer creates a new
session on every open — including "Load" from Recent Papers. Reproduced against
a live server: annotate in session 1, close, reopen the same `paper_ref`, and
`GET /api/annotations` returned `count: 0`. The rows stayed in SQLite, orphaned
under a session id nothing would query again.

**Fix.** Schema migration 2 re-keys `annotations` and `notes` to `paper_ref`,
carrying `session_id` as last-writer provenance. Rows are merged per paper with
the newest `updated_at` winning. Sessions remain the grain of the action event
log — that is genuinely per-session — while reading output belongs to the paper.
`export_workspace()` is now paper-centric for the same reason.

Covered by `PaperScopedStateTest`, `SchemaMigrationTest` (builds a v1 database
and upgrades it), an HTTP test, and an E2E test that annotates, closes, reopens
and expects the highlight to still be listed.

### 2. An agent could open a session the viewer could never join (blocking)

`openPaperWithInputs()` always POSTed `/api/open-paper`; there was no
`?session_id=` deep link, no `GET /api/sessions`, and no `list_sessions` MCP
tool. The agent skill told the user to "set the same paper_ref/pdf_uri in UI",
which creates a second session — so the agent watched an empty event stream.

**Fix.**

- `GET /api/sessions` (filterable by `paper_ref`, `open_only`) and
  `GET /api/session`, plus `list_sessions` / `get_session` MCP tools and an
  `apw-dev list-sessions` command.
- The viewer reads `?session_id=` (attach) and `?pdf_uri=`/`?paper_ref=` (open),
  and keeps `session_id` in the address bar so a reload rejoins the session.
- `SKILL.md` now tells agents to hand over a `?session_id=` link and to find an
  open session rather than asking the user to retype anything.

### 3. The local API trusted any web page the user had open (high)

The threat model claimed same-origin policy covered this. It does not: SOP stops
another site reading responses, not sending requests, and an unchecked `Host`
header makes DNS rebinding work. Verified against a running server — a
`text/plain` POST with `Origin: https://evil.example` was accepted (201),
`Host: evil.example` was served, and `/api/pdf?uri=/etc/passwd` returned file
bytes with `--pdf-root` unset.

**Fix.** Three guards in `viewer_server.py`: loopback-only `Host`, same-origin
(or absent) `Origin`, and `Content-Type: application/json` on POST. Blocked
requests are audit-logged as `blocked_request`. Running without `--pdf-root` now
prints a startup warning, and `playwright.config.ts` passes one so the shipped
config demonstrates the recommended posture. `docs/security-local.md` states the
correction rather than quietly replacing the wrong row.

The default remains unrestricted rather than `~/Papers`: a default pointing at a
directory most users do not have would fail closed on first run. The warning
plus the guards carry that weight.

### 4. The most correctness-sensitive code had no tests (high)

Five frontend unit tests existed and two of them exercised `createEventListItem`,
which nothing had called since the React migration. `annotation-helpers.ts` (346
lines of anchoring logic), `main-parsers.ts`, and `mcp_server.py` — the entire
agent-facing surface — had none.

**Fix.** Python tests went from 67 to 94, frontend unit tests from 5 to 42,
E2E from 5 to 8. New coverage: anchor resolution and drift recovery, prefix and
suffix disambiguation, annotation layer rendering and its rect fallback, payload
parsers, MCP tool registration and a full workflow through `call_tool`, the
browser attack surface, and session discovery. CI installs the `mcp` extra so
those tests run instead of skipping.

### 5. The React split had stopped halfway (medium)

`App.tsx` was 1,120 lines with ~40 functions in the component body;
`usePaperSession`, `usePdfReader`, `usePdfSearch` from the previous plan were
never extracted. Close to 300 lines of pre-React DOM renderers were dead.

**Fix.** `usePdfReader` (document, rendering, caches, zoom, outline, navigation)
and `usePdfSearch` (query, results, hit navigation) are extracted; `App.tsx` is
867 lines of session, annotation, note and export orchestration. The dead
renderers are gone, `list-renderers.ts` became `ui/search-highlight.ts` — the one
function that had callers — and `eslint-plugin-react-hooks` now enforces
`rules-of-hooks` and `exhaustive-deps`, with the four real violations fixed
rather than suppressed. The unmount cleanup that App and `usePageCache`
duplicated now lives only in the hook.

### 6. Concurrent renders could pair the wrong canvas with the wrong text layer (medium)

`renderPage()` is reachable from nine controls and only the wheel handler
guarded re-entry. Two overlapping calls could leave page N on the canvas with
page M's `data-start`/`data-end` offsets underneath — a wrong-page `copy` event,
or an annotation anchored to text that is not shown.

**Fix.** Every render takes a token; a newer render retires an older one at each
await boundary, and the in-flight pdf.js `TextLayer` is cancelled.

### 7. Housekeeping (low)

- `format:check` and a new `lint:python` (ruff) are part of `check:frontend` /
  `check:backend`, so `npm run verify` and CI both enforce them. The 15
  unformatted files are formatted and ruff is clean.
- Annotation and note listings order by id instead of `updated_at DESC`, so
  paging cannot skip or repeat a row that is edited mid-scan. Clients sort for
  display; each record still carries `updatedAt`.
- Validation errors carry their field explicitly (`FieldValidationError`) instead
  of having `details.field` parsed back out of the message text.
- `data/rks.sqlite3` (324 KB, empty, unreferenced) removed and `data/` ignored.
- Reading progress is keyed from a ref written when the paper opens, so loading
  a recent paper no longer saves progress under whatever `paper_ref` happened to
  be in the input box.
- MIT `LICENSE` added.

## Gate results after remediation

| Gate | Before | After |
|---|---|---|
| Python tests | 67 pass | 94 pass |
| Frontend unit tests | 5 pass (2 on dead code) | 42 pass |
| Playwright E2E | 5 pass | 8 pass |
| `ruff check src tests` | not run | clean |
| `npm run format:check` | 15 files failing | clean |
| `npm audit --omit=dev` | 0 | 0 |
| `npm audit` (incl. dev chain) | 17 advisories | 0 |

## Follow-up: the two items originally deferred

### Session lifecycle

The first pass stopped short of `usePaperSession` on the grounds that the
coupling would only move. Re-reading the code showed the real problem was not
the missing hook but the duplication between `openPaperWithInputs` and
`attachToSession`, which had already diverged: attach did not clear search
state, and did not close the session the viewer was holding. Neither divergence
was reachable yet — attach only ran at mount, with empty state — but both would
have become bugs the moment attach was wired to a control, which session
discovery makes an obvious next step.

The fix went in three steps, each of which made the next one cheaper:

1. **One shared tail.** `enterSession()` now performs everything both entry
   paths need — identity, clear search, clear workspace, restore zoom and page,
   open the document, load the workspace, update recents, update the URL. Open
   and attach differ only in how they obtain the session and what they do on
   failure.
2. **Coarser subsystem APIs.** `usePdfReader` gained `openDocument()` and kept
   `resetReader()`; `useWorkspaceData` gained `loadFor()` and absorbed
   `recordAction()`, which writes into the event stream it already owns. The
   session flow now drives three verbs instead of fifteen setters, so the
   coupling shrank rather than moved.
3. **Progress no longer reads ambient state.** `openDocument()` takes the
   paper identity and hands it back through `onProgress`, so reading progress
   describes the document that was actually rendered. This removed the last
   two-way dependency (session identity ⇄ reader) and made the hook extraction
   one-directional.

`useWorkspaceCommands` was extracted first as the higher-yield, lower-risk cut:
the annotation and note commands plus the form fields they own, with nothing
depending on them. `usePaperSession` followed once the cycle was gone.

`App.tsx` is now 496 lines of composition, JSX, and small UI handlers, down from
1,120 at the start of the review. The behaviour is unchanged: the same E2E suite
passes, plus a new test asserting that opening a second paper clears the first
one's search results.

### Dependency majors

The blocker for the only upgrade with runtime risk was not the version bump. The
project hand-declared `pdfjs-dist/build/pdf.mjs` in `frontend/src/types/`, so
`tsc` validated the app against its own description of pdf.js. pdfjs-dist ships
real declarations, but nothing resolved them for that import specifier.

`frontend/src/types/pdfjs-types.ts` now re-exports the shipped declarations and
a tsconfig `paths` entry maps the runtime specifier onto them; the hand-written
stub and the `PdfDocumentLike` / `PdfPageLike` / `PdfViewportLike` stand-ins are
gone. The compiler caught three real breaks that would otherwise have shipped:

- v5 requires `canvas` in `RenderParameters` alongside `canvasContext`.
- v6 takes `DocumentInitParameters`, not a bare URL string.
- v6 moved `PageViewport` to its own module.

An E2E test now asserts the text layer's `data-start` / `data-end` offsets are
contiguous, because a pdf.js change that stops populating them breaks highlight
placement without breaking anything visible.

Upgrades taken: eslint 10, `@eslint/js` 10, globals 17, jsdom 29, vitest 4,
Vite 8, vite-plugin-pwa 1.3, TypeScript 6, pdfjs-dist 6, plus the remaining
minors. `npm audit` reports zero advisories. Two upgrades are blocked by other
people's packages rather than by this project:

| Blocked | Reason |
|---|---|
| `@vitejs/plugin-react` 6 | requires `@babel/core` 8; `vite-plugin-pwa` → `workbox-build` 7.4 pins `@babel/core` 7. Version 5.2 already supports Vite 8, so nothing is lost by waiting. |
| TypeScript 7 | `@typescript-eslint` 8.69 declares `typescript <6.1.0` and crashes on load against the native compiler. TypeScript 6.0.3 is the current ceiling. |

CI moves to Node 22 and `package.json` records the engine floor
(`^20.19.0 || ^22.13.0 || >=24`), since Vite 8 and eslint 10 both require more
than the Node 20.0 the workflow previously pinned.

Vitest 4 also surfaced a latent cost: every test file was loading jsdom, and its
worker startup began timing out. Only two suites touch the DOM, so the default
environment is now `node` and those two opt in with a `@vitest-environment`
docblock.
