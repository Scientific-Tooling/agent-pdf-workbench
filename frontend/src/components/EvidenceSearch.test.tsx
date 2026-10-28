/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiGet } from "../services/api";
import { EvidenceSearch } from "./EvidenceSearch";

vi.mock("../services/api", () => ({ apiGet: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const emptyResult = {
  query: "source",
  total: 0,
  offset: 0,
  limit: 20,
  has_more: false,
  outcome: "no_matches",
  results: [],
  pending_papers: [],
  unavailable_evidence: [],
};

async function mount(session = "first") {
  await act(async () =>
    root.render(
      createElement(EvidenceSearch, {
        key: session,
        sessionId: session,
        papers: [
          { key: "p1", title: "First paper" },
          { key: "p2", title: "Second paper" },
        ],
      }),
    ),
  );
}
async function change(selector: string, value: string) {
  await act(async () => {
    const element = container.querySelector(selector) as HTMLInputElement;
    const prototype =
      element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("sends explicit filters and explains an empty evidence search", async () => {
  vi.mocked(apiGet).mockResolvedValue(emptyResult);
  await mount();
  await change("input", "source");
  await change("select", "p2");
  await submit();
  expect(apiGet).toHaveBeenCalledWith(
    expect.stringContaining("session_id=first&q=source&paper=p2&review=all"),
  );
  expect(container.textContent).toContain("No imported evidence matches");
  expect(container.textContent).toContain("full paper text are outside this search");
});

it("discards a delayed response when a filter changes or a new paper opens", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(apiGet).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await mount();
  await change("input", "source");
  await submit();
  await change("select", "p2");
  await act(async () => complete({ ...emptyResult, total: 99 }));
  expect(container.textContent).not.toContain("99 evidence matches");
  await submit();
  await mount("second");
  await act(async () => complete({ ...emptyResult, total: 88 }));
  expect(container.textContent).not.toContain("88 evidence matches");
  expect((container.querySelector("input") as HTMLInputElement).value).toBe("");
});

it("keeps unavailable quotations readable and errors retryable", async () => {
  vi.mocked(apiGet).mockRejectedValueOnce(new Error("Restore the project database"));
  await mount();
  await change("input", "source");
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Restore");
  vi.mocked(apiGet).mockResolvedValue({
    ...emptyResult,
    total: 1,
    results: [
      {
        source_key: "identity",
        note_id: "note",
        revision: "revision",
        paper: { key: "p1", title: "First paper" },
        record: { document: { sha256: "hash" }, item: { review: { status: "unreviewed" } } },
        matches: [
          { role: "source", text: "A retained quotation", page: 1 },
          { role: "commentary", text: "An interpretation" },
        ],
        passages: [{ annotation_id: "annotation", page: 1, url: null, message: "Source changed" }],
      },
    ],
  });
  await submit();
  expect(container.textContent).toContain("A retained quotation");
  expect(container.textContent).toContain("Commentary");
  expect(container.textContent).toContain("unreviewed");
  expect(container.textContent).toContain("Source changed");
  expect(container.querySelector("a")).toBeNull();
});
