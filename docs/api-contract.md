# HTTP API Contract

This document describes the local HTTP API payload contracts for
agent-pdf-workbench. The API is intended for single-user local usage on
`127.0.0.1`.

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
- `PAYLOAD_TOO_LARGE`
- `BAD_GATEWAY`

`details.field` is included when the failing field can be identified.

## Pagination

List endpoints return pagination metadata. Callers must not assume `limit=1000`
returns the full workspace.

### Actions

`GET /api/list-actions?session_id=...&limit=1000&after_id=123`

Response fields:

- `events`: ordered by ascending event `id`.
- `has_more`: true when more rows exist.
- `next_after_id`: pass this as `after_id` to fetch the next page.

### Annotations

`GET /api/annotations?session_id=...&limit=1000&offset=0`

Response fields:

- `annotations`: ordered by `updated_at DESC, annotation_id ASC`.
- `offset`: offset used for this page.
- `has_more`: true when more rows exist.
- `next_offset`: pass this as `offset` to fetch the next page.

### Notes

`GET /api/notes?session_id=...&limit=1000&offset=0`

Response fields:

- `notes`: ordered by `updated_at DESC, note_id ASC`.
- `offset`: offset used for this page.
- `has_more`: true when more rows exist.
- `next_offset`: pass this as `offset` to fetch the next page.

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
