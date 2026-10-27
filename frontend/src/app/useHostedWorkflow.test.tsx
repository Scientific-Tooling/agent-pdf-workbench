/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "../services/api";
import { useHostedWorkflow, type HostedWorkflow } from "./useHostedWorkflow";

vi.mock("../services/api", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let model: HostedWorkflow;
function Harness({ session }: { session: string }) {
  model = useHostedWorkflow(session);
  return null;
}
const status = (title: string) => ({ enabled: true, title, preview: null, brief: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(session: string) {
  await act(async () => {
    root.render(createElement(Harness, { session }));
  });
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

describe("hosted workflow request ownership", () => {
  it("keeps the server's conflict explanation when an import is rejected", async () => {
    vi.mocked(apiGet).mockResolvedValue(status("Paper"));
    const result = { conflicts: [{ reason: "revision_changed", id: "one" }] };
    vi.mocked(apiPost).mockResolvedValue({ applied: false, result });
    await mount("paper");
    await act(async () => model.run("apply"));
    expect(model.error).toBe(true);
    expect(model.operationDetails).toEqual(result);
    expect(model.message).toContain("Import was not applied");
  });

  it("ignores an earlier paper's delayed status after switching sessions", async () => {
    const old = deferred<unknown>();
    vi.mocked(apiGet).mockImplementation((path) =>
      path.includes("first") ? old.promise : Promise.resolve(status("Second paper")),
    );
    await mount("first");
    await mount("second");
    await act(async () => old.resolve(status("First paper")));
    expect(model.data?.title).toBe("Second paper");
    expect(model.sessionId).toBe("second");
  });

  it("never applies a delayed preview to a newly opened paper", async () => {
    const old = deferred<unknown>();
    vi.mocked(apiGet).mockResolvedValue(status("First paper"));
    vi.mocked(apiPost).mockReturnValue(old.promise);
    await mount("first");
    await act(async () => model.toggle("annotation:one"));
    let pending!: Promise<void>;
    await act(async () => {
      pending = model.run("preview");
    });
    expect(vi.mocked(apiPost).mock.calls[0][1]).toMatchObject({
      session_id: "first",
      annotation_ids: ["one"],
    });
    vi.mocked(apiGet).mockResolvedValue(status("Second paper"));
    await mount("second");
    await act(async () => {
      old.resolve({ preview: { id: "old-preview" } });
      await pending;
    });
    expect(model.preview).toBeNull();
    expect(model.selected).toEqual([]);
    expect(model.data?.title).toBe("Second paper");
    expect(model.busy).toBe(false);
  });

  it("submits a double-click only once and keeps failures retryable", async () => {
    const request = deferred<unknown>();
    vi.mocked(apiGet).mockResolvedValue(status("Paper"));
    vi.mocked(apiPost).mockReturnValue(request.promise);
    await mount("paper");
    await act(async () => model.toggle("note:one"));
    let pending!: Promise<void>;
    await act(async () => {
      pending = model.run("preview");
      void model.run("preview");
    });
    expect(apiPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve({ preview: null });
      await pending;
    });
    vi.mocked(apiPost).mockRejectedValue(new Error("Source changed"));
    await act(async () => model.run("preview"));
    expect(model.message).toBe("Source changed");
    expect(model.error).toBe(true);
    expect(model.busy).toBe(false);
    expect(model.selected).toEqual(["note:one"]);
  });
});
