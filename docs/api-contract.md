# HTTP API Contract

This document describes the local HTTP API payload contracts for
agent-pdf-workbench. The API is intended for single-user local usage on
`127.0.0.1`.

## Request Requirements

The server answers only requests that came from its own viewer:

- `Host` must name a loopback address (`127.0.0.1`, `localhost`, `::1`) or the
  configured `--host`. Anything else returns `403 FORBIDDEN`, which is what
  blocks DNS rebinding.
- An `Origin` header, when present, must match one of those names. A foreign or
  opaque (`null`) origin returns `403 FORBIDDEN`, which is what blocks
  cross-site writes.
- `POST` bodies must be sent with `Content-Type: application/json`. Anything
  else returns `415 UNSUPPORTED_MEDIA_TYPE`; this rejects the CORS-safelisted
  `text/plain` shape a cross-origin page can send without a preflight.

## Data Scope

Sessions own the action event stream. Annotations and notes belong to the
**paper** (`paper_ref`), not to the session that created them: every session on
the same paper reads and writes one set. Endpoints that take `session_id`
resolve it to that session's `paper_ref`.

## Error Envelope

API errors return JSON:

```json
{
  "error": "human readable message",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "annotation.page"
  }
}
```

Common codes:

- `MISSING_FIELD`
- `VALIDATION_ERROR`
- `FORBIDDEN`
- `NOT_FOUND`
- `UNSUPPORTED_MEDIA_TYPE`
- `PAYLOAD_TOO_LARGE`
- `BAD_GATEWAY`

`details.field` names the failing field. Validation errors raised by the store
carry the field explicitly rather than having it parsed back out of the message.

## Pagination

List endpoints return pagination metadata. Callers must not assume `limit=1000`
returns the full workspace.

### Actions

`GET /api/list-actions?session_id=...&limit=1000&after_id=123`

Response fields:

- `events`: ordered by ascending event `id`.
- `has_more`: true when more rows exist.
- `next_after_id`: pass this as `after_id` to fetch the next page.

### Sessions

`GET /api/sessions?paper_ref=...&open_only=1&limit=100&offset=0`

All query parameters are optional. Sessions are ordered newest-first
(`opened_at DESC, id ASC`), with `offset`, `has_more`, and `next_offset` as
above. `open_only=1` returns only sessions that have not been closed — this is
how an agent finds the session a reader currently has open.

`GET /api/session?session_id=...` returns one session, or `404 NOT_FOUND`. The
response carries `paper_ref` and `pdf_uri`, which is everything the viewer needs
to attach to existing work.

### Annotations

`GET /api/annotations?session_id=...&limit=1000&offset=0`
`GET /api/annotations?paper_ref=...&limit=1000&offset=0`

Exactly one of `session_id` or `paper_ref` is required; both name the same
paper-level set. Supplying neither or both returns `400 MISSING_FIELD`.

Response fields:

- `annotations`: ordered by `annotation_id ASC`. The order is stable while rows
  are being edited, so paging cannot skip or repeat a record; each record
  carries `updatedAt` for recency sorting in the client.
- `paper_ref`: the resolved paper scope.
- `offset`: offset used for this page.
- `has_more`: true when more rows exist.
- `next_offset`: pass this as `offset` to fetch the next page.

Each record is `{id, paper_ref, session_id, annotation, created_at, updated_at}`,
where `session_id` records the session that last wrote the row.

### Notes

`GET /api/notes?session_id=...&limit=1000&offset=0`
`GET /api/notes?paper_ref=...&limit=1000&offset=0`

Same scope rules as annotations; `notes` are ordered by `note_id ASC`.

## Payloads

### `POST /api/open-paper`

Required:

- `paper_ref`: non-empty string
- `pdf_uri`: non-empty string

Optional:

- `agent_id`: non-empty string
- `user_id`: non-empty string
- `metadata`: object

### `POST /api/record-action`

Required:

- `session_id`: non-empty string
- `event_type`: non-empty string

Optional:

- `page`: integer >= 1 or null
- `selection_text`: string or null
- `payload`: object or null
- `source`: non-empty string, defaults to `viewer`

### `POST /api/annotations`

Required body shape:

```json
{
  "session_id": "ps_...",
  "annotation": {
    "id": "ann_...",
    "page": 1,
    "type": "highlight",
    "quote": "selected text",
    "anchor": null,
    "comment": "",
    "tags": [],
    "rects": [],
    "createdAt": "2026-05-19T12:00:00+00:00",
    "updatedAt": "2026-05-19T12:00:00+00:00"
  }
}
```

Annotation rules:

- `id`: non-empty string
- `page`: integer >= 1
- `type`: `highlight` or `underline`
- `quote`: string
- `anchor`: null or text-anchor object
- `comment`: string
- `tags`: array of strings
- `rects`: array of normalized rectangles
- `createdAt`, `updatedAt`: ISO datetime strings

Text anchor:

```json
{
  "quote": "selected text",
  "start": 10,
  "end": 23,
  "prefix": "before",
  "suffix": "after"
}
```

`start` and `end` may be null. When both are integers, `end` must be greater
than or equal to `start`.

Rectangle:

```json
{
  "x": 0.1,
  "y": 0.2,
  "width": 0.3,
  "height": 0.1
}
```

`width` and `height` must be non-negative numbers.

### `POST /api/annotations/delete`

Required:

- `session_id`: non-empty string
- `annotation_id`: non-empty string

The operation is idempotent. Missing annotations return `deleted: false`.

### `POST /api/notes`

Required body shape:

```json
{
  "session_id": "ps_...",
  "note": {
    "id": "note_...",
    "title": "Short title",
    "markdown": "Longer note",
    "linkedAnnotationIds": ["ann_..."],
    "createdAt": "2026-05-19T12:00:00+00:00",
    "updatedAt": "2026-05-19T12:00:00+00:00"
  }
}
```

Note rules:

- `id`: non-empty string
- `title`: string
- `markdown`: string
- `linkedAnnotationIds`: array of strings
- `createdAt`, `updatedAt`: ISO datetime strings

### `POST /api/notes/delete`

Required:

- `session_id`: non-empty string
- `note_id`: non-empty string

The operation is idempotent. Missing notes return `deleted: false`.

## Viewer Deep Links

The viewer reads two query parameters on load:

- `/?session_id=ps_...` attaches to an existing session instead of opening a new
  one, and reports a closed session rather than silently starting another.
- `/?pdf_uri=/path/to/paper.pdf&paper_ref=...` opens a session for that file.
  When `paper_ref` is omitted it is derived from the file stem.

After a session opens, the viewer keeps `session_id` in the address bar, so a
reload rejoins the same session.
