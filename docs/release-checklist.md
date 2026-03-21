# Release Checklist

This checklist covers the steps to cut a new release of agent-pdf-workbench.

## Versioning Policy

- Versions follow `0.MINOR.PATCH` while the project is in pre-1.0 development.
- A MINOR bump (`0.2.0 → 0.3.0`) indicates new features or breaking API changes.
- A PATCH bump (`0.2.0 → 0.2.1`) indicates bug fixes only.
- Schema migrations always increment `SCHEMA_VERSION` in `store.py` and are forward-only.
  A MINOR bump is required whenever a new migration is added.
- Python and Node dependency updates that change behaviour count as a MINOR bump.

## Pre-release Checks

1. **Update version in two places:**
   - `pyproject.toml` → `version = "X.Y.Z"`
   - `package.json` → `"version": "X.Y.Z"`
   - Ensure both match exactly.

2. **Run full test suite locally:**
   ```bash
   bash bootstrap.sh
   PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -v
   npm run verify
   npm run test:e2e
   ```
   All tests must pass.

3. **Check CI is green** on the main branch.

4. **Build and inspect frontend assets:**
   ```bash
   npm run build:frontend
   ls -lh src/agent_pdf_workbench/web/
   ```
   Verify `index.html`, `app.js`, `styles.css` are present and sizes look reasonable.

5. **Run diagnostics against a fresh data directory:**
   ```bash
   PYTHONPATH=src python3 -m agent_pdf_workbench.dev_cli \
     --db-path /tmp/apw-release-check/events.db diagnostics
   ```
   All checks must report `ok`.

6. **Verify health endpoint metadata:**
   ```bash
   # Start the server in background, then:
   curl -s http://127.0.0.1:8790/api/health | python3 -m json.tool
   ```
   Check `version`, `schema_version`, and `web_assets_present` are correct.

7. **Verify database schema is up-to-date:**
   ```bash
   PYTHONPATH=src python3 -c "
   from pathlib import Path
   from agent_pdf_workbench.store import EventStore, SCHEMA_VERSION
   s = EventStore(Path('/tmp/apw-release-check/events.db'))
   assert s.get_schema_version() == SCHEMA_VERSION, 'Schema mismatch!'
   print(f'Schema OK at version {SCHEMA_VERSION}')
   "
   ```

8. **Check SCHEMA_VERSION comment** in `store.py` is up to date.

9. **Review `docs/operations-local.md`** for any outdated procedures.

## Cutting the Release

1. Commit the version bump:
   ```bash
   git add pyproject.toml package.json package-lock.json
   git commit -m "chore: bump version to X.Y.Z"
   ```

2. Tag the release:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main --tags
   ```

3. Publish release notes on GitHub with:
   - Summary of changes
   - Schema version (if changed)
   - DB compatibility note (see rollback section in `docs/operations-local.md`)

## Post-release

- Verify the CI run on the tagged commit passes.
- Update `docs/operations-local.md` if upgrade steps changed.
- Announce in the project's communication channel if applicable.

## Rollback Instructions

See `docs/operations-local.md` → "Rollback" for the full procedure.

**Short version:**
1. Stop the server.
2. Restore the DB backup taken before the upgrade.
3. Reinstall the previous app version.
4. Start the server.

**Never** attempt to roll back a DB that has had forward migrations applied — it will
result in schema version mismatch errors.  Always restore from a backup instead.
