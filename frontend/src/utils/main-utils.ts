export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseLinkedIds(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function paperRefFromUri(uri: string): string {
  // Mirrors the agent skill's rule: with no paper_ref given, name the paper
  // after the file so a deep-linked PDF still gets a stable identifier.
  const withoutQuery = uri.split(/[?#]/)[0];
  const base = withoutQuery.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.pdf$/i, "").trim();
  return stem || "untitled-paper";
}

export function fileNameOf(uri: string): string {
  // Sidebar rows show the file, not the six lines of absolute path it sits under.
  const withoutQuery = uri.split(/[?#]/)[0];
  return withoutQuery.split(/[\\/]/).pop() || uri;
}
