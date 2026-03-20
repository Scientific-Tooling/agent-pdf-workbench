import { getProgress } from "./storage";
import { nowIso } from "../utils/main-utils";
import type { Annotation, Note, PaperSession } from "../types/types";

function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface ExportState {
  paperRef: string;
  pdfUri: string;
  session: PaperSession | null;
  annotations: Annotation[];
  notes: Note[];
  searchQuery: string;
}

export function exportJson(state: ExportState): void {
  const payload = {
    exported_at: nowIso(),
    paper_ref: state.paperRef,
    pdf_uri: state.pdfUri,
    session: state.session,
    annotations: state.annotations,
    notes: state.notes,
    search_query: state.searchQuery,
    progress: getProgress(state.paperRef),
  };
  downloadFile(
    `${state.paperRef || "paper"}-reading-data.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
}

export function exportMarkdown(state: ExportState): void {
  const lines: string[] = [];
  lines.push(`# Reading Notes: ${state.paperRef || "Unknown Paper"}`);
  lines.push("");
  lines.push(`- PDF URI: ${state.pdfUri || "-"}`);
  lines.push(`- Session: ${state.session?.id ?? "-"}`);
  lines.push(`- Exported At: ${nowIso()}`);
  lines.push("");
  lines.push("## Annotations");
  lines.push("");

  if (state.annotations.length === 0) {
    lines.push("_No annotations_");
  } else {
    const sorted = state.annotations.slice().sort((a, b) => a.page - b.page);
    for (const annotation of sorted) {
      lines.push(`### ${annotation.id} (p.${annotation.page}, ${annotation.type})`);
      if (annotation.tags.length > 0) {
        lines.push(`Tags: ${annotation.tags.join(", ")}`);
      }
      lines.push(`> ${annotation.quote}`);
      lines.push(annotation.comment ? `Comment: ${annotation.comment}` : "Comment: -");
      lines.push("");
    }
  }

  lines.push("## Notes");
  lines.push("");
  if (state.notes.length === 0) {
    lines.push("_No notes_");
  } else {
    for (const note of state.notes) {
      lines.push(`### ${note.title || note.id}`);
      if (note.linkedAnnotationIds.length > 0) {
        lines.push(`Linked annotations: ${note.linkedAnnotationIds.join(", ")}`);
      }
      lines.push("");
      lines.push(note.markdown || "_(empty)_");
      lines.push("");
    }
  }

  downloadFile(`${state.paperRef || "paper"}-reading-notes.md`, lines.join("\n"), "text/markdown");
}
