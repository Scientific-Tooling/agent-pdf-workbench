import { expect, it } from "vitest";
import { paperByline } from "./paper-byline";

it("uses recorded bibliography and abbreviates long author lists only", () => {
  expect(paperByline({ authors: ["A Researcher", "B Reader"], venue: "Journal", year: 2024 })).toBe(
    "A Researcher & B Reader · Journal · 2024",
  );
  expect(
    paperByline(
      { authors: ["A Researcher", "B Reader", "C Writer"], venue: "Journal", year: 2024 },
      true,
    ),
  ).toBe("A Researcher et al. · 2024");
});
it("omits absent bibliography without inventing authors or dates", () => {
  expect(paperByline(null)).toBe("");
  expect(paperByline({ authors: [], year: null, venue: "Journal" })).toBe("Journal");
});
