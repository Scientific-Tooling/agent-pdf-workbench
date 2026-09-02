# Viewer UI Improvement Plan

Created: 2026-09-02

This plan turns the September 2026 UI review into batched engineering work. It
covers the reading surface only; API, storage, and agent-facing behaviour are
out of scope and unchanged.

## Baseline

Observed by running the viewer against a three-page paper-like PDF at 1512px
and 1024px, with two annotations and one note created:

- Full-text search reports matches and jumps pages, but **nothing is marked on
  the page**. `applySearchHighlightsToCurrentPage` applies `.search-hit` and
  `.current-hit` correctly (measured: 2 hits and 1 current hit across 11 text
  spans), and `styles.css` defines neither class. Computed background on a hit
  span is `rgba(0, 0, 0, 0)`.
- At 1024px the page canvas is clipped on the right, and the toolbar controls
  that would fix it — `Prev`/`Next` and `Fit Width` — are the ones that drop
  out of the bar.
- The only media query narrows the side panels to `260px 1fr 320px`; they never
  collapse, so at 1024px the two panels hold 580px and the document gets ~440px
  for a canvas rendered 826px wide at 135%.
- Nothing in the app calls `scrollIntoView`, so jumping to a search hit or an
  annotation lands on the right page but not necessarily in view.
- Three consecutive writes stack three toasts over the workspace panel, hiding
  the note list and the first search result they are reporting on.
- `prefers-color-scheme` appears zero times; `prefers-reduced-motion` zero
  times; `aria-*` appears once in the whole component tree (ToastStack).

## Goals

1. Make features the UI already claims actually visible — search hits first.
2. Keep the document readable at every window size the app is used at.
3. Give the reading surface the space and the visual weight it deserves.
4. Make the sidebars report on the reading, not on the plumbing.
5. Support long reading sessions: dark theme, keyboard, reduced motion.

## Non-Goals

- No change to the HTTP API, MCP tools, storage schema, or event semantics.
- No new runtime dependencies for batches 1–4.
- No visual redesign for its own sake: each batch fixes a named problem.

## Priority Summary

| Batch | Theme | Size | Outcome |
|---|---|---|---|
| 1 | Visible feedback | S | Search hits are visible and in view; toasts stop covering what they announce. |
| 2 | Responsive layout and toolbar | M | The document is never clipped; every control stays reachable; search moves into the toolbar. |
| 3 | Sidebar information hierarchy | M | Sidebars show the paper and the work, not URIs and session ids. |
| 4 | Theme and accessibility | M | Dark theme, labelled controls, discoverable shortcuts, honoured motion preference. |
| 5 | Continuous scrolling reader | L | Cross-page reading without page-turn interruptions. |

---

## Batch 1: Visible Feedback

Problem: the two features that report progress — search and write
confirmations — either say nothing on the page or say it on top of the content.

Tasks:

- Add `.search-hit` and `.current-hit` rules to `styles.css`, following the
  existing `.annotation-mark.highlight` approach (`mix-blend-mode: multiply`
  over the transparent text layer). The current hit needs a stronger treatment
  than the other hits, not just a different hue.
- Scroll the current hit into view after `jumpToSearchResult`, and the target
  annotation after `jumpToAnnotation`, when it falls outside the stage
  viewport. Respect `prefers-reduced-motion` for the scroll behaviour.
- Coalesce toasts: a new toast of the same kind replaces the standing one
  rather than stacking beneath it; cap the stack at two.
- Move the toast stack clear of the workspace panel, and drop the duplicate
  status text (the `Status` chip and the toast currently say the same thing).

Acceptance criteria:

- Searching a term visibly marks every hit on the current page, with the active
  hit distinguishable at a glance.
- Jumping to a hit or an annotation always leaves the target on screen.
- Three writes in a row never obscure the lists in the workspace panel.

Verification:

```bash
npm run test:unit
npm run test:e2e
```

Add an E2E assertion that the computed background of `.current-hit` is not
transparent. That is the regression this batch exists to prevent: the class was
applied and unstyled, so no test noticed.

Files: `frontend/src/styles.css`, `frontend/src/ui/search-highlight.ts`,
`frontend/src/app/usePdfSearch.ts`, `frontend/src/app/useWorkspaceCommands.ts`,
`frontend/src/hooks/useToastStack.ts`, `frontend/src/components/ToastStack.tsx`.

