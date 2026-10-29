import { describe, expect, it } from "vitest";
import { buildPdfPageText } from "./pdf-layer";
import { resolveAnchorOffsets } from "./text-anchor";
import type { TextItem } from "../types/pdfjs-types";
import fragments from "./fixtures/real-passage-fragments.json";

const anchor = (quote: string) => ({ quote, start: null, end: null, prefix: "", suffix: "" });
const item = (str: string, hasEOL = false) => ({ str, hasEOL }) as TextItem;

describe("PDF fragment-aware citation matching", () => {
  for (const example of fragments.cases) {
    it(`locates the unchanged pilot quote ${example.note_id}`, () => {
      const page = buildPdfPageText(example.items as TextItem[]);
      const found = resolveAnchorOffsets(anchor(example.quote), page.text, page.optionalWhitespace);
      expect(found).not.toBeNull();
      expect(page.text.slice(found!.start, found!.end).replace(/\s/g, "")).toBe(
        example.quote.replace(/\s/g, ""),
      );
    });
  }

  it("preserves saved offsets and rendered span coordinates", () => {
    const page = buildPdfPageText([item("A ‘"), item("quote"), item("’ ends.")]);
    expect(page.spans[1]).toEqual({ start: 4, end: 9 });
    expect(
      resolveAnchorOffsets(
        { ...anchor("‘ quote ’"), start: 2, end: 11 },
        page.text,
        page.optionalWhitespace,
      ),
    ).toEqual({ start: 2, end: 11 });
    expect(resolveAnchorOffsets(anchor("‘quote’"), page.text, page.optionalWhitespace)).toEqual({
      start: 2,
      end: 11,
    });
  });

  it("never removes real word boundaries, signs, operands, units or negation", () => {
    const page = buildPdfPageText([
      item("not significant; 25-50 cells; 13.5 h; S"),
      item("1"),
      item(" + S"),
      item("2"),
    ]);
    for (const quote of [
      "notsignificant",
      "25+50 cells",
      "25-500 cells",
      "13.5 s",
      "S1 - S2",
      "S1 + S3",
    ]) {
      expect(resolveAnchorOffsets(anchor(quote), page.text, page.optionalWhitespace)).toBeNull();
    }
    const separateLines = buildPdfPageText([item("no", true), item("where")]);
    expect(
      resolveAnchorOffsets(anchor("nowhere"), separateLines.text, separateLines.optionalWhitespace),
    ).toBeNull();
  });

  it("rejects ambiguity even when only one occurrence uses synthetic spaces", () => {
    const page = buildPdfPageText([item("‘quote’ and ‘"), item("quote"), item("’")]);
    expect(resolveAnchorOffsets(anchor("‘quote’"), page.text, page.optionalWhitespace)).toBeNull();
    expect(
      resolveAnchorOffsets(
        { ...anchor("‘quote’"), prefix: "and" },
        page.text,
        page.optionalWhitespace,
      ),
    ).toEqual({ start: 12, end: 21 });
  });

  it("expands only typographic ligatures, with correct original offsets", () => {
    expect(resolveAnchorOffsets(anchor("five 🧬"), "A ﬁve 🧬 result")).toEqual({
      start: 2,
      end: 8,
    });
    expect(resolveAnchorOffsets(anchor("x2"), "x²")).toBeNull();
    expect(resolveAnchorOffsets(anchor("1 mg"), "1 μg")).toBeNull();
  });
});
