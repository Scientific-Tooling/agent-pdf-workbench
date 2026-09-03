# Frontend Bundle Budget

Created: 2026-05-19

The viewer frontend intentionally includes PDF.js, React, annotation rendering,
search, export, and local workspace behavior. A single 500 kB JavaScript budget
is too tight for that scope, so the build now uses explicit chunks and a
documented warning threshold.

## Current Sizes

Measured after `npm run build:frontend` (pdf.js 6, Vite 8):

| Asset | Size | Notes |
|---|---|---|
| `app.js` | ~50 kB | application code, well under budget |
| `react-*.js` | ~185 kB | React + React DOM |
| `pdfjs-*.js` | ~421 kB | PDF.js main thread |
| `pdf.worker.min-*.mjs` | ~1.24 MB | loaded by the worker, not the page |

## Current Policy

- Main app entry chunk target: below 700 kB minified.
- PDF.js code is split into a dedicated chunk.
- React/React DOM code is split into a dedicated chunk.
- The PDF.js worker remains a separate generated asset and is expected to be
  larger than application code.

## Rationale

This is a local-first reader, not a public marketing page. The first meaningful
workflow is opening and rendering PDFs, so loading PDF.js during app startup is
acceptable. The budget should still catch accidental growth from unrelated
features, large libraries, or duplicated dependencies.

## Review Triggers

Revisit the budget when:

- `npm run build:frontend` emits a chunk-size warning.
- The main app chunk grows above 700 kB minified.
- Startup becomes visibly slower on the target local machines.
- A new dependency adds more than 100 kB minified to the app or vendor chunks.

## Verification

```bash
npm run build:frontend
npm run test:e2e
```
