import { describe, expect, it } from "vitest";

import {
  asAnnotation,
  asAnnotationRecord,
  asNote,
  asNoteRecord,
  asTextAnchor,
} from "./main-parsers";

const TIME = "2026-09-02T10:00:00+00:00";

const validAnnotation = {
  id: "ann_1",
  page: 3,
  type: "highlight",
  quote: "scaled dot-product attention",
  anchor: {
    quote: "scaled dot-product attention",
    start: 10,
    end: 38,
    prefix: "of ",
    suffix: " is",
  },
  comment: "key idea",
  tags: ["method"],
  rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
  createdAt: TIME,
  updatedAt: TIME,
};

describe("asAnnotation", () => {
  it("round-trips a well-formed annotation", () => {
    expect(asAnnotation(validAnnotation)).toEqual(validAnnotation);
  });

  it("rejects payloads missing the fields the reader depends on", () => {
    expect(asAnnotation(null)).toBeNull();
    expect(asAnnotation("ann_1")).toBeNull();
    expect(asAnnotation({ ...validAnnotation, id: 7 })).toBeNull();
    expect(asAnnotation({ ...validAnnotation, page: "3" })).toBeNull();
    expect(asAnnotation({ ...validAnnotation, type: "strikethrough" })).toBeNull();
  });

  it("drops malformed tags and rectangles instead of failing the whole annotation", () => {
    const parsed = asAnnotation({
      ...validAnnotation,
      tags: ["ok", 5, null],
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }, { x: "a" }, null],
    });
    expect(parsed?.tags).toEqual(["ok"]);
    expect(parsed?.rects).toHaveLength(1);
  });

  it("defaults optional text fields so the UI never renders undefined", () => {
    const parsed = asAnnotation({ id: "ann_2", page: 1, type: "underline" });
    expect(parsed).toMatchObject({ quote: "", comment: "", tags: [], rects: [] });
    expect(parsed?.createdAt).toEqual(expect.any(String));
  });
});

describe("asTextAnchor", () => {
  it("keeps numeric offsets and context", () => {
    expect(
      asTextAnchor({ quote: "q", start: 1, end: 4, prefix: "a", suffix: "b" }, "fallback"),
    ).toEqual({
      quote: "q",
      start: 1,
      end: 4,
      prefix: "a",
      suffix: "b",
    });
  });

  it("nulls out non-finite offsets so rect fallback is used", () => {
    const parsed = asTextAnchor({ quote: "q", start: Number.NaN, end: "4" }, "fallback");
    expect(parsed).toMatchObject({ start: null, end: null });
  });

  it("borrows the annotation quote when the anchor has none", () => {
    expect(asTextAnchor({ start: 1, end: 2 }, "fallback")?.quote).toBe("fallback");
  });

  it("returns null for a non-object anchor", () => {
    expect(asTextAnchor(null, "fallback")).toBeNull();
    expect(asTextAnchor("anchor", "fallback")).toBeNull();
  });
});

describe("asNote", () => {
  it("round-trips a well-formed note", () => {
    const note = {
      id: "note_1",
      title: "Reading note",
      markdown: "body",
      linkedAnnotationIds: ["ann_1"],
      createdAt: TIME,
      updatedAt: TIME,
    };
    expect(asNote(note)).toEqual(note);
  });

  it("requires an id and filters non-string links", () => {
    expect(asNote({ title: "no id" })).toBeNull();
    expect(asNote({ id: "note_2", linkedAnnotationIds: ["a", 2] })?.linkedAnnotationIds).toEqual([
      "a",
    ]);
  });
});

describe("record wrappers", () => {
  const record = {
    id: "ann_1",
    paper_ref: "p_1",
    session_id: "ps_1",
    annotation: validAnnotation,
    created_at: TIME,
    updated_at: TIME,
  };

  it("accepts a server annotation record", () => {
    expect(asAnnotationRecord(record)?.annotation.id).toBe("ann_1");
  });

  it("rejects a record whose annotation payload is unusable", () => {
    expect(asAnnotationRecord({ ...record, annotation: { id: "x" } })).toBeNull();
    expect(asAnnotationRecord({ ...record, session_id: 1 })).toBeNull();
    expect(asAnnotationRecord(undefined)).toBeNull();
  });

  it("accepts a server note record", () => {
    const noteRecord = {
      id: "note_1",
      paper_ref: "p_1",
      session_id: "ps_1",
      note: {
        id: "note_1",
        title: "t",
        markdown: "m",
        linkedAnnotationIds: [],
        createdAt: TIME,
        updatedAt: TIME,
      },
      created_at: TIME,
      updated_at: TIME,
    };
    expect(asNoteRecord(noteRecord)?.note.title).toBe("t");
    expect(asNoteRecord({ ...noteRecord, note: {} })).toBeNull();
  });
});
