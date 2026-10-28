/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, vi, expect } from "vitest";
import { apiGet, apiPost } from "../services/api";
import { ProjectHistoryPanel } from "./ProjectHistoryPanel";

vi.mock("../services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const refresh = vi.fn().mockResolvedValue(undefined);
const update = {
  freshness: "outdated",
  checked_at: "2026-10-28T12:00:00Z",
  baseline_id: "edition",
  changes: [
    {
      category: "evidence",
      id: "note",
      change: "changed",
      before: { title: "Before" },
      after: { title: "After" },
    },
  ],
  attention: [
    {
      kind: "interpretation",
      id: "comparison",
      paper: "p1",
      message: "Support: stale; review: stale.",
    },
  ],
  history: {
    editions: [{ id: "edition", created_at: "2026-10-28T11:00:00Z" }],
    pending_briefs: ["pending"],
    legacy_briefs: [],
  },
};
async function mount(sessionId = "first") {
  await act(async () =>
    root.render(createElement(ProjectHistoryPanel, { key: sessionId, sessionId, refresh })),
  );
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  )!;
  await act(async () => button.click());
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("checks freshness without writes and resumes the exact interrupted edition", async () => {
  vi.mocked(apiGet).mockResolvedValue(update);
  await mount();
  expect(apiPost).not.toHaveBeenCalled();
  expect(container.textContent).toContain("saved brief is outdated");
  expect(container.textContent).toContain("review: stale");
  vi.mocked(apiPost).mockResolvedValue({});
  await click("Resume this brief");
  expect(apiPost).toHaveBeenCalledWith("/api/workflow", {
    action: "brief",
    session_id: "first",
    request_id: "pending",
  });
  expect(refresh).toHaveBeenCalledOnce();
});
it("removes a previously current label when a new check fails", async () => {
  vi.mocked(apiGet).mockResolvedValue({ ...update, freshness: "current" });
  await mount();
  expect(container.textContent).toContain("Brief matches the project");
  vi.mocked(apiGet).mockRejectedValueOnce(new Error("Missing source database"));
  await click("Check changes");
  expect(container.textContent).not.toContain("Brief matches the project");
  expect(container.textContent).toContain("Freshness could not be verified");
});
it("ignores an earlier paper's delayed history response", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiGet)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue({ ...update, attention: [], changes: [] });
  await mount();
  await mount("second");
  await act(async () => resolve(update));
  expect(container.textContent).toContain("0 changes · 0 items need attention");
  expect(container.textContent).not.toContain("review: stale");
});

it("keeps the history disclosure mounted while an older edition loads", async () => {
  vi.mocked(apiGet).mockResolvedValue(update);
  await mount();
  const select = container.querySelector<HTMLSelectElement>("select")!;
  const disclosure = select.closest("details")!;
  disclosure.open = true;
  let resolve!: (value: unknown) => void;
  vi.mocked(apiGet).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => {
    select.value = "edition";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(disclosure.isConnected).toBe(true);
  expect(disclosure.open).toBe(true);
  await act(async () =>
    resolve({
      id: "edition",
      created_at: "2026-10-28T11:00:00Z",
      text: "Earlier original finding",
    }),
  );
  expect(disclosure.open).toBe(true);
  expect(disclosure.textContent).toContain("Earlier original finding");
});
