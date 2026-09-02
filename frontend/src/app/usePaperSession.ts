import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { apiGet, apiPost } from "../services/api";
import { getProgress, getRecentPapers } from "../services/storage";
import type { PaperSession, RecentPaper } from "../types/types";
import { paperRefFromUri } from "../utils/main-utils";
import { DEFAULT_AGENT_ID, DEFAULT_USER_ID } from "./app-types";
import type { ToastType } from "./app-types";
import type { OpenDocument } from "./usePdfReader";

interface PaperSessionParams {
  sessionRef: MutableRefObject<PaperSession | null>;
  /** Put a document on screen. */
  openDocument: (params: OpenDocument & { page: number; zoom?: number }) => Promise<void>;
  /** Load the session's events and the paper's annotations and notes. */
  loadWorkspaceFor: (sessionId: string) => Promise<void>;
  /**
   * Clear everything except the paper identity: reader, search, workspace and
   * form state. Identity is this hook's own business, which keeps the
   * dependency one-way.
   */
  resetViewer: () => void;
  clearSearch: () => void;
  clearWorkspaceData: () => void;
  setStatus: (message: string) => void;
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
  onError: (error: unknown, fallback?: string) => void;
}

/**
 * Which paper the viewer is holding, and how it gets there.
 *
 * Three ways in — the open form, a `?session_id=` link, a `?pdf_uri=` link —
 * and they all converge on `enterSession`, so none of them can quietly stop
 * clearing search or loading annotations the way the others do.
 */
export function usePaperSession(params: PaperSessionParams) {
  const {
    sessionRef,
    openDocument,
    loadWorkspaceFor,
    resetViewer,
    clearSearch,
    clearWorkspaceData,
    setStatus,
    showToast,
    onError,
  } = params;

  const [session, setSession] = useState<PaperSession | null>(null);
  const [paperRef, setPaperRef] = useState("p_demo_001");
  const [pdfUri, setPdfUri] = useState("/tmp/paper.pdf");
  const [recentPapers, setRecentPapersState] = useState<RecentPaper[]>(() => getRecentPapers());

  function refreshRecentPapers(): void {
    setRecentPapersState(getRecentPapers());
  }

  function clearPaperIdentity(): void {
    setSession(null);
    sessionRef.current = null;
    setPaperRef("");
    setPdfUri("");
  }

  function resetToEmptyViewer(): void {
    clearPaperIdentity();
    resetViewer();
  }

  async function leaveCurrentSession(): Promise<void> {
    const sid = sessionRef.current?.id;
    if (!sid) {
      return;
    }
    await apiPost("/api/close-paper", { session_id: sid });
    resetToEmptyViewer();
    rememberSessionInUrl(null);
  }

  async function closeSession(): Promise<void> {
    if (!sessionRef.current) {
      return;
    }
    await leaveCurrentSession();
    setStatus("session closed");
    showToast("Session closed", "success");
  }

  /**
   * Everything both entry paths do once a session exists.
   *
   * Opening a paper and attaching to an existing session differ only in how
   * the session is obtained; keeping the tail in one place is what stops them
   * from drifting apart.
   */
  async function enterSession(
    target: PaperSession,
    options: { preferredPage?: number } = {},
  ): Promise<void> {
    setSession(target);
    sessionRef.current = target;
    setPaperRef(target.paper_ref);
    setPdfUri(target.pdf_uri);
    clearSearch();
    clearWorkspaceData();

    const progress = getProgress(target.paper_ref);
    await openDocument({
      paperRef: target.paper_ref,
      pdfUri: target.pdf_uri,
      page: options.preferredPage ?? progress?.lastPage ?? 1,
      // No saved zoom means no decision to honour, so the page fits the width
      // it actually has instead of a hard-coded 135%.
      zoom: progress?.zoom,
      sessionId: target.id,
    });
    await loadWorkspaceFor(target.id);
    refreshRecentPapers();
    rememberSessionInUrl(target.id);
    setStatus("session ready");
  }

  async function openPaperWithInputs(
    paperRefValue: string,
    pdfUriValue: string,
    options: { preferredPage?: number } = {},
  ): Promise<void> {
    await leaveCurrentSession();

    setStatus("opening session...");
    const openedSession = await apiPost<PaperSession>("/api/open-paper", {
      paper_ref: paperRefValue,
      pdf_uri: pdfUriValue,
      agent_id: DEFAULT_AGENT_ID,
      user_id: DEFAULT_USER_ID,
    });

    try {
      await enterSession(openedSession, options);
      showToast("Session opened", "success");
    } catch (error) {
      // Roll back the session this call created; a session nobody can read is
      // worse than none.
      try {
        await apiPost("/api/close-paper", { session_id: openedSession.id });
      } catch {
        // Keep original open error as primary signal.
      }
      resetToEmptyViewer();
      throw error;
    }
  }

  function rememberSessionInUrl(sessionId: string | null): void {
    // Keeping the id in the URL means a reload — or a link an agent hands the
    // reader — lands back in the same session instead of starting a new one.
    const url = new URL(window.location.href);
    if (sessionId) {
      url.searchParams.set("session_id", sessionId);
    } else {
      url.searchParams.delete("session_id");
    }
    url.searchParams.delete("paper_ref");
    url.searchParams.delete("pdf_uri");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function attachToSession(sessionId: string): Promise<void> {
    if (sessionRef.current?.id === sessionId) {
      return;
    }
    const attached = await apiGet<PaperSession>(
      `/api/session?session_id=${encodeURIComponent(sessionId)}`,
    );

    if (attached.closed_at) {
      setPaperRef(attached.paper_ref);
      setPdfUri(attached.pdf_uri);
      setStatus("That session is closed. Open the paper again to keep reading.");
      showToast("Session already closed", "warning");
      rememberSessionInUrl(null);
      return;
    }

    // The viewer is leaving whatever it held, so close it rather than orphan it.
    await leaveCurrentSession();
    setStatus("attaching to session...");
    await enterSession(attached);
    showToast("Attached to existing session", "success");
  }

  async function openPaper(): Promise<void> {
    const ref = paperRef.trim();
    const uri = pdfUri.trim();
    if (!ref || !uri) {
      setStatus("paper_ref and pdf_uri are required");
      return;
    }
    await openPaperWithInputs(ref, uri);
  }

  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const requestedSessionId = params.get("session_id");
    const requestedPdfUri = params.get("pdf_uri");
    const requestedPaperRef = params.get("paper_ref");
    if (!requestedSessionId && !requestedPdfUri) {
      return;
    }

    void (async () => {
      try {
        if (requestedSessionId) {
          await attachToSession(requestedSessionId);
          return;
        }
        if (requestedPdfUri) {
          await openPaperWithInputs(
            requestedPaperRef?.trim() || paperRefFromUri(requestedPdfUri),
            requestedPdfUri,
          );
        }
      } catch (error) {
        onError(error, "Could not open the requested session");
      }
    })();
    // Deep links are read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    session,
    paperRef,
    setPaperRef,
    pdfUri,
    setPdfUri,
    recentPapers,
    refreshRecentPapers,
    clearPaperIdentity,
    openPaper,
    openPaperWithInputs,
    closeSession,
    rememberSessionInUrl,
  };
}
