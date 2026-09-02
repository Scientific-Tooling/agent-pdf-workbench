import { describe, expect, it } from "vitest";

import { clamp, paperRefFromUri, parseLinkedIds, parseTags } from "./main-utils";

describe("paperRefFromUri", () => {
  it("names a paper after its file stem", () => {
    expect(paperRefFromUri("/home/reader/Papers/attention-is-all-you-need.pdf")).toBe(
      "attention-is-all-you-need",
    );
  });

  it("handles Windows paths, URLs, and query strings", () => {
    expect(paperRefFromUri("C:\\Papers\\transformer.PDF")).toBe("transformer");
    expect(paperRefFromUri("https://arxiv.org/pdf/1706.03762v5.pdf?download=1")).toBe(
      "1706.03762v5",
    );
  });

  it("falls back to a placeholder when there is no usable stem", () => {
    expect(paperRefFromUri("")).toBe("untitled-paper");
    expect(paperRefFromUri("/papers/.pdf")).toBe("untitled-paper");
  });
});

describe("input parsing", () => {
  it("splits and trims comma-separated tags, dropping blanks", () => {
    expect(parseTags(" method , , evidence ")).toEqual(["method", "evidence"]);
    expect(parseTags("   ")).toEqual([]);
  });

  it("parses linked annotation ids the same way", () => {
    expect(parseLinkedIds("ann_1, ann_2,")).toEqual(["ann_1", "ann_2"]);
  });

  it("clamps values into range", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(clamp(2, 1, 3)).toBe(2);
  });
});
