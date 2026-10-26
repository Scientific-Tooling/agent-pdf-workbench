import { expect, it } from "vitest";

import { readTextFromPdfItems } from "./pdf-layer";
import type { TextItem } from "../types/pdfjs-types";

it("keeps page text offsets aligned with text spans when marked content is present", () => {
  const text = (str: string) => ({ str }) as TextItem;
  expect(
    readTextFromPdfItems([
      text("first"),
      { type: "beginMarkedContent", id: "tag" },
      text("target"),
      { type: "endMarkedContent", id: "" },
    ]),
  ).toBe("first target");
});
