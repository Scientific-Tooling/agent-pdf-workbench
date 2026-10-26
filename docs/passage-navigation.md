# Reopen a cited source passage

The viewer accepts an exact passage link from an imported-evidence brief:

```text
/?session_id=ps_example&document_sha256=<PDF hash>&annotation_id=ann_example&page=2&passage_sha256=<passage hash>
```

All five fields are required together. The PDF hash identifies the document
revision. The passage hash covers `{annotation_id, page, quote, anchor, rects}`
using the same canonical JSON/SHA-256 convention as the selected-evidence
contract. It deliberately excludes comments and tags: editing an interpretation
does not move its supporting passage. RKS separately preserves the complete
imported evidence revision and review status.

The viewer resolves the annotation in the session's paper scope, checks its page
and passage hash, fetches the PDF with byte verification, opens the explicit
page, and selects the annotation. Saved reading progress does not override a
citation page. The URL retains the passage identity for reloads. Changing papers
or closing the viewer clears citation parameters.

A closed reading session can still identify a citation. Opening that link starts
a new reading session for the same paper reference, PDF, and paper-scoped
annotation. Opening the viewer records normal reading telemetry; checking a
citation through the CLI/API is read-only.

## Read-only preflight

```bash
apw-dev --db-path /path/to/events.db resolve-passage --session-id ps_example --document-sha256 <PDF hash> --annotation-id ann_example --page 2 --passage-sha256 <passage hash>
```

The result is `apw.passage.v1`, with the resolved session and annotation. The CLI
opens an existing database read-only and never initializes/migrates it. The
server mirrors it at `GET /api/passage` with the five link parameters.

This checks database identity and the recorded passage revision. It does not
parse the PDF or check the file bytes. Structured Intelligence's brief generator
also verifies the local PDF; the viewer checks both PDF bytes and source text
when opening the link.

`GET /api/pdf?uri=<local path>&sha256=<PDF hash>` returns only bytes matching that
hash, while retaining the normal PDF-root and size restrictions. Citation loading
gives those exact bytes to PDF.js, so later range requests cannot read a replaced
file. Module scripts have explicit JavaScript MIME types, including on Windows.

## Missing and changed anchors

There is no automatic move to a different PDF, page, annotation, or repeated quote.

| Condition | Result and recovery |
| --- | --- |
| Incomplete/malformed link | Regenerate it from the imported evidence |
| Session missing from this database | Select the correct APW database or restore its backup |
| PDF reference/hash changed | Restore the exact reading snapshot |
| Annotation deleted | Restore the annotation backup; imported RKS evidence remains available |
| Page, quote, anchor, or rectangles edited | Inspect the imported revision, review a fresh export, and regenerate the brief |
| Page outside the PDF | Repair the recorded page; the viewer does not clamp it |
| Quote missing or ambiguous in page text | Repair the text anchor with an exact range or distinguishing context |

Text anchors use validated offsets when the quote matches. Otherwise, a unique
quote with matching available context is required. Whitespace can be normalized
without changing original text offsets. Missing quotes and equally plausible
repeated passages fail. PDF structure tags do not contribute phantom spaces to
the page text or shift annotation offsets.

The checks establish source identity and location. They do not establish that an
interpretation follows from a passage or that a scientific claim is correct.

## Validation

Python unit/API tests cover read-only resolution, closed sessions, missing/edited
annotations, the PDF transport hash, and static module MIME types. Frontend tests
cover link parsing and strict anchor resolution. Playwright's `passage.spec.ts`
uses a generated two-page PDF to check selection, reload, saved-position override,
closed-session reading, changed bytes, and invalid anchors.

Playwright uses portable Python invocation and temporary database paths. Set
`APW_E2E_PYTHON` to the intended Python executable and `APW_E2E_PORT` to an unused
port when running beside another viewer. On Windows, use the installed environment's
`Scripts/python.exe`. The repository LF rule matches Prettier across platforms.
