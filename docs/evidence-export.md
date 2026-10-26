# Export selected evidence to RKS

Use a session created by Structured Intelligence's source-reading workflow, with
an RKS paper reference containing the exact PDF SHA-256.

```bash
apw-dev --db-path /path/to/events.db export-evidence --session-id ps_example --source-id reading-workspace --annotation-id ann_example --note-id note_example > evidence.json
```

Repeat selection flags to select multiple objects. At least one is required.
The exporter opens the existing schema-2 database read-only, reads the selected
records in one transaction, and verifies the session's local PDF hash. It never
initializes or migrates a workspace. The stable `--source-id` names this APW
database; keep it through moves/backups and choose a new ID for an independent DB.

The `scientific-tooling.selected-evidence.v1` result preserves workspace/paper/PDF
identity, selected APW object IDs, original content, page/quote/anchor/rectangle
data, timestamps, last-writing session, and content and provenance revisions.
Notes embed their linked passages. Missing selected objects or linked annotations
fail explicitly. Unlinked notes have no passage anchor. Export does not infer
deletions from missing or unselected objects.

Every item is unreviewed by default. A viewer session, highlight, or note is not
proof of a scientific review. To record an actual completed human review, inspect
the source and exported content, then supply `--reviews reviews.json`:

```json
{
  "schema": "scientific-tooling.evidence-reviews.v1",
  "source_id": "reading-workspace",
  "paper_ref": "rks:review-a:p_000001:sha256:<exact PDF hash>",
  "reviews": {
    "annotation:ann_example": {
      "status": "reviewed",
      "method": "human",
      "reviewer": "<actual reviewer>",
      "reviewed_at": "<actual ISO 8601 timestamp with timezone>",
      "content_revision": "<content_revision from the inspected export>",
      "statement": "<what was checked and any limitations>"
    }
  }
}
```

This is a template, not an established review. The exporter rejects stale content
revisions, mismatched source identities, and reviews for unselected items. Review
provenance is caller asserted, not authenticated. It remains in the exported
artifact; this command does not write a review into APW's annotation database.
Keep the manifest to reproduce a reviewed export. Without it, a new export is
unreviewed and RKS will require explicit acceptance to replace a reviewed record.

RKS supports a read-only preview followed by a transactional apply:

```bash
rks note import-evidence evidence.json --workspace-id review-a > plan.json
rks note import-evidence evidence.json --workspace-id review-a --apply --plan plan.json
```

Inspect the bundle and plan before applying. A revision conflict returns exit 2
with a JSON report. RKS's `docs/evidence-import.md` defines the versioned contract,
revision acceptance, merge handling, and backup semantics. The Structured
Intelligence `workflows/research/evidence-import.md` workflow provides the complete
CLI orchestration. Nothing here establishes quote correctness or scientific validity.
