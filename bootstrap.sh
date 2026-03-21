#!/usr/bin/env bash
# bootstrap.sh — one-command local install for agent-pdf-workbench
# Usage: bash bootstrap.sh
# Re-running is safe (idempotent).

set -euo pipefail

APW_DIR="${APW_DIR:-.apw}"
DB_PATH="${DB_PATH:-$APW_DIR/events.db}"

echo "=== agent-pdf-workbench bootstrap ==="

# ── 1. Python version check ────────────────────────────────────────────────────
PYTHON="${PYTHON:-python3}"
PY_OK=$("$PYTHON" -c "import sys; print(1 if sys.version_info >= (3,10) else 0)" 2>/dev/null || echo 0)
if [[ "$PY_OK" != "1" ]]; then
  echo "ERROR: Python 3.10+ is required. Found: $($PYTHON --version 2>&1 || echo 'not found')"
  exit 1
fi
echo "  ✓ Python: $($PYTHON --version)"

# ── 2. Install Python package in editable mode ────────────────────────────────
echo "  Installing Python package..."
"$PYTHON" -m pip install -e . --quiet
echo "  ✓ Python package installed"

# ── 3. Node / npm check ────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found. Install Node.js 18+ from https://nodejs.org"
  exit 1
fi
echo "  ✓ npm: $(npm --version)"

# ── 4. Install Node dependencies ───────────────────────────────────────────────
echo "  Installing Node dependencies..."
npm ci --silent
echo "  ✓ Node dependencies installed"

# ── 5. Build frontend assets ───────────────────────────────────────────────────
echo "  Building frontend assets..."
npm run build:frontend --silent
echo "  ✓ Frontend assets built"

# ── 6. Install Playwright browser (if not present) ────────────────────────────
if command -v npx &>/dev/null; then
  echo "  Installing Playwright Chromium browser (required for E2E tests)..."
  npx playwright install chromium --quiet 2>/dev/null || true
  echo "  ✓ Playwright browser ready"
fi

# ── 7. Create local data directory ────────────────────────────────────────────
mkdir -p "$APW_DIR"
echo "  ✓ Data directory: $APW_DIR"

# ── 8. Smoke test: run Python unit tests ──────────────────────────────────────
echo "  Running unit tests..."
PYTHONPATH=src "$PYTHON" -m unittest discover -s tests/unit -p 'test_*.py' -q
echo "  ✓ Unit tests passed"

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Start the viewer server:"
echo "  PYTHONPATH=src $PYTHON -m agent_pdf_workbench.viewer_server \\"
echo "    --db-path $DB_PATH \\"
echo "    --pdf-root ~/Papers"
echo ""
echo "Or with the installed script:"
echo "  apw-viewer-server --db-path $DB_PATH --pdf-root ~/Papers"
echo ""
echo "Then open: http://127.0.0.1:8790"
