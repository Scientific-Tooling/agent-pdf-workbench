/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "../services/api";
import { upsertProgress } from "../services/storage";
import type { PaperSession } from "../types/types";
import { usePaperSession } from "./usePaperSession";

vi.mock("../services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let model: ReturnType<typeof usePaperSession>;
let params: Parameters<typeof usePaperSession>[0];
const paper = (id: string): PaperSession => ({
  id,
  paper_ref: id,
  pdf_uri: `/${id}.pdf`,
  agent_id: "test",
  user_id: "test",
  metadata: {},
  opened_at: "now",
  closed_at: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness() {
  model = usePaperSession(params);
  return null;
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  params = {
    sessionRef: { current: null },
    openDocument: vi.fn().mockResolvedValue(undefined),
    loadWorkspaceFor: vi.fn().mockResolvedValue(undefined),
    focusPassage: vi.fn(),
    resetViewer: vi.fn(),
    clearSearch: vi.fn(),
    clearWorkspaceData: vi.fn(),
    prepareForPaper: vi.fn(),
    setStatus: vi.fn(),
    showToast: vi.fn(),
    onError: vi.fn(),
  };
  vi.mocked(apiGet).mockImplementation(async (path) =>
    paper(new URL(path, "http://localhost").searchParams.get("session_id")!),
  );
  await act(async () => {
    root.render(createElement(Harness));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("switches between hosted sessions without closing them, retaining view mode and restoring each page", async () => {
  upsertProgress({
    paperRef: "second",
    pdfUri: "/second.pdf",
    sessionId: "second",
    lastPage: 7,
    zoom: 0.8,
    zoomMode: "fit",
    updatedAt: "now",
  });
  await act(async () => model.switchSession("first"));
  await act(async () => model.switchSession("second"));
  expect(params.openDocument).toHaveBeenLastCalledWith(
    expect.objectContaining({ sessionId: "second", page: 7, zoom: undefined, preserveView: true }),
  );
  expect(window.location.search).toBe("?session_id=second");
  await act(async () => model.switchSession("first"));
  expect(model.session?.id).toBe("first");
  expect(params.resetViewer).not.toHaveBeenCalled();
  expect(apiPost).not.toHaveBeenCalled();
  expect(params.prepareForPaper).toHaveBeenCalledTimes(3);
});

it("ignores a superseded session lookup, including a click back to the currently displayed paper", async () => {
  await act(async () => model.switchSession("first"));
  const old = deferred<PaperSession>();
  vi.mocked(apiGet).mockImplementation((path) =>
    path.includes("second") ? old.promise : Promise.resolve(paper("first")),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = model.switchSession("second");
  });
  expect(model.switching).toBe(true);
  await act(async () => model.switchSession("first"));
  await act(async () => {
    old.resolve(paper("second"));
    await pending;
  });
  expect(model.session?.id).toBe("first");
  expect(model.switching).toBe(false);
  expect(params.openDocument).not.toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "second" }),
  );
});

it("does not restore an earlier paper's workspace after a slow render finishes", async () => {
  await act(async () => model.switchSession("first"));
  const slow = deferred<void>();
  vi.mocked(params.openDocument).mockImplementation((doc) =>
    doc.sessionId === "second" ? slow.promise : Promise.resolve(),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = model.switchSession("second");
  });
  await act(async () => model.switchSession("third"));
  await act(async () => {
    slow.resolve();
    await pending;
  });
  expect(params.loadWorkspaceFor).not.toHaveBeenCalledWith("second");
  expect(model.session?.id).toBe("third");
  expect(window.location.search).toBe("?session_id=third");
});

it("restores history inside the app and retains the current paper on a failed lookup", async () => {
  await act(async () => model.switchSession("first"));
  await act(async () => model.switchSession("second"));
  await act(async () => {
    window.history.replaceState({}, "", "/?session_id=first");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(model.session?.id).toBe("first");
  vi.mocked(apiGet).mockRejectedValue(new Error("Unavailable"));
  await act(async () => {
    await expect(model.switchSession("second")).rejects.toThrow("Unavailable");
  });
  expect(model.session?.id).toBe("first");
  expect(model.switching).toBe(false);
  expect(apiPost).not.toHaveBeenCalled();
});

it("clears a failed PDF without closing a project-owned session", async () => {
  await act(async () => model.switchSession("first"));
  vi.mocked(params.openDocument).mockRejectedValue(new Error("PDF unavailable"));
  await act(async () => {
    await expect(model.switchSession("second")).rejects.toThrow("PDF unavailable");
  });
  expect(model.session).toBeNull();
  expect(model.switching).toBe(false);
  expect(params.resetViewer).toHaveBeenCalledOnce();
  expect(apiPost).not.toHaveBeenCalled();
});

it("keeps the verified document and citation URL when its quote cannot be located", async () => {
  const failure = new Error("Cited quote is missing or ambiguous on this page");
  vi.mocked(params.focusPassage).mockRejectedValue(failure);
  vi.mocked(apiGet).mockResolvedValue({
    session: paper("cited"),
    document_sha256: "a".repeat(64),
    annotation: { page: 3, quote: "missing" },
  });
  const query = `?session_id=cited&document_sha256=${"a".repeat(64)}&annotation_id=ann_1&page=3&passage_sha256=${"b".repeat(64)}`;
  await act(async () => {
    window.history.replaceState({}, "", `/${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(model.session?.id).toBe("cited");
  expect(model.switching).toBe(false);
  expect(params.openDocument).toHaveBeenCalledWith(
    expect.objectContaining({ page: 3, expectedSha256: "a".repeat(64) }),
  );
  expect(params.loadWorkspaceFor).toHaveBeenCalledWith("cited");
  expect(params.resetViewer).not.toHaveBeenCalled();
  expect(apiPost).not.toHaveBeenCalled();
  expect(params.onError).toHaveBeenCalledWith(failure, expect.any(String));
  expect(window.location.search).toBe(query);
  expect(params.setStatus).not.toHaveBeenCalledWith("passage ready — page 3");
});

it("ignores a failed lookup belonging to a superseded switch", async () => {
  let reject!: (error: Error) => void;
  const old = new Promise<PaperSession>((_, fail) => {
    reject = fail;
  });
  vi.mocked(apiGet).mockImplementation((path) =>
    path.includes("first") ? old : Promise.resolve(paper("second")),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = model.switchSession("first");
  });
  await act(async () => model.switchSession("second"));
  await act(async () => {
    reject(new Error("Old request failed"));
    await pending;
  });
  expect(model.session?.id).toBe("second");
  expect(model.switching).toBe(false);
  expect(params.onError).not.toHaveBeenCalled();
});
