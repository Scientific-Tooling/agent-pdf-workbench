import { describe, expect, it } from "vitest";

import { buildEventLines } from "./timeline";
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

  it("omits empty selection text and payload lines", () => {
    const lines = buildEventLines(sampleEvent({ payload: {}, selection_text: null }));
    expect(lines).toEqual(["7 | comment | p.3 | 2026-03-20T12:00:00+00:00"]);
  });

  it("returns document text as plain data, never markup", () => {
    // WorkspacePanel renders these lines as JSX text nodes, so escaping is
    // React's job; this asserts the builder does not pre-render any markup.
    const lines = buildEventLines(
      sampleEvent({ selection_text: '<img src=x onerror="window.__xss=true">', payload: {} }),
    );
    expect(lines[1]).toBe('text: <img src=x onerror="window.__xss=true">');
  });

  it("renders a missing page as a dash", () => {
    const lines = buildEventLines(sampleEvent({ page: null, payload: {} }));
    expect(lines[0]).toContain("p.-");
  });
});
