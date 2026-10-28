/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiPost } from "../services/api";
import type { Annotation, PaperSession } from "../types/types";
import { useWorkspaceCommands } from "./useWorkspaceCommands";
import { useWorkspaceData } from "./useWorkspaceData";

vi.mock("../services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let data: ReturnType<typeof useWorkspaceData>;
let commands: ReturnType<typeof useWorkspaceCommands>;
let sessionRef: { current: PaperSession | null };
const recordAction = vi.fn().mockResolvedValue(null);
const showToast = vi.fn();
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
const annotation = (id: string): Annotation => ({
  id,
  page: 1,
  type: "highlight",
  quote: `Quote for ${id}`,
  anchor: null,
  comment: `Comment for ${id}`,
  tags: [],
  rects: [],
  createdAt: "now",
  updatedAt: "now",
});
function Harness() {
  data = useWorkspaceData({ sessionRef, onError: vi.fn() });
  commands = useWorkspaceCommands({
    sessionRef,
    pageRef: { current: 1 },
    annotations: data.annotations,
    selectedAnnotation:
      data.annotations.find((item) => item.id === data.selectedAnnotationId) ?? null,
    selectedNote: null,
    setSelectedAnnotationId: data.setSelectedAnnotationId,
    setSelectedNoteId: data.setSelectedNoteId,
    upsertAnnotation: data.upsertAnnotation,
    deleteAnnotationLocally: data.deleteAnnotation,
    upsertNote: data.upsertNote,
    deleteNoteLocally: data.deleteNote,
    recordAction,
    getSelectionRectsAndQuote: () => null,
    renderPage: vi.fn(),
    onHideQuickAnnotator: vi.fn(),
    showToast,
  });
  return null;
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  sessionRef = { current: paper("original") };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    data.setAnnotations([annotation("first"), annotation("second")]);
    data.setSelectedAnnotationId("first");
  });
  await act(async () => commands.setAnnotationCommentInput("Edited first comment"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function beginDelayedSave() {
  let release!: () => void;
  const saved = { ...annotation("first"), comment: "Edited first comment" };
  vi.mocked(apiPost).mockImplementationOnce(
    () => new Promise((resolve) => (release = () => resolve({ annotation: saved }))),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = commands.updateSelectedAnnotationMeta();
  });
  return { release, pending };
}

it("a delayed metadata save preserves the newly selected highlight and its editor", async () => {
  const save = await beginDelayedSave();
  await act(async () => data.setSelectedAnnotationId("second"));
  await act(async () => {
    save.release();
    await save.pending;
  });
  expect(data.annotations.find((item) => item.id === "first")?.comment).toBe(
    "Edited first comment",
  );
  expect(data.selectedAnnotationId).toBe("second");
  expect(commands.annotationCommentInput).toBe("Comment for second");
});

it("a delayed metadata save stays with its original paper after switching", async () => {
  const save = await beginDelayedSave();
  await act(async () => {
    sessionRef.current = paper("next");
    data.clearWorkspaceData();
  });
  await act(async () => {
    save.release();
    await save.pending;
  });
  expect(data.annotations).toEqual([]);
  expect(data.selectedAnnotationId).toBeNull();
  expect(commands.annotationCommentInput).toBe("");
  expect(recordAction.mock.calls.every((call) => call[4] === "original")).toBe(true);
  expect(recordAction).toHaveBeenCalledTimes(2);
  expect(showToast).not.toHaveBeenCalled();
});