---

## Batch 2: Responsive Layout and Toolbar

Problem: `.layout` is a fixed three-column grid with one media query that only
shrinks the columns. Below roughly 1200px the document loses the contest for
space and gets clipped, and the toolbar sheds controls silently.

Tasks:

- Replace the fixed grid with breakpoints that collapse panels rather than
  squeeze the document:
  - `>= 1400px`: both panels open.
  - `1100–1400px`: workspace panel open, control panel collapses to a rail.
  - `< 1100px`: both panels become drawers over the reading surface.
- Give each panel an explicit collapse toggle, and persist the state per panel
  in `localStorage` alongside the existing reading progress.
- Fit the page to the available width on first render and on resize, unless the
  reader has set a zoom themselves in this session.
- Rework the toolbar so controls never disappear: navigation, zoom, and search
  groups, with low-priority items moving into an overflow menu at narrow
  widths. `Fit Width` is never in the overflow.
- Move search from the floating overlay into the toolbar's empty middle, and
  delete the overlay. Keep `/` and `Ctrl/Cmd+F` as focus shortcuts.

Acceptance criteria:

- At 1512, 1280, 1024 and 768px the page canvas fits its column with no
  horizontal clipping, and the body never scrolls sideways.
- `Fit Width` is reachable at every width.
- Reopening the app restores the panel layout the reader left.

Verification:

```bash
npm run test:e2e
```

E2E at 1024px and 768px asserting the canvas width does not exceed the stage
width, and that `#fitWidthBtn` is visible.

Files: `frontend/src/styles.css`, `frontend/src/components/ReaderPanel.tsx`,
`frontend/src/components/ControlPanel.tsx`,
`frontend/src/components/WorkspacePanel.tsx`, `frontend/src/app/App.tsx`,
`frontend/src/services/storage.ts`.

---

## Batch 3: Sidebar Information Hierarchy

Problem: the most prominent card in the app holds two text inputs and a raw
session id — agent-facing plumbing — while a single recent paper can occupy six
lines of absolute path.

Tasks:

- Collapse the Session card once a paper is open: one line with the paper
  reference, current page, and a status dot. The inputs return on demand
  (a "Change paper" control), and the session id moves into a tooltip or a
  `details` disclosure.
- Recent papers list the paper reference and last page; the file path becomes
  the row's `title`, truncated to one line in the UI.
- Do not render cards with nothing in them — an outline-less document should
  not cost a card that says "No outline".
- Truncate annotation quotes on a word boundary with an ellipsis instead of
  mid-word (`networks that include an encoder and a d`).
- Show the annotation and note counts on the collapsed card headers so a
  collapsed panel still reports what it holds.

Acceptance criteria:

- With a paper open, the control panel fits without scrolling at 900px height.
- No absolute path is rendered as wrapped body text anywhere in the sidebar.
- Quote previews end at a word.

Verification:

```bash
npm run test:unit
npm run test:e2e
```

Files: `frontend/src/components/ControlPanel.tsx`,
`frontend/src/components/WorkspacePanel.tsx`, `frontend/src/styles.css`,
`frontend/src/utils/main-utils.ts` (word-boundary truncation, unit-tested).

---

## Batch 4: Theme and Accessibility

Problem: a tool for reading papers for hours has one hard-coded light theme, no
labelled controls, no discoverable shortcuts, and no motion preference.

Tasks:

- Extract the palette into tokens on `:root`, add a dark set under
  `prefers-color-scheme: dark`, and a manual override persisted in
  `localStorage`. Both themes need contrast checked against the PDF canvas,
  which stays white — the page itself is not inverted.
- Label icon-only controls (`aria-label`), mark the status line `aria-live`,
  and give the panels landmark roles.
- Add a visible `:focus-visible` style; verify the whole open → annotate → note
  flow is reachable by keyboard.
- Honour `prefers-reduced-motion` for panel transitions, toasts, and the
  scroll-into-view added in batch 1.
- Add a shortcut help overlay on `?`, listing `j`/`k`/`f` and the batch 2
  search shortcuts, and surface the same hints in tooltips.

Acceptance criteria:

- Dark theme renders correctly on first paint with no light flash, and the
  reading surface stays legible against it.
- Every control has an accessible name; the reading flow is keyboard-complete.
- With reduced motion set, no animated transitions run.

