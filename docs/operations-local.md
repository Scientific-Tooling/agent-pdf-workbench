# Operations Runbook — Local Mode

This document covers day-to-day operations for running agent-pdf-workbench on a
single local workstation.

## Contents

- [Starting the server](#starting-the-server)
- [Backup](#backup)
- [Restore](#restore)
- [Upgrade](#upgrade)
- [Rollback](#rollback)
- [WAL checkpoint / compaction](#wal-checkpoint--compaction)
- [Crash recovery](#crash-recovery)
- [DB corruption detection](#db-corruption-detection)
- [Troubleshooting common failures](#troubleshooting-common-failures)
- [Known limitations](#known-limitations)

---

## Starting the server

### Recommended local production invocation

```bash
apw-viewer-server \
  --db-path ~/.apw/events.db \
  --pdf-root ~/Papers
```

- `--pdf-root` constrains the server to serve PDFs only from that directory,
  preventing accidental exposure of unrelated files.
- The server always binds to `127.0.0.1` by default.
- Use `APW_LOG_LEVEL=DEBUG` for verbose output during troubleshooting.

### Foreground (development)

```bash
PYTHONPATH=src python3 -m agent_pdf_workbench.viewer_server \
  --db-path /tmp/apw/events.db
```

### Background (persistent session)

Using `nohup`:
```bash
nohup apw-viewer-server \
  --db-path ~/.apw/events.db \
  --pdf-root ~/Papers \
  > ~/.apw/server.log 2>&1 &
echo $! > ~/.apw/server.pid
```

Stop it:
```bash
kill $(cat ~/.apw/server.pid) && rm ~/.apw/server.pid
```

Using `systemd` (Linux):
```ini
# ~/.config/systemd/user/apw.service
[Unit]
Description=Agent PDF Workbench viewer server

[Service]
ExecStart=apw-viewer-server --db-path %h/.apw/events.db --pdf-root %h/Papers
Restart=on-failure
Environment=APW_LOG_LEVEL=INFO

[Install]
WantedBy=default.target
```
```bash
systemctl --user enable --now apw.service
```

### Restart behaviour

The server is stateless between restarts — all data is persisted in SQLite.
Restart it freely.  In-flight HTTP requests at shutdown time will complete (the
server calls `server_close()` which waits for active threads).

---

## Backup

**Always back up before upgrading.**

### Online SQLite backup (recommended)

```bash
apw-dev --db-path ~/.apw/events.db backup \
  --output ~/.apw/backups/events-$(date +%F).db
```

This uses SQLite's online backup API — safe while the server is running.

### JSON export (human-readable)

```bash
apw-dev --db-path ~/.apw/events.db export \
  --output ~/.apw/backups/workspace-$(date +%F).json
```

Exports every paper with its annotations, notes, sessions, and events as a
single JSON file. The top level is `{"papers": [...], "paper_count", "session_count"}`;
each paper carries one annotation/note set and one entry per reading session.
Useful for offline analysis or archiving.

### Verify the backup

```bash
python3 -c "
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute('PRAGMA integrity_check').fetchone()
v = conn.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0]
print(f'Backup OK — schema version {v}')
conn.close()
" ~/.apw/backups/events-$(date +%F).db
```

---

## Restore

1. **Stop the server.**
2. **Copy the backup over the live DB:**
   ```bash
   cp ~/.apw/events.db ~/.apw/events.db.pre-restore  # safety copy
   cp ~/.apw/backups/events-YYYY-MM-DD.db ~/.apw/events.db
   ```
3. **Verify integrity:**
   ```bash
   apw-dev --db-path ~/.apw/events.db diagnostics
   ```
4. **Start the server.**

---

## Upgrade

1. **Back up the database** (see [Backup](#backup) above).
2. Pull the new code:
   ```bash
   git pull
   ```
3. Run bootstrap to update dependencies and rebuild assets:
   ```bash
   bash bootstrap.sh
   ```
4. Restart the server — schema migrations run automatically on first connection.
5. Verify with the health endpoint:
   ```bash
   curl -s http://127.0.0.1:8790/api/health | python3 -m json.tool
   ```
   Check `schema_version` matches the expected value.

---

## Rollback

Rollback is only safe if:
- You have a backup taken **before** the upgrade.
- The new schema version has not introduced data that the old code cannot read.

Steps:
1. Stop the server.
2. Restore the DB backup (see [Restore](#restore)).
3. Reinstall the previous app version:
   ```bash
   git checkout vX.Y.Z
   bash bootstrap.sh
   ```
4. Start the server.

**Do not** attempt to run the old code against a DB that has been migrated to a
newer schema version — it will fail with a `RuntimeError: newer than supported`.

---

## WAL checkpoint / compaction

SQLite WAL mode accumulates a write-ahead log file (`events.db-wal`) alongside
the main database.  It is checkpointed automatically, but you can force one:

```bash
apw-dev --db-path ~/.apw/events.db checkpoint
```

Output includes `log` (pages in WAL) and `checkpointed` (pages flushed to main
DB).  If `busy > 0`, a reader was active and the checkpoint was partial — retry.

Run a checkpoint before taking backups to minimise WAL size.

---

## Crash recovery

If the server crashed (power loss, kill -9, etc.):

1. **SQLite WAL mode is crash-safe** — the database will be in a consistent state
   on next open.  No manual recovery is needed.
2. Open the DB and check integrity:
   ```bash
   python3 -c "
   import sqlite3
   conn = sqlite3.connect('~/.apw/events.db')
   result = conn.execute('PRAGMA integrity_check').fetchone()
   print('Integrity:', result[0])
   "
   ```
3. If integrity check reports anything other than `ok`, follow
   [DB corruption detection](#db-corruption-detection) below.

---

## DB corruption detection

Signs of corruption:
- `PRAGMA integrity_check` returns something other than `ok`.
- `RuntimeError: DB schema version … does not match expected`.
- `sqlite3.DatabaseError: database disk image is malformed`.

Recovery steps:
1. **Stop the server immediately.**
2. Attempt `sqlite3 ~/.apw/events.db .dump > dump.sql` — if it succeeds,
   the data may be recoverable.
3. Restore from the most recent backup (see [Restore](#restore)).
4. If no backup exists, import from a JSON export if one was made.

Prevention:
- Enable regular backups (cron or script).
- Use a filesystem that supports `fsync` (not RAM-based tmpfs for production use).
- Avoid running the DB on a network filesystem (NFS, SMB).

---

## Troubleshooting common failures

### Port already in use

```
OSError: [Errno 98] Address already in use
```

Find and stop the conflicting process:
```bash
lsof -ti :8790 | xargs kill -9
```
Or start on a different port:
```bash
apw-viewer-server --port 8791 --db-path ~/.apw/events.db
```

### PDF not loading

- If the viewer shows a fetch error, check the server terminal for the error.
- If `--pdf-root` is set, ensure the PDF is inside that directory.
- Check the PDF URI is an absolute path.
- Remote PDFs require `--allow-remote-pdf` or `APW_ALLOW_REMOTE_PDF=1`.
- PDFs larger than the configured limit return `PAYLOAD_TOO_LARGE`; increase
  `--max-pdf-bytes` or `APW_MAX_PDF_BYTES` only if the machine has enough memory.

### Missing browser for E2E tests

```
Error: browserType.launch: Executable doesn't exist at …
```

Run:
```bash
npx playwright install --with-deps chromium
```

If Chromium exists but fails with a missing shared library such as `libnspr4.so`,
run the same command again; the `--with-deps` flag installs browser system
dependencies on supported Linux environments.

### Frontend assets missing (blank page)

```
WARNING [apw] Missing web assets in …
```

Run:
```bash
npm run build:frontend
```

### Schema versions

| Version | Change | Notes |
|---|---|---|
| 1 | Initial schema | sessions, action events, annotations, notes |
| 2 | Annotations and notes keyed by `paper_ref` | Applied automatically on first connection. Rows are merged per paper, newest `updated_at` winning when the same id existed in several sessions. Reading output from earlier sessions becomes visible again when the paper is reopened. |

Migrations are forward-only. Take a backup before upgrading (see
[Backup](#backup)); to go back, restore that backup rather than downgrading a
migrated database.

### Schema version mismatch

```
RuntimeError: DB schema version 2 is newer than supported 1.
```

You are running an older version of the app against a DB migrated by a newer
version.  Upgrade the app (see [Upgrade](#upgrade)) or restore an older backup.

---

## Known limitations

- **Single user only.** There is no authentication.  The server must only be
  bound to `127.0.0.1`.
- **No real-time sync.** Multiple browser tabs will not see each other's changes
  without a manual page refresh.
- **SQLite WAL checkpoint** does not run automatically on a schedule.  For very
  long running sessions with many events, run `apw-dev checkpoint` periodically.
- **Large PDF files** are capped before being read into memory.  The default
  limit is 100 MiB; larger files need an explicit `--max-pdf-bytes` override.
- **Export JSON** is a point-in-time snapshot.  There is no import command —
  restore from a SQLite backup for full data recovery.
