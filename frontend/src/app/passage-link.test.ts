import { describe, expect, it } from "vitest";

import { clearPassageQuery, passageQuery } from "./passage-link";

function query(): URLSearchParams {
  return new URLSearchParams({
    session_id: "ps_1",
    document_sha256: "a".repeat(64),
    annotation_id: "ann α",
    page: "2",
    passage_sha256: "b".repeat(64),
  });
}

describe("passage links", () => {
  it("keeps ordinary session links and forwards complete citation identities literally", () => {
    expect(passageQuery(new URLSearchParams("session_id=ps_1"))).toBeNull();
    expect(passageQuery(query())?.get("annotation_id")).toBe("ann α");
  });
  it("rejects partial, malformed, fractional, and overflowing citation identities", () => {
    for (const [key, value] of [
      ["session_id", ""],
      ["annotation_id", ""],
      ["document_sha256", "bad"],
      ["page", "0"],
      ["page", "2.1"],
      ["page", "2x"],
      ["page", "9999999999999999999"],
    ]) {
      const params = query();
      params.set(key, value);
      expect(() => passageQuery(params)).toThrow();
    }
  });
  it("clears citation identity when changing papers", () => {
    const params = query();
    clearPassageQuery(params);
    expect(params.toString()).toBe("session_id=ps_1");
  });
});