Verification:

```bash
npm run check:frontend
npm run test:e2e
```

E2E asserting icon-only buttons expose an accessible name, plus a manual pass
of the keyboard flow recorded in the release checklist.

Files: `frontend/src/styles.css`, all four components,
`frontend/src/services/storage.ts`, `frontend/src/hooks/` (shortcut help).

---

## Batch 5: Continuous Scrolling Reader

Problem: the reader renders one page into one canvas and turns pages when the
stage hits an edge. Papers are read across page boundaries — figures, tables,
and equations routinely straddle them.

This batch is a release of its own. It touches rendering, the page cache,
annotation anchoring, and the action event stream at once, so it should not be
bundled with any of the above.

Tasks:

- Render a virtualized column of pages, mounting canvases and text layers only
  near the viewport.
- Move the annotation layer to per-page containers, keeping anchor resolution
  page-scoped as it is today.
- Derive the current page from scroll position and emit `page_change` from
  there, leaning on the store's existing 0.75s coalescing.
- Keep the explicit page-jump, outline, search, and annotation jumps working
  against the new scroll model.
- Decide and document what `Fit Width` and zoom mean in a continuous column.

Acceptance criteria:

- Scrolling through a 30-page document stays responsive and memory stable —
  the existing `PAGE_CACHE_LIMIT` eviction still bounds bitmaps.
- Annotations render on the correct page at any scroll offset and survive zoom.
- The event stream does not gain a burst of `page_change` rows per scroll.

Verification:

```bash
npm run verify
```

Plus a memory check over sustained scrolling, as in the Phase A4 note of
`future-development-plan.md`.

---

## Cross-Cutting Requirements

- Every batch ends with `npm run verify` green.
- Every batch is screenshotted at 1512, 1280, 1024, and 768px before it is
  called done; UI work that is not looked at is not finished.
- New user-visible strings say what happened, in the reader's terms.
- No batch may make the document area smaller than it is today.
- Behaviour changes that a test can hold get a test in the same batch.

## Suggested Execution Order

1. **Batch 1** first: it is the smallest and it fixes a feature that currently
   reports success while showing nothing.
2. **Batch 2** next: it is a prerequisite for batch 3 (which assumes panels can
   collapse) and it removes the floating search overlay.
3. **Batch 3** after the layout settles, so the sidebar is redesigned once.
4. **Batch 4** any time after batch 3; the token extraction is easier once the
   markup has stopped moving.
5. **Batch 5** as a separate release, after 1–4 are stable.

## Batch 1 Outcome (2026-09-02)

Done:

- `.search-hit` and `.current-hit` now paint (sky tokens, `multiply` over the
  text layer). The active hit gets a stronger fill plus a ring, so it reads
  apart from the others at a glance and never reads as an annotation.
- `scrollIntoStageView()` brings the active search hit or a jumped-to
  annotation into view, but only when it is actually outside the stage, so
  clicking a visible mark does not move the page. It honours
  `prefers-reduced-motion`.
- Toasts of the same kind supersede each other and the stack is capped at two;
  it moved to bottom-centre, clear of the workspace panel.
- Transient confirmations left the `Status` chip, which now reports session
  state ("session ready", "session closed") instead of echoing every toast.

Three E2E tests cover it, including one that asserts the *computed* background
of `.current-hit` is not transparent — the shape of the bug that shipped
unnoticed, since the class was applied and simply unstyled.

Known limitation, not addressed here: highlighting is span-level, so a match
tints the whole text run it falls in rather than the matched characters. Making
it character-precise means reusing the Range-to-rects code that annotations
already have, on a dedicated search layer. Worth doing, but it is a rendering
change rather than a stylesheet one.

Also fixed in passing: ESLint's `no-undef` was firing on TypeScript DOM types
(`ScrollToOptions`). It is off for TS sources now — `tsc` already resolves
identifiers, so it could only produce false positives.

## Tracking Checklist

- [x] Batch 1: search hits visible and scrolled into view; toasts coalesced.
- [ ] Batch 2: responsive breakpoints, collapsible panels, toolbar overflow.
- [ ] Batch 3: sidebar hierarchy, paths and empty states.
- [ ] Batch 4: dark theme, accessible names, shortcuts, reduced motion.
- [ ] Batch 5: continuous scrolling reader.
