/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "../services/api";
import { ComparisonPanel } from "./ComparisonPanel";

vi.mock("../services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const evidence = {
  note_id: "n1",
  revision: "old",
  status: "current",
  source_status: "available",
  paper: { key: "p1", title: "Paper" },
  record: {
    item: {
      content: { comment: "Imported interpretation" },
      review: { status: "unreviewed" },
      passages: [{ page: 1, quote: "No increase at 5 mg." }],
    },
  },
  passages: [{ page: 1, quote: "No increase at 5 mg.", url: "/?source", message: "Verified" }],
};
const comparison = {
  id: "cmp_fixture",
  revision: "v1",
  title: "Fixture",
  question: "What differs?",
  criteria: [{ id: "c1", label: "Conditions" }],
  papers: [{ key: "p1", title: "Paper", paper_source: "source" }],
  cells: [
    {
      key: "source|c1",
      criterion_id: "c1",
      paper_source: "source",
      paper: { key: "p1", title: "Paper" },
      text: "Proposed interpretation",
      conditions: "5 mg",
      origin: "agent",
      support_status: "linked",
      evidence: [evidence],
      review: { status: "unreviewed", latest: null, history: [] },
    },
  ],
  excluded_papers: [],
  markdown: "Fixture",
};
const data = {
  comparisons: [{ id: comparison.id, title: comparison.title }],
  comparison,
  evidence: [evidence],
};
async function mount(session = "first") {
  await act(async () =>
    root.render(createElement(ComparisonPanel, { key: session, sessionId: session })),
  );
}
async function change(selector: string, value: string) {
  await act(async () => {
    const element = container.querySelector(selector) as HTMLInputElement;
    const prototype =
      element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(async () =>
    container
      .querySelector(".comparison-cell form")!
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

it("preserves agent origin, exact quotations and selection identity across a lost-response retry", async () => {
  vi.mocked(apiGet).mockResolvedValue(data);
  vi.mocked(apiPost)
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({ comparison });
  await mount();
  expect(container.querySelector("blockquote")?.textContent).toBe("No increase at 5 mg.");
  expect(container.textContent).toContain("Imported review: unreviewed");
  await change(".comparison-cell textarea", "Updated proposal");
  expect(container.querySelector(".comparison-review fieldset")).toHaveProperty("disabled", true);
  await save();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Lost response");
  const first = vi.mocked(apiPost).mock.calls[0][1];
  expect(first).toMatchObject({
    expected_revision: "v1",
    payload: { origin: "agent", evidence: [{ note_id: "n1", revision: "old" }] },
  });
  await save();
  expect(vi.mocked(apiPost).mock.calls[1][1]).toEqual(first);
});

it("keeps replaced evidence explicit instead of selecting its new revision", async () => {
  vi.mocked(apiGet).mockResolvedValue({ ...data, evidence: [{ ...evidence, revision: "new" }] });
  await mount();
  expect(container.textContent).toContain("Previously selected evidence changed or disappeared");
  const choices = container.querySelectorAll('.comparison-cell form input[type="checkbox"]');
  expect(choices[0]).toHaveProperty("checked", true);
  expect(choices[1]).toHaveProperty("checked", false);
});

it("ignores an old session's delayed load", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiGet)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ comparisons: [] });
  await mount();
  await mount("second");
  await act(async () => resolve(data));
  expect(container.textContent).not.toContain("Proposed interpretation");
});

it("requires an explicit human attestation and blocks accepting an unsupported entry", async () => {
  vi.mocked(apiGet).mockResolvedValue({
    ...data,
    comparison: {
      ...comparison,
      cells: [{ ...comparison.cells[0], support_status: "unsupported" }],
    },
  });
  await mount();
  expect(container.querySelector('.comparison-review option[value="accepted"]')).toHaveProperty(
    "disabled",
    true,
  );
  expect(container.querySelector(".comparison-review button")).toHaveProperty("disabled", true);
  await act(async () =>
    container
      .querySelector(".comparison-review form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(apiPost).not.toHaveBeenCalled();
});
