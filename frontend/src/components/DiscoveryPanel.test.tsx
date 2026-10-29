/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, vi, expect } from "vitest";
import { apiGet, apiPost } from "../services/api";
import { DiscoveryPanel } from "./DiscoveryPanel";

vi.mock("../services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const refresh = vi.fn().mockResolvedValue(undefined);
const candidate = {
  id: "c1",
  title: "Frozen title",
  authors: ["A Researcher"],
  year: 2024,
  venue: "Journal",
  identifiers: { doi: "10.1234/example" },
  landing_url: "https://doi.org/10.1234/example",
  abstract: "Metadata, not read evidence.",
  pdf_sources: [{ url: "https://papers.example/source.pdf", source: "crossref_link" }],
};
const discovery = {
  id: "run",
  query: "conditions",
  provider: "crossref",
  retrieved_at: "2026-10-28",
  status: "complete",
  error: null,
  candidates: [candidate],
};
const listing = { discoveries: [discovery], selections: [], discovery };
async function mount(sessionId = "first") {
  await act(async () =>
    root.render(createElement(DiscoveryPanel, { key: sessionId, sessionId, refresh })),
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

it("does not select search results implicitly and preserves an exact selection across a lost response", async () => {
  vi.mocked(apiGet).mockResolvedValue(listing);
  await mount();
  expect(apiPost).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Abstract · metadata only");
  vi.mocked(apiPost)
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({ selection: { status: "added", paper_key: "p2" } });
  await click("Add selected PDF");
  const request = vi.mocked(apiPost).mock.calls[0][1];
  expect(request).toMatchObject({
    action: "discovery_select",
    discovery_id: "run",
    candidate_id: "c1",
    source: 1,
  });
  await click("Add selected PDF");
  expect(vi.mocked(apiPost).mock.calls[1][1]).toEqual(request);
  expect(refresh).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("p2: PDF added");
});

it("keeps missing full text explicit and requires a choice among multiple sources", async () => {
  vi.mocked(apiGet).mockResolvedValue({
    ...listing,
    discovery: {
      ...discovery,
      candidates: [
        { ...candidate, pdf_sources: [] },
        {
          ...candidate,
          id: "c2",
          pdf_sources: [
            ...candidate.pdf_sources,
            { url: "https://other.example/source.pdf", source: "crossref_link" },
          ],
        },
      ],
    },
  });
  await mount();
  expect(container.textContent).toContain("No downloadable PDF reported");
  expect(
    [...container.querySelectorAll("button")].find((b) => b.textContent === "Add selected PDF"),
  ).toHaveProperty("disabled", true);
  await click("Keep reference without PDF");
  expect(apiPost).toHaveBeenCalledWith(
    "/api/workflow",
    expect.objectContaining({ candidate_id: "c1", action: "discovery_select" }),
  );
});

it("discards another session's pending candidate list", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(apiGet)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ discoveries: [], selections: [] });
  await mount();
  await mount("second");
  await act(async () => resolve(listing));
  expect(container.textContent).not.toContain("Frozen title");
});

it("shows the retained provider translation and warnings without changing the query", async () => {
  vi.mocked(apiGet).mockResolvedValue({
    ...listing,
    discovery: {
      ...discovery,
      provider: "pubmed",
      details: {
        total: 917,
        query_translation: '"single person"[MeSH Terms] AND "DNA replication"[MeSH Terms]',
        warnings: { quotedphrasesnotfound: ["biological replicates"] },
      },
    },
  });
  await mount();
  expect(container.textContent).toContain("Showing 1 of 917 results in provider order.");
  expect(container.textContent).toContain('"DNA replication"[MeSH Terms]');
  expect(container.textContent).toContain("biological replicates");
  expect(apiPost).not.toHaveBeenCalled();
});
