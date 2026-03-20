import { describe, expect, it } from "vitest";

import { buildEventLines, createEventListItem } from "./timeline";
import type { ActionEvent } from "../types/types";

function sampleEvent(overrides: Partial<ActionEvent> = {}): ActionEvent {
  return {
    id: 7,
    session_id: "ps_test",
    event_type: "comment",
    page: 3,
    selection_text: null,
    payload: { text: "hello" },
    source: "viewer",
    created_at: "2026-03-20T12:00:00+00:00",
    ...overrides,
  };
}

describe("timeline rendering", () => {
  it("builds stable event lines", () => {
    const lines = buildEventLines(sampleEvent());
    expect(lines).toEqual([
      "7 | comment | p.3 | 2026-03-20T12:00:00+00:00",
      'payload: {"text":"hello"}',
    ]);
  });

  it("renders text with textContent to prevent HTML injection", () => {
    const event = sampleEvent({
      selection_text: '<img src=x onerror="window.__xss=true">',
      payload: {},
    });
    const li = createEventListItem(event);

    expect(li.children).toHaveLength(2);
    expect(li.innerHTML).toContain("&lt;img");
    expect(li.querySelector("img")).toBeNull();
  });
});
