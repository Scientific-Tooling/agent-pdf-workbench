import type { Annotation, PaperSession } from "../types/types";

export interface PassageResponse {
  schema: "apw.passage.v1";
  session: PaperSession;
  annotation: Annotation;
  document_sha256: string;
  passage_sha256: string;
}

export function passageQuery(params: URLSearchParams): URLSearchParams | null {
  const fields = ["document_sha256", "annotation_id", "page", "passage_sha256"];
  if (!fields.some((key) => params.has(key))) return null;
  if (!params.get("session_id") || fields.some((key) => !params.get(key))) {
    throw new Error("Incomplete passage link. Regenerate it from the imported evidence.");
  }
  for (const key of ["document_sha256", "passage_sha256"]) {
    if (!/^[a-f0-9]{64}$/.test(params.get(key)!)) {
      throw new Error("Invalid passage hash. Regenerate the citation link.");
    }
  }
  const page = params.get("page")!;
  if (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page))) {
    throw new Error("Citation page must be a positive integer. Regenerate the link.");
  }
  const query = new URLSearchParams();
  for (const key of ["session_id", ...fields]) query.set(key, params.get(key)!);
  return query;
}

export function clearPassageQuery(params: URLSearchParams): void {
  for (const key of ["document_sha256", "annotation_id", "page", "passage_sha256"])
    params.delete(key);
}
